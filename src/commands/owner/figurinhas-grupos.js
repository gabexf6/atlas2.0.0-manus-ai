import { PREFIX } from "../../config.js";
import { listStickerGroups } from "../../services/stickerBroadcaster.js";

export default {
  name: "figurinhas-grupos",
  description: "Lista os chats que recebem as figurinhas automáticas",
  commands: ["figurinhas-grupos", "figurinhasgrupos"],
  usage: `${PREFIX}figurinhas-grupos`,
  handle: async ({ socket, sendReply }) => {
    const grupos = listStickerGroups();
    if (!grupos.length) {
      return sendReply(`Nenhum chat recebe figurinhas ainda. Mande ${PREFIX}figurinhas-on no grupo que vai receber.`);
    }
    const linhas = [];
    for (const jid of grupos) {
      let nome = "";
      if (jid.endsWith("@g.us")) {
        nome = await socket.groupMetadata(jid).then((m) => m?.subject || "").catch(() => "");
      }
      linhas.push(`• ${nome ? `${nome} ` : ""}(${jid})`);
    }
    await sendReply(`🎨 Chats que recebem figurinhas:\n\n${linhas.join("\n")}`);
  },
};
