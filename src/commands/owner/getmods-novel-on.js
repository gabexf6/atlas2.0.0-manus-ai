import { PREFIX } from "../../config.js";
import { addGetmodsNovelGroup } from "../../services/getmodsBroadcaster.js";

export default {
  name: "getmods-novel-on",
  description: "Cadastra este grupo para receber apenas novels e jogos de romance do GetModsAPK",
  commands: ["getmods-novel-on", "gm-novel-on"],
  usage: `${PREFIX}getmods-novel-on`,

  handle: async ({ remoteJid, sendReply, sendReact }) => {
    const novo = addGetmodsNovelGroup(remoteJid);

    await sendReply(
      novo
        ? "📚 Este grupo receberá apenas novels e jogos de romance do GetModsAPK."
        : "Este grupo já está cadastrado para receber novels e jogos de romance."
    );

    await sendReact("✅");
  },
};