import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadThreads } from "../../../services/bronxysApi.js";

export default {
  name: "threads",
  description: "Baixa o vídeo de um link do Threads",
  commands: ["threads"],
  usage: `${PREFIX}threads <link>`,
  handle: async ({ fullArgs, sendVideoFromBuffer, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}threads https://www.threads.net/@user/post/abc123`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando do Threads...`);
    try {
      const { buffer } = await downloadThreads(url);
      await sendVideoFromBuffer(buffer, "");
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};