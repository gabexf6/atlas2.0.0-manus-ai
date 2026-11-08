import { PREFIX } from "../../config.js";
import { removeGetmodsGroup } from "../../services/getmodsBroadcaster.js";

export default {
  name: "getmods-off",
  description: "Para de receber atualizações do GetModsAPK",
  commands: ["getmods-off", "gm-off"],
  usage: `${PREFIX}getmods-off`,
  handle: async ({ remoteJid, sendReply, sendReact }) => {
    const removido = removeGetmodsGroup(remoteJid);
    await sendReply(removido ? 'Este chat não vai mais receber atualizações.' : 'Este chat não estava recebendo.');
    await sendReact("✅");
  },
};