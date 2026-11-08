import { KISSRUSH_BLOG_URL } from "../config.js";
import { cleanExternalText, validateSearchQuery } from "./httpLimits.js";

const APP_PROVIDERS = {
  getmods: {
    label: "GetMods",
    module: "./getmodsApi.js",
    hosts: ["getmodsapk.com", "www.getmodsapk.com"],
  },
  liteapks: {
    label: "LiteAPKs",
    module: "./liteapksApi.js",
    hosts: ["liteapks.com", "www.liteapks.com"],
  },
  an1: {
    label: "AN1",
    module: "./an1Api.js",
    hosts: ["an1.com", "www.an1.com"],
  },
  androidtunado: {
    label: "AndroidTunado",
    module: "./androidtunadoApi.js",
    hosts: ["androidtunado.com.br", "www.androidtunado.com.br"],
  },
};

function safeProviderUrl(value, allowedHosts) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !allowedHosts.includes(url.hostname.toLowerCase())
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function metadataEvidence(source, title, url, excerpt = "") {
  return {
    source,
    title: cleanExternalText(title, 180),
    url,
    excerpt: cleanExternalText(excerpt, 700),
  };
}

function normalizeKeywords(value) {
  return String(value || "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const DELIVERY_ACTION = /\b(?:envia|envie|enviar|manda|mande|mandar|baixa|baixe|baixar|download|procura|procure|buscar|busca|busque|encontra|encontre|encontrar|acha|ache|arranja|arranje)\b/;
const AVAILABILITY_QUESTION = /^(?:tem|temos|existe|consegue\s+(?:achar|encontrar)|voc[eê]\s+tem)\b/;
const APP_TYPE = /\b(?:jogo|jogos|game|games|apk|apps?|aplicativo|aplicativos|mods?)\b/;
const OTHER_CONTENT_TYPE = /\b(?:livros?|books?|receitas?|mangas?|novels?|resumos?)\b/;

function stripDeliveryWords(raw) {
  return cleanExternalText(raw, 240)
    .replace(/^\s*(?:por favor\s+)?(?:me\s+)?(?:voc[eê]\s+)?(?:temos|tem|existe|consegue\s+(?:achar|encontrar)|envia|envie|enviar|manda|mande|mandar|baixa|baixe|baixar|download|procura|procure|buscar|busca|busque|encontra|encontre|encontrar|acha|ache|arranja|arranje)\s+/i, "")
    .replace(/^\s*(?:o|a|um|uma)\s+/i, "")
    .replace(/^\s*(?:jogos?|games?|apk|apps?|aplicativos?|mods?)\b[\s:,-]*/i, "")
    .replace(/^\s*(?:do|da|de)\s+/i, "")
    .replace(/(?:,?\s*)(?:por favor|por gentileza|pfv)$/i, "")
    .replace(/[?!.,]+\s*$/, "")
    .trim();
}

export function parseGameDeliveryIntent(rawQuery) {
  const raw = cleanExternalText(rawQuery, 240).trim();
  const normalized = normalizeKeywords(raw);
  if (!raw || (!DELIVERY_ACTION.test(normalized) && !AVAILABILITY_QUESTION.test(normalized)) || OTHER_CONTENT_TYPE.test(normalized)) return null;

  const query = stripDeliveryWords(raw);
  if (!APP_TYPE.test(normalized)) return { kind: "clarify", query };
  if (!query) return { kind: "clarify", query: "" };
  return { kind: "game", query };
}

function catalogResultMatches(title, url, query) {
  const terms = normalizeKeywords(query)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 1);
  if (!terms.length) return false;

  const candidate = normalizeKeywords(`${title || ""} ${url || ""}`)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/);
  return terms.every((term) => candidate.some((word) => word === term || (term.length >= 4 && word.includes(term))));
}

function normalizeResearchQuery(value) {
  return normalizeKeywords(value)
    .replace(/^(?:quem foi|quem era|o que foi|o que e|qual foi|me fala sobre|me fale sobre|fale sobre)\s+/, "")
    .replace(/\bdom\b/g, " ")
    .replace(/\bprimeiro\b/g, " i ")
    .replace(/\bsegundo\b/g, " ii ")
    .replace(/\bterceiro\b/g, " iii ")
    .replace(/[?!.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || String(value || "");
}

function removeConflictingYearResults(question, results) {
  const targetYear = normalizeKeywords(question).match(/\b(?:19|20)\d{2}\b/g)?.at(-1);
  if (!targetYear) return results;
  const filtered = results.filter((item) => {
    const titleYear = normalizeKeywords(item?.title).match(/\b(?:19|20)\d{2}\b/)?.[0];
    return !titleYear || titleYear === targetYear;
  });
  return filtered.length ? filtered : results;
}

async function searchApps(providerName, query) {
  const provider = APP_PROVIDERS[providerName];
  if (!provider) throw new Error("Provedor de apps não reconhecido.");

  const service = await import(provider.module);
  const results = await service.searchPosts(query);
  return (Array.isArray(results) ? results : []).slice(0, 3).flatMap((item) => {
    const url = safeProviderUrl(item?.url, provider.hosts);
    const title = cleanExternalText(item?.title, 180);
    if (!url || !title) return [];
    return [metadataEvidence(
      provider.label,
      title,
      url,
      "Metadados de página. O Atlas não baixou nem instalou nenhum APK.",
    )];
  });
}

async function searchBooksMetadata(query) {
  const { searchBooks } = await import("./annas-archive.js");
  const results = await searchBooks(query);
  return (Array.isArray(results) ? results : []).slice(0, 3).flatMap((item) => {
    const title = cleanExternalText(item?.title, 180);
    if (!title) return [];
    const excerpt = [item?.author, item?.meta]
      .map((value) => cleanExternalText(value, 240))
      .filter(Boolean)
      .join(" — ");
    return [metadataEvidence(
      "Catálogo de livros do Atlas — licença/autorizações não verificadas; somente metadados",
      title,
      "",
      excerpt,
    )];
  });
}

async function searchRecipesMetadata(query) {
  const { searchRecipes } = await import("./tudodelicious.js");
  const results = await searchRecipes(query);
  return (Array.isArray(results) ? results : []).slice(0, 3).flatMap((item) => {
    const url = safeProviderUrl(item?.url, ["tudodelicious.com", "www.tudodelicious.com"]);
    const title = cleanExternalText(item?.title, 180);
    if (!url || !title) return [];
    return [metadataEvidence("Receitas do Atlas", title, url, item?.description)];
  });
}

async function searchMangaMetadata(query) {
  const { searchManga } = await import("./mangaApi.js");
  const results = await searchManga(query);
  return (Array.isArray(results) ? results : []).slice(0, 3).flatMap((item) => {
    const url = safeProviderUrl(item?.href, ["atsu.moe", "www.atsu.moe"]);
    const title = cleanExternalText(item?.name, 180);
    if (!url || !title) return [];
    return [metadataEvidence("Catálogo de mangá do Atlas", title, url, "Resultado bibliográfico; nenhum capítulo foi baixado.")];
  });
}

async function searchKissRushMetadata(query) {
  let host = "";
  try {
    host = new URL(KISSRUSH_BLOG_URL).hostname.toLowerCase();
  } catch {
    return [];
  }
  const { searchPosts } = await import("./kissrushApi.js");
  const results = await searchPosts(query, 3);
  return (Array.isArray(results) ? results : []).slice(0, 3).flatMap((item) => {
    const url = safeProviderUrl(item?.url, [host]);
    const title = cleanExternalText(item?.title, 180);
    if (!url || !title) return [];
    const excerpt = [item?.summary, item?.date]
      .map((value) => cleanExternalText(value, 240))
      .filter(Boolean)
      .join(" — ");
    return [metadataEvidence("Blog KissRush — resultado de pesquisa", title, url, excerpt)];
  });
}

export async function collectEvidence(mode, query, providerName = "") {
  const safeQuery = validateSearchQuery(query);

  if (mode === "general") {
    const { searchWeb, searchWikipedia } = await import("./knowledgeSearch.js");
    const researchQuery = normalizeResearchQuery(safeQuery);
    const outcomes = await Promise.allSettled([
      searchWikipedia(researchQuery),
      searchWeb(researchQuery),
    ]);
    const results = outcomes
      .filter((outcome) => outcome.status === "fulfilled")
      .flatMap((outcome) => outcome.value)
      .slice(0, 6);
    return removeConflictingYearResults(safeQuery, results);
  }

  if (mode === "web" || mode === "wiki") {
    const { searchWeb, searchWikipedia } = await import("./knowledgeSearch.js");
    return mode === "web" ? searchWeb(safeQuery) : searchWikipedia(safeQuery);
  }

  if (mode === "apps") return searchApps(providerName, safeQuery);
  if (mode === "books") return searchBooksMetadata(safeQuery);
  if (mode === "recipes") return searchRecipesMetadata(safeQuery);
  if (mode === "manga") return searchMangaMetadata(safeQuery);
  if (mode === "kissrush") return searchKissRushMetadata(safeQuery);

  throw new Error("Fonte de pesquisa não reconhecida.");
}

function balancedGeneralSources(evidence) {
  const wikipedia = evidence.filter((item) => /wikip[eé]dia/i.test(item?.source || ""));
  const web = evidence.filter((item) => /web|duckduckgo/i.test(item?.source || ""));
  const other = evidence.filter((item) => !wikipedia.includes(item) && !web.includes(item));
  const ordered = [];
  const max = Math.max(wikipedia.length, web.length, other.length);
  for (let i = 0; i < max; i += 1) {
    if (wikipedia[i]) ordered.push(wikipedia[i]);
    if (web[i]) ordered.push(web[i]);
    if (other[i]) ordered.push(other[i]);
  }
  return ordered;
}

async function tryInternalSearch(searcher, query) {
  try {
    const results = await searcher(query);
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

/** Pesquise sequencialmente os quatro catálogos internos, sem busca geral na web. */
export async function searchGameCatalogs(rawQuery) {
  const query = validateSearchQuery(rawQuery);
  const matches = [];
  const checked = [];

  for (const providerName of Object.keys(APP_PROVIDERS)) {
    const provider = APP_PROVIDERS[providerName];
    try {
      const service = await import(provider.module);
      const results = await service.searchPosts(query);
      let match = null;

      for (const item of (Array.isArray(results) ? results : []).slice(0, 3)) {
        const url = safeProviderUrl(item?.url, provider.hosts);
        let title = cleanExternalText(item?.title, 180);
        if (!url || !catalogResultMatches(title, url, query)) continue;

        if (typeof service.getPostDetails === "function") {
          try {
            const details = await service.getPostDetails(url);
            title = cleanExternalText(details?.title, 180) || title;
          } catch {}
        }
        if (!catalogResultMatches(title, url, query)) continue;
        match = { source: provider.label, title, url };
        break;
      }

      checked.push({ source: provider.label, ok: true });
      if (match) matches.push(match);
    } catch {
      checked.push({ source: provider.label, ok: false });
    }
  }

  return { query, matches, checked };
}

/**
 * Para conversas gerais, pesquisa sempre Web + Wikipédia e acrescenta os
 * catálogos do Atlas apenas quando a mensagem indica que são relevantes.
 * Os adaptadores devolvem metadados; esta função nunca chama downloads.
 */
export async function collectConversationEvidence(rawQuery) {
  const query = validateSearchQuery(rawQuery);
  let general = [];
  try {
    general = await collectEvidence("general", query);
  } catch {}
  const normalized = normalizeKeywords(query);
  const internal = [];

  const namedProviders = Object.keys(APP_PROVIDERS).filter((provider) => normalized.includes(provider));
  const wantsApps = namedProviders.length > 0 || /\b(apk|app|apps|aplicativo|aplicativos|mod|mods|android)\b/.test(normalized);
  if (wantsApps) {
    const providers = namedProviders.length ? namedProviders : Object.keys(APP_PROVIDERS);
    for (const provider of providers) {
      internal.push(...await tryInternalSearch((value) => searchApps(provider, value), query));
      if (internal.length >= 2) break;
    }
  }

  if (/\b(livro|livros|book|books|autor|autora|isbn|ebook|e-book|biblioteca|romance)\b/.test(normalized)) {
    internal.push(...await tryInternalSearch(searchBooksMetadata, query));
  }
  if (/\b(receita|receitas|ingrediente|ingredientes|cozinhar|bolo|prato|culinaria)\b/.test(normalized)) {
    internal.push(...await tryInternalSearch(searchRecipesMetadata, query));
  }
  if (/\b(manga|mangas|capitulo de manga)\b/.test(normalized)) {
    internal.push(...await tryInternalSearch(searchMangaMetadata, query));
  }
  if (/\b(kissrush|web\s*novel|novel)\b/.test(normalized)) {
    internal.push(...await tryInternalSearch(searchKissRushMetadata, query));
  }

  const balancedGeneral = balancedGeneralSources(general);
  if (!internal.length) return balancedGeneral.slice(0, 6);
  return [
    ...internal.slice(0, 1),
    ...balancedGeneral.slice(0, 2),
    ...internal.slice(1, 2),
    ...balancedGeneral.slice(2, 4),
  ].slice(0, 6);
}
