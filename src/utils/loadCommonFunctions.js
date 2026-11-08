import { delay } from "zapo-js";
import fs from "node:fs";
import { BOT_EMOJI, TIMEOUT_IN_MILLISECONDS_BY_EVENT } from "../config.js";
import {
  ajustAudioByBuffer,
  hasMessageContent,
  download,
  extractDataFromMessage,
  removeFileWithTimeout,
} from "./index.js";
import {
  detectImageMimetype,
  detectMimetype,
} from "../services/imageOptimizer.js";

export function loadCommonFunctions({ socket, webMessage }) {
  const {
    args,
    commandName,
    fullArgs,
    fullMessage,
    prefix,
    remoteJid,
    remoteJidAlt,
    userLid,
  } = extractDataFromMessage(webMessage);

  if (!remoteJid) {
    return null;
  }

  const isImage = hasMessageContent(webMessage, "image");
  const isVideo = hasMessageContent(webMessage, "video");
  const isSticker = hasMessageContent(webMessage, "sticker");
  const withRetry = async (fn, maxRetries = 3, delayMs = 1000) => {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        console.warn(
          `Tentativa ${attempt}/${maxRetries} falhou:`,
          error.message,
        );

        if (attempt < maxRetries) {
          await delay(delayMs * attempt);
        }
      }
    }

    throw new Error(
      `Falha após ${maxRetries} tentativas. Último erro: ${lastError.message}`,
    );
  };

  const sendTypingState = async (anotherJid = "") => {
    const sendToJid = anotherJid || remoteJid;

    try {
      await socket.sendPresenceUpdate("composing", sendToJid);
    } catch (error) {
      console.warn(`Não foi possível atualizar o status de digitação: ${error.message}`);
    }

    await delay(TIMEOUT_IN_MILLISECONDS_BY_EVENT);
  };

  const sendRecordState = async (anotherJid = "") => {
    const sendToJid = anotherJid || remoteJid;

    try {
      await socket.sendPresenceUpdate("recording", sendToJid);
    } catch (error) {
      console.warn(`Não foi possível atualizar o status de gravação: ${error.message}`);
    }

    await delay(TIMEOUT_IN_MILLISECONDS_BY_EVENT);
  };

  const downloadImage = async (webMessage, fileName) => {
    return await download(webMessage, fileName, "image", "png");
  };

  const downloadSticker = async (webMessage, fileName) => {
    return await download(webMessage, fileName, "sticker", "webp");
  };

  const downloadVideo = async (webMessage, fileName) => {
    return await download(webMessage, fileName, "video", "mp4");
  };

  const splitReplyIntoParts = (value, maxChars = 3200) => {
    const source = String(value ?? "").trim();
    if (!source) return [""];
    const parts = [];
    let rest = source;
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars + 1);
      let cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
      if (cut < Math.floor(maxChars * 0.55)) {
        const sentenceMatches = [...window.matchAll(/[.!?](?:["'”’)]*)?(?=\s|$)/g)];
        cut = sentenceMatches.filter((match) => match.index < maxChars).at(-1)?.index + 1 || 0;
      }
      if (cut < Math.floor(maxChars * 0.55)) cut = window.lastIndexOf(" ", maxChars);
      if (cut <= 0) cut = maxChars;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  };

  const sendReply = async (text, mentions) => {
    await sendTypingState();

    const optionalParams = mentions?.length ? { mentions } : {};
    const parts = splitReplyIntoParts(text);
    let result;
    for (const part of parts) {
      result = await socket.sendMessage(
        remoteJid,
        { text: `${BOT_EMOJI} ${part}`, ...optionalParams },
        { quoted: JSON.parse(JSON.stringify(webMessage)) },
      );
    }
    return result;
  };

  const sendReact = async (emoji, msgKey = webMessage.key) => {
    return await socket.sendMessage(remoteJid, {
      react: {
        text: emoji,
        key: msgKey,
      },
    });
  };

  const sendSuccessReact = async () => {
    return await sendReact("✅");
  };

  const sendWaitReact = async () => {
    return await sendReact("⏳");
  };

  const sendReplyWithOptionalReaction = async (reaction, text, mentions) => {
    try {
      await sendReact(reaction);
    } catch (error) {
      console.warn(`Não foi possível enviar a reação ${reaction}: ${error.message}`);
    }

    return await sendReply(text, mentions);
  };

  const sendSuccessReply = async (text, mentions) =>
    sendReplyWithOptionalReaction("✅", `✅ ${text}`, mentions);

  const sendWaitReply = async (text, mentions) =>
    sendReplyWithOptionalReaction(
      "⏳",
      `⏳ Aguarde! ${text || "Carregando dados..."}`,
      mentions,
    );

  const sendWarningReply = async (text, mentions) =>
    sendReplyWithOptionalReaction("⚠️", `⚠️ Atenção! ${text}`, mentions);

  const sendErrorReply = async (text, mentions) =>
    sendReplyWithOptionalReaction("❌", `❌ Erro! ${text}`, mentions);

  const sendStickerFromFile = async (file, quoted = true) => {
    const quotedObject = quoted
      ? { quoted: JSON.parse(JSON.stringify(webMessage)) }
      : {};
    return await socket.sendMessage(
      remoteJid,
      {
        sticker: fs.readFileSync(file),
      },
      {
        ...quotedObject,
      },
    );
  };

  const sendImageFromFile = async (
    file,
    caption = "",
    mentions = null,
    quoted = true,
  ) => {
    const quotedObject = quoted
      ? { quoted: JSON.parse(JSON.stringify(webMessage)) }
      : {};

    let optionalParams = {};

    if (mentions?.length) {
      optionalParams = { mentions };
    }

    return await withRetry(async () => {
      const imageBuffer = fs.readFileSync(file);
      const mimetype = await detectImageMimetype(imageBuffer, "image/jpeg");

      return await socket.sendMessage(
        remoteJid,
        {
          image: imageBuffer,
          mimetype,
          caption: caption ? `${BOT_EMOJI} ${caption}` : "",
          ...optionalParams,
        },
        {
          ...quotedObject,
        },
      );
    });
  };

  const sendImageFromBuffer = async (
    buffer,
    caption = "",
    mentions = null,
    quoted = true,
  ) => {
    const quotedObject = quoted
      ? { quoted: JSON.parse(JSON.stringify(webMessage)) }
      : {};

    let optionalParams = {};

    if (mentions?.length) {
      optionalParams = { mentions };
    }

    return await withRetry(async () => {
      const mimetype = await detectImageMimetype(buffer, "image/jpeg");

      return await socket.sendMessage(
        remoteJid,
        {
          image: buffer,
          mimetype,
          caption: caption ? `${BOT_EMOJI} ${caption}` : "",
          ...optionalParams,
        },
        {
          ...quotedObject,
        },
      );
    });
  };

  const sendAudioFromBuffer = async (
    buffer,
    asVoice = false,
    quoted = true,
  ) => {
    const quotedObject = quoted
      ? { quoted: JSON.parse(JSON.stringify(webMessage)) }
      : {};

    const {
      audioPath,
      audioBuffer: processedBuffer,
      oldAudioPath,
    } = await ajustAudioByBuffer(buffer, asVoice);

    const mimetype = asVoice ? "audio/ogg; codecs=opus" : "audio/mpeg";

    if (asVoice) {
      await sendRecordState();
    }

    removeFileWithTimeout(audioPath);
    removeFileWithTimeout(oldAudioPath);

    return await socket.sendMessage(
      remoteJid,
      {
        audio: processedBuffer,
        mimetype,
        ptt: asVoice,
      },
      {
        ...quotedObject,
      },
    );
  };

  const sendDocumentFromBuffer = async (
    buffer,
    mimetype,
    fileName,
    quoted = true,
  ) => {
    const quotedObject = quoted
      ? { quoted: JSON.parse(JSON.stringify(webMessage)) }
      : {};
    return await socket.sendMessage(
      remoteJid,
      {
        document: buffer,
        mimetype: mimetype || "application/octet-stream",
        fileName: fileName || "documento.pdf",
      },
      {
        ...quotedObject,
      },
    );
  };

  const sendVideoFromBuffer = async (
    buffer,
    caption = "",
    mentions = null,
    quoted = true,
  ) => {
    const quotedObject = quoted
      ? { quoted: JSON.parse(JSON.stringify(webMessage)) }
      : {};

    let optionalParams = {};

    if (mentions?.length) {
      optionalParams = { mentions };
    }

    const mimetype = await detectMimetype(buffer, "video/mp4");

    return await socket.sendMessage(
      remoteJid,
      {
        video: buffer,
        mimetype,
        caption: caption ? `${BOT_EMOJI} ${caption}` : "",
        ...optionalParams,
      },
      {
        ...quotedObject,
      },
    );
  };
  return {
    args,
    commandName,
    fullArgs,
    fullMessage,
    isImage,
    isSticker,
    isVideo,
    prefix,
    remoteJid,
    remoteJidAlt,
    socket,
    userLid,
    webMessage,
    downloadImage,
    downloadSticker,
    downloadVideo,
    sendAudioFromBuffer,
    sendDocumentFromBuffer,
    sendErrorReply,
    sendImageFromBuffer,
    sendImageFromFile,
    sendReact,
    sendReply,
    sendStickerFromFile,
    sendSuccessReact,
    sendSuccessReply,
    sendVideoFromBuffer,
    sendWaitReact,
    sendWaitReply,
    sendWarningReply,
  };
}
