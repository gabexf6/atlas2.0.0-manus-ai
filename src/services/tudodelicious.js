import { lazyRequire } from '../utils/lazy.js';
const getCheerio = lazyRequire('cheerio');
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createContext } from './browserManager.js';

const execFileAsync = promisify(execFile);
const BASE_URL = 'https://tudodelicious.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function normalizeText(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
function cleanQuery(query) { return query.replace(/\s+/g, ' ').trim(); }
function scoreRecipe(recipe, queryWords) {
  const titleNorm = normalizeText(recipe.title);
  const descNorm = normalizeText(recipe.description);
  let titleHits = 0, descHits = 0;
  for (const word of queryWords) {
    if (titleNorm.includes(word)) titleHits++;
    if (descNorm.includes(word)) descHits++;
  }
  let score = titleHits * 100 + descHits * 30;
  if (queryWords.length > 0 && titleHits === queryWords.length) score += 200;
  if (recipe.image) score += 10;
  return score;
}
function isoDurationToText(iso) {
  if (!iso) return '';
  const match = iso.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
  if (!match) return iso;
  const [, d, h, m] = match;
  const parts = [];
  if (Number(d)) parts.push(`${Number(d)}d`);
  if (Number(h)) parts.push(`${Number(h)}h`);
  if (Number(m)) parts.push(`${Number(m)}min`);
  if (!parts.length) return /[1-9]/.test(iso) ? iso : '';
  return parts.join(' ');
}
function duracao(valor) {
  const v = String(valor || '').trim();
  if (/^P/i.test(v)) return isoDurationToText(v);
  return limparRotulo(v, /^(tempo de )?(preparo|cozimento|total)[:\s]*/i);
}
function limparRotulo(valor, rotulo) {
  const texto = String(valor || '').replace(rotulo, '').replace(/\s+/g, ' ').trim();
  if (!texto || texto.length > 40) return '';
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
const PALAVRAS_VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'e', 'a', 'o', 'as', 'os', 'na', 'no', 'em', 'para', 'pra', 'ao', 'um', 'uma', 'receita', 'receitas', 'como', 'fazer']);
function variacoesDaBusca(query) {
  const inteiro = cleanQuery(query);
  const palavras = inteiro.split(/\s+/).filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(normalizeText(p)));
  const lista = [inteiro, palavras.join(' ')];
  [...palavras].sort((x, y) => y.length - x.length).forEach((p) => lista.push(p));
  return [...new Set(lista.filter(Boolean))];
}
function textoSemHtml(html) { return getCheerio().load(`<p>${html || ''}</p>`)('p').text().trim(); }
async function buscarNaApiDoSite(page, query) {
  const vistos = new Set();
  const resultados = [];
  for (const termo of variacoesDaBusca(query)) {
    const url = `${BASE_URL}/wp-json/wp/v2/recipe?search=${encodeURIComponent(termo)}&per_page=20&_fields=link,title,excerpt`;
    let itens = [];
    try {
      itens = await page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'include' });
        if (!r.ok) return [];
        const dados = await r.json().catch(() => []);
        return Array.isArray(dados) ? dados : [];
      }, url);
    } catch { itens = []; }
    for (const item of itens) {
      if (!item?.link || vistos.has(item.link)) continue;
      vistos.add(item.link);
      resultados.push({ title: textoSemHtml(item.title?.rendered), url: item.link, description: textoSemHtml(item.excerpt?.rendered).substring(0, 200), image: null });
    }
    if (resultados.length) break;
  }
  return resultados;
}

export async function searchRecipes(query) {
  const cleanedQuery = cleanQuery(query);
  const context = await createContext({ userAgent: USER_AGENT, locale: 'pt-BR', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(cleanedQuery)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const achouLinks = await page.waitForSelector('a[href*="/receita/"], body.search-no-results, body.search-results', { timeout: 20000 }).then(() => page.$('a[href*="/receita/"]')).then(Boolean).catch(() => false);
    if (achouLinks) await page.waitForTimeout(1000);
    const html = await page.content();
    const $ = getCheerio().load(html);
    const results = [];
    $('a[href*="/receita/"]').each((_, linkEl) => {
      const $link = $(linkEl);
      const href = $link.attr('href');
      if (!href) return;
      const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
      if (results.some((r) => r.url === url)) return;
      const title = $link.text().trim();
      if (!title || title.length < 3) return;
      const $article = $link.closest('article, .post, .entry, div').first();
      const description = $article.find('p').first().text().trim().substring(0, 200);
      const image = $article.find('img').first().attr('src') || null;
      results.push({ title, url, description, image });
    });
    const queryWords = normalizeText(query).split(/\s+/).filter((w) => w.length >= 3 && !PALAVRAS_VAZIAS.has(w));
    let scored = results.map((r) => ({ ...r, score: scoreRecipe(r, queryWords) })).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
    if (!scored.length) {
      const daApi = await buscarNaApiDoSite(page, query);
      scored = daApi.map((r) => ({ ...r, score: scoreRecipe(r, queryWords) })).sort((a, b) => b.score - a.score);
    }
    await page.close(); await context.close();
    return scored;
  } catch (error) {
    await page.close().catch(() => {}); await context.close().catch(() => {});
    throw new Error('Não foi possível buscar a receita.');
  }
}

export async function getRecipe(url) {
  const context = await createContext({ userAgent: USER_AGENT, locale: 'pt-BR', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.wprm-recipe-container, h1', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const data = await page.evaluate(() => {
      const result = { title: '', description: '', image: null, servings: '', prepTime: '', cookTime: '', totalTime: '', restTime: '', difficulty: '', category: '', datePublished: '' };
      const lista = (v) => (Array.isArray(v) ? v : [v]).map((x) => (typeof x === 'string' ? x : x?.name || '')).map((x) => String(x).trim()).filter(Boolean).join(', ');
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const script of scripts) {
        try {
          const parsed = JSON.parse(script.textContent);
          const items = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of items) {
            const graph = item['@graph'] ? item['@graph'] : [item];
            for (const node of graph) {
              const type = node['@type'];
              const types = Array.isArray(type) ? type : [type];
              if (!result.datePublished && node.datePublished && types.some((t) => ['Recipe', 'Article', 'BlogPosting', 'WebPage'].includes(t))) result.datePublished = node.datePublished;
              if (!types.includes('Recipe')) continue;
              if (!result.title) result.title = node.name || '';
              if (!result.description) result.description = (node.description || '').replace(/<[^>]*>/g, '').trim();
              if (!result.image && node.image) {
                if (typeof node.image === 'string') result.image = node.image;
                else if (Array.isArray(node.image)) { const first = node.image[0]; result.image = typeof first === 'string' ? first : first?.url || null; }
                else if (node.image.url) result.image = node.image.url;
              }
              if (!result.servings && node.recipeYield) { const y = node.recipeYield; result.servings = Array.isArray(y) ? String(y[0]) : String(y); }
              if (!result.prepTime && node.prepTime) result.prepTime = node.prepTime;
              if (!result.cookTime && node.cookTime) result.cookTime = node.cookTime;
              if (!result.totalTime && node.totalTime) result.totalTime = node.totalTime;
              if (!result.category && node.recipeCategory) result.category = lista(node.recipeCategory);
              if (!result.difficulty) { const dif = node.difficulty || node.recipeDifficulty || node.educationalLevel; if (dif) result.difficulty = lista(dif); }
            }
          }
        } catch {}
      }
      const q = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.trim() : ''; };
      if (!result.title) result.title = q('.wprm-recipe-name') || q('h1');
      if (!result.description) result.description = q('.wprm-recipe-summary');
      if (!result.image) { const img = document.querySelector('.wprm-recipe-image img'); if (img) result.image = img.src; }
      if (!result.servings) result.servings = q('.wprm-recipe-servings-with-unit') || q('.wprm-recipe-servings-container') || q('.wprm-recipe-servings');
      if (!result.prepTime) result.prepTime = q('.wprm-recipe-prep-time-container');
      if (!result.cookTime) result.cookTime = q('.wprm-recipe-cook-time-container');
      if (!result.totalTime) result.totalTime = q('.wprm-recipe-total-time-container');
      const textoPagina = (document.querySelector('.wprm-recipe-container, article, main') || document.body).innerText || '';
      const porRotulo = (rotulos) => {
        for (const r of rotulos) {
          const m = textoPagina.match(new RegExp(`(?:^|\\n)\\s*${r}\\s*:?\\s*\\n?\\s*([^\\n]{1,40})`, 'i'));
          if (m && m[1].trim()) return m[1].trim();
        }
        return '';
      };
      const curto = (t) => (t && t.length <= 40 ? t : '');
      const tag = (nome) => curto(q(`.wprm-recipe-${nome}`)) || curto(q(`.wprm-recipe-${nome}-container`));
      const delicious = (...seletores) => {
        for (const sel of seletores) { const v = curto(q(sel)); if (v) return v; }
        return '';
      };
      if (!result.servings) result.servings = delicious('.dr-sim-metaa.dr-yields b', '.wpdelicious-meta.dr-yields b') || porRotulo(['Porções', 'Rendimento', 'Rende']);
      if (!result.prepTime) result.prepTime = delicious('.dr-prep-time b') || porRotulo(['Tempo de preparo', 'Preparo']);
      if (!result.difficulty) result.difficulty = delicious('.dr-sim-metaa.dr-lavel b', '.wpdelicious-meta.dr-label b') || tag('difficulty') || porRotulo(['Dificuldade', 'Nível']);
      if (!result.category) result.category = delicious('.wpdelicious-recipe-banner .wpdelicious-category a', '.wpdelicious-category a') || tag('course') || porRotulo(['Categoria', 'Tipo de prato', 'Tipo de refeição', 'Curso']);
      result.restTime = curto(q('.wprm-recipe-custom-time-container')) || porRotulo(['Tempo de descanso', 'Descanso', 'Tempo de espera']);
      if (!result.datePublished) { const meta = document.querySelector('meta[property="article:published_time"]'); if (meta) result.datePublished = meta.getAttribute('content') || ''; }
      return result;
    });
    await page.close(); await context.close();
    const cleanServings = (data.servings || '').replace(/^por[çc]ões?[:\s]*/i, '').replace(/^rendimento[:\s]*/i, '').trim();
    return {
      title: data.title, description: data.description, image: data.image, servings: cleanServings,
      prepTime: duracao(data.prepTime), cookTime: duracao(data.cookTime), totalTime: duracao(data.totalTime),
      restTime: limparRotulo(data.restTime, /^(tempo de )?(descanso|espera)[:\s]*/i),
      difficulty: limparRotulo(data.difficulty, /^(dificuldade|n[íi]vel)[:\s]*/i),
      category: limparRotulo(data.category, /^(categoria|tipo de (prato|refei[çc][ãa]o)|curso)[:\s]*/i),
      datePublished: data.datePublished || '', url,
    };
  } catch (error) {
    await page.close().catch(() => {}); await context.close().catch(() => {});
    throw new Error('Não foi possível carregar a receita.');
  }
}

const RECIPE_PATH = '/receita/';
function isRecipeUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.endsWith('tudodelicious.com') && u.pathname.startsWith(RECIPE_PATH) && u.pathname.length > RECIPE_PATH.length + 1 && !u.pathname.startsWith(`${RECIPE_PATH}page/`) && !u.pathname.includes('/feed');
  } catch { return false; }
}
function normalizeRecipeUrl(url) {
  const u = new URL(url); u.search = ''; u.hash = '';
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u.toString();
}
function looksBlocked(text) { return /just a moment|cf-chl|challenge-platform|attention required/i.test(text || ''); }

async function fetchPageText(url) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const text = await response.text();
    if (response.ok && !looksBlocked(text)) return text;
    if (response.status === 404) return null;
  } catch {}
  const context = await createContext({ userAgent: USER_AGENT, locale: 'pt-BR', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (response && response.status() === 404) return null;
    const body = response ? await response.text().catch(() => null) : null;
    return body || (await page.content());
  } catch { return null; } finally { await page.close().catch(() => {}); await context.close().catch(() => {}); }
}
function extractLocs(xml) { return [...String(xml || '').matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/gi)].map((m) => m[1].trim()); }
function uniqueRecipeUrls(urls) {
  const seen = new Set(); const out = [];
  for (const url of urls) {
    if (!isRecipeUrl(url)) continue;
    const clean = normalizeRecipeUrl(url);
    if (seen.has(clean)) continue;
    seen.add(clean); out.push(clean);
  }
  return out;
}
async function recipeUrlsFromSitemap() {
  const indexes = ['/wp-sitemap.xml', '/sitemap_index.xml', '/sitemap.xml'];
  for (const indexPath of indexes) {
    const xml = await fetchPageText(`${BASE_URL}${indexPath}`);
    if (!xml || !/<loc>/i.test(xml)) continue;
    const locs = extractLocs(xml);
    const direct = uniqueRecipeUrls(locs);
    if (direct.length) return direct;
    const children = locs.filter((loc) => /\.xml/i.test(loc) && /receita|recipe|post/i.test(loc)).slice(0, 15);
    const all = [];
    for (const child of children) { const childXml = await fetchPageText(child); all.push(...extractLocs(childXml)); }
    const urls = uniqueRecipeUrls(all);
    if (urls.length) return urls;
  }
  return [];
}
async function recipeUrlsFromFeed() {
  for (const feedPath of ['/receita/feed/', '/feed/']) {
    const xml = await fetchPageText(`${BASE_URL}${feedPath}`);
    if (!xml || !/<item>/i.test(xml)) continue;
    const links = [...xml.matchAll(/<item>[\s\S]*?<link>\s*([^<\s]+)/gi)].map((m) => m[1]);
    const urls = uniqueRecipeUrls(links);
    if (urls.length) return urls;
  }
  return [];
}
async function recipeUrlsFromHome() {
  const html = await fetchPageText(`${BASE_URL}/`);
  if (!html) return [];
  const $ = getCheerio().load(html);
  const hrefs = [];
  $('a[href*="/receita/"]').each((_, el) => { const href = $(el).attr('href'); if (href) hrefs.push(href.startsWith('http') ? href : `${BASE_URL}${href}`); });
  return uniqueRecipeUrls(hrefs);
}
let allRecipesCache = { at: 0, urls: [] };
const ALL_RECIPES_CACHE_MS = 6 * 60 * 60 * 1000;
export async function listAllRecipeUrls() {
  if (allRecipesCache.urls.length && Date.now() - allRecipesCache.at < ALL_RECIPES_CACHE_MS) return allRecipesCache.urls;
  let urls = await recipeUrlsFromSitemap();
  if (!urls.length) urls = await recipeUrlsFromFeed();
  if (!urls.length) urls = await recipeUrlsFromHome();
  if (urls.length) allRecipesCache = { at: Date.now(), urls };
  return urls;
}
export async function listLatestRecipeUrls() {
  let urls = await recipeUrlsFromFeed();
  if (!urls.length) urls = await recipeUrlsFromHome();
  if (!urls.length) urls = await recipeUrlsFromSitemap();
  return urls;
}

export async function downloadRecipeImage(imageUrl, destinationDir) {
  await fs.promises.mkdir(destinationDir, { recursive: true });
  const uniqueId = crypto.randomBytes(4).toString('hex');
  const filePath = path.join(destinationDir, `recipe_${uniqueId}.jpg`);
  const response = await fetch(imageUrl, { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*', Referer: BASE_URL }, redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar imagem`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(filePath, buffer);
  return { filePath, size: buffer.length };
}

export async function enhanceRecipeImage(inputPath, outputPath) {
  try {
    await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', inputPath, '-vf', 'scale=800:-2:flags=lanczos,unsharp=5:5:0.5', '-q:v', '2', '-f', 'image2', outputPath], { timeout: 30000 });
    return outputPath;
  } catch (err) {
    return inputPath;
  }
}