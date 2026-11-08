import { PREFIX } from "../../config.js";
import { listRecipeGroups } from "../../services/recipeBroadcaster.js";

export default {
  name: "receitas-grupos",
  description: "Lista os chats que recebem as receitas automáticas",
  commands: ["receitas-grupos", "receitasgrupos"],
  usage: `${PREFIX}receitas-grupos`,
  handle: async ({ socket, sendReply }) => {
    const grupos = listRecipeGroups();
    if (!grupos.length) {
      return sendReply(`Nenhum chat recebe receitas ainda. Mande ${PREFIX}receitas-on no grupo que vai receber.`);
    }
    const linhas = [];
    for (const jid of grupos) {
      let nome = "";
      if (jid.endsWith("@g.us")) {
        nome = await socket.groupMetadata(jid).then((m) => m?.subject || "").catch(() => "");
      }
      linhas.push(`• ${nome ? `${nome} ` : ""}(${jid})`);
    }
    await sendReply(`🍳 Chats que recebem receitas:\n\n${linhas.join("\n")}`);
  },
};
