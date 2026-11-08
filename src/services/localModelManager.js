import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { warningLog } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function configuredPort() {
  if (process.env.ATLAS_LLM_PORT) {
    return boundedInteger(process.env.ATLAS_LLM_PORT, 8080, 1024, 65535);
  }
  try {
    const base = new URL(process.env.ATLAS_LLM_BASE_URL || "http://127.0.0.1:8080/v1");
    return base.port ? boundedInteger(base.port, 8080, 1024, 65535) : 8080;
  } catch {
    return 8080;
  }
}

const PORT = configuredPort();
const CONTEXT_SIZE = boundedInteger(process.env.ATLAS_LLM_CTX_SIZE, 2048, 512, 2048);
const THREADS = boundedInteger(process.env.ATLAS_LLM_THREADS, 3, 1, 3);
const BATCH_SIZE = boundedInteger(process.env.ATLAS_LLM_BATCH_SIZE, 32, 8, 128);
const UBATCH_SIZE = boundedInteger(process.env.ATLAS_LLM_UBATCH_SIZE, 16, 8, 64);
const START_TIMEOUT_MS = boundedInteger(process.env.ATLAS_LLM_START_TIMEOUT_MS, 180_000, 10_000, 300_000);
const IDLE_UNLOAD_MS = boundedInteger(process.env.ATLAS_LLM_IDLE_UNLOAD_MS, 120_000, 30_000, 600_000);
const SERVER_BIN = path.resolve(PROJECT_ROOT, process.env.ATLAS_LLAMA_SERVER_BIN || "bin/llama-server");
const MODEL_PATH = path.resolve(PROJECT_ROOT, process.env.ATLAS_LLM_MODEL_PATH || "models/SmolLM3-Q4_K_M.gguf");
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;

let child = null;
let startPromise = null;
let stopPromise = null;
let idleTimer = null;
let activeLeases = 0;
let ownedByAtlas = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isHealthy() {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(900) });
    await response.body?.cancel().catch(() => {});
    return response.ok;
  } catch {
    return false;
  }
}

function buildArgs() {
  return [
    "--model", MODEL_PATH,
    "--jinja",
    "--host", "127.0.0.1",
    "--port", String(PORT),
    "--ctx-size", String(CONTEXT_SIZE),
    "--threads", String(THREADS),
    "--threads-batch", String(THREADS),
    "--batch-size", String(BATCH_SIZE),
    "--ubatch-size", String(UBATCH_SIZE),
    "--parallel", "1",
    "--cache-type-k", "q8_0",
    "--cache-type-v", "q8_0",
  ];
}

async function stopOwnedServer() {
  if (!ownedByAtlas || !child || activeLeases > 0) return;
  const current = child;
  clearTimeout(idleTimer);
  idleTimer = null;

  stopPromise = new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      if (child === current) child = null;
      ownedByAtlas = false;
      resolve();
    };
    const killTimer = setTimeout(() => {
      if (current.exitCode === null && current.signalCode === null) current.kill("SIGKILL");
      finish();
    }, 5000);
    killTimer.unref?.();
    current.once("exit", finish);
    if (current.exitCode !== null || current.signalCode !== null) finish();
    else current.kill("SIGTERM");
  }).finally(() => {
    stopPromise = null;
  });

  await stopPromise;
}

function scheduleIdleUnload() {
  clearTimeout(idleTimer);
  if (!ownedByAtlas || activeLeases > 0 || !child) return;
  idleTimer = setTimeout(() => {
    if (activeLeases === 0) void stopOwnedServer();
  }, IDLE_UNLOAD_MS);
  idleTimer.unref?.();
}

async function startOwnedServer() {
  if (stopPromise) await stopPromise;
  if (!fs.existsSync(SERVER_BIN)) {
    throw new Error("Runtime llama-server ausente. Execute npm install ou node scripts/prepare-local-ai.mjs após liberar espaço.");
  }
  if (!fs.existsSync(MODEL_PATH)) {
    throw new Error("Arquivo SmolLM3 ausente. Execute npm install ou node scripts/prepare-local-ai.mjs após liberar espaço.");
  }

  let spawnError = null;
  const launchedChild = spawn(SERVER_BIN, buildArgs(), {
    cwd: PROJECT_ROOT,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, OMP_NUM_THREADS: String(THREADS) },
  });
  child = launchedChild;
  ownedByAtlas = true;
  launchedChild.once("error", (error) => { spawnError = error; });
  launchedChild.once("exit", (code, signal) => {
    if (child === launchedChild) child = null;
    ownedByAtlas = false;
    clearTimeout(idleTimer);
    idleTimer = null;
    if (code !== 0 && code !== null) {
      warningLog(`llama-server encerrou (código ${code}, sinal ${signal || "nenhum"}).`);
    }
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (spawnError) {
      await stopOwnedServer();
      throw new Error(`Não consegui iniciar llama-server: ${spawnError.message}`);
    }
    if (launchedChild.exitCode !== null || launchedChild.signalCode !== null) {
      throw new Error("llama-server encerrou antes de ficar pronto. Confira a arquitetura e as bibliotecas do runtime.");
    }
    if (await isHealthy()) return true;
    await sleep(500);
  }

  await stopOwnedServer();
  throw new Error(`O modelo local demorou mais de ${Math.round(START_TIMEOUT_MS / 1000)} segundos para carregar.`);
}

async function ensureServer() {
  if (await isHealthy()) return false;
  if (process.env.ATLAS_LLM_AUTOSTART === "0") {
    throw new Error("Servidor local de IA não está ativo em loopback. Inicie llama-server ou habilite ATLAS_LLM_AUTOSTART.");
  }
  if (startPromise) return startPromise;

  startPromise = startOwnedServer();
  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}

export async function acquireLocalModel() {
  clearTimeout(idleTimer);
  idleTimer = null;
  const startedHere = await ensureServer();
  activeLeases += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    activeLeases = Math.max(0, activeLeases - 1);
    if (startedHere || ownedByAtlas) scheduleIdleUnload();
  };
}

function stopBeforeExit() {
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
}

process.once("exit", stopBeforeExit);
