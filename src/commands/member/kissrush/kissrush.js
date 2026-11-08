import { PREFIX } from '../../../config.js';
import { InvalidParameterError } from '../../../errors/index.js';
import { searchPosts, formatPostDate } from '../../../services/kissrushApi.js';

export default {
  name: 'kissrush',
  description: 'Busca posts no blog KissRush',
  commands: ['kissrush', 'kr', 'blog'],
  usage: `${PREFIX}kissrush <termo>`,

  handle: async ({ fullArgs, sendReply, sendReact, socket, remoteJid }) => {
    const query = String(fullArgs || '').trim();

    if (!query) {
      throw new InvalidParameterError(
        `Exemplo: ${PREFIX}kissrush reelshort`,
      );
    }

    await sendReact('🔍');

    try {
      const posts = await searchPosts(query, 8);

      if (!posts.length) {
        await sendReact('❌');
        return sendReply(`❌ Nada encontrado pra *"${query}"* no KissRush.`);
      }

      // Envia cada post como uma mensagem separada
      for (const post of posts) {
        const linhas = [
          `📱 *${post.title}*`,
          '',
          post.summary ? `_${post.summary.substring(0, 180)}..._` : '',
          '',
        ];

        const date = formatPostDate(post.datePublished);
        if (date) linhas.push(`📅 ${date}`);
        if (post.categories.length) linhas.push(`🏷️ ${post.categories.join(' · ')}`);

        linhas.push('');
        linhas.push(`🔗 ${post.link}`);

        const caption = linhas.filter((l) => l !== undefined).join('\n');

        if (post.image) {
          try {
            const response = await fetch(post.image, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
              signal: AbortSignal.timeout(15000),
            });
            if (response.ok) {
              const buffer = Buffer.from(await response.arrayBuffer());
              await socket.sendMessage(remoteJid, {
                image: buffer,
                caption,
                mimetype: 'image/jpeg',
              });
              continue;
            }
          } catch (err) {
            console.error('[kissrush] Erro na imagem:', err.message);
          }
        }

        await socket.sendMessage(remoteJid, { text: caption });
      }

      await sendReact('✅');
    } catch (error) {
      console.error('[kissrush] erro:', error.message);
      await sendReact('❌');
      await sendReply(`❌ Erro ao buscar: ${error.message}`);
    }
  },
};