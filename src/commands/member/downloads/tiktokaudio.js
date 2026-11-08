import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadTikTokAudio } from "../../../services/bronxysApi.js";

export default {
  name: "tiktokaudio",
  description: "Baixa o áudio de um link do TikTok",
  commands: ["tiktokaudio", "ttaudio"],
  usage: `${PREFIX}tiktokaudio <link>`,
  handle: async ({ fullArgs, socket, remoteJid, webMessage, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}tiktokaudio https://www.tiktok.com/@user/video/123`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando áudio do TikTok...`);
    try {
      const { buffer } = await downloadTikTokAudio(url);
      await socket.sendMessage(remoteJid, { audio: buffer, mimetype: "audio/mpeg", ptt: false }, { quoted: JSON.parse(JSON.stringify(webMessage)) });
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};