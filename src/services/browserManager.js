import fs from "node:fs";

const CHROMIUM_EXECUTABLE_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "/data/data/com.termux/files/usr/bin/chromium-browser",
  "/data/data/com.termux/files/usr/bin/chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean);

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function findSystemChromium() {
  for (const candidate of CHROMIUM_EXECUTABLE_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

let browserInstance = null;
let launchingPromise = null;
let idleTimer = null;
const IDLE_TIMEOUT_MS = boundedInteger(process.env.ATLAS_BROWSER_IDLE_MS, 20_000, 5_000, 120_000);
const MAX_CONTEXTS = boundedInteger(process.env.ATLAS_MAX_BROWSER_CONTEXTS, 1, 1, 2);
const MAX_CONTEXT_WAITERS = boundedInteger(process.env.ATLAS_MAX_BROWSER_WAITERS, 8, 1, 32);
const CONTEXT_MAX_LIFETIME_MS = 15 * 60 * 1000;
const CHROMIUM_JS_HEAP_MB = boundedInteger(process.env.ATLAS_CHROMIUM_JS_HEAP_MB, 128, 64, 512);
let activeContexts = 0;
const waiters = [];

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleIdleClose() {
  clearIdleTimer();
  if (activeContexts > 0) return;

  idleTimer = setTimeout(async () => {
    idleTimer = null;
    if (activeContexts > 0 || !browserInstance) return;

    const browser = browserInstance;
    try {
      await browser.close();
    } catch {}
    if (browserInstance === browser) browserInstance = null;
  }, IDLE_TIMEOUT_MS);
  idleTimer.unref?.();
}

function acquireSlot() {
  clearIdleTimer();
  if (activeContexts < MAX_CONTEXTS) {
    activeContexts += 1;
    return Promise.resolve();
  }
  if (waiters.length >= MAX_CONTEXT_WAITERS) {
    return Promise.reject(new Error("Fila do navegador cheia; tente novamente em instantes."));
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function releaseSlot() {
  const next = waiters.shift();
  if (next) {
    next();
    return;
  }
  activeContexts = Math.max(0, activeContexts - 1);
  if (activeContexts === 0) scheduleIdleClose();
}

export async function getBrowser() {
  clearIdleTimer();

  if (browserInstance && browserInstance.isConnected()) {
    if (activeContexts === 0) scheduleIdleClose();
    return browserInstance;
  }

  if (launchingPromise) {
    const browser = await launchingPromise;
    if (activeContexts === 0) scheduleIdleClose();
    return browser;
  }

  launchingPromise = (async () => {
    const executablePath = findSystemChromium();
    const args = [
      "--disable-blink-features=AutomationControlled",
      "--disable-http-cache",
      "--disk-cache-size=0",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      `--js-flags=--max-old-space-size=${CHROMIUM_JS_HEAP_MB}`,
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--mute-audio",
      "--no-first-run",
      "--disable-features=Translate",
      "--renderer-process-limit=1",
    ];

    // Prefira executar o bot como usuário sem privilégios. Containers root
    // podem exigir esta opção; nesse caso, o sandbox do Chromium fica desativado.
    const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
    if (isRoot || process.env.ATLAS_CHROMIUM_NO_SANDBOX === "1") {
      args.push("--no-sandbox", "--disable-setuid-sandbox");
    }

    const options = { headless: true, args };
    if (executablePath) options.executablePath = executablePath;

    console.log("[BrowserManager] Iniciando Chromium central...");
    // Playwright só entra na memória quando uma busca realmente precisa do browser.
    const { chromium } = await import("playwright");
    const browser = await chromium.launch(options);
    browser.on("disconnected", () => {
      if (browserInstance === browser) browserInstance = null;
    });
    return browser;
  })();

  try {
    browserInstance = await launchingPromise;
    return browserInstance;
  } finally {
    launchingPromise = null;
    if (activeContexts === 0) scheduleIdleClose();
  }
}

export async function createContext(contextOptions = {}) {
  await acquireSlot();
  let context;
  try {
    const browser = await getBrowser();
    context = await browser.newContext(contextOptions);
  } catch (error) {
    releaseSlot();
    throw error;
  }

  let released = false;
  let lifetimeTimer = null;
  const release = () => {
    if (released) return;
    released = true;
    if (lifetimeTimer) clearTimeout(lifetimeTimer);
    releaseSlot();
  };

  const originalClose = context.close.bind(context);
  context.close = async (...args) => {
    try {
      return await originalClose(...args);
    } finally {
      release();
    }
  };

  lifetimeTimer = setTimeout(() => {
    context.close().catch(() => {});
  }, CONTEXT_MAX_LIFETIME_MS);
  lifetimeTimer.unref?.();

  return context;
}

export async function closeBrowser() {
  clearIdleTimer();
  if (activeContexts > 0) return false;
  if (browserInstance) {
    const browser = browserInstance;
    try {
      await browser.close();
    } finally {
      if (browserInstance === browser) browserInstance = null;
    }
  }
  return true;
}
