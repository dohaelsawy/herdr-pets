// Finds the sprites and keeps a copy under ~/.config/herdr-app/data/pets/.
// The logic lives here with its file and program access passed in, so it runs under
// tests; art.js hands it Herdr's real ones. Nothing it fetches is ever part of this repo.
import { UPSTREAM_TAG } from "./pets.js";
import { spritesFor } from "./engine.js";
import { readSize, flop } from "./gif.js";
import { EDITOR_DIRS, EXTENSION_ONLY, newestExtension, spriteName, leftName, rawUrl, themeFiles, pngSize } from "./sources.js";

export const DATA_REL = "data/pets"; // image() paths are relative to ~/.config/herdr-app
const RECIPE = 1; // bump when what is cached changes shape, so old caches are rebuilt
const CURL_SECONDS = 20; // per attempt
const EXEC_MS = 90000; // curl's three attempts and their pauses fit inside this

const dirOf = (path) => path.slice(0, path.lastIndexOf("/"));
const reason = (e) => String(e?.message ?? e);

// io: { exec, fs, home, appHome } with the shapes of Herdr's `exec`, `fs/promises`,
// `home()` and `appHome()`.
export function createArt({ exec, fs, home, appHome }) {
  const has = (path) => fs.exists(path).catch(() => false);
  const remove = (path) => fs.unlink(path).catch(() => {});

  // The media folder of the newest installed vscode-pets, or null. Looked up once: the
  // promise is kept, so callers that arrive during the lookup wait for the same answer.
  let lookup;
  const extensionMedia = () => (lookup ??= findExtension());

  async function findExtension() {
    for (const rel of EDITOR_DIRS) {
      const dir = `${home()}/${rel}`;
      const found = newestExtension(await fs.readdir(dir).catch(() => []));
      if (found && (await has(`${dir}/${found}/media`))) return `${dir}/${found}/media`;
    }
    return null;
  }

  // Puts media/<rel> at dest and returns its bytes; null when upstream has no such file.
  async function obtain(rel, dest) {
    const dir = await extensionMedia();
    if (dir && (await has(`${dir}/${rel}`))) {
      const bytes = await fs.readFile(`${dir}/${rel}`);
      await fs.writeFile(dest, bytes);
      return bytes;
    }
    // curl writes to a side file, so a download that is cut short never sits at dest.
    const part = `${dest}.part`;
    let r;
    try {
      r = await exec(
        "curl",
        ["-sL", "--retry", "2", "--connect-timeout", "10", "--max-time", String(CURL_SECONDS), "-o", part, "-w", "%{http_code}", rawUrl(UPSTREAM_TAG, rel)],
        { timeout: EXEC_MS },
      );
    } catch (e) {
      await remove(part);
      throw new Error(`Sprites need either vscode-pets installed in an editor, or curl (${reason(e)}).`);
    }
    const status = r.stdout.trim();
    if (r.code !== 0 || status !== "200") {
      await remove(part);
      if (r.code === 0 && status === "404") return null; // upstream has no such file
      throw new Error(r.code !== 0 ? `Download failed (curl ${r.code}). Check the connection.` : `Download failed (HTTP ${status}).`);
    }
    try {
      const bytes = await fs.readFile(part);
      await fs.writeFile(dest, bytes);
      return bytes;
    } finally {
      await remove(part);
    }
  }

  // The cached answer for one pet, or null when any of it is missing or out of date.
  async function cachedPet(metaFile) {
    try {
      const meta = JSON.parse(await fs.readFile(metaFile, "utf8"));
      const files = Object.values(meta.sprites ?? {}).flatMap((s) => [s.right, s.left]);
      if (meta.recipe !== RECIPE || files.length === 0) return null;
      for (const rel of files) if (!(await has(`${appHome()}/${rel}`))) return null;
      return meta;
    } catch {
      return null;
    }
  }

  async function buildPet(type, color) {
    const dir = `${appHome()}/${DATA_REL}/${type}`;
    const metaFile = `${dir}/${color.replaceAll(" ", "_")}.json`;
    const cached = await cachedPet(metaFile);
    if (cached) return cached;
    if (EXTENSION_ONLY.includes(type) && !(await extensionMedia())) {
      throw new Error("Needs the vscode-pets extension installed in an editor.");
    }
    await fs.mkdir(dir, { recursive: true });
    const sprites = {};
    for (const label of spritesFor(type)) {
      const name = spriteName(color, label);
      const bytes = await obtain(`${type}/${name}`, `${dir}/${name}`);
      if (!bytes) continue;
      let size;
      try {
        size = readSize(bytes);
      } catch {
        await remove(`${dir}/${name}`);
        throw new Error(`The ${color} ${type}'s "${label}" sprite is not a valid GIF.`);
      }
      let left = name;
      try {
        await fs.writeFile(`${dir}/${leftName(name)}`, flop(bytes));
        left = leftName(name);
      } catch (e) {
        // One odd file shouldn't cost the pet: it walks backwards in this state.
        console.log(`pets: could not mirror ${type}/${name}: ${reason(e)}`);
      }
      sprites[label] = { right: `${DATA_REL}/${type}/${name}`, left: `${DATA_REL}/${type}/${left}`, width: size.width, height: size.height };
    }
    if (Object.keys(sprites).length === 0) throw new Error(`No sprites found for the ${color} ${type}.`);
    const meta = { recipe: RECIPE, sprites };
    await fs.writeFile(metaFile, JSON.stringify(meta));
    return meta;
  }

  // A theme's pictures: { background, foreground }, each { path, width, height } or null.
  async function buildTheme(theme, dark, size) {
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
      if (!bytes) {
        out[layer] = null;
        continue;
      }
      try {
        out[layer] = { path: `${DATA_REL}/${rel}`, ...pngSize(bytes) };
      } catch {
        await remove(dest); // not kept, so the next try fetches it again
        throw new Error(`The ${theme} theme's ${layer} picture is not a valid PNG.`);
      }
    }
    if (!out.background && !out.foreground) throw new Error(`No pictures found for the ${theme} theme.`);
    return out;
  }

  // Every copy of the mod shares this module. Callers asking for the same thing at
  // once share one piece of work, so two of them never write the same files together.
  const inFlight = new Map();
  function once(key, work) {
    if (!inFlight.has(key)) inFlight.set(key, work().finally(() => inFlight.delete(key)));
    return inFlight.get(key);
  }

  // One pet's animations: { recipe, sprites: { <label>: { right, left, width, height } } },
  // with paths ready for image(). Cached per type and colour.
  const loadPet = (type, color) => once(`pet/${type}/${color}`, () => buildPet(type, color));
  const loadTheme = (theme, dark, size) => once(`theme/${theme}/${dark ? "dark" : "light"}/${size}`, () => buildTheme(theme, dark, size));

  return { extensionMedia, loadPet, loadTheme };
}
