import * as cheerio from "cheerio";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  cleanExternalText,
  readResponseTextLimited,
  validateSearchQuery,
} from "./httpLimits.js";

const USER_AGENT = "Atlas/2.0 (local research assistant)";
const MAX_SEARCH_RESULTS = 3;
const MAX_WEB_CANDIDATES = 8;
const MAX_BROWSER_CANDIDATES = 2;
const MAX_RESPONSE_BYTES = 512 * 1024;
const BROWSER_NAVIGATION_TIMEOUT_MS = 6000;

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === "::1"
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isPublicAddress(rawAddress) {
  const address = String(rawAddress || "").replace(/^\[|\]$/g, "").toLowerCase();
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [a, b, c] = octets;
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (version === 6) {
    const firstField = address.split(":")[0];
    const first = Number.parseInt(firstField, 16);
    return Number.isFinite(first) && first >= 0x2000 && first <= 0x3fff &&
      !address.startsWith("2001:db8:") &&
      !address.startsWith("2001:10:") &&
      !address.startsWith("2002:");
  }
  return false;
}

async function safeBrowserDocumentUrl(value) {
  const url = safeHttpsUrl(value);
  if (!url) return null;
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return isPublicAddress(hostname) ? url : null;
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.length && addresses.every(({ address }) => isPublicAddress(address)) ? url : null;
  } catch {
    return null;
  }
}

function unwrapSearchLink(href) {
  try {
    const url = new URL(href, "https://html.duckduckgo.com");
    const host = url.hostname.toLowerCase();
    if (
      (host === "duckduckgo.com" || host.endsWith(".duckduckgo.com")) &&
      url.pathname.startsWith("/l/")
    ) {
      return url.searchParams.get("uddg") || url.searchParams.get("url") || "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

async function fetchText(url, timeoutMs = 8000) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/json;q=0.9,*/*;q=0.5",
      "User-Agent": USER_AGENT,
    },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error("A fonte de pesquisa não respondeu.");
  return readResponseTextLimited(response, MAX_RESPONSE_BYTES);
}

function getRelevantParagraphs(text, rawQuery) {
  const queryTerms = cleanExternalText(rawQuery, 240)
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 4);
  const paragraphs = String(text || "")
    .split(/\r?\n+|(?<=[.!?])\s+/u)
    .map((part) => cleanExternalText(part, 500))
    .filter((part) => part.length >= 45);
  if (!paragraphs.length) return "";

  const scored = paragraphs.map((part, index) => {
    const normalized = part.toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const score = queryTerms.reduce((sum, term) => sum + (normalized.includes(term) ? 1 : 0), 0);
    return { part, index, score };
  });
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 4);
  if (ranked.every((item) => item.score === 0)) return cleanExternalText(paragraphs.slice(0, 3).join(" "), 1200);
  return cleanExternalText(ranked.sort((a, b) => a.index - b.index).map((item) => item.part).join(" "), 1200);
}

async function readSearchResultsInBrowser(results, query) {
  const candidates = results.filter((item) => item?.url).slice(0, MAX_BROWSER_CANDIDATES);
  if (!candidates.length) return results;

  let context;
  try {
    const { createContext } = await import("./browserManager.js");
    context = await createContext({
      acceptDownloads: false,
      javaScriptEnabled: false,
      serviceWorkers: "block",
    });
    await context.route("**/*", async (route) => {
      try {
        const request = route.request();
        if (request.resourceType() !== "document" || !["GET", "HEAD"].includes(request.method())) {
          await route.abort();
          return;
        }
        if (!(await safeBrowserDocumentUrl(request.url()))) {
          await route.abort();
          return;
        }
        await route.continue();
      } catch {
        await route.abort().catch(() => {});
      }
    });

    const page = await context.newPage();
    page.setDefaultNavigationTimeout(BROWSER_NAVIGATION_TIMEOUT_MS);
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
    page.on("popup", (popup) => popup.close().catch(() => {}));
    const enriched = [...results];

    for (const candidate of candidates) {
      const safeUrl = await safeBrowserDocumentUrl(candidate.url);
      if (!safeUrl) continue;
      try {
        await page.goto(safeUrl, {
          waitUntil: "domcontentloaded",
          timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
        });
        let pageText = "";
        for (const selector of ["article", "main", "body"]) {
          try {
            pageText = await page.locator(selector).first().innerText({ timeout: 1200 });
            if (pageText.trim()) break;
          } catch {}
        }
        const excerpt = getRelevantParagraphs(pageText, query);
        if (excerpt.length < 100) continue;
        const index = enriched.findIndex((item) => item.url === candidate.url);
        if (index >= 0) {
          enriched[index] = {
            ...candidate,
            source: "Busca web + navegador universal do Atlas",
            excerpt,
          };
        }
        break;
      } catch {
        // Se uma página não abrir, os snippets do buscador continuam disponíveis.
      }
    }
    return enriched;
  } catch {
    // O browser é complementar; falhas do Chromium não apagam resultados HTTP.
    return results;
  } finally {
    await context?.close().catch(() => {});
  }
}

export async function searchWikipedia(rawQuery) {
  const query = validateSearchQuery(rawQuery);
  const normalizedQuery = cleanExternalText(query, 240)
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const targetsBrazilianPedroII = /\bpedro\s+ii\s+do\s+brasil\b/.test(normalizedQuery);
  const url = new URL("https://pt.wikipedia.org/w/api.php");
  const params = {
    action: "query",
    prop: "extracts|info",
    exchars: "1200",
    explaintext: "1",
    inprop: "url",
    redirects: "1",
    format: "json",
    formatversion: "2",
    utf8: "1",
  };
  if (targetsBrazilianPedroII) {
    params.titles = "Pedro II do Brasil";
  } else {
    params.generator = "search";
    params.gsrsearch = query;
    params.gsrlimit = String(MAX_SEARCH_RESULTS);
  }
  url.search = new URLSearchParams(params).toString();

  const payload = JSON.parse(await fetchText(url));
  const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];

  return pages.slice(0, MAX_SEARCH_RESULTS).flatMap((page) => {
    const title = cleanExternalText(page?.title, 180);
    const excerpt = cleanExternalText(page?.extract, 1200);
    const sourceUrl = safeHttpsUrl(page?.fullurl);
    if (!title || !excerpt || !sourceUrl) return [];
    const searchableText = `${title} ${excerpt}`.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (/pode\s+(?:se\s+)?referir-se|may\s+refer\s+to|pagina\s+de\s+desambiguacao|disambiguation/i.test(searchableText)) return [];
    if (targetsBrazilianPedroII && !/pedro\s+ii\s+do\s+brasil|imperador\s+do\s+brasil/.test(searchableText)) return [];
    const parsed = new URL(sourceUrl);
    if (parsed.hostname !== "pt.wikipedia.org") return [];
    return [{ source: "Wikipédia em português", title, url: sourceUrl, excerpt }];
  });
}

export async function searchWeb(rawQuery) {
  const query = validateSearchQuery(rawQuery);
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const results = [];

  $(".result").each((_, element) => {
    if (results.length >= MAX_WEB_CANDIDATES) return;
    const item = $(element);
    const title = cleanExternalText(item.find(".result__a").first().text(), 180);
    const href = item.find(".result__a").first().attr("href");
    const excerpt = cleanExternalText(item.find(".result__snippet").first().text(), 700);
    const sourceUrl = safeHttpsUrl(unwrapSearchLink(href || ""));
    if (!title || !sourceUrl) return;
    results.push({
      source: "Busca na web (DuckDuckGo)",
      title,
      url: sourceUrl,
      excerpt: excerpt || "Resultado indexado; o buscador não forneceu um resumo.",
    });
  });

  const independentResults = results.filter((item) => {
    try {
      return !new URL(item.url).hostname.toLowerCase().endsWith("wikipedia.org");
    } catch {
      return false;
    }
  });
  return readSearchResultsInBrowser(independentResults.slice(0, MAX_SEARCH_RESULTS), query);
}
