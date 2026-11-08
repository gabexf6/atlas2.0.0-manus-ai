import { OWNER_LID, PREFIX } from "../../config.js";
import { DangerError, InvalidParameterError } from "../../errors/index.js";
import { onlyNumbers } from "../../utils/index.js";
import { errorLog } from "../../utils/logger.js";

function normalizeLid(value) {
  return String(value || "").replace(/:[0-9]+/g, "").trim();
}

export default {
  name: "ban",
  description: "Remove um membro do grupo",
  commands: ["ban", "kick"],
  usage: `${PREFIX}ban @membro\n\nou responda à mensagem do membro com ${PREFIX}ban`,

  /** @param {CommandHandleProps} props */
  handle: async ({
    args,
    isReply,
    socket,
    remoteJid,
    replyLid,
    userLid,
    sendReply,
    sendSuccessReact,
    sendErrorReply,
  }) => {
    try {
      if (!String(remoteJid || "").endsWith("@g.us")) {
        throw new DangerError(
          "Este comando só pode ser usado em grupos."
        );
      }

      if (!args.length && !isReply) {
        throw new InvalidParameterError(
          "Mencione o membro que deseja remover ou responda à mensagem dele."
        );
      }

      if (args.length && !String(args[0]).includes("@")) {
        throw new InvalidParameterError(
          'Mencione o membro usando "@".'
        );
      }

      const mentionedDigits = args[0]
        ? onlyNumbers(String(args[0]))
        : "";

      const mentionedLid = mentionedDigits
        ? `${mentionedDigits}@lid`
        : null;

      const targetLid = normalizeLid(
        isReply ? replyLid : mentionedLid
      );

      if (!targetLid || targetLid === "@lid") {
        throw new InvalidParameterError(
          "Não consegui identificar o membro. Tente mencioná-lo ou responder à mensagem dele."
        );
      }

      if (normalizeLid(targetLid) === normalizeLid(userLid)) {
        throw new DangerError(
          "Você não pode remover a si mesmo."
        );
      }

      if (
        OWNER_LID &&
        normalizeLid(targetLid) === normalizeLid(OWNER_LID)
      ) {
        throw new DangerError(
          "Você não pode remover o proprietário do Atlas."
        );
      }

      // Evita remover o próprio bot, caso sua identidade esteja disponível.
      const botIdentities = [
        socket?.user?.lid,
        socket?.user?.id,
      ]
        .filter(Boolean)
        .map(normalizeLid);

      if (botIdentities.includes(normalizeLid(targetLid))) {
        throw new DangerError(
          "Você não pode remover o próprio Atlas."
        );
      }

      await socket.groupParticipantsUpdate(
        remoteJid,
        [targetLid],
        "remove"
      );

      await sendSuccessReact();
      await sendReply("✅ Membro removido do grupo.");
    } catch (error) {
      errorLog(
        `Erro no comando ban: ${
          error?.stack || error?.message || error
        }`
      );

      await sendErrorReply(
        `Não foi possível remover o membro: ${
          error?.message || "erro desconhecido"
        }`
      );
    }
  },
};