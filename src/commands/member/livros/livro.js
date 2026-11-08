import { PREFIX } from '../../../config.js';
import {
  searchBooks,
  downloadBookByMd5,
  downloadCover,
  enhanceCover,
} from '../../../services/annas-archive.js';
import { InvalidParameterError } from '../../../errors/index.js';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const MIME_TYPES = {
  '.epub': 'application/epub+zip',
  '.pdf': 'application/pdf',
  '.mobi': 'application/x-mobipocket-ebook',
  '.azw': 'application/vnd.amazon.ebook',
  '.azw3': 'application/vnd.amazon.ebook',
  '.fb2': 'application/x-fictionbook+xml',
  '.fbz': 'application/x-fictionbook+xml',
  '.djvu': 'image/vnd.djvu',
  '.txt': 'text/plain',
  '.rtf': 'application/rtf',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.cbz': 'application/vnd.comicbook+zip',
  '.cbr': 'application/vnd.comicbook-rar',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

const MAX_SIZE = 900 * 1024 * 1024;

const chatLocks = new Set();
const md5Locks = new Set();

function getMimetype(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
}

function parseMeta(meta) {
  if (!meta) return { language: '', format: '', size: '', year: '' };

  const languageMatch = meta.match(/([a-záàâãéêíóôõúç]+)\s*\[[a-z]{2}\]/i);
  const language = languageMatch
    ? languageMatch[1].charAt(0).toUpperCase() + languageMatch[1].slice(1)
    : '';

  const formatMatch = meta.match(
    /\b(EPUB|PDF|MOBI|AZW3?|DJVU|FB2|TXT|RTF|DOCX?|ODT|CBZ|CBR)\b/i,
  );
  const format = formatMatch ? formatMatch[1].toUpperCase() : '';

  const sizeMatch = meta.match(/([\d.]+\s*(?:KB|MB|GB))/i);
  const size = sizeMatch ? sizeMatch[1].replace(/\s+/g, ' ').toUpperCase() : '';

  const yearMatch = meta.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : '';

  return { language, format, size, year };
}

function buildCaption(book) {
  const { language, format, size, year } = parseMeta(book.meta);

  const lines = [];
  lines.push(`📖 *${book.title}*`);

  if (book.author) {
    lines.push(`✍️ ${book.author}`);
  }

  lines.push('');

  const details = [];
  if (language) details.push(`🌐 ${language}`);
  if (format) details.push(`📄 ${format}`);
  if (size) details.push(`💾 ${size}`);
  if (year) details.push(`📅 ${year}`);

  if (details.length > 0) {
    lines.push(details.join('  ·  '));
  }

  return lines.join('\n');
}

export default {
  name: 'livro',
  description: "Baixa livros do Anna's Archive",
  commands: ['livro', 'book'],
  usage: `${PREFIX}livro <título>`,

  handle: async ({ sendReply, args, fullArgs, remoteJid, socket }) => {
    if (!args[0]) {
      throw new InvalidParameterError('Informe o título do livro.');
    }

    if (chatLocks.has(remoteJid)) {
      return sendReply(
        '⏳ Você já tem um download em andamento. Aguarde ele terminar.',
      );
    }
    chatLocks.add(remoteJid);

    try {
      await sendReply(`🔍 Buscando *"${fullArgs}"*...`);

      const results = await searchBooks(fullArgs);

      if (!results.length) {
        return sendReply(
          '❌ Nenhum livro encontrado com esse termo exato. ' +
            'Tente um título mais específico.',
        );
      }

      const book = results[0];
      console.log('📚 Escolhido:', book.title, '| MD5:', book.md5);

      if (md5Locks.has(book.md5)) {
        return sendReply(
          '⏳ Esse livro já está sendo baixado. Aguarde um instante.',
        );
      }
      md5Locks.add(book.md5);

      await sendReply(`📖 *${book.title}*\n\n⏳ Baixando...`);

      runDownloadInBackground({ book, remoteJid, socket }).catch((err) => {
        console.error('❌ Erro no download em background:', err);
      });
    } finally {
      chatLocks.delete(remoteJid);
    }
  },
};

async function runDownloadInBackground({ book, remoteJid, socket }) {
  const tempDir = path.resolve('assets', 'temp', 'downloads');
  let bookPath = null;
  let coverPath = null;
  let enhancedPath = null;

  try {
    const [bookResult, coverResult] = await Promise.allSettled([
      downloadBookByMd5(book.md5, tempDir),
      book.cover ? downloadCover(book.cover, tempDir) : Promise.resolve(null),
    ]);

    if (bookResult.status === 'rejected') {
      throw bookResult.reason;
    }

    const { filePath, fileName, size } = bookResult.value;
    bookPath = filePath;

    if (size === 0) {
      await socket.sendMessage(remoteJid, {
        text: `❌ *${book.title}*: arquivo veio vazio.`,
      });
      return;
    }

    if (size > MAX_SIZE) {
      await socket.sendMessage(remoteJid, {
        text: `❌ *${book.title}*: ${formatBytes(size)}, acima do limite do WhatsApp (100MB).`,
      });
      return;
    }

    if (coverResult.status === 'fulfilled' && coverResult.value) {
      coverPath = coverResult.value.filePath;
    }

    const caption = buildCaption(book);
    const buffer = fs.readFileSync(bookPath);
    const mimetype = getMimetype(fileName);

    if (coverPath) {
      try {
        const enhancedId = crypto.randomBytes(4).toString('hex');
        enhancedPath = path.join(tempDir, `enhanced_${enhancedId}.jpg`);
        await enhanceCover(coverPath, enhancedPath);

        const finalCoverPath = fs.existsSync(enhancedPath)
          ? enhancedPath
          : coverPath;

        const coverBuffer = fs.readFileSync(finalCoverPath);

        console.log(`📤 Enviando capa + livro ${fileName}`);

        await socket.sendMessage(remoteJid, {
          image: coverBuffer,
          caption,
          mimetype: 'image/jpeg',
        });

        await socket.sendMessage(remoteJid, {
          document: buffer,
          mimetype,
          fileName,
        });
        return;
      } catch (coverErr) {
        console.error('⚠️ Erro ao processar capa:', coverErr.message);
      }
    }

    console.log(`📤 Enviando ${fileName} (sem capa)`);
    await socket.sendMessage(remoteJid, {
      document: buffer,
      mimetype,
      fileName,
      caption,
    });
  } catch (error) {
    console.error('❌ downloadBookByMd5 falhou:', error.message);
    try {
      await socket.sendMessage(remoteJid, {
        text: `❌ Falha ao baixar *${book.title}*.\n\n_${error.message}_`,
      });
    } catch (sendErr) {
      console.error('Erro ao avisar no chat:', sendErr.message);
    }
  } finally {
    md5Locks.delete(book.md5);
    for (const p of [bookPath, coverPath, enhancedPath]) {
      if (p && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch (err) {
          console.error('Erro ao apagar temporário:', err.message);
        }
      }
    }
  }
}