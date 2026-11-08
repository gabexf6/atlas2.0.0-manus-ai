import { isOwner } from "../../middlewares/index.js";
import { collectConversationEvidence, collectEvidence } from "../../services/assistantSources.js";
import { answerFromEvidence } from "../../services/localAssistant.js";
import { cleanExternalText } from "../../services/httpLimits.js";
import { isGroupAiEnabled, setGroupAiEnabled } from "../../utils/aiGroupSettings.js";

const APP_PROVIDERS = new Set(["getmods", "liteapks", "an1", "androidtunado"]);
const BROWSER_MODES = new Set(["apps", "books", "recipes", "manga", "kissrush"]);
const SOURCE_MODES = new Map([
  ["web", "web"],
  ["internet", "web"],
  ["wiki", "wiki"],
  ["wikipedia", "wiki"],
  ["apps", "apps"],
  ["app", "apps"],
  ["livro", "books"],
  ["livros", "books"],
  ["receita", "recipes"],
  ["receitas", "recipes"],
  ["manga", "manga"],
  ["mangá", "manga"],
  ["kissrush", "kissrush"],
]);

function parseRequest(rawValue) {
  const raw = String(rawValue ?? "").trim();
  const firstSpace = raw.indexOf(" ");
  const first = (firstSpace < 0 ? raw : raw.slice(0, firstSpace)).toLocaleLowerCase("pt-BR");
  const rest = firstSpace < 0 ? "" : raw.slice(firstSpace + 1).trim();

  if (APP_PROVIDERS.has(first)) return { mode: "apps", provider: first, query: rest };

  const mode = SOURCE_MODES.get(first);
  if (!mode) return { mode: "general", query: raw };

  if (mode === "apps") {
    const providerSpace = rest.indexOf(" ");
    const provider = (providerSpace < 0 ? rest : rest.slice(0, providerSpace)).toLocaleLowerCase("pt-BR");
    const query = providerSpace < 0 ? "" : rest.slice(providerSpace + 1).trim();
    return { mode, provider, query };
  }

  return { mode, query: rest };
}

function formatReferences(evidence) {
  return evidence.slice(0, 6).map((item, index) => {
    const title = cleanExternalText(item?.title, 150).replace(/[*_~`]/g, "");
    const source = cleanExternalText(item?.source, 120).replace(/[*_~`]/g, "");
    const url = cleanExternalText(item?.url, 400);
    const label = title || source || "Fonte consultada";
    return url ? `${index + 1}. ${label} — ${url}` : `${index + 1}. ${label}`;
  }).join("\n");
}

function identityVariants(value) {
  const normalized = String(value || "").replace(/:[0-9]+(?=@)/g, "").trim().toLowerCase();
  if (!normalized) return [];
  const local = normalized.split("@")[0];
  const digits = local.replace(/\D/g, "");
  return [normalized, local, digits].filter(Boolean);
}

function identitiesMatch(left, right) {
  const variants = new Set(identityVariants(left));
  return identityVariants(right).some((value) => variants.has(value));
}

async function isGroupAdminOrOwner({ socket, remoteJid, userLid, remoteJidAlt, webMessage }) {
  if (isOwner({ userLid, remoteJid, remoteJidAlt })) return true;
  const metadata = await socket.groupMetadata(remoteJid);
  const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];
  const candidates = [
    userLid,
    remoteJidAlt,
    webMessage?.key?.participant,
    webMessage?.key?.participantAlt,
  ].filter(Boolean);

  return participants.some((participant) => {
    const isAdmin = participant?.admin === "admin" || participant?.admin === "superadmin" ||
      participant?.isAdmin === true || participant?.isSuperAdmin === true;
    return isAdmin && candidates.some((candidate) => identitiesMatch(candidate, participant?.id));
  });
}

async function handleGroupToggle(action, props) {
  const { socket, remoteJid, userLid, remoteJidAlt, webMessage, sendReply, sendWarningReply } = props;
  if (!String(remoteJid || "").endsWith("@g.us")) {
    await sendWarningReply("A conversa automática só pode ser ativada ou desativada dentro de um grupo.");
    return true;
  }

  if (action === "status") {
    await sendReply(`A IA deste grupo está ${isGroupAiEnabled(remoteJid) ? "ativada" : "desativada"}.`);
    return true;
  }

  let authorized = false;
  try {
    authorized = await isGroupAdminOrOwner({ socket, remoteJid, userLid, remoteJidAlt, webMessage });
  } catch {
    authorized = false;
  }
  if (!authorized) {
    await sendWarningReply("Só o proprietário do bot ou um administrador deste grupo pode mudar o modo de conversa da IA.");
    return true;
  }

  const enabled = action === "ativar";
  try {
    setGroupAiEnabled(remoteJid, enabled);
    await sendReply(enabled
      ? "IA ativada neste grupo. Vou pesquisar fontes antes de responder mensagens comuns. Use /ia desativar para parar."
      : "IA desativada neste grupo.");
  } catch {
    await sendWarningReply("Não consegui salvar a configuração da IA para este grupo.");
  }
  return true;
}

export default {
  name: "ia",
  description: "Pesquisa fontes da web, Wikipédia e subsistemas do Atlas; pode conversar em grupo com fontes.",
  commands: ["ia", "atlasia"],
  usage: "/ia <pergunta> | /ia ativar | /ia desativar | /ia wiki <pergunta>",
  handle: async (props) => {
    const rawArgs = String(props.fullArgs ?? "").trim();
    const action = rawArgs.toLocaleLowerCase("pt-BR");
    if (["ativar", "desativar", "status"].includes(action)) {
      await handleGroupToggle(action, props);
      return;
    }

    const request = parseRequest(rawArgs);
    if (!request.query || request.query.length > 240) {
      await props.sendWarningReply(
        "Use uma pergunta de até 240 caracteres. Exemplos: /ia Como funciona a fotossíntese?; /ia wiki fotossíntese; /ia apps getmods nome do app.",
      );
      return;
    }

    if (request.mode === "apps" && !APP_PROVIDERS.has(request.provider)) {
      await props.sendWarningReply("Informe um provedor: getmods, liteapks, an1 ou androidtunado.");
      return;
    }

    await props.sendWaitReply("Pesquisando fontes públicas e consultando o modelo local...");

    try {
      const evidence = request.mode === "general"
        ? await collectConversationEvidence(request.query)
        : await collectEvidence(request.mode, request.query, request.provider);
      if (!evidence.length) {
        await props.sendReply("Não encontrei fontes suficientes para responder. Tente reformular a busca.");
        return;
      }

      // A conversa geral pode rotear para qualquer catálogo; feche Chromium antes de carregar o GGUF.
      if (request.mode === "general" || BROWSER_MODES.has(request.mode)) {
        const { closeBrowser } = await import("../../services/browserManager.js");
        await closeBrowser().catch(() => {});
      }

      const answer = await answerFromEvidence(request.query, evidence);
      const references = formatReferences(evidence);
      await props.sendReply(`${answer}\n\nFontes consultadas:\n${references}`);
    } catch {
      await props.sendWarningReply(
        "Não consegui concluir a pesquisa. Verifique a conexão e execute scripts/install-local-ai.sh no servidor para instalar o modelo e o runtime local.",
      );
    }
  },
};
