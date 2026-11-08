import { PREFIX } from "../../config.js";
import { removeGetmodsNovelGroup } from "../../services/getmodsBroadcaster.js";

export default {
  name: "getmods-novel-off",
  description: "Remove este grupo da categoria Novel do GetModsAPK",
  commands: ["getmods-novel-off", "gm-novel-off"],
  usage: `${PREFIX}getmods-novel-off`,

  handle: async ({ remoteJid, sendReply, sendReact }) => {
    const removido = removeGetmodsNovelGroup(remoteJid);

    await sendReply(
      removido
        ? "📚 Este grupo não receberá mais alertas de novels e jogos de romance."
        : "Este grupo não estava cadastrado na categoria Novel."
    );

    await sendReact("✅");
  },
};