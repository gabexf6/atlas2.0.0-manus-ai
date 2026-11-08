import { PREFIX } from '../../config.js';
import { resetKissRushHistory } from '../../services/kissrushBroadcaster.js';

export default {
  name: 'kissrush-reset',
  description: 'Reseta o histórico (próxima checagem registra sem enviar)',
  commands: ['kissrush-reset', 'kr-reset'],
  usage: `${PREFIX}kissrush-reset`,
  handle: async ({ sendReply, sendReact }) => {
    resetKissRushHistory();
    await sendReply(
      '🔄 Histórico resetado. A próxima checagem vai apenas registrar os posts, sem enviar.',
    );
    await sendReact('✅');
  },
};