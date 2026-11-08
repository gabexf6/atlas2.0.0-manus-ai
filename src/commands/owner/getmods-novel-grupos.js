import { PREFIX } from "../../config.js";
import { listGetmodsNovelGroups } from "../../services/getmodsBroadcaster.js";

export default {
  name: "getmods-novel-grupos",
  description: "Lista os grupos cadastrados na categoria Novel do GetModsAPK",
  commands: ["getmods-novel-grupos", "gm-novel-grupos"],
  usage: `${PREFIX}getmods-novel-grupos`,

  handle: async ({ socket, sendReply }) => {
    const grupos = listGetmodsNovelGroups();

    if (!grupos.length) {
      return sendReply(
        `Nenhum grupo cadastrado. Use ${PREFIX}getmods-novel-on no grupo desejado.`
      );
    }

    const linhas = [];

    for (const jid of grupos) {
      const nome = jid.endsWith("@g.us")
        ? await socket.groupMetadata(jid)
            .then(m => m?.subject || "")
            .catch(() => "")
        : "";

      linhas.push(`• ${nome || jid}`);
    }

    await sendReply(
      `📚 *Grupos da categoria Novel:*\n\n${linhas.join("\n")}`
    );
  },
};