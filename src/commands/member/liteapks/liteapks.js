import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { searchPosts, getPostDetails } from "../../../services/liteapksApi.js";

export default {
  name: "liteapks",
  description: "Busca um app no LiteAPKs",
  commands: ["liteapks", "la"],
  usage: `${PREFIX}liteapks <nome do app>`,
  handle: async ({ fullArgs, socket, remoteJid, sendReact, sendReply }) => {
    const query = fullArgs.trim();
    if (!query) throw new InvalidParameterError(`Exemplo: ${PREFIX}liteapks minecraft`);
    await sendReact("⏳");
    await sendReply(`🔍 Buscando por *"${query}"* no LiteAPKs...`);
    try {
      const posts = await searchPosts(query);
      if (!posts.length) {
        await sendReact("❌");
        return sendReply(
          `Não encontrei o app, marque o Gabe.AM29, o ADM mais gostoso desse grupo e espere a boa vontade dele para que ele possa te responder com o app, ou faça a sua própria pesquisa no Google.\n\nLembre-se, o Gabe em momento algum é obrigado a enviar os mods pra vcs, ele faz pq gosta, não abuse da vontade dele.`
        );
      }
      const post = posts[0];
      const detalhes = await getPostDetails(post.url);
      const caption = `📱 *${detalhes.title}*\n💿 Versão: ${detalhes.version || "?"}\n⚡ Mod: ${detalhes.mod || "?"}\n💾 Tamanho: ${detalhes.size || "?"}\n\n_${detalhes.description.substring(0, 250)}..._\n\n🔗 ${detalhes.url}`.trim();
      if (detalhes.image) {
        try {
          const imgRes = await fetch(detalhes.image, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (imgRes.ok) {
            const buffer = Buffer.from(await imgRes.arrayBuffer());
            await socket.sendMessage(remoteJid, { image: buffer, caption, mimetype: "image/jpeg" });
            await sendReact("✅");
            return;
          }
        } catch (err) { console.error(`[liteapks] Erro ao baixar capa:`, err.message); }
      }
      await socket.sendMessage(remoteJid, { text: caption });
      await sendReact("✅");
    } catch (error) {
      console.error(`[liteapks] ❌ Erro fatal:`, error);
      await sendReact("❌");
      await sendReply(`❌ Erro ao buscar: ${error.message}`);
    }
  },
};