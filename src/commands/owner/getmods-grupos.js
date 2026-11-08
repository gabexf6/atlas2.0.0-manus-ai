import { PREFIX } from "../../config.js";
import { listGetmodsGroups } from "../../services/getmodsBroadcaster.js";

export default {
  name: "getmods-grupos",
  description: "Lista os chats que recebem atualizações do GetModsAPK",
  commands: ["getmods-grupos", "gm-grupos"],
  usage: `${PREFIX}getmods-grupos`,
  handle: async ({ socket, sendReply }) => {
    const grupos = listGetmodsGroups();
    if (!grupos.length) {
      return sendReply(`Nenhum chat recebe ainda. Use ${PREFIX}getmods-on.`);
    }
    const linhas = [];
    for (const jid of grupos) {
      let nome = '';
      if (jid.endsWith('@g.us')) {
        nome = await socket.groupMetadata(jid).then(m => m?.subject || '').catch(() => '');
      }
      linhas.push(`• ${nome ? `${nome} ` : ''}(${jid})`);
    }
    await sendReply(`📱 Chats que recebem GetModsAPK:\n\n${linhas.join('\n')}`);
  },
};