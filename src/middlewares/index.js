import { OWNER_LID, OWNER_PHONE } from "../config.js";
import { getPrefix } from "../utils/database.js";

export function verifyPrefix(prefix, groupJid) {
  const groupPrefix = getPrefix(groupJid);
  return groupPrefix === prefix;
}

export function hasTypeAndCommand({ type, command }) {
  return !!type && !!command;
}

function normalizedIdentity(value) {
  return String(value || "").replace(/\D/g, "");
}

function isConfiguredIdentity(value) {
  const identity = normalizedIdentity(value);
  return Boolean(identity) && identity !== "12345678901234567890";
}

export function isOwner({ userLid, remoteJid, remoteJidAlt } = {}) {
  const configured = [OWNER_LID, OWNER_PHONE].filter(isConfiguredIdentity).map(normalizedIdentity);
  if (!configured.length) return false;

  return [userLid, remoteJid, remoteJidAlt].some((candidate) =>
    configured.includes(normalizedIdentity(candidate)),
  );
}

export async function checkPermission({ type, userLid, remoteJid, remoteJidAlt } = {}) {
  if (type === "member") return true;
  return isOwner({ userLid, remoteJid, remoteJidAlt });
}
