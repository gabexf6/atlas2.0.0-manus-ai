import { PREFIX } from "../../config.js";
import { sendRandomStickerPack } from "../../services/stickerBroadcaster.js";

export default {
  name: "figurinhas-agora",
  description: "Manda um pack aleatório do Sticker.ly agora, neste chat (pra testar)",
  commands: ["figurinhas-agora", "figurinhasagora"],
  usage: `${PREFIX}figurinhas-agora`,
  handle: async ({ socket, remoteJid, sendReply, sendReact }) => {
    await sendReact("⏳");
    try {
      await sendRandomStickerPack(socket, [remoteJid]);
      await sendReact("✅");
    } catch (error) {
      await sendReply(`❌ Não consegui mandar um pack: ${error.message}`);
      await sendReact("❌");
    }
  },
};
