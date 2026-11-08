import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, renameSync, rmSync, statSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const require = createRequire(import.meta.url);
const { version: nodeVersion } = require("../package.json");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_PATH = path.join(ROOT, "models", "Qwen_Qwen3-0.6B-Q3_K_S.gguf");
const MODEL_PART = `${MODEL_PATH}.part`;
const MODEL_URL = "https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF/resolve/main/Qwen_Qwen3-0.6B-Q3_K_S.gguf";
const MIN_MODEL_BYTES = 350_000_000;
const MAX_MODEL_BYTES = 420_000_000;
const LLAMA_TAG = "b12110";
const TEMP_ROOT = path.join(ROOT, ".atlas-ai-install");
const BIN_DIR = path.join(ROOT, "bin");
const WRAPPER_PATH = path.join(BIN_DIR, "llama-server");

function log(message) {
  console.log(`[Atlas IA] ${message}`);
}

function isLfsPointer(filePath) {
  if (!existsSync(filePath) || statSync(filePath).size > 8192) return false;
  const content = readFileSync(filePath, "utf8");
  return content.startsWith("version https://git-lfs.github.com/spec/v1");
}

function isValidModel(filePath) {
  if (!existsSync(filePath)) return false;
  const size = statSync(filePath).size;
  if (size < MIN_MODEL_BYTES || size > MAX_MODEL_BYTES) return false;
  const fd = openSync(filePath, "r");
  const magic = Buffer.alloc(4);
  try {
    readSync(fd, magic, 0, 4, 0);
  } finally {
    closeSync(fd);
  }
  return magic.toString("ascii") === "GGUF";
}

async function downloadFile(url, destination, { minBytes, maxBytes, label }) {
  mkdirSync(path.dirname(destination), { recursive: true });
  if (existsSync(destination)) {
    const existingSize = statSync(destination).size;
    if (existingSize >= minBytes && existingSize <= maxBytes) return existingSize;
    rmSync(destination, { force: true });
  }
  const partPath = `${destination}.part`;
  let offset = existsSync(partPath) ? statSync(partPath).size : 0;
  if (offset > maxBytes) {
    rmSync(partPath, { force: true });
    offset = 0;
  }

  let response = await fetch(url, {
    headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  if (offset > 0 && response.status !== 206) {
    rmSync(partPath, { force: true });
    offset = 0;
    response = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
  }
  if (!response.ok || !response.body) {
    throw new Error(`${label}: servidor de download retornou HTTP ${response.status}.`);
  }

  const append = offset > 0 && response.status === 206;
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(partPath, { flags: append ? "a" : "w" }),
  );

  const size = statSync(partPath).size;
  if (size < minBytes || size > maxBytes) {
    throw new Error(`${label}: tamanho inesperado (${size} bytes; esperado entre ${minBytes} e ${maxBytes}).`);
  }
  renameSync(partPath, destination);
  return size;
}

async function ensureModel() {
  mkdirSync(path.dirname(MODEL_PATH), { recursive: true });
  if (isValidModel(MODEL_PATH)) {
    log(`modelo GGUF já está presente (${statSync(MODEL_PATH).size} bytes).`);
    return;
  }

  if (isLfsPointer(MODEL_PATH)) {
    log("o clone trouxe o pointer do Git LFS sem o conteúdo; baixando o mesmo GGUF da origem pública para completar o checkout.");
    rmSync(MODEL_PATH, { force: true });
  } else if (existsSync(MODEL_PATH) && statSync(MODEL_PATH).size > 8192) {
    throw new Error(`Existe um arquivo GGUF inválido em ${MODEL_PATH}; ele foi preservado e não será sobrescrito.`);
  }

  log("baixando Qwen3-0.6B Q3_K_S; são aproximadamente 390 MB e a instalação pode demorar.");
  const size = await downloadFile(MODEL_URL, MODEL_PATH, {
    minBytes: MIN_MODEL_BYTES,
    maxBytes: MAX_MODEL_BYTES,
    label: "Download do modelo",
  });
  if (!isValidModel(MODEL_PATH)) {
    rmSync(MODEL_PATH, { force: true });
    throw new Error("O arquivo baixado não passou pela verificação de formato GGUF.");
  }
  log(`modelo instalado (${size} bytes).`);
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function pruneExactLfsCache() {
  const git = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: ROOT, encoding: "utf8" });
  if (git.status !== 0 || !git.stdout.trim()) return;
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  if (status.status !== 0 || status.stdout.trim()) return;
  const gitDir = path.resolve(ROOT, git.stdout.trim());
  const oid = await sha256File(MODEL_PATH);
  const objectPath = path.join(gitDir, "lfs", "objects", oid.slice(0, 2), oid.slice(2, 4), oid);
  if (existsSync(objectPath)) {
    rmSync(objectPath, { force: true });
    log("cache duplicado do Git LFS removido após validar o modelo para economizar armazenamento.");
  }
}

function findServerBinary(directory) {
  for (const entry of require("node:fs").readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const result = findServerBinary(candidate);
      if (result) return result;
    } else if (entry.isFile() && entry.name === "llama-server") {
      return candidate;
    }
  }
  return null;
}

function testRuntime(binaryPath) {
  if (!existsSync(binaryPath)) return false;
  const result = spawnSync(binaryPath, ["--version"], { encoding: "utf8", timeout: 15_000 });
  if (result.error || result.status !== 0) {
    const details = [result.error?.message, result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join(" | ");
    log(`teste do runtime falhou: ${details || `código ${result.status}`}`);
    return false;
  }
  return true;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function ensureRuntime() {
  if (process.platform !== "linux") {
    throw new Error(`Runtime pré-compilado disponível somente para Linux; plataforma detectada: ${process.platform}.`);
  }
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
  if (!arch) throw new Error(`Arquitetura não suportada para o runtime: ${process.arch}.`);

  if (testRuntime(WRAPPER_PATH)) {
    log("runtime llama-server já está pronto.");
    return;
  }

  const asset = `llama-${LLAMA_TAG}-bin-ubuntu-${arch}.tar.gz`;
  const url = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${asset}`;
  const archivePath = path.join(TEMP_ROOT, asset);
  const extractRoot = path.join(TEMP_ROOT, "runtime-extract");
  const runtimeDir = path.join(BIN_DIR, `llama-${LLAMA_TAG}-${arch}`);

  log(`obtendo runtime CPU oficial ${asset} do GitHub.`);
  await downloadFile(url, archivePath, {
    minBytes: 10_000_000,
    maxBytes: 60_000_000,
    label: "Download do runtime",
  });

  rmSync(extractRoot, { recursive: true, force: true });
  mkdirSync(extractRoot, { recursive: true });
  const extracted = spawnSync("tar", ["-xzf", archivePath, "-C", extractRoot], {
    encoding: "utf8",
    timeout: 120_000,
  });
  if (extracted.error || extracted.status !== 0) {
    throw new Error(`Não foi possível extrair o runtime: ${extracted.error?.message || extracted.stderr || extracted.status}`);
  }

  const extractedServer = findServerBinary(extractRoot);
  if (!extractedServer) throw new Error("O pacote do llama.cpp não contém llama-server.");
  const extractedDir = path.dirname(extractedServer);
  rmSync(runtimeDir, { recursive: true, force: true });
  mkdirSync(BIN_DIR, { recursive: true });
  renameSync(extractedDir, runtimeDir);

  const serverPath = path.join(runtimeDir, "llama-server");
  const wrapper = `#!/usr/bin/env sh\nexec ${shellQuote(serverPath)} "$@"\n`;
  require("node:fs").writeFileSync(WRAPPER_PATH, wrapper, { mode: 0o755 });
  chmodSync(WRAPPER_PATH, 0o755);

  if (!testRuntime(WRAPPER_PATH)) {
    rmSync(WRAPPER_PATH, { force: true });
    throw new Error("O runtime oficial foi baixado, mas não iniciou neste Linux. Veja a mensagem de teste acima.");
  }
  log("runtime instalado e validado.");
}

async function main() {
  log(`preparando IA local para Node ${nodeVersion} (${process.platform}/${process.arch}).`);
  mkdirSync(TEMP_ROOT, { recursive: true });
  await ensureModel();
  await ensureRuntime();
  await pruneExactLfsCache();
  log("preparação concluída; o Atlas carregará o modelo sob demanda.");
}

main().catch((error) => {
  console.error(`[Atlas IA] Falha na preparação automática: ${error.message}`);
  process.exitCode = 1;
});
