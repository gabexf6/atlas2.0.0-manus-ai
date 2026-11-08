import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FFMPEG_BIN, TEMP_DIR } from "../config.js";
import { getRandomName, removeFileIfExists } from "../utils/index.js";
import { createContext } from "./browserManager.js";

export const STICKERLY_MAX_SEND = 30;

const STICKERLY_API_ROOTS = ["https://api.sticker.ly/v3.1", "http://api.sticker.ly/v3.1"];
const STICKERLY_API_USER_AGENT = "androidapp.stickerly/1.13.3";

const SEARCH_HTML_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
};

const SHARE_PAGE_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; AtlasBot/1.0)" };

const PACK_GRAPH_SEEDS = ["https://sticker.ly/"];
const PACK_GRAPH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PACK_GRAPH_MAX_VISITED = 120;
const PACK_GRAPH_MAX_EXPANSIONS = 100;

const STICKERLY_QUERY_STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "a", "o", "as", "os", "um", "uma", "uns", "umas",
  "e", "ou", "para", "por", "com", "sem", "em", "no", "na", "nos", "nas",
  "the", "of", "and", "for", "to", "in", "on", "at",
]);

let stickerlyPackGraphCache = { builtAt: 0, cards: [] };

async function fetchTextWithTimeout(url, options = {}, timeoutMs = 15000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 10000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchBufferWithTimeout(url, options = {}, timeoutMs = 12000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchStickerlySearchLinks(url, timeoutMs = 9000) {
  const context = await createContext({
    userAgent: SEARCH_HTML_HEADERS["User-Agent"],
    locale: "pt-BR",
    viewport: { width: 1365, height: 900 },
    extraHTTPHeaders: { "Accept-Language": SEARCH_HTML_HEADERS["Accept-Language"] },
  });
  const page = await context.newPage();
  try {
    page.setDefaultNavigationTimeout(timeoutMs);
    page.setDefaultTimeout(timeoutMs);
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(900);
    const details = await page.evaluate(() => ({
      title: document.title || "",
      text: (document.body?.innerText || "").slice(0, 1800),
      links: Array.from(document.querySelectorAll("a[href]"), (a) => ({ href: a.href, text: (a.innerText || a.textContent || "").trim() })).slice(0, 500),
    }));
    const links = [];
    for (const item of details.links || []) {
      const href = decodeSearchResultUrlSafe(item.href || "");
      const normalized = normalizeStickerlyPackUrl(href);
      if (normalized) links.push(normalized);
      // Search engines sometimes hide the final URL inside redirect parameters.
      for (const match of String(item.href || "").matchAll(/https?%3A%2F%2F(?:www%2E)?sticker%2Ely%2Fs%2F[A-Za-z0-9_-]+/gi)) {
        try { links.push(normalizeStickerlyPackUrl(decodeURIComponent(match[0]))); } catch {}
      }
    }
    return { links: [...new Set(links.filter(Boolean))], status: response?.status() ?? 0, title: details.title, text: details.text };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function fetchStickerlySearchHtml(url, timeoutMs = 9000) {
  const context = await createContext({ userAgent: SEARCH_HTML_HEADERS["User-Agent"], locale: "pt-BR", viewport: { width: 1365, height: 900 }, extraHTTPHeaders: { "Accept-Language": SEARCH_HTML_HEADERS["Accept-Language"] } });
  const page = await context.newPage();
  try {
    page.setDefaultNavigationTimeout(timeoutMs);
    page.setDefaultTimeout(timeoutMs);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(700);
    return await page.content();
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

function formatError(error) {
  return error?.message || String(error || "");
}

function decodeHtmlEntities(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeJsEscapedText(value = "") {
  const raw = String(value || "");
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\")
      .trim();
  }
}

function decodeSearchResultUrl(value = "") {
  try {
    return decodeURIComponent(String(value || "").trim());
  } catch {
    return String(value || "").trim();
  }
}

export function buildStickerlyHelpText(currentPrefix = "/") {
  const prefix = String(currentPrefix || "/").trim() || "/";
  return `ℹ️ *Como usar?* 📦

\`${prefix}stickerly\` \`<código, link ou busca>\` 👉🏿 Baixa um pack do Sticker.ly e manda como *pacote de figurinhas* do WhatsApp (uma mensagem só, com "Adicionar às suas figurinhas").

Por padrão manda o pack inteiro (até ${STICKERLY_MAX_SEND} figurinhas). Pra limitar a quantidade, informe um valor após \`|\`.

👁️‍🗨️ Ex.: ${prefix}stickerly naruto
👁️‍🗨️ Ex.: ${prefix}stickerly memes brasileiros | 9
👁️‍🗨️ Ex.: ${prefix}stickerly https://sticker.ly/s/JY3M4B`;
}

export function parseStickerlyRequestText(rawText = "") {
  const raw = String(rawText || "").trim();
  if (!raw) {
    return { query: "", limit: STICKERLY_MAX_SEND, explicitLimit: false, wantsAll: true };
  }

  let query = raw;
  let limit = STICKERLY_MAX_SEND;
  let wantsAll = true;
  let explicitLimit = false;
  const separatorIndex = raw.lastIndexOf("|");

  if (separatorIndex >= 0) {
    const left = raw.slice(0, separatorIndex).trim();
    const right = raw.slice(separatorIndex + 1).trim();

    if (/^\d+$/.test(right)) {
      query = left;
      limit = Math.max(1, Math.min(STICKERLY_MAX_SEND, Number(right)));
      wantsAll = false;
      explicitLimit = true;
    } else if (/^(?:all|tudo|todo|todos|pack)$/i.test(right)) {
      query = left;
      wantsAll = true;
      explicitLimit = true;
    }
  }

  return { query: query.trim(), limit, explicitLimit, wantsAll };
}

function normalizeStickerlySearchText(text = "") {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeStickerlyQuery(query = "") {
  return normalizeStickerlySearchText(query)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token && token.length >= 2 && !STICKERLY_QUERY_STOPWORDS.has(token));
}

function extractStickerlyPackUrl(input = "") {
  const urlMatch = String(input || "").match(/https?:\/\/(?:www\.)?sticker\.ly\/s\/[A-Za-z0-9_-]+/i);
  return urlMatch?.[0] || "";
}

function extractStickerlyPackCode(input = "") {
  const shareMatch = String(input || "").match(/(?:sticker\.ly\/s\/|\/pack\/)([A-Za-z0-9_-]{5,12})/i);
  if (shareMatch?.[1]) return shareMatch[1];

  const codeMatch = String(input || "").trim().match(/^[A-Z0-9_-]{5,12}$/i);
  return codeMatch?.[0] || "";
}

function looksLikeStickerlyDirectCodeInput(input = "", code = "") {
  const raw = String(input || "").trim();
  const normalizedCode = String(code || "").trim();
  if (!raw || !normalizedCode) return false;

  if (/(?:sticker\.ly\/s\/|\/pack\/)/i.test(raw)) return true;
  if (/[0-9_-]/.test(raw)) return true;
  return /^[A-Z]{5,12}$/.test(raw);
}

export function normalizeStickerlyPackUrl(input = "") {
  const directUrl = extractStickerlyPackUrl(input);
  if (directUrl) return directUrl;

  const directCode = extractStickerlyPackCode(input);
  if (directCode && looksLikeStickerlyDirectCodeInput(input, directCode)) {
    return `https://sticker.ly/s/${directCode}`;
  }

  return "";
}

function decodeSearchResultUrlSafe(rawUrl = "") {
  const candidate = String(rawUrl || "").trim();
  if (!candidate) return "";

  try {
    const parsed = new URL(candidate, "https://duckduckgo.com");
    const redirected = parsed.searchParams.get("uddg") || parsed.searchParams.get("u");
    if (redirected) {
      return decodeURIComponent(redirected);
    }

    return parsed.toString();
  } catch {
    return decodeSearchResultUrl(rawUrl);
  }
}

function extractMetaContent(html = "", key = "") {
  const escapedKey = String(key || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escapedKey}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escapedKey}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${escapedKey}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escapedKey}["']`, "i"),
  ];

  for (const pattern of patterns) {
    const match = String(html || "").match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]).trim();
    }
  }

  return "";
}

function extractStickerlyTitleFromHtml(html = "") {
  const metaTitle = extractMetaContent(html, "og:title") || extractMetaContent(html, "twitter:title");
  if (metaTitle) {
    return metaTitle.replace(/\s*(?:-|\||–|—)\s*Sticker\.ly.*$/i, "").trim();
  }

  const titleMatch = String(html || "").match(/<title>([^<]+)<\/title>/i);
  if (!titleMatch?.[1]) return "";

  return decodeHtmlEntities(titleMatch[1]).replace(/\s*(?:-|\||–|—)\s*Sticker\.ly.*$/i, "").trim();
}

function extractStickerlyAuthorFromHtml(html = "") {
  const description = extractMetaContent(html, "og:description") || extractMetaContent(html, "twitter:description");
  if (!description) return "";

  const byMatch = description.match(/\bby\s+([^.|]+?)(?:\s*(?:\.|on Sticker\.ly|$))/i);
  return byMatch?.[1] ? byMatch[1].trim() : "";
}

function mergeStickerlyCards(cards = []) {
  const merged = new Map();

  for (const rawCard of cards) {
    const url = normalizeStickerlyPackUrl(rawCard?.url || "");
    if (!url) continue;

    const previous = merged.get(url) || { url, title: "", author: "", description: "" };
    const title = String(rawCard?.title || "").trim();
    const author = String(rawCard?.author || "").trim();
    const description = String(rawCard?.description || "").trim();

    merged.set(url, {
      url,
      title: previous.title || title,
      author: previous.author || author,
      description: previous.description || description,
    });
  }

  return Array.from(merged.values());
}

function extractStickerlySearchResultUrls(html = "") {
  const urls = new Set();
  const htmlText = String(html || "");

  const directMatches = htmlText.match(/https?:\/\/(?:www\.)?sticker\.ly\/s\/[A-Za-z0-9_-]+/gi) || [];
  for (const match of directMatches) urls.add(match);

  for (const packMatch of htmlText.matchAll(/https?:\/\/ahx4\.adj\.st\/pack\/([A-Za-z0-9_-]{5,12})/gi)) {
    if (packMatch?.[1]) urls.add(`https://sticker.ly/s/${packMatch[1]}`);
  }

  for (const hrefMatch of htmlText.matchAll(/href="([^"]+)"/gi)) {
    const decoded = decodeSearchResultUrlSafe(hrefMatch[1] || "");
    const packUrl = normalizeStickerlyPackUrl(decoded);
    if (packUrl) urls.add(packUrl);
  }

  return Array.from(urls);
}

function extractStickerlyPackCardsFromHomeHtml(html = "") {
  const cards = [];
  const blocks = String(html || "").match(/<div class="sticker_pack">[\s\S]*?<\/div>\s*<\/div>/gi) || [];

  for (const block of blocks) {
    const titleMatch = block.match(/<strong class="name">([\s\S]*?)<\/strong>/i);
    const authorMatch = block.match(/<span class="author">([\s\S]*?)<\/span>/i);
    const codeMatch = block.match(/https:\/\/stickerly\.pstatic\.net\/sticker_pack\/[^"'\\\s>]+\/([A-Za-z0-9_-]{5,12})\//i);

    if (!codeMatch?.[1]) continue;

    cards.push({
      url: `https://sticker.ly/s/${codeMatch[1]}`,
      title: decodeHtmlEntities((titleMatch?.[1] || "").replace(/<[^>]+>/g, " ")).trim(),
      author: decodeHtmlEntities((authorMatch?.[1] || "").replace(/<[^>]+>/g, " ")).trim(),
    });
  }

  return cards;
}

function extractStickerlyPackCardsFromShareHtml(html = "", currentUrl = "") {
  const cards = [];
  const htmlText = String(html || "");
  const currentPackUrl = normalizeStickerlyPackUrl(currentUrl);
  const currentTitleMatch = htmlText.match(/<strong class="this_text">\s*([\s\S]*?)<\/strong>/i);
  const currentAuthorMatch = htmlText.match(/<span class="sticker_author">\s*([\s\S]*?)<\/span>/i);

  if (currentPackUrl) {
    cards.push({
      url: currentPackUrl,
      title: decodeHtmlEntities((currentTitleMatch?.[1] || "").replace(/<[^>]+>/g, " ")).trim(),
      author: decodeHtmlEntities((currentAuthorMatch?.[1] || "").replace(/<[^>]+>/g, " ")).trim(),
    });
  }

  for (const match of htmlText.matchAll(/<a[^>]+href="([^"]*\/pack\/[A-Za-z0-9_-]{5,12}[^"]*)"[^>]*class="card_inner"[\s\S]*?<dd class="this_name_pack">\s*([\s\S]*?)<\/dd>[\s\S]*?<dd class="this_name_maker">\s*([\s\S]*?)<\/dd>/gi)) {
    const code = extractStickerlyPackCode(match[1] || "");
    if (!code) continue;

    cards.push({
      url: `https://sticker.ly/s/${code}`,
      title: decodeHtmlEntities((match[2] || "").replace(/<[^>]+>/g, " ")).trim(),
      author: decodeHtmlEntities((match[3] || "").replace(/<[^>]+>/g, " ")).trim(),
    });
  }

  return cards;
}

function extractStickerlyPackCardsFromBraveHtml(html = "") {
  const cards = [];
  const htmlText = String(html || "");

  for (const match of htmlText.matchAll(/\{title:"((?:\\.|[^"])*)",url:"(https?:\/\/(?:www\.)?sticker\.ly\/s\/[A-Za-z0-9_-]+)"[\s\S]*?description:"((?:\\.|[^"])*)"/gi)) {
    cards.push({
      url: normalizeStickerlyPackUrl(match[2] || ""),
      title: decodeJsEscapedText(match[1] || "").trim(),
      description: decodeJsEscapedText(match[3] || "").trim(),
    });
  }

  for (const match of htmlText.matchAll(/<a href="(https?:\/\/(?:www\.)?sticker\.ly\/s\/[A-Za-z0-9_-]+)"[\s\S]{0,2500}?<div class="title[^"]*" title="([^"]*)">([\s\S]*?)<\/div>(?:[\s\S]{0,2500}?<div class="content[^"]*">([\s\S]*?)<\/div>)?/gi)) {
    cards.push({
      url: normalizeStickerlyPackUrl(match[1] || ""),
      title: decodeHtmlEntities((match[2] || match[3] || "").replace(/<[^>]+>/g, " ")).trim(),
      description: decodeHtmlEntities((match[4] || "").replace(/<[^>]+>/g, " ")).trim(),
    });
  }

  return mergeStickerlyCards(cards);
}

function buildStickerlyQueryVariants(query = "") {
  const tokens = tokenizeStickerlyQuery(query);
  if (!tokens.length) return [];

  const normalized = tokens.join(" ").trim();
  const variants = new Set();

  if (normalized) {
    variants.add(normalized);
    variants.add(`${normalized} stickerly`);
  }

  if (tokens.length >= 2) {
    variants.add(tokens.slice(0, 2).join(" "));
    variants.add(tokens.slice(0, 3).join(" "));
  }

  for (const token of tokens) {
    variants.add(token);
    variants.add(`${token} stickerly`);
  }

  return Array.from(variants).map((item) => item.trim()).filter(Boolean);
}

function buildStickerlySearchQueries(query = "") {
  const normalized = tokenizeStickerlyQuery(query).join(" ").trim();
  if (!normalized) return [];

  const variants = new Set();
  variants.add(`${normalized} site:sticker.ly/s`);
  variants.add(`${normalized} sticker.ly`);

  for (const variant of buildStickerlyQueryVariants(query).slice(0, 6)) {
    variants.add(`${variant} site:sticker.ly/s`);
    variants.add(`${variant} sticker.ly`);
  }

  return Array.from(variants).filter(Boolean).slice(0, 8);
}

function scoreStickerlyPackCard(query = "", card = {}) {
  const normalizedQuery = normalizeStickerlySearchText(query);
  const tokens = tokenizeStickerlyQuery(query);
  const title = normalizeStickerlySearchText(card?.title || "");
  const author = normalizeStickerlySearchText(card?.author || "");
  const description = normalizeStickerlySearchText(card?.description || "");
  const combined = [title, author, description].filter(Boolean).join(" ");
  let score = 0;

  if (!tokens.length) return score;
  if (title === normalizedQuery) score += 280;
  if (normalizedQuery && title.includes(normalizedQuery)) score += 200;
  if (normalizedQuery && combined.includes(normalizedQuery)) score += 110;

  let matchedTokens = 0;
  for (const token of tokens) {
    if (title.includes(token)) {
      score += 55;
      matchedTokens += 1;
      continue;
    }
    if (author.includes(token)) {
      score += 26;
      matchedTokens += 1;
      continue;
    }
    if (description.includes(token)) {
      score += 12;
      matchedTokens += 1;
      continue;
    }
    score -= 15;
  }

  if (tokens.length) {
    score += Math.round((matchedTokens / tokens.length) * 120);
    if (matchedTokens === tokens.length) score += 80;
  }

  if (/\b(?:meme|memes)\b/i.test(combined) && /\b(?:meme|memes)\b/i.test(query)) {
    score += 25;
  }

  return score;
}

async function buildStickerlyPackGraphCatalog(forceRefresh = false) {
  const now = Date.now();
  if (
    !forceRefresh &&
    stickerlyPackGraphCache.builtAt &&
    now - stickerlyPackGraphCache.builtAt < PACK_GRAPH_CACHE_TTL_MS
  ) {
    return stickerlyPackGraphCache.cards;
  }

  const queue = Array.from(new Set(PACK_GRAPH_SEEDS));
  const visited = new Set();
  const collectedCards = [];
  let depthExpansions = 0;

  while (queue.length && visited.size < PACK_GRAPH_MAX_VISITED) {
    const targetUrl = queue.shift();
    const normalizedTarget = normalizeStickerlyPackUrl(targetUrl) || String(targetUrl || "").trim();
    if (!normalizedTarget || visited.has(normalizedTarget)) continue;
    visited.add(normalizedTarget);

    try {
      const html = await fetchStickerlySearchHtml(normalizedTarget, 15000);
      const isHome = normalizedTarget === "https://sticker.ly/";
      const cards = isHome
        ? extractStickerlyPackCardsFromHomeHtml(html)
        : extractStickerlyPackCardsFromShareHtml(html, targetUrl);

      collectedCards.push(...cards);

      if (!isHome && depthExpansions < PACK_GRAPH_MAX_EXPANSIONS) {
        const related = extractStickerlyPackCardsFromShareHtml(html, targetUrl);
        for (const relatedCard of related) {
          const normalizedUrl = normalizeStickerlyPackUrl(relatedCard.url);
          if (normalizedUrl && !visited.has(normalizedUrl)) queue.push(normalizedUrl);
        }
        depthExpansions += 1;
      }
    } catch {
    }
  }

  const mergedCards = mergeStickerlyCards(collectedCards);
  stickerlyPackGraphCache = { builtAt: now, cards: mergedCards };
  return mergedCards;
}

export async function listStickerlyCatalog() {
  return buildStickerlyPackGraphCatalog();
}

async function searchStickerlyPackGraph(query, limit = 5) {
  const cards = await buildStickerlyPackGraphCatalog();
  return cards
    .map((card) => ({ card, score: scoreStickerlyPackCard(query, card) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(limit, 1))
    .map((item) => item.card);
}

async function searchStickerlyPackCardsWithBrave(query, limit = 5) {
  const searchQueries = buildStickerlySearchQueries(query);
  const collected = [];

  for (const searchQuery of searchQueries.slice(0, 3)) {
    try {
      const braveUrl = `https://search.brave.com/search?q=${encodeURIComponent(searchQuery)}&source=web`;
      const html = await fetchStickerlySearchHtml(braveUrl, 15000);
      collected.push(...extractStickerlyPackCardsFromBraveHtml(html));
    } catch {
    }
  }

  return mergeStickerlyCards(collected)
    .map((card) => ({ card, score: scoreStickerlyPackCard(query, card) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(limit, 1))
    .map((item) => item.card);
}

async function rerankStickerlyCandidateUrls(query, candidateUrls = [], limit = 5) {
  const ranked = [];

  for (const candidateUrl of candidateUrls) {
    const normalizedUrl = normalizeStickerlyPackUrl(candidateUrl);
    if (!normalizedUrl) continue;

    try {
      const pack = await fetchStickerlyPackData(normalizedUrl);
      const score = scoreStickerlyPackCard(query, { url: pack.url, title: pack.title, author: pack.author });
      ranked.push({ url: normalizedUrl, score });
    } catch {
    }
  }

  return ranked
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(limit, 1))
    .map((item) => item.url);
}

async function searchStickerlyPackUrls(query, limit = 5) {
  const directPackUrl = normalizeStickerlyPackUrl(query);
  if (directPackUrl) return [directPackUrl];

  const q = String(query || "").trim();
  const searchTexts = [
    `${q} site:sticker.ly/s`,
    `Sticker.ly ${q} sticker pack`,
  ];
  const jobs = [];
  for (const searchText of searchTexts) {
    jobs.push((async () => {
      const url = `https://search.brave.com/search?q=${encodeURIComponent(searchText)}&source=web`;
      const result = await fetchStickerlySearchLinks(url, 9000);
      return result.links;
    })());
    jobs.push((async () => {
      const url = `https://duckduckgo.com/?q=${encodeURIComponent(searchText)}&ia=web`;
      const result = await fetchStickerlySearchLinks(url, 9000);
      return result.links;
    })());
  }
  const settled = await Promise.allSettled(jobs);
  const urls = [];
  for (const result of settled) {
    if (result.status === "fulfilled") urls.push(...result.value);
    else console.warn(`[Figurinhas] Falha no buscador: ${formatError(result.reason)}`);
  }
  return [...new Set(urls.map(normalizeStickerlyPackUrl).filter(Boolean))]
    .slice(0, Math.max(limit, 1));
}

function extractStickerlyStickerEntries(html = "", packUrl = "") {
  const entries = [];
  const seen = new Set();
  const packCode = extractStickerlyPackCode(packUrl);

  for (const match of String(html || "").matchAll(/https:\/\/stickerly\.pstatic\.net\/sticker_pack\/[^"'\\\s>]+\/([A-Za-z0-9_-]{5,12})\/[^"'\\\s>]+\/([A-Za-z0-9_-]+)\.(png|webp|gif)/gi)) {
    const code = String(match[1] || "").trim();
    if (packCode && code && code.toLowerCase() !== packCode.toLowerCase()) continue;

    const fileName = `${match[2]}.${match[3]}`;
    const sid = String(match[2] || "").trim();
    const key = `${code}||${fileName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({
      sid,
      fileName,
      animated: /\.(gif|webp)$/i.test(fileName) && /_ani|animated|motion/i.test(fileName),
      primaryUrl: match[0],
      fallbackUrl: "",
    });
  }

  return entries;
}

function buildStickerlyApiStickerEntries(result) {
  const resourceUrlPrefix = String(result?.resourceUrlPrefix || "").trim();
  if (!resourceUrlPrefix) return [];

  const entries = [];
  const seen = new Set();

  for (const sticker of Array.isArray(result?.stickers) ? result.stickers : []) {
    const fileName = String(sticker?.fileName || "").trim();
    if (!fileName) continue;

    const primaryUrl = `${resourceUrlPrefix}${fileName}`;
    const fallbackUrl = fileName.endsWith(".webp") ? `${resourceUrlPrefix}${fileName.replace(/\.webp$/i, ".png")}` : "";
    const key = `${sticker?.sid || ""}||${fileName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({
      sid: String(sticker?.sid || ""),
      fileName,
      animated: Boolean(sticker?.animated || sticker?.isAnimated),
      primaryUrl,
      fallbackUrl,
    });
  }

  return entries;
}

async function fetchStickerlyPackDataFromApi(packCode) {
  const normalizedCode = extractStickerlyPackCode(packCode);
  if (!normalizedCode) throw new Error("Código de pacote inválido do Sticker.ly.");

  let lastError = null;

  for (const root of STICKERLY_API_ROOTS) {
    try {
      const payload = await fetchJsonWithTimeout(
        `${root}/stickerPack/${normalizedCode}`,
        { headers: { "User-Agent": STICKERLY_API_USER_AGENT, Accept: "application/json" } },
        10000,
      );

      const result = payload?.result || payload || {};
      const stickers = buildStickerlyApiStickerEntries(result);
      if (!stickers.length) throw new Error("A API do Sticker.ly não retornou figurinhas para este pacote.");

      return {
        url: normalizeStickerlyPackUrl(result?.shareUrl || normalizedCode) || `https://sticker.ly/s/${normalizedCode}`,
        title: String(result?.name || "").trim() || "Pack Sticker.ly",
        author: String(result?.authorName || "").trim(),
        stickers,
        source: "api",
        packCode: normalizedCode,
        packSize: stickers.length,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Não consegui acessar a API do Sticker.ly para este pacote.");
}

async function fetchStickerlyPackData(input) {
  const packUrl = normalizeStickerlyPackUrl(input);
  if (!packUrl) throw new Error("Informe um código ou link válido do Sticker.ly.");

  const packCode = extractStickerlyPackCode(packUrl);
  if (packCode) {
    try {
      return await fetchStickerlyPackDataFromApi(packCode);
    } catch {
    }
  }

  const html = await fetchTextWithTimeout(packUrl, { headers: SHARE_PAGE_HEADERS }, 10000);
  const stickers = extractStickerlyStickerEntries(html, packUrl);
  if (!stickers.length) throw new Error("Não encontrei figurinhas neste pacote do Sticker.ly.");

  return {
    url: packUrl,
    title: extractStickerlyTitleFromHtml(html) || "Pack Sticker.ly",
    author: extractStickerlyAuthorFromHtml(html),
    stickers,
    source: "html",
    packCode,
    packSize: stickers.length,
  };
}

function buildStickerlyPackSearchResult(pack = {}, query = "") {
  const packSize = Math.max(0, Number(pack?.packSize || pack?.stickers?.length || 0));
  const metadataScore = scoreStickerlyPackCard(query, { url: pack?.url, title: pack?.title, author: pack?.author });

  return { ...pack, packSize, score: metadataScore + Math.min(42, packSize) };
}

export async function searchStickerlyPacks(query, limit = 6) {
  const candidateLimit = Math.max(Math.min(Number(limit) || 6, 8), 1);
  const candidateUrls = await searchStickerlyPackUrls(query, Math.max(candidateLimit, 4));
  if (!candidateUrls.length) return [];

  const urls = [...new Set(candidateUrls.map(normalizeStickerlyPackUrl).filter(Boolean))].slice(0, 4);
  const settled = await Promise.allSettled(urls.map(async (url) => {
    const pack = await fetchStickerlyPackData(url);
    return buildStickerlyPackSearchResult(pack, query);
  }));
  const results = settled
    .filter((item) => item.status === "fulfilled")
    .map((item) => item.value);

  return results.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return Number(right.packSize || 0) - Number(left.packSize || 0);
  }).slice(0, candidateLimit);
}

export async function resolveStickerlyPack(query) {
  const directPackUrl = normalizeStickerlyPackUrl(query);
  if (!directPackUrl) throw new Error("Informe um código ou link válido do Sticker.ly.");
  return fetchStickerlyPackData(directPackUrl);
}

function normalizeStickerlyFetchedBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (Buffer.isBuffer(value?.buffer)) return value.buffer;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  throw new Error("O Sticker.ly retornou uma resposta de mídia inválida.");
}

export async function fetchStickerlyStickerBuffer(entry, packUrl) {
  const headers = { Referer: packUrl, "User-Agent": SHARE_PAGE_HEADERS["User-Agent"] };
  const errors = [];
  const candidates = [entry?.primaryUrl, entry?.fallbackUrl].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return normalizeStickerlyFetchedBuffer(await fetchBufferWithTimeout(candidate, { headers }, 12000));
    } catch (error) {
      errors.push(formatError(error));
    }
  }

  throw new Error(errors[0] || "HTTP 404");
}

function detectStickerlyMediaTypeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    buffer.subarray(8, 12).equals(Buffer.from("WEBP"))
  ) {
    return { mime: "image/webp", ext: "webp" };
  }

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png" };
  }

  if (buffer.length >= 6) {
    const gifHeader = buffer.subarray(0, 6).toString("ascii");
    if (gifHeader === "GIF87a" || gifHeader === "GIF89a") return { mime: "image/gif", ext: "gif" };
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }

  if (buffer.length >= 12 && buffer.subarray(4, 8).equals(Buffer.from("ftyp"))) {
    return { mime: "video/mp4", ext: "mp4" };
  }

  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { mime: "video/webm", ext: "webm" };
  }

  return null;
}

function isLikelyTextPayload(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false;

  const preview = buffer.subarray(0, Math.min(buffer.length, 120)).toString("utf8").trim().toLowerCase();
  if (!preview) return false;

  return (
    preview.startsWith("<!doctype") ||
    preview.startsWith("<html") ||
    preview.startsWith("<?xml") ||
    preview.startsWith("{") ||
    preview.startsWith("[") ||
    preview.includes("<html") ||
    preview.includes("access denied") ||
    preview.includes("forbidden")
  );
}

function inferStickerlyMediaTypeFromEntry(entry = {}) {
  const candidates = [entry?.fileName, entry?.primaryUrl, entry?.fallbackUrl]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.endsWith(".webp")) return { mime: "image/webp", ext: "webp" };
    if (candidate.endsWith(".png")) return { mime: "image/png", ext: "png" };
    if (candidate.endsWith(".gif")) return { mime: "image/gif", ext: "gif" };
    if (candidate.endsWith(".jpg") || candidate.endsWith(".jpeg")) return { mime: "image/jpeg", ext: "jpg" };
    if (candidate.endsWith(".mp4")) return { mime: "video/mp4", ext: "mp4" };
    if (candidate.endsWith(".webm")) return { mime: "video/webm", ext: "webm" };
  }

  return null;
}

function runFfmpeg(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, _stdout, stderr) => {
      if (error) {
        console.error("FFmpeg error (Sticker.ly):", stderr);
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function convertImageBufferToStickerBuffer(buffer) {
  const tempIn = path.resolve(TEMP_DIR, getRandomName("img"));
  const tempOut = path.resolve(TEMP_DIR, getRandomName("webp"));

  try {
    await fs.promises.writeFile(tempIn, buffer);
    await runFfmpeg(
      `${FFMPEG_BIN} -y -i "${tempIn}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2" -f webp -quality 90 "${tempOut}"`,
    );
    return await fs.promises.readFile(tempOut);
  } catch {
    throw new Error("Erro ao converter imagem do Sticker.ly em figurinha.");
  } finally {
    removeFileIfExists(tempIn);
    removeFileIfExists(tempOut);
  }
}

async function convertVideoBufferToStickerBuffer(buffer, ext = "mp4") {
  const tempIn = path.resolve(TEMP_DIR, getRandomName(ext || "mp4"));
  const tempOut = path.resolve(TEMP_DIR, getRandomName("webp"));

  try {
    await fs.promises.writeFile(tempIn, buffer);
    await runFfmpeg(
      `${FFMPEG_BIN} -y -i "${tempIn}" -vf "scale=350:350,fps=15" -c:v libwebp -loop 0 -quality 8 -compression_level 6 -method 6 -preset picture -an -f webp "${tempOut}"`,
    );
    return await fs.promises.readFile(tempOut);
  } catch {
    throw new Error("Erro ao converter vídeo/gif do Sticker.ly em figurinha.");
  } finally {
    removeFileIfExists(tempIn);
    removeFileIfExists(tempOut);
  }
}

export async function convertStickerlyBufferToStickerBuffer(buffer, entry = {}) {
  const inputBuffer = normalizeStickerlyFetchedBuffer(buffer);
  const { fileTypeFromBuffer } = await import("file-type");
  const detectedType = await fileTypeFromBuffer(inputBuffer).catch(() => null);
  const sniffedType = detectStickerlyMediaTypeFromBuffer(inputBuffer);
  const hintedType = isLikelyTextPayload(inputBuffer) ? null : inferStickerlyMediaTypeFromEntry(entry);
  const type = detectedType || sniffedType || hintedType;
  const mime = String(type?.mime || "");
  const ext = String(type?.ext || "");

  if (mime === "image/webp") return inputBuffer;
  if (mime.startsWith("image/")) return convertImageBufferToStickerBuffer(inputBuffer);
  if (mime === "image/gif" || mime.startsWith("video/")) {
    return convertVideoBufferToStickerBuffer(inputBuffer, ext || (mime === "image/gif" ? "gif" : "mp4"));
  }

  throw new Error("O Sticker.ly retornou um formato de figurinha não suportado.");
}