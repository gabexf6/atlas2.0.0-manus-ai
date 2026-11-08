import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadTwitterVideo } from "../../../services/bronxysApi.js";

export default {
  name: "twitter",
  description: "Baixa o vídeo de um link do Twitter/X",
  commands: ["twitter", "x"],
  usage: `${PREFIX}twitter <link>`,
  handle: async ({ fullArgs, sendVideoFromBuffer, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}twitter https://twitter.com/user/status/123`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando vídeo do Twitter...`);
    try {
      const { buffer } = await downloadTwitterVideo(url);
      await sendVideoFromBuffer(buffer, "");
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};