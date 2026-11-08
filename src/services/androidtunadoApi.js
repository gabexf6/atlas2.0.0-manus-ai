import { createContext } from './browserManager.js';

const BASE_URL = 'https://androidtunado.com.br';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function normalize(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export async function searchPosts(query) {
  const context = await createContext({
    userAgent: USER_AGENT,
    locale: 'pt-BR',
  });

  const page = await context.newPage();

  try {
    console.log(`[androidtunado] 🔎 Pesquisando: ${query}`);

    const searchUrl =
      `${BASE_URL}/?s=${encodeURIComponent(query)}`;

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await page.waitForTimeout(4000);

    const results = await page.evaluate(() => {
      const found = new Map();

      const ignoredPaths = [
        '/categoria/',
        '/category/',
        '/tag/',
        '/author/',
        '/page/',
        '/wp-content/',
        '/wp-admin/',
        '/wp-json/',
      ];

      const links = document.querySelectorAll('a[href]');

      for (const a of links) {
        const url = a.href;

        if (!url.startsWith('https://androidtunado.com.br/')) {
          continue;
        }

        if (
          ignoredPaths.some(path => url.includes(path)) ||
          url.includes('?') ||
          url === 'https://androidtunado.com.br/'
        ) {
          continue;
        }

        const card =
          a.closest('article') ||
          a.closest('.post') ||
          a.closest('.item') ||
          a.parentElement;

        const title =
          a.innerText.trim() ||
          a.getAttribute('title') ||
          card?.querySelector('h2, h3, h4')?.innerText.trim() ||
          '';

        if (!title || title.length < 3) continue;

        const image =
          card?.querySelector('img')?.src ||
          a.querySelector('img')?.src ||
          null;

        if (!found.has(url)) {
          found.set(url, {
            url,
            title,
            image,
          });
        }
      }

      return Array.from(found.values());
    });

    const normalizedQuery = normalize(query);

    const filtered = results
      .map(post => ({
        ...post,
        score: normalize(post.title).includes(normalizedQuery) ? 10 : 0,
      }))
      .filter(post => {
        const title = normalize(post.title);
        const url = normalize(post.url);
        const terms = normalizedQuery.split(/\s+/).filter(Boolean);

        return terms.some(term =>
          title.includes(term) || url.includes(term)
        );
      })
      .sort((a, b) => b.score - a.score)
      .map(({ score, ...post }) => post);

    console.log(
      `[androidtunado] ✅ ${filtered.length} resultados encontrados.`
    );

    if (!filtered.length) {
      console.log(
        '[androidtunado] ⚠️ Nenhum resultado encontrado.',
        `Links encontrados na página: ${results.length}`
      );
    }

    return filtered;

  } catch (error) {
    console.error('[androidtunado] Erro na pesquisa:', error);

    throw error;

  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

export async function getPostDetails(url) {
  const context = await createContext({
    userAgent: USER_AGENT,
    locale: 'pt-BR',
  });

  const page = await context.newPage();

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      const title =
        document.querySelector('h1')?.innerText.trim() || '';

      const body = document.body.innerText;

      const image =
        document.querySelector('meta[property="og:image"]')?.content ||
        document.querySelector('article img')?.src ||
        null;

      const categories = [
        ...document.querySelectorAll(
          'a[rel="category tag"], .cat-links a, a[href*="/categoria/"]'
        ),
      ]
        .map(el => el.innerText.trim())
        .filter(Boolean);

      const developer =
        body.match(/Desenvolvedor\s*\n\s*([^\n]+)/i)?.[1] || '';

      const updated =
        body.match(/(?:Melhoria|Última atualização)\s*\n\s*([^\n]+)/i)?.[1] || '';

      const requirements =
        body.match(/Requisitos\s*\n\s*([^\n]+)/i)?.[1] || '';

      const version =
        title.match(/\bv([\d.]+)/i)?.[1] || '';

      let description = '';

      const paragraphs = document.querySelectorAll(
        'article p, .entry-content p, main p'
      );

      for (const p of paragraphs) {
        const text = p.innerText.trim();

        if (text.length > 60) {
          description = text;
          break;
        }
      }

      return {
        title,
        image,
        categories,
        developer,
        updated,
        requirements,
        version,
        description,
      };
    });

    return {
      url,
      ...data,
    };

  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}