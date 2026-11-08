import { PREFIX } from '../../config.js';
import { checkAndSendNewPosts } from '../../services/kissrushBroadcaster.js';

export default {
  name: 'kissrush-agora',
  description: 'Força uma checagem agora (útil pra testar)',
  commands: ['kissrush-agora', 'kr-agora', 'blog-agora'],
  usage: `${PREFIX}kissrush-agora`,
  handle: async ({ socket, sendReply, sendReact }) => {
    await sendReact('⏳');
    try {
      await checkAndSendNewPosts(socket);
      await sendReact('✅');
    } catch (error) {
      await sendReply(`❌ ${error.message}`);
      await sendReact('❌');
    }
  },
};