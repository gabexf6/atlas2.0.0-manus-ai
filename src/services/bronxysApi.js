import { BRONXYS_API_KEY, BRONXYS_BASE_URL } from "../config.js";

const FETCH_HEADERS = { "User-Agent": "Mozilla/5.0", "Accept-Language": "pt-BR" };

export function ensureApiKey() {
  if (!BRONXYS_API_KEY) {
    throw new Error(
      "Configure a variável de ambiente ATLAS_BRONXYS_API_KEY (chave grátis em https://api.bronxyshost.com.br) antes de usar os downloaders.",
    );
  }
}

function buildUrl(endpoint, params = {}) {
  const url = new URL(`${BRONXYS_BASE_URL}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  url.searchParams.set("apikey", BRONXYS_API_KEY);
  return url.toString();
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);

async function fetchWithRetry(url, { attempts = 3, delayMs = 1500 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(url, { headers: FETCH_HEADERS });
    if (response.ok) return response;
    if (!RETRYABLE_STATUS.has(response.status) || i === attempts - 1) {
      lastError = new Error(`HTTP ${response.status}`);
      lastError.response = response;
      throw lastError;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
  }
  throw lastError;
}

// Baixa o conteúdo de uma URL qualquer (CDN direto, sem passar pela Bronxys de novo) como Buffer.
const MAX_PARALLEL_DOWNLOADS = Number(process.env.ATLAS_MAX_PARALLEL_DOWNLOADS) || 2;
let activeDownloads = 0;
const downloadQueue = [];

async function withDownloadSlot(task) {
  if (activeDownloads >= MAX_PARALLEL_DOWNLOADS) {
    await new Promise((resolve) => downloadQueue.push(resolve));
  } else {
    activeDownloads += 1;
  }
  try {
    return await task();
  } finally {
    const next = downloadQueue.shift();
    if (next) next();
    else activeDownloads -= 1;
  }
}

export function fetchUrlBuffer(url) {
  return withDownloadSlot(() => fetchUrlBufferNow(url));
}

async function fetchUrlBufferNow(url) {
  let response;
  try {
    response = await fetchWithRetry(url);
  } catch (error) {
    throw new Error(`Falha ao baixar o arquivo (${error.message}) — o servidor de origem pode estar instável, tenta de novo em alguns segundos`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fetchJson(endpoint, params) {
  ensureApiKey();
  let response;
  try {
    response = await fetchWithRetry(buildUrl(endpoint, params));
  } catch (error) {
    throw new Error(`API respondeu ${error.message} para "${endpoint}" — provável instabilidade passageira do lado da API, tenta de novo em alguns segundos`);
  }
  return response.json();
}

// Vários endpoints da Bronxys SERVEM a mídia diretamente ao serem acessados
// (o link já É o arquivo) — então só precisamos buscar aquele link como buffer.
async function fetchDirectMedia(endpoint, params) {
  ensureApiKey();
  return fetchUrlBuffer(buildUrl(endpoint, params));
}

// -----------------------------------------------------------------------------
// Detecção de plataforma a partir da URL — usado pelo /downloader universal.
// -----------------------------------------------------------------------------
export function detectPlatform(rawUrl) {
  const url = String(rawUrl || "").toLowerCase();
  if (url.includes("tiktok.com")) return "tiktok";
  if (url.includes("instagram.com")) return "instagram";
  if (url.includes("facebook.com") || url.includes("fb.watch")) return "facebook";
  if ((url.includes("twitter.com") || url.includes("x.com")) && url.includes("status")) return "twitter";
  if (url.includes("threads.net")) return "threads";
  if (url.includes("kwai.com") || url.includes("kwai.app")) return "kwai";
  if (url.includes("ifunny.co")) return "ifunny";
  if (url.includes("open.spotify.com")) return "spotify";
  if (url.includes("soundcloud.com")) return "soundcloud";
  if (url.includes("mediafire.com")) return "mediafire";
  if (url.includes("aptoide.com")) return "aptoide";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  return null;
}

// Cada entrada descreve os formatos aceitos: "video", "audio", "document", "image".
// O primeiro da lista é o padrão quando só existe uma opção (sem menu de escolha).
export const PLATFORM_FORMATS = {
  tiktok: ["video", "audio"],
  instagram: ["video", "audio"], // tipo real (foto/vídeo) só se sabe após consultar a API
  facebook: ["video", "audio"],
  twitter: ["video", "audio"],
  threads: ["video"],
  kwai: ["video"],
  ifunny: ["video"],
  spotify: ["audio"],
  soundcloud: ["audio"],
  mediafire: ["document"],
  aptoide: ["document"],
  youtube: ["audio", "video"],
};

// -----------------------------------------------------------------------------
// Downloads por plataforma
// -----------------------------------------------------------------------------
export async function downloadTikTokVideo(url) {
  return { buffer: await fetchDirectMedia("tiktok", { url }), mimetype: "video/mp4" };
}
export async function downloadTikTokAudio(url) {
  return { buffer: await fetchDirectMedia("tiktok", { url }), mimetype: "audio/mpeg" };
}

export async function downloadFacebookVideo(url) {
  return { buffer: await fetchDirectMedia("face_video", { url }), mimetype: "video/mp4" };
}
export async function downloadFacebookAudio(url) {
  return { buffer: await fetchDirectMedia("face_audio", { url }), mimetype: "audio/mpeg" };
}

export async function downloadTwitterVideo(url) {
  return { buffer: await fetchDirectMedia("twitter_video", { url }), mimetype: "video/mp4" };
}
export async function downloadTwitterAudio(url) {
  return { buffer: await fetchDirectMedia("twitter_audio", { url }), mimetype: "audio/mpeg" };
}

export async function downloadThreads(url) {
  return { buffer: await fetchDirectMedia("threads", { url }), mimetype: "video/mp4" };
}
export async function downloadKwai(url) {
  return { buffer: await fetchDirectMedia("kwai", { url }), mimetype: "video/mp4" };
}
export async function downloadIfunny(url) {
  return { buffer: await fetchDirectMedia("ifunny", { url }), mimetype: "video/mp4" };
}
export async function downloadSpotify(url) {
  return { buffer: await fetchDirectMedia("spotify", { url }), mimetype: "audio/mpeg" };
}
export async function downloadSoundcloud(url) {
  return { buffer: await fetchDirectMedia("soundcloud", { url }), mimetype: "audio/mpeg" };
}

export async function searchYoutube(query) {
  const results = await fetchJson("pesquisa_ytb", { nome: query });
  return Array.isArray(results) ? results : [];
}
export async function downloadYoutubeAudio(query) {
  return { buffer: await fetchDirectMedia("play", { nome_url: query }), mimetype: "audio/mpeg" };
}
export async function downloadYoutubeVideo(query) {
  return { buffer: await fetchDirectMedia("play_video", { nome_url: query }), mimetype: "video/mp4" };
}

// Instagram devolve um JSON com o link real da mídia (não é servido direto).
export async function downloadInstagram(url) {
  const data = await fetchJson("instagram", { url });
  const item = data?.msg?.[0];
  if (!item?.url) throw new Error("não encontrei mídia nesse link do Instagram");
  const buffer = await fetchUrlBuffer(item.url);
  const mimetype = item.type === "mp4" ? "video/mp4"
    : item.type === "mp3" ? "audio/mpeg"
    : item.type === "webp" ? "image/webp"
    : item.type === "jpg" ? "image/jpeg"
    : "video/mp4";
  return { buffer, mimetype, kind: mimetype.split("/")[0] };
}

export async function downloadMediaFire(url) {
  const data = await fetchJson("mediafire", { url });
  const item = data?.resultado?.[0];
  if (!item?.link) throw new Error("não encontrei esse arquivo no MediaFire");
  const buffer = await fetchUrlBuffer(item.link);
  return { buffer, mimetype: `application/${item.mime || "octet-stream"}`, fileName: item.nama, size: item.size };
}

export async function searchAptoide(query) {
  const data = await fetchJson("aptoide_pesquisa", { pesquisa: query });
  return data?.aptoide || "";
}
export async function downloadAptoide(url) {
  const data = await fetchJson("aptoide", { url });
  if (!data?.link) throw new Error("não encontrei esse APK no Aptoide");
  const buffer = await fetchUrlBuffer(data.link);
  return { buffer, mimetype: "application/vnd.android.package-archive", fileName: data.titulo || "app.apk" };
}

export async function searchPinterest(query) {
  const data = await fetchJson("pinterest", { nome: query });
  const list = Array.isArray(data) ? data : [];
  if (!list.length) throw new Error("não encontrei imagens desse termo no Pinterest");
  const url = list[Math.floor(Math.random() * list.length)];
  return { buffer: await fetchUrlBuffer(url), mimetype: "image/jpeg" };
}
