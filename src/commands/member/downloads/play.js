import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { searchYoutube, downloadYoutubeAudio } from "../../../services/bronxysApi.js";
import { isDurationTooLong } from "../../../utils/duration.js";

export default {
  name: "play",
  description: "Busca uma música no YouTube e envia o áudio",
  commands: ["play"],
  usage: `${PREFIX}play <nome da música>`,
  handle: async ({ fullArgs, socket, remoteJid, webMessage, sendWaitReply, sendImageFromBuffer, sendSuccessReply, sendErrorReply, sendReact }) => {
    const query = fullArgs.trim();
    if (!query) {
      throw new InvalidParameterError(`Exemplo: ${PREFIX}play nome da música`);
    }

    await sendReact("⏳");
    await sendWaitReply(`Buscando "${query}"...`);

    try {
      const results = await searchYoutube(query);
      const info = results?.[0];
      if (isDurationTooLong(info?.tempo)) {
  throw new Error(
    "esse vídeo ultrapassa o limite de 5 horas. Escolha um vídeo mais curto."
  );
      }

      if (info?.thumb) {
        const thumb = await fetch(info.thumb).then((r) => r.arrayBuffer()).then(Buffer.from).catch(() => null);
        if (thumb) {
          await sendImageFromBuffer(
            thumb,
            `🎵 ${info.titulo || query}\n⏱️ ${info.tempo || "?"}\n📅 ${info.postado || "?"}`,
          );
        }
      }

      const { buffer } = await downloadYoutubeAudio(query);
      const quotedObject = { quoted: JSON.parse(JSON.stringify(webMessage)) };
      await socket.sendMessage(remoteJid, { audio: buffer, mimetype: "audio/mpeg", ptt: false }, quotedObject);

      await sendSuccessReply("Download concluído!");
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`Erro ao baixar: ${error.message}`);
      await sendReact("❌");
    }
  },
};