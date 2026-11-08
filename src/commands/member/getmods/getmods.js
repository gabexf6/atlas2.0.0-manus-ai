import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { searchPosts, getPostDetails } from "../../../services/getmodsApi.js";

export default {
  name: "getmods",
  description: "Busca um app no GetModsAPK",
  commands: ["getmods", "gm"],
  usage: `${PREFIX}getmods <nome do app>`,
  
  handle: async ({ fullArgs, socket, remoteJid, sendReact, sendReply }) => {
    const query = fullArgs.trim();
    if (!query) {
      throw new InvalidParameterError(`Exemplo: ${PREFIX}getmods minecraft`);
    }

    await sendReact("⏳");
    await sendReply(`🔍 Buscando por *"${query}"* no GetMods...`);

    try {
      const posts = await searchPosts(query);

      if (!posts.length) {
        await sendReact("❌");
        return sendReply(
          `Não encontrei o app, marque o Gabe.AM29, o ADM mais gostoso desse grupo e espere a boa vontade dele para que ele possa te responder com o app, ou faça a sua própria pesquisa no Google.\n\nLembre-se, o Gabe em momento algum é obrigado a enviar os mods pra vcs, ele faz pq gosta, não abuse da vontade dele.`
        );
      }

      // Pega apenas o primeiro resultado
      const post = posts[0];
      const detalhes = await getPostDetails(post.url);
      
      const caption = `
📱 *${detalhes.title}*
💿 Versão: ${detalhes.version || "?"}
⚡ Mod: ${detalhes.mod || "?"}
💾 Tamanho: ${detalhes.size || "?"}

_${detalhes.description.substring(0, 250)}..._

🔗 ${detalhes.url}
      `.trim();

      if (detalhes.image) {
        try {
          const imgRes = await fetch(detalhes.image, { headers: { 'User-Agent': 'Mozilla/5.0' }});
          if (imgRes.ok) {
            const buffer = Buffer.from(await imgRes.arrayBuffer());
            await socket.sendMessage(remoteJid, { image: buffer, caption, mimetype: "image/jpeg" });
            await sendReact("✅");
            return;
          }
        } catch (err) {
          console.error(`[getmods] Erro ao baixar capa:`, err.message);
        }
      }

      await socket.sendMessage(remoteJid, { text: caption });
      await sendReact("✅");
    } catch (error) {
      console.error(`[getmods] ❌ Erro fatal:`, error);
      await sendReact("❌");
      await sendReply(`❌ Erro ao buscar: ${error.message}`);
    }
  },
};