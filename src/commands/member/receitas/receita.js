import { PREFIX } from '../../../config.js';
import { searchRecipes, getRecipe } from '../../../services/tudodelicious.js';
import { sendRecipe } from '../../../services/recipeSender.js';
import { InvalidParameterError } from '../../../errors/index.js';

const chatLocks = new Set();

export default {
  name: 'receita',
  description: 'Busca receitas no Tudo Delicious',
  commands: ['receita', 'recipe'],
  usage: `${PREFIX}receita <termo>`,

  handle: async ({ sendReply, args, fullArgs, remoteJid, socket }) => {
    if (!args[0]) {
      throw new InvalidParameterError('Informe o que você quer cozinhar.');
    }

    if (chatLocks.has(remoteJid)) {
      return sendReply('⏳ Aguarde a busca anterior terminar.');
    }
    chatLocks.add(remoteJid);

    try {
      await sendReply(`🔍 Buscando receita de *"${fullArgs}"*...`);

      const results = await searchRecipes(fullArgs);

      if (!results.length) {
        return sendReply('❌ Nenhuma receita encontrada. Tente outro termo.');
      }

      const best = results[0];
      console.log('🍳 Receita escolhida:', best.title);

      await sendReply(`👨‍🍳 Carregando *${best.title}*...`);

      const recipe = await getRecipe(best.url);
      await sendRecipe(socket, remoteJid, recipe);
    } catch (error) {
      console.error('❌ Erro no comando receita:', error);
      await sendReply(`❌ Erro ao buscar receita: ${error.message}`);
    } finally {
      chatLocks.delete(remoteJid);
    }
  },
};
