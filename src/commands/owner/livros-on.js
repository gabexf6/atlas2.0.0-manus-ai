import { PREFIX } from '../../config.js';
import { addBookGroup } from '../../services/bookBroadcaster.js';

export default {
  name: 'livros-on',
  description: 'Cadastra este chat pra receber livros aleatórios do Anna\'s Archive',
  commands: ['livros-on', 'livroson', 'ativar-livros'],
  usage: `${PREFIX}livros-on (mande no grupo que vai receber)`,
  handle: async ({ remoteJid, sendReply, sendReact }) => {
    const novo = addBookGroup(remoteJid);
    await sendReply(
      novo
        ? '📚 Este chat vai receber um livro aleatório por hora (com capa e link pra baixar).'
        : 'Este chat já recebe livros automáticos.',
    );
    await sendReact('✅');
  },
};