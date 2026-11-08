export async function detectImageMimetype(buffer, fallback = "image/jpeg") {
  try {
    const { fileTypeFromBuffer } = await import("file-type");
    const type = await fileTypeFromBuffer(buffer);

    if (type?.mime?.startsWith("image/")) {
      return type.mime;
    }
  } catch {
  }

  return fallback;
}

export async function detectMimetype(buffer, fallback) {
  try {
    const { fileTypeFromBuffer } = await import("file-type");
    const type = await fileTypeFromBuffer(buffer);

    if (type?.mime) {
      return type.mime;
    }
  } catch {
  }

  return fallback;
}
