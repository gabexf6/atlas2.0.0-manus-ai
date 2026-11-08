import { getRecipeState, updateRecipeState } from "../utils/database.js";
import { getRecipe, listAllRecipeUrls, listLatestRecipeUrls } from "./tudodelicious.js";
import { sendRecipe } from "./recipeSender.js";
import { errorLog, infoLog } from "../utils/logger.js";

const INTERVALO_ALEATORIA_MS = 3 * 60 * 60 * 1000; // uma receita aleatória a cada 3 horas
const INTERVALO_NOVAS_MS = 15 * 60 * 1000; // olha se saiu receita nova a cada 15 min
const ESPERA_SE_FALHAR_MS = 10 * 60 * 1000; // site fora do ar: tenta de novo em 10 min
const TICK_MS = 60 * 1000;
const MAX_RECENTES = 50; // não repete nenhuma das últimas 50 enviadas
const MAX_VISTAS = 3000;
const MAX_NOVAS_POR_VEZ = 3;
const NOVA_ATE_DIAS = 7; // receita "nova" publicada há mais que isso é ignorada

let rodando = false;
let proximaChecagemNovas = 0;
let proximaTentativaAleatoria = 0;

export function addRecipeGroup(jid) {
  const { grupos } = getRecipeState();
  if (grupos.includes(jid)) return false;
  updateRecipeState({ grupos: [...grupos, jid] });
  return true;
}

export function removeRecipeGroup(jid) {
  const { grupos } = getRecipeState();
  if (!grupos.includes(jid)) return false;
  updateRecipeState({ grupos: grupos.filter((g) => g !== jid) });
  return true;
}

export function listRecipeGroups() {
  return getRecipeState().grupos;
}

function lembrarEnviada(url) {
  const { recentes } = getRecipeState();
  updateRecipeState({ recentes: [...recentes.filter((u) => u !== url), url].slice(-MAX_RECENTES) });
}

async function enviarPara(socket, destinos, recipe, header) {
  for (const jid of destinos) {
    try {
      await sendRecipe(socket, jid, recipe, { header });
    } catch (error) {
      errorLog(`[Receitas] Falha ao enviar pra ${jid}: ${error.message}`);
    }
  }
}

// Sorteia uma receita do site (evitando as últimas enviadas) e manda.
// Sem "destinos", manda pra todos os grupos cadastrados e conta como a
// receita da hora.
export async function sendRandomRecipe(socket, destinos = null) {
  const urls = await listAllRecipeUrls();
  if (!urls.length) throw new Error("não consegui listar as receitas do site");

  const recentes = new Set(getRecipeState().recentes);
  const naoRepetidas = urls.filter((u) => !recentes.has(u));
  const pool = [...(naoRepetidas.length ? naoRepetidas : urls)];

  let ultimoErro;
  for (let tentativa = 0; tentativa < 3 && pool.length; tentativa++) {
    const url = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    try {
      const recipe = await getRecipe(url);
      if (!recipe.title) throw new Error("receita sem título");
      await enviarPara(socket, destinos || getRecipeState().grupos, recipe, "🍳 *Receita da hora*");
      lembrarEnviada(url);
      if (!destinos) updateRecipeState({ ultimoEnvio: Date.now() });
      infoLog(`[Receitas] Receita da hora enviada: ${recipe.title}`);
      return recipe;
    } catch (error) {
      ultimoErro = error;
    }
  }
  throw ultimoErro || new Error("não consegui carregar nenhuma receita");
}

// Compara as receitas mais recentes do site com as já conhecidas e manda
// as novas. Na primeira vez só memoriza o que já existe (pra não mandar o
// site inteiro como "novo").
async function checkNewRecipes(socket) {
  const latest = await listLatestRecipeUrls();
  if (!latest.length) return;

  const state = getRecipeState();
  if (!state.vistas.length) {
    updateRecipeState({ vistas: latest });
    infoLog(`[Receitas] Primeira checagem: ${latest.length} receitas marcadas como já existentes.`);
    return;
  }

  const vistas = new Set(state.vistas);
  const novas = latest.filter((u) => !vistas.has(u));
  if (!novas.length) return;

  // Marca como vistas antes de enviar, pra nunca mandar a mesma duas vezes
  updateRecipeState({ vistas: [...novas, ...state.vistas].slice(0, MAX_VISTAS) });

  if (novas.length > MAX_NOVAS_POR_VEZ) {
    // Muitas "novas" de uma vez = a lista do site mudou de formato ou fonte,
    // não é o seu amigo postando 10 receitas no mesmo minuto.
    infoLog(`[Receitas] ${novas.length} receitas desconhecidas de uma vez — só registrei, não enviei.`);
    return;
  }

  for (const url of novas) {
    try {
      const recipe = await getRecipe(url);
      const publicada = Date.parse(recipe.datePublished || "");
      if (!Number.isNaN(publicada) && Date.now() - publicada > NOVA_ATE_DIAS * 24 * 60 * 60 * 1000) {
        infoLog(`[Receitas] "${recipe.title}" apareceu agora mas é antiga — não enviei como nova.`);
        continue;
      }
      await enviarPara(socket, getRecipeState().grupos, recipe, "🆕 *Receita nova no site!*");
      lembrarEnviada(url);
      infoLog(`[Receitas] Receita nova enviada: ${recipe.title}`);
    } catch (error) {
      errorLog(`[Receitas] Falha ao carregar receita nova ${url}: ${error.message}`);
    }
  }
}

async function tick(socket) {
  if (rodando) return;
  const { grupos, ultimoEnvio } = getRecipeState();
  if (!grupos.length) return;

  rodando = true;
  try {
    const agora = Date.now();

    if (agora >= proximaChecagemNovas) {
      proximaChecagemNovas = agora + INTERVALO_NOVAS_MS;
      await checkNewRecipes(socket).catch((error) =>
        errorLog(`[Receitas] Erro ao checar receitas novas: ${error.message}`),
      );
    }

    if (agora - (ultimoEnvio || 0) >= INTERVALO_ALEATORIA_MS && agora >= proximaTentativaAleatoria) {
      try {
        await sendRandomRecipe(socket);
      } catch (error) {
        proximaTentativaAleatoria = Date.now() + ESPERA_SE_FALHAR_MS;
        errorLog(`[Receitas] Erro na receita da hora (tento de novo em 10 min): ${error.message}`);
      }
    }
  } finally {
    rodando = false;
  }
}

export function startRecipeBroadcaster(socket) {
  const timer = setInterval(() => {
    tick(socket).catch((error) => errorLog(`[Receitas] Erro no agendador: ${error.message}`));
  }, TICK_MS);
  timer.unref?.();
}