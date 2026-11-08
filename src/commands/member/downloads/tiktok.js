import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadTikTokVideo } from "../../../services/bronxysApi.js";

export default {
  name: "tiktok",
  description: "Baixa o vídeo de um link do TikTok",
  commands: ["tiktok", "tt"],
  usage: `${PREFIX}tiktok <link>`,
  handle: async ({ fullArgs, sendVideoFromBuffer, sendReact, sendErrorReply, sendReply }) => {
    const url = fullArgs.trim();
    if (!url) throw new InvalidParameterError(`Exemplo: ${PREFIX}tiktok https://www.tiktok.com/@user/video/123`);
    await sendReact("⏳");
    await sendReply(`📥 Baixando vídeo do TikTok...`);
    try {
      const { buffer } = await downloadTikTokVideo(url);
      await sendVideoFromBuffer(buffer, "");
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`❌ Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};