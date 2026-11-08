import { PREFIX } from '../../config.js';
import { removeKissRushGroup } from '../../services/kissrushBroadcaster.js';

export default {
  name: 'kissrush-off',
  description: 'Para de receber posts do KissRush neste chat',
  commands: ['kissrush-off', 'kr-off', 'blog-off'],
  usage: `${PREFIX}kissrush-off`,
  handle: async ({ remoteJid, sendReply, sendReact }) => {
    const removido = removeKissRushGroup(remoteJid);
    await sendReply(
      removido
        ? 'Este chat não vai mais receber posts do KissRush.'
        : 'Este chat não estava recebendo posts do KissRush.',
    );
    await sendReact('✅');
  },
};