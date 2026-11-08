import { PREFIX } from "../../config.js";
import { sendRandomRecipe } from "../../services/recipeBroadcaster.js";

export default {
  name: "receitas-agora",
  description: "Manda uma receita aleatória do site agora, neste chat (pra testar)",
  commands: ["receitas-agora", "receitaagora"],
  usage: `${PREFIX}receitas-agora`,
  handle: async ({ socket, remoteJid, sendReply, sendReact }) => {
    await sendReact("⏳");
    try {
      await sendRandomRecipe(socket, [remoteJid]);
      await sendReact("✅");
    } catch (error) {
      await sendReply(`❌ Não consegui pegar uma receita: ${error.message}`);
      await sendReact("❌");
    }
  },
};
