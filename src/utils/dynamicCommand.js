import { BOT_EMOJI, ONLY_GROUP_ID } from "../config.js";
import { checkPermission, hasTypeAndCommand, verifyPrefix } from "../middlewares/index.js";
import { badMacHandler } from "./badMacHandler.js";
import { getPrefix } from "./database.js";
import { findCommandImport } from "./index.js";
import { errorLog } from "./logger.js";

export async function dynamicCommand(paramsHandler, startProcess) {
  const {
    commandName,
    fullMessage,
    prefix,
    remoteJid,
    sendErrorReply,
    sendReact,
    sendReply,
    sendWarningReply,
  } = paramsHandler;

  const { type, command } = await findCommandImport(commandName);

  if (ONLY_GROUP_ID && ONLY_GROUP_ID !== remoteJid) {
    return;
  }

  if (!verifyPrefix(prefix, remoteJid)) {
    return;
  }

  const groupPrefix = getPrefix(remoteJid);

  if (fullMessage === groupPrefix) {
    await sendReact(BOT_EMOJI);
    await sendReply(
      `Este é meu prefixo! Use ${groupPrefix}menu para ver os comandos disponíveis!`
    );

    return;
  }

  if (!hasTypeAndCommand({ type, command })) {
    await sendWarningReply(
      `Comando não encontrado! Use ${groupPrefix}menu para ver os comandos disponíveis!`
    );

    return;
  }

  if (!(await checkPermission({ type, command, ...paramsHandler }))) {
    await sendErrorReply("Você não tem permissão para executar este comando!");
    return;
  }

  try {
    await command.handle({
      ...paramsHandler,
      type,
      startProcess,
    });
  } catch (error) {
    if (badMacHandler.handleError(error, `command:${command?.name}`)) {
      await sendWarningReply(
        "Erro temporário de sincronização. Tente novamente em alguns segundos."
      );
      return;
    }

    if (badMacHandler.isSessionError(error)) {
      errorLog(
        `Erro de sessão durante execução de comando ${command?.name}: ${error.message}`
      );
      await sendWarningReply(
        "Erro de comunicação. Tente executar o comando novamente."
      );
      return;
    }

    if (error.name === "InvalidParameterError") {
      await sendWarningReply(`Parâmetros inválidos! ${error.message}`);
    } else if (error.name === "WarningError") {
      await sendWarningReply(error.message);
    } else if (error.name === "DangerError") {
      await sendErrorReply(error.message);
    } else if (error.isAxiosError) {
      const messageText = error.response?.data?.message || error.message;
      const url = error.config?.url || "URL não disponível";

      await sendErrorReply(
        `Ocorreu um erro ao executar uma chamada remota para ${url} no comando ${command.name}!

📄 *Detalhes*: ${messageText}`
      );
    } else {
      errorLog("Erro ao executar comando", error);
      await sendErrorReply(
        `Ocorreu um erro ao executar o comando ${command.name}!

📄 *Detalhes*: ${error.message}`
      );
    }
  }
}
