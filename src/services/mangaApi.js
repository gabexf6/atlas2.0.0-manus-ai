import fs from 'node:fs';
import path from 'node:path';
import { createContext } from './browserManager.js';
import { ZipStoreWriter } from '../utils/zipStore.js';

const BASE_URL = (process.env.ATLAS_MANGA_BASE_URL || 'https://atsu.moe').replace(/\/+$/, '');
const API_BASE = `${BASE_URL}/api`;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const IMAGE_THREADS = 4; // Não gasta RAM, então pode ser 4
const BLOCK_IMAGES_DEFAULT = process.env.ATLAS_MANGA_BLOCK_IMAGES !== '0';

const searchCache = new Map();
const infoCache = new Map();
const chaptersCache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

export function parseMangaUrl(input) {
  let str = String(input || '').trim();
  if (str.includes('atsu.moe') || /manga\s+[A-Za-z0-9_-]+/i.test(str)) {
    str = str.replace(/\s+/g, '/');
  }
  const match = str.match(/(?:atsu\.moe\/)?manga\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
}

export function mangaIdFromHref(href) {
  return String(href || '').match(/\/manga\/([^/?#]+)/)?.[1] || null;
}

// ---------- extratores ----------

export function extractSearchResults() {
  const results = [];
  const links = document.querySelectorAll('a[href^="/manga/"]');
  for (const a of links) {
    const titleEl = a.querySelector('.line-clamp-3, .line-clamp-2, h3, p') || a;
    const name = titleEl.textContent.trim().replace(/\s+/g, ' ');
    if (name && name.length > 1) {
      results.push({ name, href: a.getAttribute('href') });
    }
  }
  return results;
}

export function extractChapterLinks() {
  const found = {};
  for (const a of document.querySelectorAll('a[href*="/read/"]')) {
    const href = a.getAttribute('href');
    const id = (href.match(/\/read\/[^/]+\/([^/"]+)/) || [])[1];
    if (!id) continue;
    const title = (a.querySelector('span.truncate')?.textContent || '').trim() || null;
    if (title === 'Start reading') continue;
    if (!found[id] || (found[id].title === null && title)) found[id] = { title, href };
  }
  return found;
}

// ---------- navegador ----------

async function withPage(fn, { blockImages = BLOCK_IMAGES_DEFAULT, blockAds = true } = {}) {
  const context = await createContext({
    userAgent: BROWSER_UA,
    locale: 'pt-BR',
    viewport: { width: 1024, height: 768 },
  });

  try {
    if (blockAds || blockImages) {
      await context.route('**/*', (route) => {
        const req = route.request();
        const url = req.url();
        const type = req.resourceType();

        if (/google-analytics|googletagmanager|doubleclick|facebook|adsystem|adservice|popads|propeller|histats|scorecardresearch/i.test(url)) {
          return route.abort();
        }

        if (blockImages && (type === 'image' || type === 'font' || type === 'media')) {
          return route.abort();
        }

        return route.continue();
      });
    }
    const page = await context.newPage();
    return await fn(page, context);
  } finally {
    await context.close().catch(() => {});
  }
}

async function openAndSettle(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (error) {
    if (!/Timeout/i.test(error.message)) throw error;
  }
  await new Promise(r => setTimeout(r, 2000));
}

// ---------- HTTP (APIs via navegador) ----------

async function fetchJsonInPage(page, url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const data = await page.evaluate(async (apiUrl) => {
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      }, url);
      return data;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastError;
}

// ---------- busca e informações ----------

export async function searchManga(name, retries = 2) {
  const cacheKey = name.toLowerCase().trim();
  if (searchCache.has(cacheKey)) return searchCache.get(cacheKey);

  for (let attempt = 0; attempt < retries; attempt++) {
    const results = await withPage(async (page) => {
      await openAndSettle(page, `${BASE_URL}/explore?search=${encodeURIComponent(name)}`);
      await page.waitForSelector('a[href^="/manga/"]', { timeout: 8000 }).catch(() => {});
      const raw = await page.evaluate(extractSearchResults);
      const seen = new Set();
      const res = [];
      for (const item of raw) {
        const id = mangaIdFromHref(item.href);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        res.push({ id, name: item.name, href: item.href });
      }
      return res;
    });

    if (results.length > 0) {
      searchCache.set(cacheKey, results);
      setTimeout(() => searchCache.delete(cacheKey), CACHE_TTL);
      return results;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return [];
}

function findCoverUrl(value, depth = 0) {
  if (!value || depth > 3) return null;
  if (typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (typeof inner === 'string' && /poster|cover|thumb|image/i.test(key)) {
        if (/\.(jpe?g|png|webp)(\?|$)/i.test(inner) || inner.includes('/static/') || inner.includes('/image')) {
          return new URL(inner, BASE_URL).href;
        }
      }
    }
    for (const inner of Object.values(value)) {
      const found = findCoverUrl(inner, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export async function getMangaInfo(id) {
  if (infoCache.has(id)) return infoCache.get(id);

  try {
    const info = await withPage(async (page) => {
      await openAndSettle(page, `${BASE_URL}/manga/${id}`);
      const data = await fetchJsonInPage(page, `${API_BASE}/manga/page?id=${encodeURIComponent(id)}`);
      const pageData = data?.mangaPage || {};
      return {
        id,
        title: pageData.title || pageData.name || null,
        status: pageData.status || null,
        cover: findCoverUrl(pageData),
      };
    }, { blockImages: true });

    if (info.title) {
      infoCache.set(id, info);
      setTimeout(() => infoCache.delete(id), CACHE_TTL);
    }
    return info;
  } catch {
    return { id, title: null, status: null, cover: null };
  }
}

// ---------- capítulos ----------

export function numberFromTitle(title) {
  const match = String(title || '').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

export function normalizeChapters(list, mangaId) {
  const byNumber = new Map();
  for (const item of list) {
    const id = String(item.id);
    const number = item.number != null ? Number(item.number) : numberFromTitle(item.title);
    if (number == null || Number.isNaN(number)) continue;
    if (byNumber.has(number)) continue;
    
    // Tenta descobrir a quantidade de páginas para travar o download
    const pageCount = item.pageCount || item.pages || item.images?.length || item.totalPages || null;

    byNumber.set(number, {
      id,
      number,
      title: item.title || `Capítulo ${number}`,
      href: item.href || `/read/${mangaId}/${id}`,
      pageCount: pageCount
    });
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

async function chaptersFromApi(id) {
  return withPage(async (page) => {
    await openAndSettle(page, `${BASE_URL}/manga/${id}`);
    const data = await fetchJsonInPage(page, `${API_BASE}/manga/allChapters?mangaId=${encodeURIComponent(id)}`);
    return Array.isArray(data?.chapters) ? data.chapters : [];
  }, { blockImages: true });
}

async function chaptersFromPage(id) {
  return withPage(async (page) => {
    await openAndSettle(page, `${BASE_URL}/manga/${id}?filter=all`);
    const seen = {};
    let stale = 0;
    for (let i = 0; i < 150 && stale < 4; i += 1) {
      const found = await page.evaluate(extractChapterLinks);
      const before = Object.keys(seen).length;
      for (const [cid, info] of Object.entries(found)) {
        if (!seen[cid] || (!seen[cid].title && info.title)) seen[cid] = info;
      }
      stale = Object.keys(seen).length === before ? stale + 1 : 0;
      await page.evaluate(() => window.scrollBy(0, 800));
      await new Promise(r => setTimeout(r, 600));
    }
    return Object.entries(seen).map(([cid, info]) => ({ id: cid, title: info.title, href: info.href }));
  });
}

export async function getChapters(id) {
  if (chaptersCache.has(id)) return chaptersCache.get(id);

  let raw = [];
  try {
    raw = await chaptersFromApi(id);
  } catch (error) {
    console.error('[manga] API de capítulos falhou, usando a página:', error.message);
  }
  if (!raw.length) raw = await chaptersFromPage(id);
  
  const normalized = normalizeChapters(raw, id);
  if (normalized.length > 0) {
    chaptersCache.set(id, normalized);
    setTimeout(() => chaptersCache.delete(id), CACHE_TTL);
  }
  return normalized;
}

export function parseChapterSpec(spec) {
  const text = String(spec || '').trim();
  const range = text.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y);
    return { min: a, max: b };
  }
  if (/^\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*$/.test(text)) {
    return { list: text.split(',').map((n) => Number(n.trim())) };
  }
  return null;
}

export function selectChapters(chapters, spec) {
  if (spec.list) return chapters.filter((c) => spec.list.includes(c.number));
  return chapters.filter((c) => c.number >= spec.min && c.number <= spec.max);
}

// ---------- download do capítulo ----------

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

function extensionFor(url, contentType) {
  const fromType = EXT_BY_TYPE[String(contentType || '').split(';')[0].trim().toLowerCase()];
  if (fromType) return fromType;
  const fromUrl = path.extname(new URL(url).pathname).replace('.', '').toLowerCase();
  return fromUrl || 'jpg';
}

export function safeFileName(text) {
  return String(text).replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'manga';
}

export async function buildChapterCbz({ chapter, outPath }) {
  const targetUrl = new URL(chapter.href, BASE_URL).href;

  // blockImages: false para o nosso próprio route.fetch cuidar das imagens
  return withPage(async (page, context) => {
    const downloadedImages = [];

    // A MÁGICA ACONTECE AQUI: Baixa a imagem via route.fetch (evita 403) e aborta a renderização (evita OOM e corrupção)
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      const type = req.resourceType();

      if (/google-analytics|googletagmanager|doubleclick|facebook|adsystem|adservice|popads|propeller|histats|scorecardresearch/i.test(url)) {
        return route.abort();
      }

      if (type === 'image') {
        if (!/logo|icon|avatar|banner|ads|tracker|profile/i.test(url)) {
          try {
            const response = await route.fetch(); // Baixa os bytes reais via rede do Chromium
            const buffer = await response.body();
            
            // Filtro de segurança: ignora imagens minúsculas (pixels de rastreamento/ícones)
            if (buffer.length > 1000) {
              downloadedImages.push({ 
                url, 
                buffer, 
                type: response.headers()['content-type'] || '' 
              });
            }
          } catch (e) {
            // Ignora falhas em imagens individuais
          }
        }
        return route.abort(); // Impede a renderização da imagem (Salva RAM)
      }

      if (type === 'font' || type === 'media') {
        return route.abort();
      }

      return route.continue();
    });

    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (error) {
      if (!/Timeout/i.test(error.message)) throw error;
    }

    // Dá um tempo para o React carregar as primeiras imagens
    await new Promise(r => setTimeout(r, 2000));

    // Rola um pouco para forçar o lazy-load apenas do capítulo atual
    try {
      await page.mouse.move(400, 400);
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, 1500);
        await new Promise(r => setTimeout(r, 200));
      }
    } catch {}

    // Tempo extra para os últimos downloads via network finalizarem
    await new Promise(r => setTimeout(r, 2000));

    if (!downloadedImages.length) throw new Error('não encontrei as páginas desse capítulo');

    // 1. Limpeza e Remoção de Duplicatas
    const uniqueMap = new Map();
    for (const img of downloadedImages) {
      uniqueMap.set(img.url, img);
    }
    let images = Array.from(uniqueMap.values());

    // 2. Ordenação Natural (1, 2, 10)
    images.sort((a, b) => a.url.localeCompare(b.url, undefined, { numeric: true, sensitivity: 'base' }));

    // 3. FILTRO CRUCIAL: Mantém apenas imagens do mesmo diretório (bloqueia Capítulo 2)
    if (images.length > 0) {
      const firstUrl = images[0].url;
      const match = firstUrl.match(/(https?:\/\/.+?\/[^\/]+?\/)/);
      if (match) {
        const baseDir = match[1];
        images = images.filter(img => img.url.startsWith(baseDir));
      }
    }

    // 4. Trava Final: Corta o número de páginas caso o site informe o total
    if (chapter.pageCount && images.length > chapter.pageCount) {
      images = images.slice(0, chapter.pageCount);
    } else if (images.length > 100) {
      images = images.slice(0, 100); // Segurança extra
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const zip = new ZipStoreWriter(outPath);
    const pad = String(images.length).length < 3 ? 3 : String(images.length).length;

    try {
      for (let i = 0; i < images.length; i++) {
        const number = String(i + 1).padStart(pad, '0');
        const ext = extensionFor(images[i].url, images[i].type);
        await zip.addFile(`${number}.${ext}`, images[i].buffer);
      }
      await zip.finish();
    } catch (error) {
      zip.abort();
      fs.rmSync(outPath, { force: true });
      throw error;
    }

    return { pages: images.length, size: fs.statSync(outPath).size };
  }, { blockAds: true, blockImages: false });
}

export async function downloadCoverBuffer(url) {
  if (!url) return null;
  try {
    return await withPage(async (page, context) => {
      const response = await context.request.get(url, {
        headers: { 'Referer': `${BASE_URL}/`, 'Accept': 'image/avif,image/webp,*/*' },
        timeout: 30000,
      });
      if (!response.ok()) return null;
      return await response.body();
    }, { blockImages: true });
  } catch {
    return null;
  }
}