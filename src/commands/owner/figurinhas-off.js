import { PREFIX } from "../../config.js";
import { removeStickerGroup } from "../../services/stickerBroadcaster.js";

export default {
  name: "figurinhas-off",
  description: "Para de mandar as figurinhas automáticas neste chat",
  commands: ["figurinhas-off", "figurinhasoff", "desativar-figurinhas"],
  usage: `${PREFIX}figurinhas-off (mande no grupo que vai parar de receber)`,
  handle: async ({ remoteJid, sendReply, sendReact }) => {
    const removido = removeStickerGroup(remoteJid);
    await sendReply(removido ? "Este chat não vai mais receber figurinhas automáticas." : "Este chat não estava recebendo figurinhas automáticas.");
    await sendReact("✅");
  },
};
