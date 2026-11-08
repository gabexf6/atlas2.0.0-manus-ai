import { BOT_EMOJI } from "../config.js";
import { getPrefix } from "../utils/database.js";
import { isGroupAiEnabled } from "../utils/aiGroupSettings.js";
import { answerFromEvidence } from "./localAssistant.js";
import {
  collectConversationEvidence,
  parseGamePageLinkRequest,
  parseGameDeliveryIntent,
  searchGameCatalogs,
} from "./assistantSources.js";
import { cleanExternalText } from "./httpLimits.js";
import { warningLog } from "../utils/logger.js";

const MAX_QUEUE = 2;
const MAX_QUERY_CHARS = 240;
const GROUP_COOLDOWN_MS = 12_000;
const SENDER_COOLDOWN_MS = 25_000;
const MAX_PER_GROUP_PER_MINUTE = 4;
const FAILURE_NOTICE_COOLDOWN_MS = 5 * 60_000;
const MAX_TRACKED_KEYS = 128;

const queue = [];
const lastGroupEnqueue = new Map();
const lastSenderEnqueue = new Map();
const groupWindows = new Map();
const seenMessageIds = new Map();
const recentUserMessages = new Map();
const recentGameResults = new Map();
const lastFailureNotice = new Map();
let draining = false;

function trimMap(map, maxSize = MAX_TRACKED_KEYS) {
  while (map.size > maxSize) map.delete(map.keys().next().value);
}

function isNoise(text) {
  const normalized = text.trim().toLocaleLowerCase("pt-BR");
  return /^(?:k{3,}|r+s{2,}|rsrs+|[😂🤣😅😆👍❤️💙💚✨🙏]+)$/u.test(normalized);
}

function greetingReply(text) {
  const normalized = text
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[!?.,]+/g, " ")
    .trim();
  if (/^(oi+|ola|opa|salve|bom dia|boa tarde|boa noite|e ai|fala|tudo bem)$/.test(normalized)) {
    return "Oi! Manda a pergunta ou o assunto; quando for algo factual, eu pesquiso antes de responder.";
  }
  if (/^(oxi|oxe|hein)$/.test(normalized)) return "Opa, manda aí — o que você quis dizer?";
  return "";
}

function rememberMessage(actorKey, text) {
  const prior = recentUserMessages.get(actorKey);
  const messages = prior && Date.now() - prior.updatedAt < 60 * 60_000 ? prior.messages : [];
  messages.push(text);
  recentUserMessages.set(actorKey, { messages: messages.slice(-2), updatedAt: Date.now() });
  trimMap(recentUserMessages);
}

function getConversationContext(actorKey) {
  const prior = recentUserMessages.get(actorKey);
  if (!prior) return "";
  if (Date.now() - prior.updatedAt > 60 * 60_000) {
    recentUserMessages.delete(actorKey);
    return "";
  }
  return prior.messages.slice(-1)[0] || "";
}

function isFollowUp(text) {
  return /^(?:e\b|isso\b|ele\b|ela\b|esse\b|essa\b|sim\b|não\b|nao\b|onde\b|quando\b|por que\b|qual deles\b|mais\b|como assim\b|hein\b|oxi\b|oxe\b|mas\b|então\b|entao\b|(?:eu\s+)?quero saber\b|me explica\b|explica melhor\b)/i.test(text.trim());
}

function searchQueryFor(text, context) {
  if (!context || !isFollowUp(text)) return text;
  const contextLimit = Math.max(0, MAX_QUERY_CHARS - text.length - 1);
  if (contextLimit === 0) return text;
  return cleanExternalText(`${context.slice(-contextLimit)} ${text}`, MAX_QUERY_CHARS);
}

function mayUseCatalogBrowser(text, evidence) {
  const sourceMatch = evidence.some((item) => /getmods|liteapks|an1|androidtunado|receita|mang[aá]|kissrush/i.test(item?.source || ""));
  const queryMatch = /\b(apk|app|apps|aplicativo|android|mod|manga|mangá|receita|receitas|kissrush|novel)\b/i.test(text);
  return sourceMatch || queryMatch;
}

async function sendText(socket, remoteJid, text) {
  if (!text) return;
  await socket.sendMessage(remoteJid, { text: `${BOT_EMOJI} ${text}` });
}

function gameSearchReply(result) {
  const failed = result.checked.filter((item) => !item.ok);
  if (result.matches.length) {
    const found = result.matches
      .map((item) => `“${cleanExternalText(item.title, 100)}” no ${item.source}`)
      .join("; ");
    return `Achei ${found}. Só um detalhe: esses catálogos entregam metadados da página, não o arquivo do jogo; o Atlas ainda não consegue anexar o APK. Então não vou mandar link de terceiros.`;
  }
  if (failed.length === result.checked.length) {
    return "Os catálogos internos não responderam agora. Tenta de novo daqui a pouco.";
  }
  if (failed.length) {
    return `Não encontrei o jogo nos catálogos que responderam. A consulta falhou em ${failed.map((item) => item.source).join(", ")}, então não consigo confirmar esses catálogos agora.`;
  }
  return `Procurei “${cleanExternalText(result.query, 100)}” nos catálogos do Atlas (GetMods, LiteAPKs, AN1 e Android Tunado), mas não achei. Se houver outra grafia, me fala que tento de novo.`;
}

function rememberGameResult(actorKey, result) {
  if (!actorKey || !result) return;
  recentGameResults.set(actorKey, { result, updatedAt: Date.now() });
  trimMap(recentGameResults);
}

function getRecentGameResult(actorKey) {
  const saved = recentGameResults.get(actorKey);
  if (!saved) return null;
  if (Date.now() - saved.updatedAt > 10 * 60_000) {
    recentGameResults.delete(actorKey);
    return null;
  }
  return saved.result;
}

async function searchCatalogsAndCloseBrowser(query) {
  try {
    return await searchGameCatalogs(query);
  } finally {
    const { closeBrowser } = await import("./browserManager.js");
    await closeBrowser().catch(() => {});
  }
}

function pageLinkReply(result, requestedQuery = "") {
  const match = result?.matches?.[0];
  if (match?.url) {
    return `Claro, achei a página “${cleanExternalText(match.title, 100)}” no ${match.source}: ${cleanExternalText(match.url, 300)}`;
  }
  if (result?.checked?.length && result.checked.every((item) => !item.ok)) {
    return "Não consegui consultar os catálogos agora. Tenta de novo daqui a pouco.";
  }
  const query = requestedQuery || result?.query || "esse jogo";
  return `Não achei a página de “${cleanExternalText(query, 100)}” nos catálogos que responderam.`;
}

async function processItem(item) {
  const { socket, remoteJid, text, actorKey } = item;
  const context = isFollowUp(text) ? getConversationContext(actorKey) : "";
  rememberMessage(actorKey, text);
  const greeting = greetingReply(text);
  if (greeting) {
    await sendText(socket, remoteJid, greeting);
    return;
  }

  const pageLinkIntent = parseGamePageLinkRequest(text);
  if (pageLinkIntent) {
    const cached = getRecentGameResult(actorKey);
    let result = cached;
    if (pageLinkIntent.query && cached?.query?.toLocaleLowerCase("pt-BR") !== pageLinkIntent.query.toLocaleLowerCase("pt-BR")) {
      result = await searchCatalogsAndCloseBrowser(pageLinkIntent.query);
      rememberGameResult(actorKey, result);
    }
    if (!pageLinkIntent.query && !result) {
      await sendText(socket, remoteJid, "Qual jogo? Me fala o nome e eu procuro a página nos catálogos do Atlas.");
      return;
    }
    await sendText(socket, remoteJid, pageLinkReply(result, pageLinkIntent.query));
    return;
  }

  const gameIntent = parseGameDeliveryIntent(text);
  if (gameIntent?.kind === "clarify") {
    await sendText(
      socket,
      remoteJid,
      `Você quer um jogo ou aplicativo? Me diga o nome junto com “jogo” (por exemplo: “me envie o jogo Journeys”) e eu procuro nos catálogos do Atlas.`,
    );
    return;
  }
  if (gameIntent?.kind === "game") {
    const result = await searchCatalogsAndCloseBrowser(gameIntent.query);
    rememberGameResult(actorKey, result);
    await sendText(socket, remoteJid, gameSearchReply(result));
    return;
  }

  const query = searchQueryFor(text, context);
  const evidence = await collectConversationEvidence(query);
  if (mayUseCatalogBrowser(query, evidence)) {
    // Carregue o gerenciador somente quando um catálogo possa ter usado Chromium.
    const { closeBrowser } = await import("./browserManager.js");
    await closeBrowser().catch(() => {});
  }

  if (!evidence.length) {
    await sendText(socket, remoteJid, "Não encontrei fontes suficientes para responder com segurança. Tenta reformular a pergunta.");
    return;
  }

  const selectedEvidence = evidence.slice(0, 2);
  const answer = await answerFromEvidence(text, selectedEvidence, context);
  await sendText(socket, remoteJid, cleanExternalText(answer, 1800));
}

async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const item = queue.shift();
      try {
        await processItem(item);
      } catch (error) {
        warningLog(`Falha na IA de grupo ${item.remoteJid}: ${error.message}`);
        const lastNotice = lastFailureNotice.get(item.remoteJid) || 0;
        if (Date.now() - lastNotice >= FAILURE_NOTICE_COOLDOWN_MS) {
          lastFailureNotice.set(item.remoteJid, Date.now());
          trimMap(lastFailureNotice);
          await sendText(
            item.socket,
            item.remoteJid,
            "Não consegui concluir a pesquisa agora. Tenta de novo daqui a pouco; se continuar, confere a conexão do servidor.",
          ).catch(() => {});
        }
      }
    }
  } finally {
    draining = false;
    if (queue.length) void drainQueue();
  }
}

export function enqueueGroupAssistant({ socket, webMessage, fullMessage, remoteJid, userLid }) {
  if (
    !socket ||
    !String(remoteJid || "").endsWith("@g.us") ||
    webMessage?.key?.fromMe ||
    !isGroupAiEnabled(remoteJid)
  ) {
    return false;
  }

  const text = cleanExternalText(fullMessage, MAX_QUERY_CHARS);
  if (!text || text === "#auto-command" || text.length < 3 || isNoise(text)) return false;

  const conversationalFollowUp = Boolean(greetingReply(text)) || isFollowUp(text) || Boolean(parseGamePageLinkRequest(text));

  const prefix = getPrefix(remoteJid);
  if (prefix && text.startsWith(prefix)) return false;

  const messageId = String(webMessage?.key?.id || "");
  if (messageId && seenMessageIds.has(messageId)) return false;
  if (messageId) {
    seenMessageIds.set(messageId, Date.now());
    for (const [id, timestamp] of seenMessageIds) {
      if (Date.now() - timestamp > 10 * 60_000) seenMessageIds.delete(id);
    }
    trimMap(seenMessageIds, 256);
  }

  if (queue.length >= MAX_QUEUE) return false;

  const now = Date.now();
  const lastGroupAt = lastGroupEnqueue.get(remoteJid) || 0;
  if (now - lastGroupAt < GROUP_COOLDOWN_MS && !conversationalFollowUp) return false;

  const sender = String(userLid || webMessage?.key?.participant || "unknown").replace(/:[0-9]+(?=@)/g, "");
  const actorKey = `${remoteJid}:${sender}`;
  const lastSenderAt = lastSenderEnqueue.get(actorKey) || 0;
  if (now - lastSenderAt < SENDER_COOLDOWN_MS && !conversationalFollowUp) return false;

  const window = groupWindows.get(remoteJid);
  const currentWindow = !window || now - window.startedAt >= 60_000
    ? { startedAt: now, count: 0 }
    : window;
  if (currentWindow.count >= MAX_PER_GROUP_PER_MINUTE) return false;
  currentWindow.count += 1;
  groupWindows.set(remoteJid, currentWindow);
  lastGroupEnqueue.set(remoteJid, now);
  lastSenderEnqueue.set(actorKey, now);
  trimMap(groupWindows);
  trimMap(lastGroupEnqueue);
  trimMap(lastSenderEnqueue);

  queue.push({ socket, remoteJid, text, actorKey });
  void drainQueue();
  return true;
}
