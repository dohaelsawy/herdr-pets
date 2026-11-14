// The art loader, given Herdr's real file and program access. This is the only module
// that reads outside the mod's folder, runs a program (curl) or reaches the network;
// what it does with them is in artcore.js.
import { exec, home, appHome } from "herdr";
import * as fs from "fs/promises";
import { createArt, DATA_REL } from "./artcore.js";

export { DATA_REL };
export const { extensionMedia, loadPet, loadTheme } = createArt({ exec, fs, home, appHome });
