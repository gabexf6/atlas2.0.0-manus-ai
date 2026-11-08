import { createContext } from './browserManager.js';
import { lazyRequire } from '../utils/lazy.js';
const getCheerio = lazyRequire('cheerio');
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const BASE_URL = 'https://br.annas-archive.pk';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function parseSizeToBytes(text) {
  if (!text) return Infinity;
  const match = text.match(/([\d.]+)\s*(KB|MB|GB)/i);
  if (!match) return Infinity;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const mult = unit === 'KB' ? 1024 : unit === 'MB' ? 1024 ** 2 : 1024 ** 3;
  return value * mult;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function normalizeText(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[''`']/g, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function hasWord(haystack, needle) {
  if (!haystack || !needle) return false;
  return haystack.split(/\s+/).some((t) => t === needle);
}
function cleanQuery(query) {
  return query.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/#\d+/g, ' ').replace(/\s+/g, ' ').trim();
}
function isJunkLine(line) {
  if (!line) return true;
  if (line.length > 200) return true;
  if (/function\s*\(|addEventListener|scriptParent|document\.|window\.|=>|reloadNode|var\s+|createElement|innerHTML|appendChild|getBoundingClientRect|setTimeout|fetch\(|Promise|querySelector/i.test(line)) return true;
  if (/^[{}\s;,]+$/.test(line)) return true;
  if (/^\(function|^\}\)\(\);?$/i.test(line)) return true;
  return false;
}
function cleanMetaLine(line) {
  return line.replace(/\s*·\s*Save\s*$/i, '').replace(/\s*·\s*[\d.,]+\s*·\s*[\d.,]+\s*$/i, '').replace(/\s*·\s*[\d.,]+\s*$/i, '').replace(/\s+/g, ' ').trim();
}
function scoreResult(book, queryWords) {
  const titleNorm = normalizeText(book.title);
  const authorNorm = normalizeText(book.author);
  const metaNorm = normalizeText(book.meta);
  let titleHits = 0, authorHits = 0, metaHits = 0;
  for (const word of queryWords) {
    if (hasWord(titleNorm, word)) titleHits++;
    if (hasWord(authorNorm, word)) authorHits++;
    if (hasWord(metaNorm, word)) metaHits++;
  }
  let score = titleHits * 100 + authorHits * 80 + metaHits * 20;
  if (queryWords.length > 0 && titleHits === queryWords.length) score += 300;
  if (queryWords.length > 0 && titleHits + authorHits + metaHits >= queryWords.length) score += 100;
  if (/\bepub\b/i.test(book.meta)) score += 40;
  else if (/\bmobi\b/i.test(book.meta)) score += 20;
  else if (/\bpdf\b/i.test(book.meta)) score += 10;
  if (/portugu[eê]s|pt\]/i.test(book.meta)) score += 30;
  else if (/ingl[eê]s|en\]/i.test(book.meta)) score += 15;
  const sizeBytes = parseSizeToBytes(book.meta);
  if (sizeBytes < 2 * 1024 * 1024) score += 25;
  else if (sizeBytes < 5 * 1024 * 1024) score += 15;
  else if (sizeBytes < 20 * 1024 * 1024) score += 5;
  if (book.title.length < 60) score += 20;
  else if (book.title.length < 100) score += 5;
  else if (book.title.length > 200) score -= 50;
  else if (book.title.length > 150) score -= 20;
  return score;
}

export async function searchBooks(query) {
  const cleanedQuery = cleanQuery(query);
  const context = await createContext({ userAgent: USER_AGENT, locale: 'pt-BR', viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();

  try {
    const cacheBuster = Date.now();
    const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(cleanedQuery)}&_=${cacheBuster}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('a[href*="/md5/"]', { timeout: 30000 });
    await page.waitForTimeout(1000);
    const html = await page.content();
    await page.close(); await context.close();

    const $ = getCheerio().load(html);
    const rawResults = [];
    $('div[id^="list_cover_"]').each((_, coverDiv) => {
      const $cover = $(coverDiv);
      const $link = $cover.closest('a[href*="/md5/"]');
      const href = $link.attr('href');
      if (!href) return;
      const md5 = href.replace('/md5/', '').replace('#', '').trim();
      if (!md5 || md5.length !== 32) return;
      if (rawResults.some((r) => r.md5 === md5)) return;
      const $container = $link.closest('div').parent();
      const $card = $container.length ? $container : $link.parent();
      let title = '';
      $card.find('a[href*="/md5/"]').each((_, el) => {
        const $a = $(el);
        const cls = $a.attr('class') || '';
        const text = $a.text().trim();
        if (cls.includes('text-lg') && text && !title) title = text;
      });
      if (!title) title = $cover.find('.text-violet-900').text().trim();
      if (!title) {
        $card.find('a[href*="/md5/"]').each((_, el) => {
          const text = $(el).text().trim();
          if (text && !title && text.length > 2 && text.length < 300) title = text;
        });
      }
      if (!title) return;
      let author = '';
      $card.find('a[href*="/search?q="]').each((_, el) => {
        const $a = $(el);
        const icon = $a.find('span[class*="icon-"]').attr('class') || '';
        const text = $a.text().trim();
        if (icon.includes('user-edit') && text && !author) author = text;
      });
      let meta = '';
      $card.find('div.text-gray-800').each((_, el) => {
        if (meta) return;
        const textoCompleto = $(el).text().trim();
        if (!textoCompleto.includes('·')) return;
        const linhas = textoCompleto.split('\n').map((l) => cleanMetaLine(l)).filter(Boolean).filter((l) => !isJunkLine(l)).filter((l) => l.includes('·'));
        if (linhas.length > 0) meta = linhas.slice(0, 2).join(' ').substring(0, 250).trim();
      });
      const cover = $cover.find('img').attr('src') || null;
      rawResults.push({ md5, title, author, meta, cover });
    });

    if (rawResults.length === 0) return [];
    const queryWords = normalizeText(query).split(/\s+/).filter((w) => w.length >= 3);
    return rawResults.map((r) => ({ ...r, score: scoreResult(r, queryWords) })).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
  } catch (error) {
    await page.close().catch(() => {}); await context.close().catch(() => {});
    throw new Error('Não foi possível buscar o livro.');
  }
}

export async function downloadCover(coverUrl, destinationDir) {
  await fs.promises.mkdir(destinationDir, { recursive: true });
  const uniqueId = crypto.randomBytes(4).toString('hex');
  const filePath = path.join(destinationDir, `cover_${uniqueId}.jpg`);
  const response = await fetch(coverUrl, { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*', Referer: BASE_URL }, redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar capa`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(filePath, buffer);
  return { filePath, size: buffer.length };
}

export async function enhanceCover(inputPath, outputPath) {
  try {
    await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', inputPath, '-vf', 'scale=512:-2:flags=lanczos,unsharp=5:5:0.5', '-q:v', '2', '-f', 'image2', outputPath], { timeout: 30000 });
    return outputPath;
  } catch (err) { return inputPath; }
}

async function esperarBotaoBaixar(page, timeoutMs = 180_000, serverId = '?') {
  const inicio = Date.now(); let ultimoLog = 0;
  while (Date.now() - inicio < timeoutMs) {
    const porTexto = await page.$('a:has-text("Baixar agora")').catch(() => null);
    if (porTexto) return porTexto;
    const href = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      for (const a of links) {
        const h = a.getAttribute('href') || '';
        if (/wbsg8v\.xyz|momot\.rs|download\.|\.apk|\.epub|\.pdf|\.mobi|\.zip/i.test(h) && !h.includes('annas-archive')) return h;
      }
      return null;
    }).catch(() => null);
    if (href) { const el = await page.$(`a[href="${href}"]`).catch(() => null); if (el) return el; }
    const porTextoCurto = await page.$('a:has-text("Baixar")').catch(() => null);
    if (porTextoCurto) { const texto = await porTextoCurto.textContent().catch(() => ''); if (/baixar/i.test(texto)) return porTextoCurto; }
    const decorrido = Math.floor((Date.now() - inicio) / 1000);
    if (decorrido >= ultimoLog + 30) { ultimoLog = decorrido; console.log(`⏳ Aguardando botão #${serverId}: ${decorrido}s...`); }
    await sleep(2000);
  }
  throw new Error(`Botão não apareceu em ${timeoutMs / 1000}s`);
}

async function extrairLinkDoServidor(md5, serverId) {
  const context = await createContext({ userAgent: USER_AGENT, locale: 'pt-BR', viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  try {
    const downloadPageUrl = `${BASE_URL}/slow_download/${md5}/0/${serverId}`;
    await page.goto(downloadPageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const linkEl = await esperarBotaoBaixar(page, 180_000, serverId);
    const downloadUrl = await linkEl.getAttribute('href');
    if (!downloadUrl || !downloadUrl.startsWith('http')) throw new Error(`Link inválido: ${downloadUrl}`);
    const cookies = await context.cookies(downloadUrl);
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    await page.close().catch(() => {}); await context.close().catch(() => {});
    return { downloadUrl, downloadPageUrl, cookieHeader };
  } catch (error) {
    await page.close().catch(() => {}); await context.close().catch(() => {});
    throw error;
  }
}

async function baixarDeServidor(md5, serverId, destinationDir, onProgress) {
  const { downloadUrl, downloadPageUrl, cookieHeader } = await extrairLinkDoServidor(md5, serverId);
  let fileName = '';
  try { const urlPath = new URL(downloadUrl).pathname; fileName = decodeURIComponent(urlPath.split('/').pop() || ''); } catch { fileName = `${md5}.epub`; }
  fileName = (fileName || `${md5}.epub`).replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!path.extname(fileName)) fileName += '.epub';
  if (fileName.length > 180) { const ext = path.extname(fileName); fileName = fileName.substring(0, 170) + ext; }
  const uniqueId = crypto.randomBytes(4).toString('hex');
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  fileName = `${baseName}__${uniqueId}${ext}`;
  await fs.promises.mkdir(destinationDir, { recursive: true });
  const filePath = path.join(destinationDir, fileName);
  await downloadSingleStream(downloadUrl, filePath, { referer: downloadPageUrl, cookie: cookieHeader }, onProgress);
  if (!fs.existsSync(filePath)) throw new Error('Arquivo não encontrado após o download.');
  const stats = fs.statSync(filePath);
  if (stats.size === 0) { fs.unlinkSync(filePath); throw new Error('Arquivo vazio'); }
  return { filePath, fileName, size: stats.size, serverId };
}

export async function downloadBookByMd5(md5, destinationDir, onProgress) {
  const SERVERS = [6, 2, 7, 1, 3, 4, 5, 8];
  const erros = [];
  for (const serverId of SERVERS) {
    try {
      const resultado = await baixarDeServidor(md5, serverId, destinationDir, onProgress);
      return resultado;
    } catch (error) { erros.push(`#${serverId}: ${error.message.substring(0, 100)}`); continue; }
  }
  throw new Error(`Todos os servidores falharam:\n${erros.join('\n')}`);
}

async function downloadSingleStream(url, filePath, { referer, cookie } = {}, onProgress) {
  const MAX_TENTATIVAS = 3;
  const TIMEOUT_MS = 45 * 60 * 1000;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    let startByte = 0;
    if (fs.existsSync(filePath)) startByte = fs.statSync(filePath).size;
    const headers = { 'User-Agent': USER_AGENT, Accept: '*/*', 'Accept-Encoding': 'identity', Connection: 'keep-alive' };
    if (referer) headers.Referer = referer;
    if (cookie) headers.Cookie = cookie;
    if (startByte > 0) headers.Range = `bytes=${startByte}-`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try { response = await fetch(url, { headers, redirect: 'follow', signal: controller.signal }); }
    catch (err) { clearTimeout(timeoutId); await sleep(3000 * tentativa); continue; }
    if ([504, 503, 502].includes(response.status)) { clearTimeout(timeoutId); await sleep(15000 * tentativa); continue; }
    if (response.status === 429) { clearTimeout(timeoutId); await sleep(20000 * tentativa); continue; }
    if (!response.ok && response.status !== 206) { clearTimeout(timeoutId); throw new Error(`HTTP ${response.status}`); }
    const isResume = response.status === 206;
    if (startByte > 0 && !isResume) { fs.writeFileSync(filePath, ''); startByte = 0; }
    const totalEsperado = parseInt(response.headers.get('content-length') || '0', 10);
    const total = totalEsperado > 0 ? (isResume ? startByte + totalEsperado : totalEsperado) : 0;
    const writeStream = fs.createWriteStream(filePath, { flags: isResume && startByte > 0 ? 'a' : 'w' });
    let downloaded = startByte, lastPct = -1, lastLog = Date.now();
    try {
      const nodeStream = Readable.fromWeb(response.body);
      nodeStream.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = Math.floor((downloaded / total) * 100);
          if (pct >= lastPct + 10 || Date.now() - lastLog > 15000) {
            lastPct = pct; lastLog = Date.now();
            try { onProgress({ downloaded, total }); } catch {}
          }
        }
      });
      await pipeline(nodeStream, writeStream); clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId); writeStream.destroy();
      if (err.name === 'AbortError') throw new Error('Download cancelado: timeout.');
      await sleep(3000 * tentativa); continue;
    }
    if (!fs.existsSync(filePath)) { await sleep(2000); continue; }
    const finalSize = fs.statSync(filePath).size;
    if (total > 0 && finalSize < total) { await sleep(2000); continue; }
    return;
  }
  throw new Error(`Servidor indisponível após ${MAX_TENTATIVAS} tentativas.`);
}