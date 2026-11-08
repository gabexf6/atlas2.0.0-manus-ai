import { PREFIX } from '../../config.js';
import { sendRandomBook } from '../../services/bookBroadcaster.js';

export default {
  name: 'livros-agora',
  description: 'Manda um livro aleatório agora, neste chat (pra testar)',
  commands: ['livros-agora', 'livrosagora'],
  usage: `${PREFIX}livros-agora`,
  handle: async ({ socket, remoteJid, sendReply, sendReact }) => {
    await sendReact('⏳');
    try {
      await sendRandomBook(socket, [remoteJid]);
      await sendReact('✅');
    } catch (error) {
      await sendReply(`❌ Não consegui pegar um livro: ${error.message}`);
      await sendReact('❌');
    }
  },
};