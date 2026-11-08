import fs from 'fs';
import path from 'path';
import { listLatestPosts, formatPostDate } from './kissrushApi.js';

const DB_DIR = path.resolve('database');
const DB_FILE = path.join(DB_DIR, 'kissrush-broadcast.json');

const INTERVAL_MS = 30 * 60 * 1000;
const MAX_RECENTES = 100;

let intervalHandle = null;

function lerEstado() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { grupos: [], vistos: {}, inicializado: false };
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      grupos: Array.isArray(parsed.grupos) ? parsed.grupos : [],
      vistos:
        parsed.vistos && typeof parsed.vistos === 'object'
          ? parsed.vistos
          : {},
      inicializado: Boolean(parsed.inicializado),
    };
  } catch {
    return { grupos: [], vistos: {}, inicializado: false };
  }
}

function salvarEstado(estado) {
  try {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(estado, null, 2));
  } catch (error) {
    console.error('[kissrush] Erro ao salvar estado:', error.message);
  }
}

export function listKissRushGroups() {
  return lerEstado().grupos;
}

export function addKissRushGroup(jid) {
  const estado = lerEstado();
  if (estado.grupos.includes(jid)) return false;
  estado.grupos.push(jid);
  salvarEstado(estado);
  return true;
}

export function removeKissRushGroup(jid) {
  const estado = lerEstado();
  const idx = estado.grupos.indexOf(jid);
  if (idx === -1) return false;
  estado.grupos.splice(idx, 1);
  salvarEstado(estado);
  return true;
}

function buildCaption(post) {
  const linhas = [];
  linhas.push(`📱 *${post.title}*`);
  linhas.push('');

  if (post.summary) {
    linhas.push(`_${post.summary.substring(0, 200)}..._`);
    linhas.push('');
  }

  const date = formatPostDate(post.datePublished);
  if (date) linhas.push(`📅 ${date}`);
  if (post.categories.length) linhas.push(`🏷️ ${post.categories.join(' · ')}`);

  linhas.push('');
  linhas.push(`🔗 ${post.link}`);

  return linhas.join('\n');
}

async function enviarPost(socket, jid, post) {
  const caption = buildCaption(post);

  if (post.image) {
    try {
      const response = await fetch(post.image, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        await socket.sendMessage(jid, {
          image: buffer,
          caption,
          mimetype: 'image/jpeg',
        });
        return;
      }
    } catch (err) {
      console.error('[kissrush] Erro na imagem:', err.message);
    }
  }

  await socket.sendMessage(jid, { text: caption });
}

export async function checkAndSendNewPosts(socket) {
  console.log('[kissrush] ==================================');
  console.log('[kissrush] 🔍 Iniciando checagem...');

  const estado = lerEstado();
  console.log(
    `[kissrush] 📂 Estado: ${estado.grupos.length} grupo(s), ${Object.keys(estado.vistos).length} visto(s), inicializado=${estado.inicializado}`,
  );

  if (!estado.grupos.length) {
    console.log('[kissrush] ⚠️ Nenhum grupo cadastrado.');
    console.log('[kissrush] ==================================');
    return;
  }

  let posts = [];
  try {
    posts = await listLatestPosts(15);
  } catch (error) {
    console.error('[kissrush] ❌ Erro ao buscar posts:', error.message);
    console.log('[kissrush] ==================================');
    return;
  }

  console.log(`[kissrush] 📰 Posts no feed: ${posts.length}`);

  if (!posts.length) {
    console.log('[kissrush] ⚠️ Feed vazio.');
    console.log('[kissrush] ==================================');
    return;
  }

  // PRIMEIRA VEZ (nunca inicializou): registra tudo sem enviar
  if (!estado.inicializado) {
    const novosVistos = { ...estado.vistos };
    for (const post of posts) {
      const chave = post.link;
      const updated = post.dateUpdated || post.datePublished || '';
      novosVistos[chave] = updated;
    }
    salvarEstado({ ...estado, vistos: novosVistos, inicializado: true });
    console.log(
      `[kissrush] ✅ Primeira execução — registrados ${posts.length} posts sem enviar.`,
    );
    console.log('[kissrush] ==================================');
    return;
  }

  // DEMAIS EXECUÇÕES: manda tudo que for novo ou tiver updated diferente
  const novosVistos = { ...estado.vistos };
  const paraEnviar = [];

  for (const post of posts) {
    const chave = post.link;
    const updated = post.dateUpdated || post.datePublished || '';
    const jaVisto = estado.vistos[chave];

    if (!jaVisto) {
      novosVistos[chave] = updated;
      paraEnviar.push(post);
      console.log(`[kissrush] 🆕 Novo: ${post.title}`);
      continue;
    }

    if (updated && updated !== jaVisto) {
      novosVistos[chave] = updated;
      paraEnviar.push(post);
      console.log(`[kissrush] ♻️ Atualizado: ${post.title}`);
    } else {
      console.log(`[kissrush] ⏭️ Sem mudança: ${post.title}`);
    }
  }

  if (!paraEnviar.length) {
    console.log('[kissrush] ⏭️ Nada novo ou atualizado.');
    salvarEstado({ ...estado, vistos: novosVistos });
    console.log('[kissrush] ==================================');
    return;
  }

  // Limita o dicionário
  const chaves = Object.keys(novosVistos);
  if (chaves.length > MAX_RECENTES) {
    const excedente = chaves.slice(0, chaves.length - MAX_RECENTES);
    for (const k of excedente) delete novosVistos[k];
  }

  paraEnviar.sort((a, b) => {
    const ta = new Date(a.dateUpdated || a.datePublished).getTime();
    const tb = new Date(b.dateUpdated || b.datePublished).getTime();
    return ta - tb;
  });

  console.log(`[kissrush] 📤 Enviando ${paraEnviar.length} post(s)...`);

  for (const post of paraEnviar) {
    for (const jid of estado.grupos) {
      try {
        await enviarPost(socket, jid, post);
        console.log(`[kissrush]    ✅ ${jid}: ${post.title}`);
      } catch (error) {
        console.error(`[kissrush]    ❌ ${jid}: ${error.message}`);
      }
    }
  }

  salvarEstado({ ...estado, vistos: novosVistos });
  console.log(`[kissrush] ✅ ${paraEnviar.length} post(s) enviados.`);
  console.log('[kissrush] ==================================');
}

/**
 * Reset "inteligente":
 *   - limpa vistos
 *   - marca inicializado=false (pra próxima checagem NÃO enviar em massa)
 *   - se quiser forçar envio de tudo, use resetKissRushHistoryFULL
 */
export function resetKissRushHistory() {
  const estado = lerEstado();
  salvarEstado({ ...estado, vistos: {}, inicializado: false });
  console.log(
    '[kissrush] 🔄 Histórico resetado. Próxima checagem vai registrar sem enviar.',
  );
}

/**
 * Reset "forçado": limpa vistos E marca inicializado=true, pra
 * a próxima checagem tratar TODOS os posts como novos e enviar tudo.
 */
export function resetKissRushHistoryForcar() {
  const estado = lerEstado();
  salvarEstado({ ...estado, vistos: {}, inicializado: true });
  console.log(
    '[kissrush] 🔄 Histórico resetado (forçado). Próxima checagem vai ENVIAR TUDO.',
  );
}

export function startKissRushBroadcaster(socket) {
  if (intervalHandle) clearInterval(intervalHandle);

  setTimeout(() => {
    checkAndSendNewPosts(socket).catch((err) =>
      console.error('[kissrush] Erro na primeira checagem:', err.message),
    );
  }, 30 * 1000);

  intervalHandle = setInterval(() => {
    checkAndSendNewPosts(socket).catch((err) =>
      console.error('[kissrush] Erro no broadcaster:', err.message),
    );
  }, INTERVAL_MS);

  console.log('[kissrush] Broadcaster iniciado (verifica a cada 15min)');
}