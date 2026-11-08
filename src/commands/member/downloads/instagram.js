import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadInstagram } from "../../../services/bronxysApi.js";

export default {
  name: "instagram",
  description: "Baixa foto ou vídeo de um link do Instagram",
  commands: ["instagram", "ig", "insta"],
  usage: `${PREFIX}instagram <link>`,
  handle: async ({ fullArgs, sendVideoFromBuffer, sendImageFromBuffer, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}instagram https://www.instagram.com/reel/abc123`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando do Instagram...`);
    try {
      const result = await downloadInstagram(url);
      if (result.kind === "video") {
        await sendVideoFromBuffer(result.buffer, "");
      } else {
        await sendImageFromBuffer(result.buffer, "");
      }
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};