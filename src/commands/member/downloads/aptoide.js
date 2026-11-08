import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadAptoide } from "../../../services/bronxysApi.js";

export default {
  name: "aptoide",
  description: "Baixa um APK do Aptoide",
  commands: ["aptoide"],
  usage: `${PREFIX}aptoide <link>`,
  handle: async ({ fullArgs, sendDocumentFromBuffer, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}aptoide https://en.aptoide.com/app/...`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando do Aptoide...`);
    try {
      const result = await downloadAptoide(url);
      await sendDocumentFromBuffer(result.buffer, result.mimetype, result.fileName);
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};