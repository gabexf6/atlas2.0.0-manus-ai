import { randomUUID } from "node:crypto";
import { lazyRequire } from "../utils/lazy.js";
import { BOT_NAME } from "../config.js";

const getSharp = lazyRequire("sharp");
const DEFAULT_STICKER_EMOJIS = ["🙂"];
const COVER_SIZE = 252;

function isAnimatedWebpBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  return buffer.includes(Buffer.from("ANIM")) || buffer.includes(Buffer.from("ANMF"));
}

async function buildCoverThumbnailFromWebp(webpBuffer) {
  return getSharp()(webpBuffer)
    .resize(COVER_SIZE, COVER_SIZE, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function buildStickerPackContent({
  title,
  author,
  stickerBuffers,
  packDescription,
}) {
  if (!Array.isArray(stickerBuffers) || !stickerBuffers.length) {
    throw new Error("Nenhuma figurinha disponível pra montar o pack.");
  }

  const stickers = stickerBuffers.map((buffer, index) => ({
    media: buffer,
    fileName: `s${index}.webp`,
    emojis: DEFAULT_STICKER_EMOJIS,
    isAnimated: isAnimatedWebpBuffer(buffer),
    mimetype: "image/webp",
  }));

  const coverThumbnail = await buildCoverThumbnailFromWebp(stickerBuffers[0]);

  return {
    type: "sticker-pack",
    stickerPackId: randomUUID(),
    name: String(title || "Figurinhas").slice(0, 120),
    publisher: String(author || BOT_NAME).slice(0, 120),
    stickers,
    trayIcon: { media: stickerBuffers[0], fileName: "tray.webp" },
    coverThumbnail,
    thumbnailWidth: COVER_SIZE,
    thumbnailHeight: COVER_SIZE,
    packDescription: packDescription ? String(packDescription).slice(0, 200) : undefined,
  };
}