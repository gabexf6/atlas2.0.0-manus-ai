import { PREFIX } from "../../../config.js";
import { buildStickerPackContent } from "../../../services/stickerPack.js";
import {
  STICKERLY_MAX_SEND,
  buildStickerlyHelpText,
  parseStickerlyRequestText,
  normalizeStickerlyPackUrl,
  resolveStickerlyPack,
  searchStickerlyPacks,
  fetchStickerlyStickerBuffer,
  convertStickerlyBufferToStickerBuffer,
} from "../../../services/stickerlyApi.js";

export default {
  name: "stickerly",
  description: "Busca um pack do Sticker.ly (por código, link ou busca) e manda como pacote de figurinhas nativo do WhatsApp",
  commands: ["stickerly", "stkly"],
  usage: `${PREFIX}stickerly <código, link ou busca> | <quantidade|all>`,
  handle: async ({
    fullArgs,
    prefix,
    webMessage,
    remoteJid,
    socket,
    sendReply,
    sendReact,
    sendWaitReply,
    sendErrorReply,
  }) => {
    const { query, limit, wantsAll } = parseStickerlyRequestText(fullArgs);

    if (!query) {
      return sendReply(buildStickerlyHelpText(prefix || PREFIX));
    }

    await sendReact("⏳");
    await sendWaitReply(`Procurando "${query}" no Sticker.ly...`);

    let pack;
    try {
      const directUrl = normalizeStickerlyPackUrl(query);
      pack = directUrl ? await resolveStickerlyPack(directUrl) : (await searchStickerlyPacks(query, 1))[0];

      if (!pack) {
        throw new Error(`não encontrei nenhum pack do Sticker.ly pra "${query}"`);
      }
    } catch (error) {
      await sendErrorReply(`Erro ao buscar no Sticker.ly: ${error.message}`);
      await sendReact("❌");
      return;
    }

    const stickers = Array.isArray(pack.stickers) ? pack.stickers : [];
    if (!stickers.length) {
      await sendErrorReply("Esse pack não tem figurinhas disponíveis.");
      await sendReact("❌");
      return;
    }

    const howMany = Math.max(
      1,
      Math.min(wantsAll ? stickers.length : limit, stickers.length, STICKERLY_MAX_SEND),
    );

    const stickerBuffers = [];
    for (const entry of stickers.slice(0, howMany)) {
      try {
        const rawBuffer = await fetchStickerlyStickerBuffer(entry, pack.url);
        const stickerBuffer = await convertStickerlyBufferToStickerBuffer(rawBuffer, entry);
        stickerBuffers.push(stickerBuffer);
      } catch (error) {
        console.warn(`Falha ao baixar figurinha do Sticker.ly (${entry?.fileName || entry?.sid}):`, error.message);
      }
    }

    if (!stickerBuffers.length) {
      await sendErrorReply("Não consegui baixar nenhuma figurinha desse pack.");
      await sendReact("❌");
      return;
    }

    try {
      const content = await buildStickerPackContent({
        title: pack.title,
        author: pack.author,
        stickerBuffers,
        packDescription: `via Sticker.ly — ${pack.url}`,
      });

      await socket.sendMessage(remoteJid, content, {
        quoted: JSON.parse(JSON.stringify(webMessage)),
      });

      await sendReact("✅");
    } catch (error) {
      console.error("Falha ao montar/enviar o sticker pack:", error);
      await sendErrorReply(`Não consegui montar o pacote de figurinhas: ${error.message}`);
      await sendReact("❌");
    }
  },
};
