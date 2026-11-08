import * as cheerio from "cheerio";
import {
  cleanExternalText,
  readResponseTextLimited,
  validateSearchQuery,
} from "./httpLimits.js";

const USER_AGENT = "Atlas/2.0 (local research assistant)";
const MAX_SEARCH_RESULTS = 3;
const MAX_RESPONSE_BYTES = 512 * 1024;

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

export async function searchWikipedia(rawQuery) {
  const query = validateSearchQuery(rawQuery);
  const url = new URL("https://pt.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: String(MAX_SEARCH_RESULTS),
    prop: "extracts|info",
    exchars: "1200",
    explaintext: "1",
    inprop: "url",
    redirects: "1",
    format: "json",
    formatversion: "2",
    utf8: "1",
  }).toString();

  const payload = JSON.parse(await fetchText(url));
  const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];

  return pages.slice(0, MAX_SEARCH_RESULTS).flatMap((page) => {
    const title = cleanExternalText(page?.title, 180);
    const excerpt = cleanExternalText(page?.extract, 1200);
    const sourceUrl = safeHttpsUrl(page?.fullurl);
    if (!title || !excerpt || !sourceUrl) return [];
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
    if (results.length >= MAX_SEARCH_RESULTS) return;
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

  return results;
}
