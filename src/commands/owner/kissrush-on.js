import { PREFIX } from '../../config.js';
import { addKissRushGroup } from '../../services/kissrushBroadcaster.js';

export default {
  name: 'kissrush-on',
  description: 'Cadastra este chat pra receber posts novos do KissRush',
  commands: ['kissrush-on', 'kr-on', 'blog-on'],
  usage: `${PREFIX}kissrush-on`,
  handle: async ({ remoteJid, sendReply, sendReact }) => {
    const novo = addKissRushGroup(remoteJid);
    await sendReply(
      novo
        ? '📱 Este chat vai receber automaticamente todo post novo do KissRush.'
        : 'Este chat já recebe posts do KissRush.',
    );
    await sendReact('✅');
  },
};