import { createContext } from './browserManager.js';

const BASE_URL = 'https://an1.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function translateToPortuguese(text) {
  if (!text) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) return text;
    const data = await res.json();
    if (data && data[0] && data[0].length > 0) return data[0].map(item => item[0]).join('');
    return text;
  } catch (err) { return text; }
}

function cleanTitleForComparison(title) {
  return title.toLowerCase()
    .replace(/^download\s+/, '')
    .replace(/\(.*?\)/g, '') 
    .replace(/\[.*?\]/g, '')
    .replace(/\b(mod|apk|free|android|on|unlimited|coins|keys|hack|cheat)\b/gi, '') 
    .replace(/\bv?\d+(\.\d+)+\b/g, '') 
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreResult(title, query) {
  const cleanTitle = cleanTitleForComparison(title);
  const cleanQuery = cleanTitleForComparison(query);
  if (cleanTitle === cleanQuery) return 1000;
  if (cleanTitle.startsWith(cleanQuery)) {
    const rest = cleanTitle.substring(cleanQuery.length).trim();
    return rest ? 500 - (rest.length * 5) : 900;
  }
  if (cleanTitle.includes(cleanQuery)) return 100;
  const queryWords = cleanQuery.split(' ');
  const titleWords = cleanTitle.split(' ');
  const matches = queryWords.filter(w => titleWords.includes(w)).length;
  return (matches / queryWords.length) * 50;
}

export async function searchPosts(query, { fast = false } = {}) {
  const context = await createContext({ userAgent: USER_AGENT, locale: 'pt-BR' });
  const page = await context.newPage();
  try {
    const searchUrl = `${BASE_URL}/?do=search&subaction=search&story=${encodeURIComponent(query)}`;
    console.log(`[an1] 🔎 Buscando "${query}"...`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: fast ? 12000 : 60000 });
    await page.waitForTimeout(fast ? 900 : 4000);
    const results = await page.evaluate(() => {
      const items = [];
      const cards = document.querySelectorAll('div.item');
      for (const card of cards) {
        const linkEl = card.querySelector('div.name a');
        const imgEl = card.querySelector('div.img img');
        const devEl = card.querySelector('div.developer');
        if (!linkEl) continue;
        const href = linkEl.href;
        const title = linkEl.getAttribute('title') || linkEl.innerText.trim();
        const image = imgEl ? imgEl.src : null;
        const developer = devEl ? devEl.innerText.trim() : '';
        if (title && href) items.push({ url: href, title, image, developer });
      }
      return items;
    });
    const scoredResults = results.map(item => ({ ...item, score: scoreResult(item.title, query) }));
    scoredResults.sort((a, b) => b.score - a.score);
    const filtered = scoredResults.filter(item => item.score >= 50);
    console.log(`[an1] 🎯 Resultados com pontuação alta: ${filtered.length}`);
    await page.close(); await context.close();
    return filtered;
  } catch (error) {
    await page.close().catch(() => {}); await context.close().catch(() => {});
    throw error;
  }
}

export async function getPostDetails(url) {
  const context = await createContext({ userAgent: USER_AGENT, locale: 'pt-BR' });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    const data = await page.evaluate(() => {
      const titleEl = document.querySelector('h1');
      const title = titleEl ? titleEl.innerText.trim() : document.title;
      let image = null;
      const ogImage = document.querySelector('meta[property="og:image"]');
      if (ogImage && ogImage.content) image = ogImage.content;
      const bodyText = document.body.innerText;
      let version = '', mod = '', size = '';
      const versionMatch = bodyText.match(/Version:\s*([\d\.]+)/i);
      if (versionMatch) version = versionMatch[1].trim();
      const sizeMatch = bodyText.match(/([\d\.]+\s*(?:Mb|MB|Gb|GB|Kb|KB))/i);
      if (sizeMatch) size = sizeMatch[1].toUpperCase();
      const modMatchTitle = title.match(/\((.*?(?:mod|menu|unlocked|money|free).*?)\)/i);
      if (modMatchTitle) mod = modMatchTitle[1];
      let description = '';
      const paragraphs = document.querySelectorAll('div.text, div.full-text, article p');
      for (const p of paragraphs) {
        const text = p.innerText.trim();
        if (text.length > 100) { description = text; break; }
      }
      return { title, image, version, mod, size, description };
    });
    const translatedDescription = await translateToPortuguese(data.description);
    await page.close(); await context.close();
    return { url, title: data.title || '', image: data.image, version: data.version || '', mod: data.mod || '', size: data.size || '', description: translatedDescription || data.description || '' };
  } catch (error) {
    await page.close().catch(() => {}); await context.close().catch(() => {});
    throw error;
  }
}
