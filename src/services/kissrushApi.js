import { KISSRUSH_BLOG_URL } from '../config.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; AtlasBot/1.0)';

export async function searchPosts(query = '', limit = 6) {
  const base = KISSRUSH_BLOG_URL.replace(/\/$/, '');
  const maxResults = Math.max(1, Math.min(Number(limit) || 6, 20));

  let url;
  if (query && query.trim()) {
    url = `${base}/feeds/posts/default?q=${encodeURIComponent(query.trim())}&alt=json&max-results=${maxResults}`;
  } else {
    url = `${base}/feeds/posts/default?alt=json&max-results=${maxResults}`;
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`Blog retornou HTTP ${response.status}`);
  }

  const data = await response.json();
  const entries = data?.feed?.entry || [];

  return entries.map(parseEntry).filter(Boolean);
}

export async function listLatestPosts(limit = 5) {
  return searchPosts('', limit);
}

function parseEntry(entry) {
  if (!entry) return null;

  const title = entry.title?.$t || 'Sem título';

  let link = '';
  const links = Array.isArray(entry.link) ? entry.link : [entry.link];
  for (const l of links) {
    if (l?.rel === 'alternate' && l?.href) {
      link = l.href;
      break;
    }
  }
  if (!link) return null;

  const datePublished = entry.published?.$t || entry.updated?.$t || '';
  const dateUpdated = entry.updated?.$t || datePublished;

  let image = entry.media$thumbnail?.url || '';

  const rawContent = entry.content?.$t || entry.summary?.$t || '';
  const summary = stripHtml(rawContent).substring(0, 300);

  if (!image && rawContent) {
    const imgMatch = rawContent.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch) image = imgMatch[1];
  }

  if (image) {
    image = image.replace(/\/s[0-9]+(\-c)?\//, '/s800/');
  }

  const categories = (entry.category || [])
    .map((c) => c?.term)
    .filter(Boolean);

  return {
    title,
    link,
    datePublished,
    dateUpdated,
    image: image || null,
    summary,
    categories,
  };
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatPostDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const ano = d.getFullYear();
    return `${dia}/${mes}/${ano}`;
  } catch {
    return '';
  }
}