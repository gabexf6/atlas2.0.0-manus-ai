import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadSpotify } from "../../../services/bronxysApi.js";

export default {
  name: "spotify",
  description: "Baixa o áudio de uma faixa do Spotify",
  commands: ["spotify"],
  usage: `${PREFIX}spotify <link>`,
  handle: async ({ fullArgs, socket, remoteJid, webMessage, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}spotify https://open.spotify.com/track/abc123`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando do Spotify...`);
    try {
      const { buffer } = await downloadSpotify(url);
      await socket.sendMessage(remoteJid, { audio: buffer, mimetype: "audio/mpeg", ptt: false }, { quoted: JSON.parse(JSON.stringify(webMessage)) });
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};