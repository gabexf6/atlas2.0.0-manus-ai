/**
 * Menu do bot — escrito à mão. Pra adicionar/remover um comando do menu,
 * é só editar o texto aqui.
 */
import pkg from "../package.json" with { type: "json" };
import { BOT_NAME } from "./config.js";
import { getPrefix } from "./utils/database.js";
import { readMore } from "./utils/index.js";

function cabecalho(p) {
  const date = new Date();
  return `╭━━━〔 🌍 ${BOT_NAME.toUpperCase()} 〕━━━⬣${readMore()}
┃ 📅 ${date.toLocaleDateString("pt-BR")}
┃ 🕒 ${date.toLocaleTimeString("pt-BR")}
┃ 🔖 Prefixo: ${p}
┃ 📦 Versão: ${pkg.version}
╰━━━━━━━━━━━━━━━━⬣`;
}

const downloads = (p) => `╭━━〔 ⬇️ DOWNLOADS 〕━━⬣
┃ 🎬 *Vídeo*
┃ ${p}tiktok <link>
┃ ${p}instagram <link>
┃ ${p}facebook <link>
┃ ${p}twitter <link>
┃ ${p}threads <link>
┃ ${p}kwai <link>
┃ ${p}ifunny <link>
┃
┃ 🎵 *Áudio*
┃ ${p}tiktokaudio <link>
┃ ${p}instagramaudio <link>
┃ ${p}facebookaudio <link>
┃ ${p}twitteraudio <link>
┃ ${p}spotify <link>
┃ ${p}soundcloud <link>
┃
┃ ▶️ *YouTube*
┃ ${p}play <música>
┃ ${p}playvideo <vídeo>
┃
┃ 📁 *Arquivos*
┃ ${p}mediafire <link>
┃ ${p}aptoide <link>
┃ ${p}pinterest <termo>
╰━━━━━━━━━━━━━━━━⬣`;

const sistemas = (p) => `╭━━〔 ⚙️ SISTEMAS 〕━━⬣
┃ 📚 *Livros & Mangas*
┃ ${p}livro <título>
┃ ${p}manga <título>
┃
┃ 🍳 *Receitas*
┃ ${p}receita <prato>
┃
┃ 📱 *Blogs & Mods*
┃ ${p}kissrush <termo>
┃ ${p}getmods <termo>
┃ ${p}liteapks <termo>
┃ ${p}an1 <termo>
┃ ${p}androidtunado <termo>
┃
┃ 🖼️ *Figurinhas*
┃ ${p}sticker (responda uma imagem/gif/vídeo)
┃ ${p}rename pacote / autor
┃ ${p}pack (responda um arquivo .fig)
┃ ${p}stickerly <busca|link|código>
╰━━━━━━━━━━━━━━━━⬣`;

const outros = (p) => `╭━━〔 🔧 OUTROS 〕━━⬣
┃ 🧠 *IA com pesquisa*
┃ ${p}ia <pergunta>
┃ ${p}ia ativar (admin do grupo)
┃ ${p}ia desativar (admin do grupo)
┃ ${p}ia wiki <pergunta>
┃ ${p}ia apps <provedor> <consulta>
┃ ${p}ia livros|receitas|manga <consulta>
┃ ${p}ping
╰━━━━━━━━━━━━━━━━⬣`;

const dono = (p) => `╭━━〔 👑 DONO 〕━━⬣
┃ 🍳 *Receitas automáticas*
┃ ${p}receitas-on (no grupo)
┃ ${p}receitas-off (no grupo)
┃ ${p}receitas-grupos
┃ ${p}receitas-agora
┃
┃ 🎨 *Figurinhas automáticas*
┃ ${p}figurinhas-on (no grupo)
┃ ${p}figurinhas-off (no grupo)
┃ ${p}figurinhas-grupos
┃ ${p}figurinhas-agora
┃
┃ 📚 *Livros automáticos*
┃ ${p}livros-on (no grupo)
┃ ${p}livros-off (no grupo)
┃ ${p}livros-grupos
┃ ${p}livros-agora
┃
┃ 📱 *KissRush automático*
┃ ${p}kissrush-on (no grupo)
┃ ${p}kissrush-off (no grupo)
┃ ${p}kissrush-grupos
┃ ${p}kissrush-agora
┃ ${p}kissrush-forcar
┃ ${p}kissrush-reset
┃
┃ 📱 *GetMods automático*
┃ ${p}getmods-on (no grupo)
┃ ${p}getmods-off (no grupo)
┃ ${p}getmods-grupos
┃ ${p}getmods-agora
┃ ${p}getmods-novel-on (no grupo)
┃ ${p}getmods-novel-off (no grupo)
┃ ${p}getmods-novel-grupos
┃ ${p}getmods-novel-agora
╰━━━━━━━━━━━━━━━━⬣`;

export function menuMessage({ remoteJid, isOwner = false } = {}) {
  const p = getPrefix(remoteJid);
  const partes = [
    cabecalho(p),
    downloads(p),
    sistemas(p),
    outros(p),
  ];
  if (isOwner) partes.push(dono(p));
  return partes.join("\n\n");
}
