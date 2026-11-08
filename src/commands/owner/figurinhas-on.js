import { PREFIX } from "../../config.js";
import { addStickerGroup } from "../../services/stickerBroadcaster.js";

export default {
  name: "figurinhas-on",
  description: "Cadastra este chat pra receber um pack de figurinhas do Sticker.ly a cada 15 min",
  commands: ["figurinhas-on", "figurinhason", "ativar-figurinhas"],
  usage: `${PREFIX}figurinhas-on (mande no grupo que vai receber)`,
  handle: async ({ remoteJid, sendReply, sendReact }) => {
    const novo = addStickerGroup(remoteJid);
    await sendReply(
      novo
        ? "Pronto! Este chat vai receber um pack completo de figurinhas a cada 15 minutos. O primeiro chega em alguns minutos (ele baixa o pack inteiro antes de mandar)."
        : "Este chat já recebe as figurinhas automáticas.",
    );
    await sendReact("✅");
  },
};
