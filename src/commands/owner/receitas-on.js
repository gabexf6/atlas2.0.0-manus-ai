import { PREFIX } from "../../config.js";
import { addRecipeGroup } from "../../services/recipeBroadcaster.js";

export default {
  name: "receitas-on",
  description: "Cadastra este chat pra receber as receitas automáticas do Tudo Delicious",
  commands: ["receitas-on", "receitason", "ativar-receitas"],
  usage: `${PREFIX}receitas-on (mande no grupo que vai receber)`,
  handle: async ({ remoteJid, sendReply, sendReact }) => {
    const novo = addRecipeGroup(remoteJid);
    await sendReply(
      novo
        ? "Pronto! Este chat vai receber uma receita a cada 1 hora, e toda receita nova que sair no site. A primeira chega em até 1 minuto."
        : "Este chat já recebe as receitas automáticas.",
    );
    await sendReact("✅");
  },
};
