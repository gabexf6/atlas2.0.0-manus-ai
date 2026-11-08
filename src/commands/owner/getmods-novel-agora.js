import { PREFIX } from "../../config.js";
import { forceSendRecentNovels } from "../../services/getmodsBroadcaster.js";

export default {
  name: "getmods-novel-agora",
  description: "Envia agora os posts recentes de novels e jogos de romance",
  commands: ["getmods-novel-agora", "gm-novel-agora"],
  usage: `${PREFIX}getmods-novel-agora`,

  handle: async ({ socket, remoteJid, sendReact }) => {
    await sendReact("⏳");

    try {
      await forceSendRecentNovels(socket, remoteJid);
      await sendReact("✅");

    } catch (error) {
      console.error(
        "[getmods] Erro no envio manual de Novel:",
        error.message
      );

      await sendReact("❌");
    }
  },
};