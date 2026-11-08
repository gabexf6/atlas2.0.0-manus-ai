import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadFacebookAudio } from "../../../services/bronxysApi.js";

export default {
  name: "facebookaudio",
  description: "Baixa o áudio de um link do Facebook",
  commands: ["facebookaudio", "fbaudio"],
  usage: `${PREFIX}facebookaudio <link>`,
  handle: async ({ fullArgs, socket, remoteJid, webMessage, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}facebookaudio https://www.facebook.com/watch/?v=123`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando áudio do Facebook...`);
    try {
      const { buffer } = await downloadFacebookAudio(url);
      await socket.sendMessage(remoteJid, { audio: buffer, mimetype: "audio/mpeg", ptt: false }, { quoted: JSON.parse(JSON.stringify(webMessage)) });
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};