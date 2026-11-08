import { connect } from "./connection.js";
import { load } from "./loader.js";
import { badMacHandler } from "./utils/badMacHandler.js";
import {
  bannerLog,
  errorLog,
  infoLog,
  installConsoleNoiseFilter,
  warningLog,
} from "./utils/logger.js";

installConsoleNoiseFilter();

process.on("uncaughtException", (error) => {
  if (badMacHandler.handleError(error, "uncaughtException")) {
    return;
  }

  errorLog(`Erro crítico não capturado: ${error.message}`);
  errorLog(error.stack);

  if (
    !error.message.includes("ENOTFOUND") &&
    !error.message.includes("timeout")
  ) {
    process.exit(1);
  }
});

process.on("unhandledRejection", (reason) => {
  if (badMacHandler.handleError(reason, "unhandledRejection")) {
    return;
  }

  errorLog(`Promessa rejeitada não tratada:`, reason);
});

async function startBot() {
  try {
    process.setMaxListeners(1500);

    bannerLog();
    infoLog("Iniciando meus componentes internos...");

    const stats = badMacHandler.getStats();
    if (stats.errorCount > 0) {
      warningLog(
        `BadMacHandler stats: ${stats.errorCount}/${stats.maxRetries} erros`,
      );
    }

    const socket = await connect();

    load(socket);

    setInterval(() => {
      const currentStats = badMacHandler.getStats();
      if (currentStats.errorCount > 0) {
        warningLog(
          `BadMacHandler stats: ${currentStats.errorCount}/${currentStats.maxRetries} erros`,
        );
      }
    }, 300_000);
  } catch (error) {
    if (badMacHandler.handleError(error, "bot-startup")) {
      warningLog("Erro Bad MAC durante inicialização, tentando novamente...");

      setTimeout(() => {
        startBot();
      }, 5000);
      return;
    }

    errorLog(`Erro ao iniciar o bot: ${error.message}`);
    errorLog(error.stack);
    process.exit(1);
  }
}

startBot();
