import fs from 'fs';
import path from 'path';
import { getRecentPosts, getPostDetails } from './getmodsApi.js';

const DB_DIR = path.resolve('database');
const DB_FILE = path.join(DB_DIR, 'getmods-broadcast.json');

const INTERVAL_MS = 30 * 60 * 1000;

let intervalHandle = null;

function lerEstado() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return {
        grupos: [],
        gruposNovels: [],
        vistos: {}
      };
    }

    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);

    return {
      grupos: Array.isArray(parsed.grupos) ? parsed.grupos : [],
      gruposNovels: Array.isArray(parsed.gruposNovels) ? parsed.gruposNovels : [],
      vistos: parsed.vistos || {}
    };

  } catch {
    return {
      grupos: [],
      gruposNovels: [],
      vistos: {}
    };
  }
}

function salvarEstado(estado) {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    fs.writeFileSync(DB_FILE, JSON.stringify(estado, null, 2));

  } catch (error) {
    console.error('[getmods] Erro ao salvar estado:', error.message);
  }
}

export function listGetmodsGroups() {
  return lerEstado().grupos;
}

export function listGetmodsNovelGroups() {
  return lerEstado().gruposNovels;
}

export function addGetmodsNovelGroup(jid) {
  const estado = lerEstado();

  if (estado.gruposNovels.includes(jid)) return false;

  estado.gruposNovels.push(jid);
  salvarEstado(estado);

  return true;
}

export function removeGetmodsNovelGroup(jid) {
  const estado = lerEstado();
  const idx = estado.gruposNovels.indexOf(jid);

  if (idx === -1) return false;

  estado.gruposNovels.splice(idx, 1);
  salvarEstado(estado);

  return true;
}

const NOVEL_TERMS = [
  'novel',
  'visual novel',
  'interactive story',
  'interactive stories',
  'romance game',
  'romance games',
  'dating sim',
  'otome',
  'choices',
  'chapters',
  'romance club',
  'journeys',
  'mystic messenger',
  'love island',
  'episode interactive',
  'interactive fiction'
];

function normalizar(texto = '') {
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ' ');
}

export function isNovelPost(post) {
  const categorias = normalizar(
    (post.categories || []).join(' ')
  );

  const conteudo = normalizar(
    `${post.title || ''} ${post.url || ''} ${post.description || ''}`
  );

  const categoryMatch = NOVEL_TERMS.some(term =>
    categorias.includes(normalizar(term))
  );

  const keywordMatch = NOVEL_TERMS.some(term =>
    conteudo.includes(normalizar(term))
  );

  return categoryMatch || keywordMatch;
}

export function addGetmodsGroup(jid) {
  const estado = lerEstado();

  if (estado.grupos.includes(jid)) return false;

  estado.grupos.push(jid);
  salvarEstado(estado);

  return true;
}

export function removeGetmodsGroup(jid) {
  const estado = lerEstado();
  const idx = estado.grupos.indexOf(jid);

  if (idx === -1) return false;

  estado.grupos.splice(idx, 1);
  salvarEstado(estado);

  return true;
}

function buildCaption(post, isUpdate = false) {
  const linhas = [];

  linhas.push(
    isUpdate
      ? `🔄 *ATUALIZADO:* ${post.title}`
      : `🆕 *NOVO:* ${post.title}`
  );

  linhas.push('');

  if (post.version) linhas.push(`💿 Versão: ${post.version}`);
  if (post.mod) linhas.push(`⚡ Mod: ${post.mod}`);
  if (post.size) linhas.push(`💾 Tamanho: ${post.size}`);

  linhas.push('');

  if (post.description) {
    linhas.push(`_${post.description.substring(0, 250)}..._`);
    linhas.push('');
  }

  linhas.push(`🔗 ${post.url}`);

  return linhas.join('\n');
}

async function enviarPost(socket, jid, post, isUpdate = false) {
  const caption = buildCaption(post, isUpdate);

  if (post.image) {
    try {
      const res = await fetch(post.image, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000)
      });

      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());

        await socket.sendMessage(jid, {
          image: buffer,
          caption,
          mimetype: 'image/jpeg'
        });

        return;
      }

    } catch (err) {
      console.error('[getmods] Erro na imagem:', err.message);
    }
  }

  await socket.sendMessage(jid, { text: caption });
}

export async function checkAndSendUpdates(socket) {
  const estado = lerEstado();

  if (!estado.grupos.length && !estado.gruposNovels.length) return;

  const posts = await getRecentPosts();

  if (!posts.length) {
    console.log('[getmods] Nenhuma atualização nas últimas 24h.');
    return;
  }

  const primeiraExecucao = Object.keys(estado.vistos).length === 0;
  const novosVistos = { ...estado.vistos };
  const paraEnviar = [];

  for (const post of posts) {
    const chave = post.url;
    const dataAtual = post.lastmod.toISOString();

    if (!estado.vistos[chave]) {
      novosVistos[chave] = dataAtual;

      if (!primeiraExecucao) {
        paraEnviar.push({
          post,
          isUpdate: false
        });
      }

    } else if (estado.vistos[chave] !== dataAtual) {
      novosVistos[chave] = dataAtual;

      paraEnviar.push({
        post,
        isUpdate: true
      });
    }
  }

  if (primeiraExecucao) {
    salvarEstado({
      ...estado,
      vistos: novosVistos
    });

    console.log(
      `[getmods] Primeira execução — registrados ${Object.keys(novosVistos).length} posts.`
    );

    return;
  }

  if (!paraEnviar.length) {
    salvarEstado({
      ...estado,
      vistos: novosVistos
    });

    return;
  }

  for (const item of paraEnviar) {
    let detalhes;

    try {
      detalhes = await getPostDetails(item.post.url);

    } catch (err) {
      console.error(
        `[getmods] Erro nos detalhes de ${item.post.url}:`,
        err.message
      );

      continue;
    }

    // Grupos gerais continuam recebendo todas as publicações.
    for (const jid of estado.grupos) {
      try {
        await enviarPost(socket, jid, detalhes, item.isUpdate);

      } catch (error) {
        console.error(
          `[getmods] Erro ao enviar para ${jid}:`,
          error.message
        );
      }
    }

    // Grupos Novel recebem somente publicações classificadas como Novel.
    if (
      estado.gruposNovels.length &&
      isNovelPost(detalhes)
    ) {
      for (const jid of estado.gruposNovels) {
        if (estado.grupos.includes(jid)) continue;

        try {
          await enviarPost(socket, jid, detalhes, item.isUpdate);

        } catch (error) {
          console.error(
            `[getmods] Erro ao enviar Novel para ${jid}:`,
            error.message
          );
        }
      }
    }
  }

  salvarEstado({
    ...estado,
    vistos: novosVistos
  });

  console.log(
    `[getmods] ${paraEnviar.length} atualizações processadas.`
  );
}

export async function forceSendRecent(socket, jid) {
  console.log('[getmods] ⚡ Forçando envio das atualizações recentes...');

  const posts = await getRecentPosts();

  if (!posts.length) {
    await socket.sendMessage(jid, {
      text: 'Nenhuma atualização nas últimas 24h.'
    });

    return;
  }

  for (const post of posts) {
    const detalhes = await getPostDetails(post.url);
    await enviarPost(socket, jid, detalhes, true);
  }

  console.log(`[getmods] ⚡ ${posts.length} atualizações enviadas.`);
}

export async function forceSendRecentNovels(socket, jid) {
  console.log('[getmods] ⚡ Forçando envio de novels e jogos de romance...');

  const posts = await getRecentPosts();
  let enviados = 0;

  for (const post of posts) {
    try {
      const detalhes = await getPostDetails(post.url);

      if (!isNovelPost(detalhes)) continue;

      await enviarPost(socket, jid, detalhes, true);
      enviados++;

    } catch (error) {
      console.error(
        `[getmods] Erro ao verificar ${post.url}:`,
        error.message
      );
    }
  }

  if (!enviados) {
    await socket.sendMessage(jid, {
      text: 'Não encontrei novels ou jogos de romance modificados nas últimas 24 horas.'
    });
  }

  console.log(`[getmods] ⚡ ${enviados} posts de Novel enviados.`);
}

export function startGetmodsBroadcaster(socket) {
  if (intervalHandle) clearInterval(intervalHandle);

  setTimeout(() => {
    checkAndSendUpdates(socket).catch(err =>
      console.error('[getmods]', err.message)
    );
  }, 30 * 1000);

  intervalHandle = setInterval(() => {
    checkAndSendUpdates(socket).catch(err =>
      console.error('[getmods]', err.message)
    );
  }, INTERVAL_MS);

  console.log('[getmods] Broadcaster iniciado (verifica sitemap a cada 30min).');
}