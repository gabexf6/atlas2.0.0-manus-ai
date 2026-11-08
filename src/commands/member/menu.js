import path from "node:path";
import { ASSETS_DIR, PREFIX } from "../../config.js";
import { menuMessage } from "../../menu.js";
import { isOwner } from "../../middlewares/index.js";

export default {
  name: "menu",
  description: "Menu de comandos",
  commands: ["menu", "help"],
  usage: `${PREFIX}menu`,
  handle: async ({ remoteJid, remoteJidAlt, sendImageFromFile, sendSuccessReact, userLid }) => {
    await sendSuccessReact();

    const message = menuMessage({
      remoteJid,
      isOwner: isOwner({ userLid, remoteJid, remoteJidAlt }),
    });

    await sendImageFromFile(path.join(ASSETS_DIR, "images", "atlas.png"), `\n\n${message}`);
  },
};
