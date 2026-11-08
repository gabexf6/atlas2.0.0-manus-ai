import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { searchYoutube, downloadYoutubeVideo } from "../../../services/bronxysApi.js";
import { isDurationTooLong } from "../../../utils/duration.js";

export default {
  name: "playvideo",
  description: "Busca um vídeo no YouTube e envia o vídeo",
  commands: ["playvideo", "playmp4", "play_video"],
  usage: `${PREFIX}playvideo <nome do vídeo>`,
  handle: async ({ fullArgs, sendWaitReply, sendVideoFromBuffer, sendSuccessReply, sendErrorReply, sendReact }) => {
    const query = fullArgs.trim();
    if (!query) {
      throw new InvalidParameterError(`Exemplo: ${PREFIX}playvideo nome do vídeo`);
    }

    await sendReact("⏳");
    await sendWaitReply(`Buscando "${query}"...`);

    try {
      const results = await searchYoutube(query);
      const info = results?.[0];
      if (isDurationTooLong(info?.tempo)) {
  throw new Error(
    "esse vídeo ultrapassa o limite de 5 horas. Escolha um vídeo mais curto."
  );
}

      const { buffer } = await downloadYoutubeVideo(query);
      await sendVideoFromBuffer(buffer, info?.titulo || query);

      await sendSuccessReply("Download concluído!");
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`Erro ao baixar: ${error.message}`);
      await sendReact("❌");
    }
  },
};