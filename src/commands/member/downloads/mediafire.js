import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadMediaFire } from "../../../services/bronxysApi.js";

export default {
  name: "mediafire",
  description: "Baixa um arquivo do MediaFire",
  commands: ["mediafire", "mf"],
  usage: `${PREFIX}mediafire <link>`,
  handle: async ({ fullArgs, sendDocumentFromBuffer, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}mediafire https://www.mediafire.com/file/abc/arquivo/file`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando do MediaFire...`);
    try {
      const result = await downloadMediaFire(url);
      await sendDocumentFromBuffer(result.buffer, result.mimetype, result.fileName);
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};