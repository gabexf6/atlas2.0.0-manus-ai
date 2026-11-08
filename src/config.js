import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PREFIX = "/";

export const BOT_EMOJI = "🧠";

export const BOT_NAME = "Atlas";

// Configure esses valores no ambiente do servidor; não mantenha dados pessoais no repositório.
export const OWNER_LID = process.env.ATLAS_OWNER_LID || "";
export const OWNER_PHONE = process.env.ATLAS_OWNER_PHONE || "";

export const KISSRUSH_BLOG_URL = "https://kissrush.blogspot.com";

// A chave deve vir do gerenciador de segredos/ambiente do host.
export const BRONXYS_API_KEY = process.env.ATLAS_BRONXYS_API_KEY || "";
export const BRONXYS_BASE_URL = "https://api.bronxyshost.com.br/api-bronxys";

export const FFMPEG_BIN = "ffmpeg";

export const COMMANDS_DIR = path.join(__dirname, "commands");

export const ASSETS_DIR = path.resolve(__dirname, "..", "assets");

export const TEMP_DIR = path.resolve(__dirname, "..", "assets", "temp");

export const TIMEOUT_IN_MILLISECONDS_BY_EVENT = 500;

export const ONLY_GROUP_ID = "";

export const DEVELOPER_MODE = false;
