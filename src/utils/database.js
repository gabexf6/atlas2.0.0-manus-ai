import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PREFIX } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const databasePath = path.resolve(__dirname, "..", "..", "database");

const PREFIX_GROUPS_FILE = "prefix-groups";

function createIfNotExists(fullPath, formatIfNotExists = []) {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, JSON.stringify(formatIfNotExists), "utf8");
  }
}

function readJSON(jsonFile, formatIfNotExists = []) {
  const fullPath = path.resolve(databasePath, `${jsonFile}.json`);

  createIfNotExists(fullPath, formatIfNotExists);

  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function writeJSON(jsonFile, data, formatIfNotExists = []) {
  const fullPath = path.resolve(databasePath, `${jsonFile}.json`);

  createIfNotExists(fullPath, formatIfNotExists);

  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf8");
}

export function getPrefix(groupJid) {
  const filename = PREFIX_GROUPS_FILE;

  const prefixGroups = readJSON(filename, {});

  return prefixGroups[groupJid] || PREFIX;
}

// ==== Receitas automáticas (Tudo Delicious) ====
// grupos: chats que recebem as receitas | vistas: receitas do site já
// conhecidas (pra detectar as novas) | recentes: últimas enviadas (pra não
// repetir) | ultimoEnvio: quando saiu a última receita da hora
const RECIPES_FILE = "receitas";
const RECIPES_DEFAULT = { grupos: [], vistas: [], recentes: [], ultimoEnvio: 0 };

export function getRecipeState() {
  return { ...RECIPES_DEFAULT, ...readJSON(RECIPES_FILE, RECIPES_DEFAULT) };
}

export function updateRecipeState(changes) {
  const state = { ...getRecipeState(), ...changes };
  writeJSON(RECIPES_FILE, state, RECIPES_DEFAULT);
  return state;
}

// ==== Figurinhas automáticas (Sticker.ly) ====
// grupos: chats que recebem | recentes: packs já enviados (pra não repetir)
// | ultimoEnvio: quando saiu o último pack
const STICKERS_FILE = "figurinhas";
const STICKERS_DEFAULT = { grupos: [], recentes: [], ultimoEnvio: 0 };

export function getStickerState() {
  return { ...STICKERS_DEFAULT, ...readJSON(STICKERS_FILE, STICKERS_DEFAULT) };
}

export function updateStickerState(changes) {
  const state = { ...getStickerState(), ...changes };
  writeJSON(STICKERS_FILE, state, STICKERS_DEFAULT);
  return state;
}
