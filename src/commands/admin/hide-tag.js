import { PREFIX } from "../../config.js";

export default {
  name: "hide-tag",
  description: "Marca todos do grupo sem mostrar os @",
  commands: ["hide-tag", "to-tag", "marcar", "marca", "tag-all"],
  usage: `${PREFIX}hide-tag <motivo>`,
  handle: async ({ fullArgs, socket, remoteJid, sendReact }) => {
    const { participants } = await socket.groupMetadata(remoteJid);
    const mentions = participants.map(({ id }) => id);

    await sendReact("📢");

    await socket.sendMessage(remoteJid, {
      text: `📢 Marcando todos!\n\n${fullArgs || ""}`.trim(),
      mentions,
    });
  },
};