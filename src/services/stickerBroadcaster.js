import { getStickerState, updateStickerState } from "../utils/database.js";
import {
  listStickerlyCatalog,
  searchStickerlyPacks,
  resolveStickerlyPack,
  fetchStickerlyStickerBuffer,
  convertStickerlyBufferToStickerBuffer,
} from "./stickerlyApi.js";
import { buildStickerPackContent } from "./stickerPack.js";
import { errorLog, infoLog } from "../utils/logger.js";

const INTERVALO_MS = 45 * 60 * 1000;
const ESPERA_SE_FALHAR_MS = 5 * 60 * 1000;
const TICK_MS = 60 * 1000;
const MAX_RECENTES = 100;
const MIN_FIGURINHAS = 3;

const TEMAS_BR = [
  "meme br engraçado", "tiozão", "chaves", "bolo de pote meme", "frases engraçadas", "memes brasileiros",
  "flamengo", "corinthians", "palmeiras", "sao paulo", "santos", "fluminense", "vasco da gama", "botafogo",
  "gremio", "internacional", "atletico-mg", "cruzeiro", "bahia", "athletico-pr", "fortaleza", "red bull bragantino",
  "vitoria", "cuiaba", "atletico-go", "juventude", "criciuma", "coritiba", "goias", "america-mg", "sport",
  "ceara", "avai", "chapecoense", "guarani", "ponte preta", "mirassol", "novorizontino", "operario-pr", "crb",
  "paysandu", "brusque", "ituano", "amazonas", "vila nova", "risada", "deboche", "malhação", "novelas",
  "meme de áudio", "meme de legenda", "meme de reação", "shitpost", "zoeira", "sarcasmo", "ironia",
  "vergonha alheia", "fail", "react", "treta", "exposed", "fofoca", "fofoca de famosos", "piada de tiozão",
  "tia do zap", "grupo da família", "áudio de WhatsApp", "print de Twitter", "trend do TikTok", "dancinha",
  "áudio viral", "corte de podcast", "live", "vídeo de gato", "vídeo de cachorro", "pet meme", "meme de segunda-feira",
  "meme de trabalho", "meme de faculdade", "meme de escola", "meme de trânsito", "meme de fila", "meme de mãe",
  "meme de pai", "meme de sogra", "meme de vizinho", "meme de casal", "meme de solteiro", "meme de rico vs pobre",
  "expectativa vs realidade", "POV", "meme de texto", "meme de imagem", "meme de vídeo", "meme de choro",
  "meme de raiva", "meme de sono", "meme de fome", "meme de preguiça", "seleção brasileira", "copa do mundo",
  "libertadores", "brasileirão", "série A", "série B", "série C", "série D", "copa do Brasil", "arbitragem",
  "VAR", "torcida", "estádio", "clássico", "Fla-Flu", "Derby", "Majestoso", "Gre-Nal", "Atle-Tiba", "Ba-Vi",
  "técnico", "jogador", "craque", "gol", "frases de jogador", "coletiva", "meme de técnico", "meme de torcedor",
  "meme de juiz", "meme de VAR", "camisa", "escudo", "hino", "mascote", "rebaixamento", "acesso", "título",
  "vice", "pipoca", "zebra", "futebol feminino", "cartola", "fantasy game", "novelas Globo", "novelas SBT",
  "novelas Record", "novelas mexicanas", "novelas turcas", "doramas", "chapolin", "pica-pau", "desenho animado",
  "anime", "série", "filme", "reality show", "BBB", "A Fazenda", "MasterChef", "The Voice", "programa de auditório",
  "Faustão", "Silvio Santos", "Ratinho", "bordões", "cenas icônicas", "vilãs", "casais", "abertura", "trilha sonora",
  "funk", "sertanejo", "pagode", "axé", "forró", "piseiro", "arrocha", "tecnomelody", "brega", "rock", "pop",
  "gospel", "MPB", "rap", "trap", "música viral", "coreografia", "show", "festival", "bolo de pote", "pão de queijo",
  "coxinha", "pastel", "churrasco", "feijoada", "açaí", "tapioca", "brigadeiro", "pudim", "pizza", "miojo", "café",
  "cerveja", "comida de festa junina", "comida de Natal", "comida de domingo", "nordeste", "sul", "sudeste",
  "centro-oeste", "norte", "gírias regionais", "sotaques", "cultura regional", "festa junina", "carnaval", "São João",
  "Natal", "Ano Novo", "Páscoa", "Dia das Mães", "Dia dos Pais", "Black Friday", "volta às aulas", "eleições",
  "WhatsApp", "Instagram", "TikTok", "X/Twitter", "Facebook", "YouTube", "Kwai", "trends", "áudios virais", "filtros",
  "lives", "podcasts", "cortes", "influencers", "criadores de conteúdo", "tretas da internet", "cancelamento",
  "celebridades", "famosos", "Seu Madruga", "Quico", "Chiquinha", "Professor Girafales", "Bruxa do 71", "véio da lancha",
  "Zé Gotinha", "Papai Noel", "Coelhinho da Páscoa", "folclore", "Saci", "Curupira", "Iara", "Mula sem Cabeça", "games",
  "mangá", "Marvel", "DC", "Star Wars", "Harry Potter", "Senhor dos Anéis", "RPG", "board games", "e-sports", "LoL",
  "Valorant", "CS", "Fortnite", "Minecraft", "GTA", "Free Fire", "vôlei", "basquete", "UFC", "F1", "skate", "surfe",
  "atletismo", "ginástica", "Olimpíadas", "Paralimpíadas", "NBA", "Champions League", "futebol americano", "política",
  "religião", "notícias", "economia", "tecnologia", "ciência", "educação", "saúde", "natureza", "animais", "viagem",
  "moda", "beleza", "humor negro", "stand-up", "tirinhas", "charges", "meme de enquete", "meme de tier list",
  "meme de ranking", "meme de quiz", "meme de print", "meme de tweet", "meme de comentário", "meme de story",
  "meme de status", "meme de direct", "meme de grupo", "meme de call", "meme de live", "meme de podcast",
  "meme de corte", "meme de TikTok", "meme de Reels", "meme de Shorts", "meme de Kwai", "meme de YouTube",
  "meme de Twitter/X", "meme de Instagram", "meme de Facebook", "meme de WhatsApp", "meme de Telegram", "meme de Discord",
  "meme de Reddit", "meme de fórum", "cala a boca", "que isso", "meu ovo", "vai tomar", "tá ok", "simples assim",
  "eu avisei", "não acredito", "que vergonha", "tô passada", "gente", "miga", "amiga", "mona", "diva", "arrasou",
  "lacrou", "mitou", "crush", "shippo", "OTP", "segunda-feira", "sexta-feira", "feriado", "fim de semana", "férias",
  "trânsito", "ônibus", "metrô", "carro", "moto", "bicicleta", "aplicativo", "Uber", "iFood", "entregador", "motoboy",
  "correio", "encomenda", "mercado", "fila", "banco", "lotérica", "cartório", "hospital", "posto de saúde", "dentista",
  "médico", "farmácia", "academia", "dieta", "nutricionista", "psicólogo", "terapia", "ansiedade", "depressão",
  "burnout", "sono", "insônia", "café", "energético", "cerveja", "bebida", "ressaca", "festa", "balada", "churrasco",
  "aniversário", "casamento", "formatura", "batizado", "velório", "cemitério", "mãe", "pai", "filho", "irmão", "avó",
  "avô", "tio", "tia", "primo", "sogra", "sogro", "genro", "nora", "cunhado", "vizinho", "porteiro", "síndico",
  "condomínio", "apartamento", "casa", "aluguel", "mudança", "reforma", "obra", "encanador", "eletricista", "pedreiro",
  "pintor", "imigração", "visto", "passaporte", "aeroporto", "avião", "hotel", "praia", "campo", "montanha", "trilha",
  "camping", "pesca", "caça", "Pokémon", "Yu-Gi-Oh", "Digimon", "Dragon Ball", "Naruto", "One Piece", "Bleach",
  "Demon Slayer", "Jujutsu Kaisen", "Attack on Titan", "Death Note", "Sailor Moon", "Cavaleiros do Zodíaco", "Tom e Jerry",
  "Looney Tunes", "Disney", "Pixar", "DreamWorks", "Cartoon Network", "Nickelodeon", "MTV", "SBT", "Globo", "Record",
  "Band", "Cultura", "TV aberta", "TV paga", "Netflix", "Prime Video", "Disney+", "HBO Max", "Globoplay", "Star+",
  "Paramount+", "Apple TV+", "Oscar", "Grammy", "eleição", "debate", "campanha", "pronunciamento", "hate", "love",
  "ship", "shippar", "fanfic", "headcanon", "AU", "crossover", "fluff", "angst", "isekai", "shounen", "shoujo",
  "seinen", "josei", "mecha", "slice of life", "harem", "stray kids",
];

const ESCRITA_ESTRANGEIRA =
  /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Hebrew}\p{Script=Greek}]/u;

const PALAVRAS_ESTRANGEIRAS =
  /\b(el|la|los|las|una|unas|unos|para|como|con|sin|por|que|más|muy|todo|toda|está|están|hacer|tener|puedo|quiero|hola|amor|gato|perro|bebe|baby|risa|gracioso|chiste|memes|español|français|bonjour|merci|avec|pour|dans|très|tout|toute|être|avoir|je|tu|nous|vous|ils|elles|chat|chien|rigolo|drôle)\b/i;

function pareceBrasileiro(pack = {}) {
  const texto = `${pack.title || ""} ${pack.author || ""}`;
  if (ESCRITA_ESTRANGEIRA.test(texto)) return false;
  if (PALAVRAS_ESTRANGEIRAS.test(texto)) return false;
  return true;
}

const embaralhar = (lista) => [...lista].sort(() => Math.random() - 0.5);

let rodando = false;
let proximaTentativa = 0;

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function addStickerGroup(jid) {
  const { grupos } = getStickerState();
  if (grupos.includes(jid)) return false;
  updateStickerState({ grupos: [...grupos, jid] });
  return true;
}

export function removeStickerGroup(jid) {
  const { grupos } = getStickerState();
  if (!grupos.includes(jid)) return false;
  updateStickerState({ grupos: grupos.filter((g) => g !== jid) });
  return true;
}

export function listStickerGroups() {
  return getStickerState().grupos;
}

async function baixarPack(pack) {
  const figurinhas = [];
  for (const entry of pack.stickers || []) {
    try {
      const raw = await fetchStickerlyStickerBuffer(entry, pack.url);
      figurinhas.push(await convertStickerlyBufferToStickerBuffer(raw, entry));
    } catch (error) {
      console.warn(
        `[Figurinhas] Falhou uma figurinha de "${pack.title}": ${error.message}`,
      );
    }
  }
  return figurinhas;
}

async function enviarPack(socket, jid, pack, figurinhas) {
  try {
    // Monta o pacote nativo do WhatsApp
    const content = await buildStickerPackContent({
      title: pack.title || "Figurinhas",
      author: pack.author || "Atlas",
      stickerBuffers: figurinhas,
      packDescription: `via Sticker.ly — ${pack.url}`,
    });

    // Envia o pacote do mesmo jeito que o comando /stickerly faz
    await socket.sendMessage(jid, content);
    
    console.log(`[Figurinhas] ✅ Pack enviado com sucesso: ${pack.title}`);
  } catch (error) {
    errorLog(`[Figurinhas] Erro ao enviar pacote: ${error.message}`);
    throw error;
  }
}

async function montarCandidatos() {
  const recentes = getStickerState().recentes;
  const jaEnviados = new Set(recentes);

  const buscados = [];
  for (const tema of embaralhar(TEMAS_BR).slice(0, 4)) {
    const packs = await searchStickerlyPacks(tema, 8).catch(() => []);
    buscados.push(...packs.map((pack) => ({ url: pack.url, pack })));
  }

  const catalogo = await listStickerlyCatalog().catch(() => []);
  const doCatalogo = catalogo.map((card) => ({ url: card.url, card }));

  const vistos = new Set();
  const unicos = (lista) =>
    lista.filter(
      (item) => item.url && !vistos.has(item.url) && vistos.add(item.url),
    );

  const novosBuscados = unicos(
    embaralhar(
      buscados.filter((i) => !jaEnviados.has(i.url) && pareceBrasileiro(i.pack)),
    ),
  );
  const repetidos = unicos(
    recentes.map((url) => buscados.find((i) => i.url === url) || { url }),
  );
  const novosCatalogo = unicos(
    embaralhar(
      doCatalogo.filter(
        (i) => !jaEnviados.has(i.url) && pareceBrasileiro(i.card),
      ),
    ),
  );

  return [...novosBuscados, ...repetidos, ...novosCatalogo];
}

export async function sendRandomStickerPack(socket, destinos = null) {
  const candidatos = (await montarCandidatos()).slice(0, 8);
  if (!candidatos.length)
    throw new Error("nenhum pack brasileiro passou pela busca");

  let ultimoErro;
  for (const item of candidatos) {
    try {
      const pack = item.pack || (await resolveStickerlyPack(item.url));
      if (!pareceBrasileiro(pack))
        throw new Error(`"${pack.title}" não parece ser pack brasileiro`);

      const figurinhas = await baixarPack(pack);
      if (figurinhas.length < MIN_FIGURINHAS) {
        throw new Error(
          `"${pack.title}" só teve ${figurinhas.length} figurinha(s) utilizável(is)`,
        );
      }

      for (const jid of destinos || getStickerState().grupos) {
        try {
          await enviarPack(socket, jid, pack, figurinhas);
        } catch (error) {
          errorLog(
            `[Figurinhas] Falha ao enviar pra ${jid}: ${error.message}`,
          );
        }
      }

      const { recentes: atuais } = getStickerState();
      updateStickerState({
        recentes: [...atuais.filter((u) => u !== item.url), item.url].slice(
          -MAX_RECENTES,
        ),
        ...(destinos ? {} : { ultimoEnvio: Date.now() }),
      });
      infoLog(
        `[Figurinhas] Pack enviado: ${pack.title} (${figurinhas.length})`,
      );
      return pack;
    } catch (error) {
      ultimoErro = error;
    }
  }
  throw ultimoErro || new Error("não consegui montar nenhum pack");
}

async function tick(socket) {
  if (rodando) return;
  const { grupos, ultimoEnvio } = getStickerState();
  if (!grupos.length) return;
  const agora = Date.now();
  if (agora - (ultimoEnvio || 0) < INTERVALO_MS || agora < proximaTentativa)
    return;

  rodando = true;
  try {
    await sendRandomStickerPack(socket);
  } catch (error) {
    proximaTentativa = Date.now() + ESPERA_SE_FALHAR_MS;
    errorLog(
      `[Figurinhas] Erro no envio automático (tento de novo em 5 min): ${error.message}`,
    );
  } finally {
    rodando = false;
  }
}

export function startStickerBroadcaster(socket) {
  const timer = setInterval(() => {
    tick(socket).catch((error) =>
      errorLog(`[Figurinhas] Erro no agendador: ${error.message}`),
    );
  }, TICK_MS);
  timer.unref?.();
}