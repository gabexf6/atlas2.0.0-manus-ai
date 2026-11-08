import { DEVELOPER_MODE } from "../config.js";
import { badMacHandler } from "../utils/badMacHandler.js";
import { dynamicCommand } from "../utils/dynamicCommand.js";
import { isAtLeastMinutesInPast } from "../utils/index.js";
import { loadCommonFunctions } from "../utils/loadCommonFunctions.js";
import { enqueueGroupAssistant } from "../services/groupAssistant.js";
import { errorLog, infoLog, warningLog } from "../utils/logger.js";

export async function onMessage({ socket, event, startProcess }) {
  if (!event) return;

  const webMessage = event;

  if (DEVELOPER_MODE) {
    infoLog(
      `\n\n⪨========== [ MENSAGEM RECEBIDA ] ==========⪩ \n\n${JSON.stringify(
        webMessage,
      )}`,
    );
  }

  try {
    const remoteJid = webMessage?.key?.remoteJid;
    if (!remoteJid) return;

    const timestamp = webMessage.timestampSeconds;
    if (isAtLeastMinutesInPast(timestamp)) return;

    const commonFunctions = loadCommonFunctions({ socket, webMessage });
    if (!commonFunctions) return;

    if (!webMessage?.key?.fromMe) {
      try {
        enqueueGroupAssistant({
          socket,
          webMessage,
          fullMessage: commonFunctions.fullMessage,
          remoteJid: commonFunctions.remoteJid || remoteJid,
          userLid: commonFunctions.userLid,
        });
      } catch (error) {
        warningLog(`Não foi possível enfileirar mensagem para IA: ${error.message}`);
      }
    }

    await dynamicCommand(commonFunctions, startProcess);
  } catch (error) {
    if (badMacHandler.handleError(error, "message-processing")) return;

    if (badMacHandler.isSessionError(error)) {
      errorLog(`Erro de sessão ao processar mensagem: ${error.message}`);
      return;
    }

    errorLog(
      `Erro ao processar mensagem: ${error.message} | Stack: ${error.stack}`,
    );
  }
}
