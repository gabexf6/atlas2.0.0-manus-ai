import pkg from "../../package.json" with { type: "json" };

let consoleNoiseFilterInstalled = false;

export function installConsoleNoiseFilter() {
  if (consoleNoiseFilterInstalled) {
    return;
  }

  const originalConsoleInfo = console.info.bind(console);

  console.info = (...args) => {
    if (args[0] === "Closing session:") {
      warningLog(
        "O WhatsApp fechou uma sessão criptografada antiga para renovar as chaves. Isso é um aviso normal da conexão e não indica erro no bot.",
      );
      return;
    }

    originalConsoleInfo(...args);
  };

  consoleNoiseFilterInstalled = true;
}

export function infoLog(message) {
  console.log("\x1b[34m[ATLAS | INFO]\x1b[0m", message);
}

export function successLog(message) {
  console.log("\x1b[32m[ATLAS | SUCCESS]\x1b[0m", message);
}

export function errorLog(message) {
  console.log("\x1b[31m[ATLAS | ERROR]\x1b[0m", message);
}

export function warningLog(message) {
  console.log("\x1b[33m[ATLAS | WARNING]\x1b[0m", message);
}

export function bannerLog() {
  console.log(`\x1b[36m █████╗ ████████╗██╗      █████╗ ███████╗\x1b[0m`);
  console.log(`\x1b[36m██╔══██╗╚══██╔══╝██║     ██╔══██╗██╔════╝\x1b[0m`);
  console.log(`\x1b[36m███████║   ██║   ██║     ███████║███████╗\x1b[0m`);
  console.log(`\x1b[36m██╔══██║   ██║   ██║     ██╔══██║╚════██║\x1b[0m`);
  console.log(`\x1b[36m██║  ██║   ██║   ███████╗██║  ██║███████║\x1b[0m`);
  console.log(`\x1b[36m╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚══════╝\x1b[0m`);

  console.log(`\x1b[36m🤖 Versão: \x1b[0m${pkg.version}\n`);
}