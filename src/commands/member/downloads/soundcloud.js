import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadSoundcloud } from "../../../services/bronxysApi.js";

export default {
  name: "soundcloud",
  description: "Baixa o áudio de uma faixa do SoundCloud",
  commands: ["soundcloud", "sc"],
  usage: `${PREFIX}soundcloud <link>`,
  handle: async ({ fullArgs, socket, remoteJid, webMessage, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}soundcloud https://soundcloud.com/artista/musica`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando do SoundCloud...`);
    try {
      const { buffer } = await downloadSoundcloud(url);
      await socket.sendMessage(remoteJid, { audio: buffer, mimetype: "audio/mpeg", ptt: false }, { quoted: JSON.parse(JSON.stringify(webMessage)) });
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};