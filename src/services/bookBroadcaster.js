import fs from 'fs';
import path from 'path';
import { searchBooks, downloadCover, downloadBookByMd5 } from './annas-archive.js';

const DB_DIR = path.resolve('database');
const DB_FILE = path.join(DB_DIR, 'livros-broadcast.json');

const INTERVAL_MS = 2 * 60 * 60 * 1000;
const MAX_SIZE = 900 * 1024 * 1024;

const TEMAS_POPULARES = [
  'romance',
  'dark romance',
  'suspense',
  'fantasia',
  'ficção científica',
  'mangá',
  'autoajuda',
  'biografia',
  'história',
  'poesia',
  'terror',
  'literatura brasileira',
  'crime',
  'distopia',
  'aventura',
  'fantasia épica',
  'mistério',
  'young adult',
  'clássicos',
  'comédia romântica',
  'thriller psicológico',
];

let intervalHandle = null;

function lerGrupos() {
  try {
    if (!fs.existsSync(DB_FILE)) return [];
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function salvarGrupos(grupos) {
  try {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(grupos, null, 2));
  } catch (error) {
    console.error('[livros] Erro ao salvar grupos:', error.message);
  }
}

export function listBookGroups() {
  return lerGrupos();
}

export function addBookGroup(jid) {
  const grupos = lerGrupos();
  if (grupos.includes(jid)) return false;
  grupos.push(jid);
  salvarGrupos(grupos);
  return true;
}

export function removeBookGroup(jid) {
  const grupos = lerGrupos();
  const idx = grupos.indexOf(jid);
  if (idx === -1) return false;
  grupos.splice(idx, 1);
  salvarGrupos(grupos);
  return true;
}

function temaAleatorio() {
  return TEMAS_POPULARES[Math.floor(Math.random() * TEMAS_POPULARES.length)];
}

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
}

function getMimetype(fileName) {
  const ext = path.extname(fileName || '').toLowerCase();
  const MIMES = {
    '.epub': 'application/epub+zip',
    '.pdf': 'application/pdf',
    '.mobi': 'application/x-mobipocket-ebook',
    '.azw': 'application/vnd.amazon.ebook',
    '.azw3': 'application/vnd.amazon.ebook',
    '.fb2': 'application/x-fictionbook+xml',
    '.djvu': 'image/vnd.djvu',
    '.txt': 'text/plain',
    '.cbz': 'application/vnd.comicbook+zip',
    '.cbr': 'application/vnd.comicbook-rar',
  };
  return MIMES[ext] || 'application/octet-stream';
}

function isPortuguese(book) {
  const meta = book.meta || '';
  return /portugu[eê]s\s*\[pt\]|Portuguese\s*\[pt\]|\[pt\]/i.test(meta);
}

function hasCover(book) {
  return Boolean(book.cover && /^https?:\/\//i.test(book.cover));
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

  const linhas = [];
  linhas.push(`📖 *${book.title}*`);

  if (book.author) {
    linhas.push(`✍️ ${book.author}`);
  }

  linhas.push('');

  const details = [];
  if (language) details.push(`🌐 ${language}`);
  if (format) details.push(`📄 ${format}`);
  if (size) details.push(`💾 ${size}`);
  if (year) details.push(`📅 ${year}`);

  if (details.length > 0) {
    linhas.push(details.join('  ·  '));
  }

  return linhas.join('\n');
}

export async function sendRandomBook(socket, jids) {
  const tempDir = path.resolve('assets', 'temp', 'downloads');
  const temasTentados = [];

  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const tema = temaAleatorio();
    temasTentados.push(tema);
    console.log(`[livros] Tentativa ${tentativa + 1}: "${tema}"`);

    let candidatos = [];
    try {
      const resultados = await searchBooks(tema);
      candidatos = resultados.filter((b) => isPortuguese(b) && hasCover(b));
    } catch (error) {
      console.error(`[livros] Erro buscando "${tema}":`, error.message);
      continue;
    }

    if (!candidatos.length) {
      console.log(`[livros] Nenhum candidato PT+com-capa pra "${tema}"`);
      continue;
    }

    const topN = candidatos.slice(0, 5).sort(() => Math.random() - 0.5);

    for (const candidato of topN) {
      let capaPath = null;
      let bookPath = null;

      try {
        const capaResult = await downloadCover(candidato.cover, tempDir);
        capaPath = capaResult.filePath;

        const bookResult = await downloadBookByMd5(candidato.md5, tempDir);
        bookPath = bookResult.filePath;
        const fileName = bookResult.fileName;
        const size = bookResult.size;

        if (size > MAX_SIZE) {
          console.log(`[livros] ${fileName} acima de 100MB, pulando`);
          continue;
        }

        const caption = buildCaption(candidato);
        const buffer = fs.readFileSync(bookPath);
        const mimetype = getMimetype(fileName);

        for (const jid of jids) {
          try {
            await socket.sendMessage(jid, {
              image: fs.readFileSync(capaPath),
              caption,
              mimetype: 'image/jpeg',
            });
            await socket.sendMessage(jid, {
              document: buffer,
              mimetype,
              fileName,
            });
          } catch (err) {
            console.error(`[livros] Erro ao enviar pra ${jid}:`, err.message);
          }
        }

        console.log(`[livros] ✅ Enviado: ${candidato.title}`);
        return candidato;
      } catch (error) {
        console.error(
          `[livros] Falha com "${candidato.title}": ${error.message}`,
        );
      } finally {
        if (bookPath && fs.existsSync(bookPath)) {
          try {
            fs.unlinkSync(bookPath);
          } catch {}
        }
        if (capaPath && fs.existsSync(capaPath)) {
          try {
            fs.unlinkSync(capaPath);
          } catch {}
        }
      }
    }
  }

  throw new Error(
    `Nenhum livro PT+com-capa conseguiu ser baixado (temas: ${temasTentados.join(', ')})`,
  );
}

export function startBookBroadcaster(socket) {
  if (intervalHandle) clearInterval(intervalHandle);

  intervalHandle = setInterval(async () => {
    const grupos = listBookGroups();
    if (!grupos.length) return;

    try {
      await sendRandomBook(socket, grupos);
    } catch (error) {
      console.error('[livros] Erro no broadcast:', error.message);
    }
  }, INTERVAL_MS);

  console.log('[livros] Broadcaster iniciado (a cada 45min)');
}