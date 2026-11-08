import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATABASE_DIR = path.resolve(__dirname, "../..", "database");
const DATABASE_FILE = path.join(DATABASE_DIR, "ia-grupos.json");

function validateGroupJid(groupJid) {
  const value = String(groupJid || "").trim();
  if (!/^[0-9A-Za-z._-]{1,100}@g\.us$/.test(value)) {
    throw new Error("JID de grupo inválido.");
  }
  return value;
}

function readEnabledGroups() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATABASE_FILE, "utf8"));
    return Array.isArray(parsed?.groups)
      ? parsed.groups.filter((jid) => typeof jid === "string" && /^[0-9A-Za-z._-]{1,100}@g\.us$/.test(jid))
      : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

export function isGroupAiEnabled(groupJid) {
  const jid = validateGroupJid(groupJid);
  return readEnabledGroups().includes(jid);
}

export function setGroupAiEnabled(groupJid, enabled) {
  const jid = validateGroupJid(groupJid);
  const groups = new Set(readEnabledGroups());
  if (enabled) groups.add(jid);
  else groups.delete(jid);

  fs.mkdirSync(DATABASE_DIR, { recursive: true });
  const temporaryFile = `${DATABASE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify({ groups: [...groups].sort() }, null, 2), "utf8");
  fs.renameSync(temporaryFile, DATABASE_FILE);
  return groups.has(jid);
}
