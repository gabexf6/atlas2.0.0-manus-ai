import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadTwitterAudio } from "../../../services/bronxysApi.js";

export default {
  name: "twitteraudio",
  description: "Baixa o áudio de um link do Twitter/X",
  commands: ["twitteraudio", "xaudio"],
  usage: `${PREFIX}twitteraudio <link>`,
  handle: async ({ fullArgs, socket, remoteJid, webMessage, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}twitteraudio https://twitter.com/user/status/123`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando áudio do Twitter...`);
    try {
      const { buffer } = await downloadTwitterAudio(url);
      await socket.sendMessage(remoteJid, { audio: buffer, mimetype: "audio/mpeg", ptt: false }, { quoted: JSON.parse(JSON.stringify(webMessage)) });
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};