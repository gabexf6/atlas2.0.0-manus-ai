import { createContext } from './browserManager.js';

const BASE_URL = 'https://getmodsapk.com';
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
  } catch {
    return text;
  }
}

async function getPostSitemapLinks(page) {
  const indexUrl = `${BASE_URL}/sitemap.xml`;
  const response = await page.request.get(indexUrl, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!response.ok()) {
    throw new Error(`Sitemap index retornou HTTP ${response.status()}`);
  }

  const xml = await response.text();
  const links = [];
  const regex = /<loc>(https?:\/\/[^<]+posts-sitemap\d+\.xml)<\/loc>/g;

  let match;
  while ((match = regex.exec(xml)) !== null) {
    links.push(match[1]);
  }

  return links;
}

async function parsePostSitemap(page, sitemapUrl) {
  const response = await page.request.get(sitemapUrl, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!response.ok()) return [];

  const xml = await response.text();
  const posts = [];
  const urlRegex = /<url>([\s\S]*?)<\/url>/g;

  let match;
  while ((match = urlRegex.exec(xml)) !== null) {
    const block = match[1];
    const locMatch = block.match(/<loc>([\s\S]*?)<\/loc>/);
    const lastmodMatch = block.match(/<lastmod>([\s\S]*?)<\/lastmod>/);

    if (locMatch && lastmodMatch) {
      posts.push({
        url: locMatch[1].trim(),
        lastmod: new Date(lastmodMatch[1].trim())
      });
    }
  }

  return posts;
}

export async function getRecentPosts() {
  const context = await createContext({
    userAgent: USER_AGENT,
    locale: 'pt-BR'
  });

  const page = await context.newPage();

  try {
    console.log('[getmods] 📡 Lendo sitemaps...');

    const sitemapLinks = await getPostSitemapLinks(page);

    console.log(`[getmods] Encontrados ${sitemapLinks.length} sitemaps de posts.`);

    const agora = new Date();
    const limite = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
    const recentes = [];

    for (const sitemapUrl of sitemapLinks) {
      const posts = await parsePostSitemap(page, sitemapUrl);

      for (const post of posts) {
        if (post.lastmod >= limite) {
          recentes.push(post);
        }
      }
    }

    console.log(`[getmods] 📦 ${recentes.length} posts modificados nas últimas 24h.`);

    await page.close();
    await context.close();

    return recentes;

  } catch (error) {
    await page.close().catch(() => {});
    await context.close().catch(() => {});

    console.error('[getmods] ❌ Erro ao ler sitemaps:', error.message);

    return [];
  }
}

export async function searchPosts(query) {
  const context = await createContext({
    userAgent: USER_AGENT,
    locale: 'pt-BR'
  });

  const page = await context.newPage();

  try {
    const stopWords = [
      'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to',
      'for', 'with', 'and', 'or', 'is', 'are', 'it',
      'de', 'do', 'da', 'dos', 'das', 'e', 'o', 'os',
      'as', 'em', 'no', 'na', 'para', 'com', 'por'
    ];

    const rawTokens = query
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/);

    let tokens = rawTokens.filter(
      t => t.length > 2 && !stopWords.includes(t)
    );

    if (tokens.length === 0) {
      tokens = rawTokens.filter(t => t.length > 0);
    }

    console.log(`[getmods] 🔎 Buscando "${query}" no sitemap...`);

    const sitemapLinks = await getPostSitemapLinks(page);
    let foundUrls = [];

    for (const sitemapUrl of sitemapLinks) {
      const posts = await parsePostSitemap(page, sitemapUrl);

      for (const post of posts) {
        const urlNorm = post.url
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');

        if (tokens.every(t => urlNorm.includes(t))) {
          foundUrls.push({
            url: post.url,
            title: query
          });
        }
      }
    }

    if (foundUrls.length > 0) {
      await page.close();
      await context.close();
      return foundUrls;
    }

    console.log('[getmods] ⚠️ Não achou no sitemap. Tentando busca HTML no site...');

    const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}`;

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    const links = await page.evaluate(() => {
      const results = [];
      const anchors = document.querySelectorAll('a[href]');

      for (const a of anchors) {
        const href = a.href;
        const text = a.innerText.trim() || a.title || '';

        const isGarbage =
          href.includes('/category/') ||
          href.includes('/tag/') ||
          href.includes('/page/') ||
          href.includes('/author/') ||
          href.includes('/blog/') ||
          href === 'https://getmodsapk.com/' ||
          href.includes('?s=');

        if (
          href.startsWith('https://getmodsapk.com/') &&
          !isGarbage &&
          href.endsWith('/')
        ) {
          const card = a.closest('article, .post, .item, .app-card') || a.parentElement;
          const hasImage = a.querySelector('img') || (card && card.querySelector('img'));

          if (
            hasImage &&
            text.length > 3 &&
            !results.some(r => r.url === href)
          ) {
            results.push({
              url: href,
              title: text
            });
          }
        }
      }

      return results;
    });

    const filtered = links.filter(l => {
      const t = l.title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      const u = l.url
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      return tokens.every(tk => t.includes(tk) || u.includes(tk));
    });

    await page.close();
    await context.close();

    return filtered;

  } catch (error) {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    throw error;
  }
}

export async function getPostDetails(url) {
  const context = await createContext({
    userAgent: USER_AGENT,
    locale: 'pt-BR'
  });

  const page = await context.newPage();

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const titleEl = document.querySelector('h1');
      const title = titleEl ? titleEl.innerText.trim() : '';

      let image = null;

      const contentImages = document.querySelectorAll(
        'article img, .entry-content img, .post-content img'
      );

      for (const img of contentImages) {
        if (
          img.src &&
          !img.src.includes('logo') &&
          !img.src.includes('avatar')
        ) {
          image = img.src;
          break;
        }
      }

      if (!image) {
        const ogImage = document.querySelector('meta[property="og:image"]');

        if (
          ogImage &&
          ogImage.content &&
          !ogImage.content.includes('logo')
        ) {
          image = ogImage.content;
        }
      }

      const bodyText = document.body.innerText;

      const categories = [
        ...document.querySelectorAll(
          'a[rel="category tag"], .cat-links a, a[href*="/category/"]'
        )
      ]
        .map(a => a.innerText.trim())
        .filter(Boolean);

      let version = '';
      let mod = '';
      let size = '';

      const versionMatch =
        bodyText.match(/Version[:\s]+([^\n]+)/i) ||
        bodyText.match(/Versão[:\s]+([^\n]+)/i);

      if (versionMatch) version = versionMatch[1].trim();

      const modMatch = bodyText.match(/Mod[:\s]+([^\n]+)/i);
      if (modMatch) mod = modMatch[1].trim();

      const sizeMatch =
        bodyText.match(/Size[:\s]+([^\n]+)/i) ||
        bodyText.match(/Tamanho[:\s]+([^\n]+)/i);

      if (sizeMatch) size = sizeMatch[1].trim();

      let description = '';

      const paragraphs = document.querySelectorAll(
        'article p, .entry-content p, .post-content p'
      );

      for (const p of paragraphs) {
        const text = p.innerText.trim();

        if (
          text.length > 80 &&
          !text.includes('Read more') &&
          !text.includes('Leia mais')
        ) {
          description = text;
          break;
        }
      }

      return {
        title,
        image,
        version,
        mod,
        size,
        description,
        categories: [...new Set(categories)]
      };
    });

    const translatedDescription = await translateToPortuguese(data.description);

    await page.close();
    await context.close();

    return {
      url,
      title: data.title || '',
      image: data.image,
      version: data.version || '',
      mod: data.mod || '',
      size: data.size || '',
      description: translatedDescription || data.description || '',
      categories: data.categories || []
    };

  } catch (error) {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    throw error;
  }
}