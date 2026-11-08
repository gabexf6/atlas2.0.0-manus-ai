import { PREFIX } from "../../config.js";
import { addGetmodsGroup } from "../../services/getmodsBroadcaster.js";

export default {
  name: "getmods-on",
  description: "Cadastra este chat para receber atualizações do GetModsAPK",
  commands: ["getmods-on", "gm-on"],
  usage: `${PREFIX}getmods-on`,
  handle: async ({ remoteJid, sendReply, sendReact }) => {
    const novo = addGetmodsGroup(remoteJid);
    await sendReply(novo ? '📱 Este chat vai receber atualizações do GetModsAPK.' : 'Este chat já recebe atualizações.');
    await sendReact("✅");
  },
};