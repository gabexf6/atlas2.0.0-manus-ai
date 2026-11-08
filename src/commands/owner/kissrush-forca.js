import { PREFIX } from '../../config.js';
import { resetKissRushHistoryForcar, checkAndSendNewPosts } from '../../services/kissrushBroadcaster.js';

export default {
  name: 'kissrush-forcar',
  description: 'Força o reenvio de TODOS os posts do feed agora',
  commands: ['kissrush-forcar', 'kr-forcar'],
  usage: `${PREFIX}kissrush-forcar`,
  handle: async ({ socket, sendReply, sendReact }) => {
    await sendReact('⏳');
    try {
      resetKissRushHistoryForcar();
      await checkAndSendNewPosts(socket);
      await sendReply('✅ Reenvio forçado concluído.');
      await sendReact('✅');
    } catch (error) {
      await sendReply(`❌ ${error.message}`);
      await sendReact('❌');
    }
  },
};