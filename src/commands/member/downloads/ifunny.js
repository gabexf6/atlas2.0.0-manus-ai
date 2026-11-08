import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadIfunny } from "../../../services/bronxysApi.js";

export default {
  name: "ifunny",
  description: "Baixa o vídeo de um link do iFunny",
  commands: ["ifunny"],
  usage: `${PREFIX}ifunny <link>`,
  handle: async ({ fullArgs, sendVideoFromBuffer, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}ifunny https://ifunny.co/video/123`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando do iFunny...`);
    try {
      const { buffer } = await downloadIfunny(url);
      await sendVideoFromBuffer(buffer, "");
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};