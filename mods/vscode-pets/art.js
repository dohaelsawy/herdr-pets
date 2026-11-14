// The art loader, given Herdr's real file and program access. This is the only module
// that reads outside the mod's folder, runs a program (curl) or reaches the network;
// what it does with them is in artcore.js.
import { exec, home, appHome } from "herdr";
import * as fs from "fs/promises";
import { createArt, DATA_REL } from "./artcore.js";

// Asking the app a question and waiting for the answer hands control back to it,
// which is what a long piece of work must do every so often.
const pause = () => fs.exists(appHome()).catch(() => false);

export { DATA_REL };
export const { extensionMedia, loadPet, loadTheme } = createArt({ exec, fs, home, appHome, pause });
