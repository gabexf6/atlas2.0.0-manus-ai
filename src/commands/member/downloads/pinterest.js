import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { searchPinterest } from "../../../services/bronxysApi.js";

export default {
  name: "pinterest",
  description: "Busca uma imagem no Pinterest por termo",
  commands: ["pinterest"],
  usage: `${PREFIX}pinterest <termo>`,
  handle: async ({ fullArgs, sendImageFromBuffer, sendReact, sendErrorReply }) => {
    const query = fullArgs.trim();
    if (!query) {
      throw new InvalidParameterError(`Exemplo: ${PREFIX}pinterest naruto`);
    }

    await sendReact("⏳");

    try {
      const { buffer } = await searchPinterest(query);
      await sendImageFromBuffer(buffer, `📌 ${query}`);
      await sendReact("✅");
    } catch (error) {
      await sendErrorReply(`Erro: ${error.message}`);
      await sendReact("❌");
    }
  },
};
