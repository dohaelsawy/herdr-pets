// Finds the sprites and keeps a copy under ~/.config/herdr-app/data/pets/.
// This is the only module that reads outside the mod's folder, runs a program (curl)
// or reaches the network. Nothing it fetches is ever part of this repo.
import { exec, home, appHome } from "herdr";
import * as fs from "fs/promises";
import { UPSTREAM_TAG } from "./pets.js";
import { spritesFor } from "./engine.js";
import { readSize, flop } from "./gif.js";
import { EDITOR_DIRS, EXTENSION_ONLY, newestExtension, spriteName, leftName, rawUrl, themeFiles, pngSize } from "./sources.js";

export const DATA_REL = "data/pets"; // image() paths are relative to ~/.config/herdr-app
const RECIPE = 1; // bump when what is cached changes shape, so old caches are rebuilt

const has = (path) => fs.exists(path).catch(() => false);
const dirOf = (path) => path.slice(0, path.lastIndexOf("/"));

// The media folder of the newest installed vscode-pets, or null. Looked up once.
let media;
export async function extensionMedia() {
  if (media !== undefined) return media;
  media = null;
  for (const rel of EDITOR_DIRS) {
    const dir = `${home()}/${rel}`;
    const found = newestExtension(await fs.readdir(dir).catch(() => []));
    if (found && (await has(`${dir}/${found}/media`))) {
      media = `${dir}/${found}/media`;
      break;
    }
  }
  return media;
}

// Puts media/<rel> at dest and returns its bytes; null when upstream has no such file.
async function obtain(rel, dest) {
  const dir = await extensionMedia();
  if (dir && (await has(`${dir}/${rel}`))) {
    const bytes = await fs.readFile(`${dir}/${rel}`);
    await fs.writeFile(dest, bytes);
    return bytes;
  }
  let r;
  try {
    r = await exec("curl", ["-sfL", "--retry", "2", "--connect-timeout", "10", "-o", dest, rawUrl(UPSTREAM_TAG, rel)]);
  } catch {
    throw new Error("Sprites need either vscode-pets installed in an editor, or curl.");
  }
  if (r.code === 22) return null; // HTTP 404: this pet has no such animation
  if (r.code !== 0) throw new Error(`Download failed (curl ${r.code}). Check the connection.`);
  return fs.readFile(dest);
}

// One pet's animations: { recipe, sprites: { <label>: { right, left, width, height } } },
// with paths ready for image(). Cached per type and colour.
export async function loadPet(type, color) {
  const dir = `${appHome()}/${DATA_REL}/${type}`;
  const metaFile = `${dir}/${color.replaceAll(" ", "_")}.json`;
  if (await has(metaFile)) {
    try {
      const meta = JSON.parse(await fs.readFile(metaFile, "utf8"));
      const files = Object.values(meta.sprites ?? {});
      if (meta.recipe === RECIPE && files.length && (await has(`${appHome()}/${files[0].right}`))) return meta;
    } catch {
      // unreadable: rebuild it
    }
  }
  if (EXTENSION_ONLY.includes(type) && !(await extensionMedia())) {
    throw new Error("Needs the vscode-pets extension installed in an editor.");
  }
  await fs.mkdir(dir, { recursive: true });
  const sprites = {};
  for (const label of spritesFor(type)) {
    const name = spriteName(color, label);
    const bytes = await obtain(`${type}/${name}`, `${dir}/${name}`);
    if (!bytes) continue;
    const { width, height } = readSize(bytes);
    let left = name;
    try {
      await fs.writeFile(`${dir}/${leftName(name)}`, flop(bytes));
      left = leftName(name);
    } catch (e) {
      // One odd file shouldn't cost the pet: it walks backwards in this state.
      console.log(`pets: could not mirror ${type}/${name}: ${e?.message ?? e}`);
    }
    sprites[label] = { right: `${DATA_REL}/${type}/${name}`, left: `${DATA_REL}/${type}/${left}`, width, height };
  }
  if (Object.keys(sprites).length === 0) throw new Error(`No sprites found for the ${color} ${type}.`);
  const meta = { recipe: RECIPE, sprites };
  await fs.writeFile(metaFile, JSON.stringify(meta));
  return meta;
}

// A theme's pictures: { background, foreground }, each { path, width, height } or null.
export async function loadTheme(theme, dark, size) {
  const out = {};
  for (const [layer, rel] of Object.entries(themeFiles(theme, dark, size))) {
    const dest = `${appHome()}/${DATA_REL}/${rel}`;
    let bytes;
    if (await has(dest)) {
      bytes = await fs.readFile(dest);
    } else {
      await fs.mkdir(dirOf(dest), { recursive: true });
      bytes = await obtain(rel, dest);
    }
    out[layer] = bytes ? { path: `${DATA_REL}/${rel}`, ...pngSize(bytes) } : null;
  }
  if (!out.background && !out.foreground) throw new Error(`No pictures found for the ${theme} theme.`);
  return out;
}
