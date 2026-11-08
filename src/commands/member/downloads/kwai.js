import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadKwai } from "../../../services/bronxysApi.js";

export default {
  name: "kwai",
  description: "Baixa o vídeo de um link do Kwai",
  commands: ["kwai"],
  usage: `${PREFIX}kwai <link>`,
  handle: async ({ fullArgs, sendVideoFromBuffer, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}kwai https://kwai.com/123`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando do Kwai...`);
    try {
      const { buffer } = await downloadKwai(url);
      await sendVideoFromBuffer(buffer, "");
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};