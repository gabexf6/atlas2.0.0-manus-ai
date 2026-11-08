import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";

import {
  searchPosts,
  getPostDetails,
} from "../../../services/androidtunadoApi.js";

export default {
  name: "androidtunado",

  description: "Busca aplicativos e jogos no Android Tunado",

  commands: [
    "androidtunado",
    "at",
  ],

  usage: `${PREFIX}androidtunado <nome do aplicativo>`,

  handle: async ({
    fullArgs,
    socket,
    remoteJid,
    sendReact,
    sendReply,
  }) => {

    const query = fullArgs.trim();

    if (!query) {
      throw new InvalidParameterError(
        `Exemplo: ${PREFIX}androidtunado spotify`
      );
    }

    await sendReact("⏳");

    await sendReply(
      `🔎 Pesquisando *${query}* no Android Tunado...`
    );

    try {
      const posts = await searchPosts(query);

      if (!posts.length) {
        await sendReact("❌");

        return sendReply(
          `❌ Não encontrei resultados para *${query}* no Android Tunado.\n\nVerifique o nome e tente novamente.`
        );
      }

      // Seleciona o primeiro resultado.
      const post = posts[0];

      const details = await getPostDetails(post.url);

      const description = details.description
        ? details.description.substring(0, 300)
        : "Descrição não disponível.";

      const caption = [
        `📱 *${details.title || post.title}*`,
        "",
        `💿 Versão: ${details.version || "Não informada"}`,
        `📅 Atualização: ${details.updated || "Não informada"}`,
        `📱 Android: ${details.requirements || "Não informado"}`,
        `👨‍💻 Desenvolvedor: ${details.developer || "Não informado"}`,
        "",
        `📝 *Descrição:*`,
        description,
        "",
        `🔗 ${details.url}`,
        "",
      ].join("\n");

      if (details.image) {
        try {
          const imgRes = await fetch(details.image, {
            headers: {
              "User-Agent": "Mozilla/5.0",
            },
            signal: AbortSignal.timeout(15000),
          });

          if (imgRes.ok) {
            const buffer = Buffer.from(
              await imgRes.arrayBuffer()
            );

            await socket.sendMessage(remoteJid, {
              image: buffer,
              caption,
              mimetype: "image/jpeg",
            });

            await sendReact("✅");

            return;
          }

        } catch (error) {
          console.error(
            "[androidtunado] Erro ao baixar imagem:",
            error.message
          );
        }
      }

      await socket.sendMessage(remoteJid, {
        text: caption,
      });

      await sendReact("✅");

    } catch (error) {
      console.error(
        "[androidtunado] ❌ Erro:",
        error
      );

      await sendReact("❌");

      await sendReply(
        `❌ Erro ao pesquisar no Android Tunado:\n${error.message}`
      );
    }
  },
};