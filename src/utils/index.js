import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { downloadMediaMessage } from "zapo-js";
import { COMMANDS_DIR, PREFIX, TEMP_DIR } from "../config.js";
import { errorLog } from "./logger.js";

export function question(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export function extractDataFromMessage(webMessage) {
  const textMessage = webMessage.message?.conversation;
  const extendedTextMessage = webMessage.message?.extendedTextMessage;
  const extendedTextMessageText = extendedTextMessage?.text;
  const imageTextMessage = webMessage.message?.imageMessage?.caption;
  const videoTextMessage = webMessage.message?.videoMessage?.caption;
  const audioTextMessage = webMessage.message?.audioMessage?.caption;
  const documentTextMessage = webMessage.message?.documentMessage?.caption;

  let fullMessage =
    textMessage ||
    extendedTextMessageText ||
    imageTextMessage ||
    videoTextMessage ||
    audioTextMessage ||
    documentTextMessage;

  if (!fullMessage) {
    fullMessage = "#auto-command";
  }

  const participantId = webMessage?.key?.participant || "";
  const userLid = (participantId || webMessage?.key?.remoteJidAlt || webMessage?.key?.remoteJid || "")
    .replace(/:[0-9][0-9]|:[0-9]/g, "");

  const [command, ...args] = fullMessage.split(" ");
  const prefix = command.charAt(0);

  const commandWithoutPrefix = command.replace(new RegExp(`^[${PREFIX}]+`), "");

  return {
    args: splitByCharacters(args.join(" "), ["\\", "|", "/"]),
    commandName: formatCommand(commandWithoutPrefix),
    fullArgs: args.join(" "),
    fullMessage,
    prefix,
    remoteJid: webMessage?.key?.remoteJid,
    remoteJidAlt: webMessage?.key?.remoteJidAlt,
    userLid,
  };
}

export function splitByCharacters(str, characters) {
  characters = characters.map((char) => (char === "\\" ? "\\\\" : char));
  const regex = new RegExp(`[${characters.join("")}]`);

  return str
    .split(regex)
    .map((str) => str.trim())
    .filter(Boolean);
}

export function formatCommand(text) {
  return onlyLettersAndNumbers(
    removeAccentsAndSpecialCharacters(text.toLocaleLowerCase().trim()),
  );
}

export function onlyLettersAndNumbers(text) {
  return text.replace(/[^a-zA-Z0-9]/g, "");
}

export function removeAccentsAndSpecialCharacters(text) {
  if (!text) return "";

  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function hasMessageContent(webMessage, context) {
  return !!getContent(webMessage, context);
}

export function getContent(webMessage, context) {
  return (
    webMessage?.message?.[`${context}Message`] ||
    webMessage?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.[
      `${context}Message`
    ] ||
    webMessage?.message?.viewOnceMessage?.message?.[`${context}Message`] ||
    webMessage?.message?.extendedTextMessage?.contextInfo?.quotedMessage
      ?.viewOnceMessage?.message?.[`${context}Message`] ||
    webMessage?.message?.viewOnceMessageV2?.message?.[`${context}Message`] ||
    webMessage?.message?.extendedTextMessage?.contextInfo?.quotedMessage
      ?.viewOnceMessageV2?.message?.[`${context}Message`]
  );
}

export async function download(webMessage, fileName, context, extension) {
  const content = getContent(webMessage, context);

  if (!content) {
    return null;
  }

  const rawMessage = { [`${context}Message`]: content };
  const stream = await downloadMediaMessage(rawMessage);

  const filePath = path.resolve(TEMP_DIR, `${fileName}.${extension}`);

  await pipeline(stream, fs.createWriteStream(filePath));

  return filePath;
}

export function readDirectoryRecursive(dir) {
  const results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of list) {
    const itemPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results.push(...readDirectoryRecursive(itemPath));
    } else if (
      !item.name.startsWith("_") &&
      (item.name.endsWith(".js") || item.name.endsWith(".ts"))
    ) {
      results.push(itemPath);
    }
  }

  return results;
}

// Índice leve: nome do comando -> arquivo. Montado UMA vez lendo só o texto dos
// arquivos (sem importar nenhum), então só o comando que for realmente usado
// entra na memória. (Antes, a 1ª mensagem importava os 59 comandos, +150MB de RAM.)
let commandIndex = null;

function buildCommandIndex() {
  const index = new Map();
  const unparsed = [];

  const subdirectories = fs
    .readdirSync(COMMANDS_DIR, { withFileTypes: true })
    .filter((directory) => directory.isDirectory())
    .map((directory) => directory.name);

  for (const type of subdirectories) {
    const subdirectoryPath = path.join(COMMANDS_DIR, type);

    for (const filePath of readDirectoryRecursive(subdirectoryPath)) {
      const source = fs.readFileSync(filePath, "utf8");
      const match = source.match(/\bcommands\s*:\s*\[([^\]]*)\]/);
      const names = match
        ? [...match[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1])
        : [];

      const entry = { type, filePath, subdirectoryPath };

      if (!names.length) {
        unparsed.push(entry);
        continue;
      }

      for (const name of names) {
        const key = formatCommand(name);
        if (!index.has(key)) index.set(key, entry);
      }
    }
  }

  return { index, unparsed };
}

async function importCommand({ filePath, subdirectoryPath }) {
  // Recarregamento a quente só se ATLAS_HOT_RELOAD=1 (cada versão fica na RAM).
  const suffix = process.env.ATLAS_HOT_RELOAD === "1"
    ? `?v=${fs.statSync(filePath).mtimeMs}`
    : "";
  const module = await import(`${pathToFileURL(filePath).href}${suffix}`);
  const command = module.default ?? module;

  if (command && typeof command === "object") {
    const segments = path.relative(subdirectoryPath, filePath).split(path.sep);
    command.__category = segments.length > 1 ? segments[0] : "geral";
  }

  return command;
}

export async function findCommandImport(commandName) {
  if (!commandIndex || process.env.ATLAS_HOT_RELOAD === "1") {
    commandIndex = buildCommandIndex();
  }

  let entry = commandIndex.index.get(commandName);

  if (entry) {
    try {
      const command = await importCommand(entry);
      return { type: entry.type, command };
    } catch (error) {
      console.error(`Erro ao importar ${entry.filePath}:`, error);
      return { type: "", command: null };
    }
  }

  // Arquivos cujo "commands" não deu pra ler como texto: importa e confere.
  for (const candidate of commandIndex.unparsed) {
    try {
      const command = await importCommand(candidate);
      const names = Array.isArray(command?.commands) ? command.commands : [];
      if (names.some((name) => formatCommand(name) === commandName)) {
        return { type: candidate.type, command };
      }
    } catch (error) {
      console.error(`Erro ao importar ${candidate.filePath}:`, error);
    }
  }

  return { type: "", command: null };
}

export const onlyNumbers = (text) => text.replace(/[^0-9]/g, "");

export function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function readMore() {
  const invisibleBreak = "\u200B".repeat(950);
  return invisibleBreak;
}

export function getRandomName(extension) {
  const fileName = `atlas_temp_${getRandomNumber(0, 999999)}`;

  if (!extension) {
    return fileName.toString();
  }

  return `${fileName}.${extension}`;
}

export function removeFileIfExists(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (error) {
    console.error("Erro ao remover arquivo:", error);
  }

  return false;
}

export function removeFileWithTimeout(filePath, timeout = 5000) {
  setTimeout(() => {
    removeFileIfExists(filePath);
  }, timeout);
}

export function getUserName(webMessage, userLid, fallback = "usuario") {
  return (
    webMessage?.pushName ||
    webMessage?.notifyName ||
    userLid?.replace(/@lid/, "") ||
    fallback
  );
}

export async function ajustAudioByBuffer(audioBuffer, isPtt = true) {
  return new Promise((resolve, reject) => {
    const tempPath = path.resolve(
      TEMP_DIR,
      getRandomName(isPtt ? "ogg" : "mp3"),
    );

    fs.writeFileSync(tempPath, audioBuffer);

    const outputPath = path.resolve(
      TEMP_DIR,
      getRandomName(isPtt ? "ogg" : "mp3"),
    );

    const command = isPtt
      ? `ffmpeg -i "${tempPath}" -vn -c:a libopus -f ogg -b:a 48k -ac 1 -y "${outputPath}"`
      : `ffmpeg -i "${tempPath}" -vn -c:a libmp3lame -f mp3 -ar 44100 -ac 2 -b:a 128k -y "${outputPath}"`;

    exec(command, (error) => {
      if (error) {
        console.error(error);
        reject(error);
        return;
      }

      try {
        const result = {
          oldAudioPath: tempPath,
          audioPath: outputPath,
          audioBuffer: fs.readFileSync(outputPath),
        };
        resolve(result);
      } catch (readError) {
        reject(readError);
      }
    });
  });
}

export function isAtLeastMinutesInPast(timestamp, minimumMinutes = 5) {
  const currentTimestamp = Math.floor(Date.now() / 1000);

  const diffInSeconds = currentTimestamp - timestamp;

  const diffInMinutes = Math.floor(diffInSeconds / 60);

  return diffInMinutes >= minimumMinutes;
}

