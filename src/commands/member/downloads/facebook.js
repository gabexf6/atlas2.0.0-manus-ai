import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadFacebookVideo } from "../../../services/bronxysApi.js";

export default {
  name: "facebook",
  description: "Baixa o vídeo de um link do Facebook",
  commands: ["facebook", "fb"],
  usage: `${PREFIX}facebook <link>`,
  handle: async ({ fullArgs, sendVideoFromBuffer, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}facebook https://www.facebook.com/watch/?v=123`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando vídeo do Facebook...`);
    try {
      const { buffer } = await downloadFacebookVideo(url);
      await sendVideoFromBuffer(buffer, "");
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};