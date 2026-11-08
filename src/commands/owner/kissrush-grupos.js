import { PREFIX } from '../../config.js';
import { listKissRushGroups } from '../../services/kissrushBroadcaster.js';

export default {
  name: 'kissrush-grupos',
  description: 'Lista os chats que recebem posts do KissRush',
  commands: ['kissrush-grupos', 'kr-grupos', 'blog-grupos'],
  usage: `${PREFIX}kissrush-grupos`,
  handle: async ({ socket, sendReply }) => {
    const grupos = listKissRushGroups();
    if (!grupos.length) {
      return sendReply(
        `Nenhum chat recebe ainda. Mande ${PREFIX}kissrush-on no grupo.`,
      );
    }
    const linhas = [];
    for (const jid of grupos) {
      let nome = '';
      if (jid.endsWith('@g.us')) {
        nome = await socket
          .groupMetadata(jid)
          .then((m) => m?.subject || '')
          .catch(() => '');
      }
      linhas.push(`• ${nome ? `${nome} ` : ''}(${jid})`);
    }
    await sendReply(`📱 Chats que recebem KissRush:\n\n${linhas.join('\n')}`);
  },
};