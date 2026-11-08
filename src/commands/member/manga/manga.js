import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PREFIX } from '../../../config.js';
import { InvalidParameterError } from '../../../errors/index.js';
import {
  searchManga,
  getMangaInfo,
  getChapters,
  parseMangaUrl,
  parseChapterSpec,
  selectChapters,
  buildChapterCbz,
  downloadCoverBuffer,
  safeFileName,
} from '../../../services/mangaApi.js';

const CBZ_MIMETYPE = 'application/vnd.comicbook+zip';
const MAX_CHAPTERS_PER_REQUEST = Number(process.env.ATLAS_MANGA_MAX_CHAPTERS) || 3;
const MAX_SIZE = 900 * 1024 * 1024;

const chatLocks = new Set();
const chapterLocks = new Set();

const formatNumber = (n) => (Number.isInteger(n) ? String(n) : String(n));

function formatBytes(bytes) {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
}

// CORREÇÃO DEFINITIVA: Usa o fullArgs (texto bruto) e Regex para achar nome e capítulo
function parseArgs(fullArgs) {
  const fullString = String(fullArgs || '').trim();
  
  // 1. Tenta achar uma URL do atsu.moe (mesmo quebrada com espaços)
  const mangaUrlRegex = /(https?:\/\/)?(?:www\.)?atsu\.moe\s*manga\s*([A-Za-z0-9_-]+)/i;
  const matchUrl = fullString.match(mangaUrlRegex);
  
  if (matchUrl) {
    const id = matchUrl[2];
    const remaining = fullString.replace(matchUrl[0], '').trim();
    const spec = remaining ? parseChapterSpec(remaining) : null;
    return { urlId: id, name: id, spec };
  }

  // 2. Se for nome, tenta achar um número no final (ex: "Manga Name 1" ou "Manga Name 1-5")
  const matchChapter = fullString.match(/^(.*?)\s+(\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?(?:\s*,\s*\d+(?:\.\d+)?)*)$/);
  if (matchChapter) {
    const name = matchChapter[1].trim();
    const spec = parseChapterSpec(matchChapter[2]);
    if (spec) {
      return { name, spec };
    }
  }

  // 3. Se não achou número no final, busca o nome inteiro
  return { name: fullString, spec: null };
}

async function resolveManga(name, urlId) {
  if (urlId) {
    const info = await getMangaInfo(urlId);
    return { manga: { id: urlId, name: info.title || urlId }, others: [], info };
  }

  const parsedId = parseMangaUrl(name);
  if (parsedId) {
    const info = await getMangaInfo(parsedId);
    return { manga: { id: parsedId, name: info.title || parsedId }, others: [], info };
  }

  const results = await searchManga(name);
  if (!results.length) return null;

  const info = await getMangaInfo(results[0].id);
  return { manga: results[0], others: results.slice(1, 5), info };
}

export default {
  name: 'manga',
  description: 'Baixa capítulos de mangá em CBZ',
  commands: ['manga', 'mangas'],
  usage: `${PREFIX}manga <nome> <capítulo>  (ex.: ${PREFIX}manga vagabond 100 | ${PREFIX}manga vagabond 100-102)`,

  handle: async ({ sendReply, fullArgs, remoteJid, socket }) => {
    // Usa fullArgs em vez de args para não depender da separação automática
    if (!fullArgs || !fullArgs.trim()) {
      throw new InvalidParameterError(
        `Informe o mangá. Exemplo: ${PREFIX}manga vagabond 100`,
      );
    }

    if (chatLocks.has(remoteJid)) {
      return sendReply('⏳ Você já tem um download em andamento. Aguarde ele terminar.');
    }
    chatLocks.add(remoteJid);

    try {
      const { name, spec, urlId } = parseArgs(fullArgs);
      
      if (!urlId) {
        await sendReply(`🔍 Buscando *"${name}"*...`);
      }

      const resolved = await resolveManga(name, urlId);
      if (!resolved) {
        return sendReply('❌ Nenhum mangá encontrado. Tente o nome em outra grafia ou cole o link do atsu.moe.');
      }

      const { manga, others, info } = resolved;
      const chapters = await getChapters(manga.id);

      if (!chapters.length) {
        return sendReply(`❌ *${manga.name}*: não consegui listar os capítulos.`);
      }

      const first = chapters[0].number;
      const last = chapters[chapters.length - 1].number;

      // Sem capítulo: mostra a ficha do mangá
      if (!spec) {
        const lines = [
          `📚 *${manga.name}*`,
          `📑 ${chapters.length} capítulos (de ${formatNumber(first)} a ${formatNumber(last)})`,
        ];
        if (info?.status) lines.push(`📌 ${info.status}`);
        
        const cmdBase = urlId ? `https://atsu.moe/manga/${urlId}` : manga.name;
        lines.push('', `Para baixar: ${PREFIX}manga ${cmdBase} ${formatNumber(last)}`);
        lines.push(`Vários de uma vez: ${PREFIX}manga ${cmdBase} ${formatNumber(first)}-${formatNumber(Math.min(first + 2, last))}`);
        
        if (others.length) {
          lines.push('', '🔎 Outros resultados:', ...others.map((o) => `• ${o.name}`));
        }
        return sendReply(lines.join('\n'));
      }

      const selected = selectChapters(chapters, spec);
      if (!selected.length) {
        return sendReply(
          `❌ Esse capítulo não existe em *${manga.name}*. Disponíveis: ${formatNumber(first)} a ${formatNumber(last)}.`,
        );
      }

      if (selected.length > MAX_CHAPTERS_PER_REQUEST) {
        return sendReply(
          `⚠️ Máximo de ${MAX_CHAPTERS_PER_REQUEST} capítulos por pedido (você pediu ${selected.length}). Divida em partes menores.`,
        );
      }

      const caption = [
        `📖 *${manga.name}*`,
        `📑 Capítulo${selected.length > 1 ? 's' : ''} ${selected.map((c) => formatNumber(c.number)).join(', ')}`,
      ].join('\n');

      await sendReply(`${caption}\n\n⏳ Baixando...`);

      runDownloadInBackground({ manga, selected, info, caption, remoteJid, socket }).catch((err) => {
        console.error('❌ Erro no download de mangá em background:', err);
      });
    } finally {
      chatLocks.delete(remoteJid);
    }
  },
};

async function runDownloadInBackground({ manga, selected, info, caption, remoteJid, socket }) {
  const tempDir = path.resolve('assets', 'temp', 'downloads');
  const created = [];
  let coverSent = false;

  try {
    for (const chapter of selected) {
      const lockKey = `${manga.id}:${chapter.id}`;
      if (chapterLocks.has(lockKey)) {
        await socket.sendMessage(remoteJid, {
          text: `⏳ O capítulo ${formatNumber(chapter.number)} já está sendo baixado. Aguarde um instante.`,
        });
        continue;
      }
      chapterLocks.add(lockKey);

      const fileName = `${safeFileName(manga.name)} - Cap ${formatNumber(chapter.number)}.cbz`;
      const outPath = path.join(tempDir, `manga_${crypto.randomBytes(4).toString('hex')}.cbz`);
      created.push(outPath);

      try {
        const { pages, size } = await buildChapterCbz({ chapter, outPath });

        if (size > MAX_SIZE) {
          await socket.sendMessage(remoteJid, {
            text: `❌ *${manga.name}* cap. ${formatNumber(chapter.number)}: ${formatBytes(size)}, grande demais pro WhatsApp.`,
          });
          continue;
        }

        if (!coverSent) {
          coverSent = true;
          const cover = await downloadCoverBuffer(info?.cover);
          if (cover) {
            await socket.sendMessage(remoteJid, { image: cover, caption, mimetype: 'image/jpeg' }).catch(() => {});
          }
        }

        console.log(`📤 Enviando ${fileName} (${pages} páginas, ${formatBytes(size)})`);
        await socket.sendMessage(remoteJid, {
          document: fs.readFileSync(outPath),
          mimetype: CBZ_MIMETYPE,
          fileName,
          caption: `${coverSent && info?.cover ? '' : `${caption}\n`}📄 ${pages} páginas · 💾 ${formatBytes(size)}`.trim(),
        });
      } catch (error) {
        console.error('❌ manga falhou:', error.message);
        await socket.sendMessage(remoteJid, {
          text: `❌ Falha ao baixar *${manga.name}* cap. ${formatNumber(chapter.number)}.\n\n_${error.message}_`,
        }).catch(() => {});
      } finally {
        chapterLocks.delete(lockKey);
        fs.rmSync(outPath, { force: true });
      }
    }
  } finally {
    for (const p of created) fs.rmSync(p, { force: true });
  }
}