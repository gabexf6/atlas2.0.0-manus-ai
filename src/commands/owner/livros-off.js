import { PREFIX } from '../../config.js';
import { removeBookGroup } from '../../services/bookBroadcaster.js';

export default {
  name: 'livros-off',
  description: 'Para de mandar os livros automáticos neste chat',
  commands: ['livros-off', 'livrosoff', 'desativar-livros'],
  usage: `${PREFIX}livros-off (mande no grupo que vai parar de receber)`,
  handle: async ({ remoteJid, sendReply, sendReact }) => {
    const removido = removeBookGroup(remoteJid);
    await sendReply(
      removido
        ? 'Este chat não vai mais receber livros automáticos.'
        : 'Este chat não estava recebendo livros automáticos.',
    );
    await sendReact('✅');
  },
};