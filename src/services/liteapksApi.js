import { createContext } from './browserManager.js';

const BASE_URL = 'https://liteapks.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function translateToPortuguese(text) {
  if (!text) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) return text;
    const data = await res.json();
    if (data && data[0]) return data[0].map(item => item[0]).join('');
    return text;
  } catch { return text; }
}

export async function searchPosts(query) {
  const context = await createContext({ userAgent: USER_AGENT, locale: 'pt-BR' });
  const page = await context.newPage();
  try {
    const stopWords = ['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or', 'is', 'are', 'it', 'de', 'do', 'da', 'dos', 'das', 'e', 'o', 'os', 'as', 'em', 'no', 'na', 'para', 'com', 'por'];
    const rawTokens = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/);
    let tokens = rawTokens.filter(t => t.length > 2 && !stopWords.includes(t));
    if (tokens.length === 0) tokens = rawTokens.filter(t => t.length > 0);

    console.log(`[liteapks] 🔎 Buscando "${query}"...`);
    const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    
    const links = await page.evaluate(() => {
      const results = [];
      const anchors = document.querySelectorAll('a.archive-post[href], article a[href], h3 a[href]');
      for (const a of anchors) {
        const href = a.href;
        const text = a.innerText.trim() || a.title || "";
        const isValid = href.startsWith('https://liteapks.com/') && (href.endsWith('.html') || href.endsWith('/')) && !href.includes('/category/') && !href.includes('/tag/') && !href.includes('/page/') && !href.includes('/author/') && !href.includes('?s=') && href !== 'https://liteapks.com/';
        if (isValid && text.length > 3 && !results.some(r => r.url === href)) results.push({ url: href, title: text });
      }
      return results;
    });
    
    const filtered = links.filter(l => {
      const t = l.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const u = l.url.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return tokens.every(tk => t.includes(tk) || u.includes(tk));
    });
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
      const title = titleEl ? titleEl.innerText.trim() : '';
      const bodyText = document.body.innerText;
      let version = '', mod = '', size = '';
      const versionMatchTitle = title.match(/\bv([\d\.]+)/i);
      if (versionMatchTitle) version = versionMatchTitle[1];
      else { const versionMatch = bodyText.match(/Version[:\s]+([^\n]+)/i) || bodyText.match(/Versão[:\s]+([^\n]+)/i); if (versionMatch) version = versionMatch[1].trim(); }
      
      const modMatchTitle = title.match(/\((.*?(?:mod|menu|features|unlocked|premium|choices).*?)\)/i);
      if (modMatchTitle) mod = modMatchTitle[1];
      else { const modMatch = bodyText.match(/Mod[:\s]+([^\n]+)/i); if (modMatch) mod = modMatch[1].trim(); }

      const sizeMatch = bodyText.match(/\b(\d+(?:\.\d+)?\s*(?:MB|GB|M|G))\b/i);
      if (sizeMatch) size = sizeMatch[1].toUpperCase();

      let image = null;
      const contentImages = document.querySelectorAll('article img, .entry-content img, .post-content img');
      for (const img of contentImages) {
        if (img.src && !img.src.includes('logo') && !img.src.includes('avatar')) { image = img.src; break; }
      }
      if (!image) {
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage && ogImage.content && !ogImage.content.includes('logo')) image = ogImage.content;
      }

      let description = '';
      const paragraphs = document.querySelectorAll('article p, .entry-content p, .post-content p');
      for (const p of paragraphs) {
        const text = p.innerText.trim();
        if (text.length > 80 && !text.includes('Read more') && !text.includes('Leia mais')) { description = text; break; }
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