import { PREFIX } from '../../config.js';
import { listBookGroups } from '../../services/bookBroadcaster.js';

export default {
  name: 'livros-grupos',
  description: 'Lista os chats que recebem os livros automáticos',
  commands: ['livros-grupos', 'livrosgrupos'],
  usage: `${PREFIX}livros-grupos`,
  handle: async ({ socket, sendReply }) => {
    const grupos = listBookGroups();
    if (!grupos.length) {
      return sendReply(
        `Nenhum chat recebe livros ainda. Mande ${PREFIX}livros-on no grupo que vai receber.`,
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
    await sendReply(`📚 Chats que recebem livros:\n\n${linhas.join('\n')}`);
  },
};