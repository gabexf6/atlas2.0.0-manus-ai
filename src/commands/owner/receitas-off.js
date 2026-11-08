import { PREFIX } from "../../config.js";
import { removeRecipeGroup } from "../../services/recipeBroadcaster.js";

export default {
  name: "receitas-off",
  description: "Para de mandar as receitas automáticas neste chat",
  commands: ["receitas-off", "receitasoff", "desativar-receitas"],
  usage: `${PREFIX}receitas-off (mande no grupo que vai parar de receber)`,
  handle: async ({ remoteJid, sendReply, sendReact }) => {
    const removido = removeRecipeGroup(remoteJid);
    await sendReply(removido ? "Este chat não vai mais receber receitas automáticas." : "Este chat não estava recebendo receitas automáticas.");
    await sendReact("✅");
  },
};
