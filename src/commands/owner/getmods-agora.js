import { PREFIX } from "../../config.js";
import { forceSendRecent } from "../../services/getmodsBroadcaster.js";

export default {
  name: "getmods-agora",
  description: "Força o envio das atualizações recentes do GetModsAPK agora",
  commands: ["getmods-agora", "gm-agora"],
  usage: `${PREFIX}getmods-agora`,
  handle: async ({ socket, remoteJid, sendReact }) => {
    await sendReact("⏳");
    try {
      await forceSendRecent(socket, remoteJid);
      await sendReact("✅");
    } catch (error) {
      await sendReact("❌");
    }
  },
};