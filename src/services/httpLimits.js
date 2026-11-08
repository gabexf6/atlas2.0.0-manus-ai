export async function readResponseTextLimited(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Resposta remota excede o limite configurado.");
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("Resposta remota excede o limite configurado.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total).toString("utf8");
}

export function cleanExternalText(value, maxLength = 700) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function validateSearchQuery(value, maxLength = 240) {
  const query = cleanExternalText(value, maxLength);
  if (!query) throw new Error("Informe uma consulta.");
  if (String(value ?? "").trim().length > maxLength) {
    throw new Error(`A consulta deve ter no máximo ${maxLength} caracteres.`);
  }
  return query;
}
