import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { lazyRequire } from "../../../utils/lazy.js";

const getUnzipper = lazyRequire("unzipper");

import { downloadMediaMessage } from "zapo-js";

export default {
  name: "figpack",
  description: "Extrai e converte stickers de arquivos .fig (formato zip)",
  commands: ["pack"],

  handle: async ({
    webMessage,
    sendStickerFromFile,
    sendWaitReact,
    sendSuccessReact,
    sendErrorReply,
  }) => {
    let tempFile = null;
    let extractPath = null;

    try {
      await sendWaitReact();

      const quoted =
        webMessage.message?.extendedTextMessage
          ?.contextInfo?.quotedMessage;

      if (!quoted?.documentMessage) {
        return await sendErrorReply("Responda um arquivo .fig");
      }

      const doc = quoted.documentMessage;

      if (!doc.fileName?.toLowerCase().endsWith(".fig")) {
        return await sendErrorReply("O arquivo precisa ter a extensão .fig");
      }

      const stream = await downloadMediaMessage({ documentMessage: doc });
      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }

      const timestamp = Date.now();
      const tempDir = path.resolve(process.cwd(), "temp");
      fs.mkdirSync(tempDir, { recursive: true });
      tempFile = path.join(tempDir, `${timestamp}.fig`);
      extractPath = path.join(tempDir, `extracted_${timestamp}`);

      fs.writeFileSync(tempFile, buffer);
      fs.mkdirSync(extractPath, { recursive: true });

      await fs
        .createReadStream(tempFile)
        .pipe(getUnzipper().Extract({ path: extractPath }))
        .promise();

      function getAllFiles(dir) {
        let results = [];
        const list = fs.readdirSync(dir);
        for (const file of list) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            results = results.concat(getAllFiles(fullPath));
          } else {
            results.push(fullPath);
          }
        }
        return results;
      }

      const files = getAllFiles(extractPath).filter((file) => {
        const ext = path.extname(file).toLowerCase();
        return [".webp", ".png", ".jpg", ".jpeg", ".gif", ".mp4"].includes(ext);
      });

      if (!files.length) {
        return await sendErrorReply("Nenhuma mídia suportada encontrada no pacote.");
      }

      for (const file of files) {
        try {
          const ext = path.extname(file).toLowerCase();
          let finalStickerPath = file;

          if ([".png", ".jpg", ".jpeg"].includes(ext)) {
            finalStickerPath = `${file}_converted.webp`;
            await new Promise((resolve, reject) => {
              const cmd = `ffmpeg -i "${file}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2" -f webp -quality 90 "${finalStickerPath}"`;
              exec(cmd, (err) => (err ? reject(err) : resolve()));
            });
          }
          else if ([".mp4", ".gif"].includes(ext)) {
            finalStickerPath = `${file}_converted.webp`;
            await new Promise((resolve, reject) => {
              const cmd = `ffmpeg -y -i "${file}" -vf "scale=350:350,fps=15" -c:v libwebp -loop 0 -quality 8 -compression_level 6 -method 6 -preset picture -an -f webp "${finalStickerPath}"`;
              exec(cmd, (err) => (err ? reject(err) : resolve()));
            });
          }

          await sendStickerFromFile(finalStickerPath);

        } catch (err) {
          console.log("Erro ao processar/enviar figurinha:", file, err.message);
        }
      }

      await sendSuccessReact();

    } catch (err) {
      console.log(err);
      await sendErrorReply(`Erro:\n${err.message}`);
    } finally {
      try {
        if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        if (extractPath && fs.existsSync(extractPath)) {
          fs.rmSync(extractPath, { recursive: true, force: true });
        }
      } catch (cleanupErr) {
        console.log("Erro ao limpar arquivos:", cleanupErr.message);
      }
    }
  },
};
