import { onMessage } from "./middlewares/onMessage.js";
import { createSocketAdapter } from "./services/wa.js";
import { startRecipeBroadcaster } from "./services/recipeBroadcaster.js";
import { startStickerBroadcaster } from "./services/stickerBroadcaster.js";
import { startBookBroadcaster } from "./services/bookBroadcaster.js";
import { startKissRushBroadcaster } from "./services/kissrushBroadcaster.js";
import { startGetmodsBroadcaster } from "./services/getmodsBroadcaster.js";
import { badMacHandler } from "./utils/badMacHandler.js";
import { errorLog, warningLog } from "./utils/logger.js";

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

const MAX_CONCURRENT_MESSAGES = boundedInteger(process.env.ATLAS_MESSAGE_CONCURRENCY, 1, 1, 2);
const MAX_QUEUED_MESSAGES = boundedInteger(process.env.ATLAS_MAX_QUEUED_MESSAGES, 12, 1, 32);
const BUSY_NOTICE_COOLDOWN_MS = 30_000;

export function load(client) {
  const socket = createSocketAdapter(client);

  startRecipeBroadcaster(socket);
  startStickerBroadcaster(socket);
  startBookBroadcaster(socket);
  startKissRushBroadcaster(socket);
  startGetmodsBroadcaster(socket);

  const safeEventHandler = async (callback, eventName) => {
    try {
      await callback();
    } catch (error) {
      if (badMacHandler.handleError(error, eventName)) return;
      errorLog(`Erro ao processar evento ${eventName}: ${error.message}`);
      if (error.stack) errorLog(`Stack trace: ${error.stack}`);
    }
  };

  const queue = [];
  const busyNoticeAt = new Map();
  let activeMessages = 0;

  const notifyBusy = (event) => {
    const jid = event?.key?.remoteJid;
    if (!jid) return;
    const now = Date.now();
    const previous = busyNoticeAt.get(jid) || 0;
    if (now - previous < BUSY_NOTICE_COOLDOWN_MS) return;

    busyNoticeAt.set(jid, now);
    for (const [knownJid, notifiedAt] of busyNoticeAt) {
      if (now - notifiedAt > BUSY_NOTICE_COOLDOWN_MS * 2) busyNoticeAt.delete(knownJid);
    }
    if (busyNoticeAt.size > 128) busyNoticeAt.delete(busyNoticeAt.keys().next().value);

    socket.sendMessage(jid, { text: "O Atlas está ocupado; tente novamente em alguns instantes." })
      .catch(() => {});
  };

  const drainQueue = () => {
    while (activeMessages < MAX_CONCURRENT_MESSAGES && queue.length > 0) {
      const { event, startProcess } = queue.shift();
      activeMessages += 1;
      void safeEventHandler(
        () => onMessage({ socket, event, startProcess }),
        "message",
      ).finally(() => {
        activeMessages -= 1;
        drainQueue();
      });
    }
  };

  client.on("message", (event) => {
    if (!event) return;
    if (queue.length >= MAX_QUEUED_MESSAGES) {
      warningLog("Fila de mensagens cheia; uma nova mensagem foi recusada para proteger a memória.");
      notifyBusy(event);
      return;
    }
    queue.push({ event, startProcess: Date.now() });
    drainQueue();
  });
}
