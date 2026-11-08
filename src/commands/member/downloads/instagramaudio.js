import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadInstagram } from "../../../services/bronxysApi.js";

export default {
  name: "instagramaudio",
  description: "Baixa o áudio de um link do Instagram",
  commands: ["instagramaudio", "igaudio"],
  usage: `${PREFIX}instagramaudio <link>`,
  handle: async ({ fullArgs, socket, remoteJid, webMessage, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}instagramaudio https://www.instagram.com/reel/abc123`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando áudio do Instagram...`);
    try {
      const result = await downloadInstagram(url);
      // O Instagram retorna o vídeo. O envio como áudio fará o whatsapp tocar só o som.
      await socket.sendMessage(remoteJid, { audio: result.buffer, mimetype: "audio/mpeg", ptt: false }, { quoted: JSON.parse(JSON.stringify(webMessage)) });
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};