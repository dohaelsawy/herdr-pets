import { test } from "node:test";
import assert from "node:assert/strict";
import { createArt, DATA_REL } from "../mods/pets/artcore.js";
import { rawUrl } from "../mods/pets/sources.js";
import { decode } from "../mods/pets/gif.js";
import { makeGif } from "./helpers.mjs";

const HOME = "/home/me";
const APP = "/home/me/.config/herdr-app";
const MEDIA = `${HOME}/.vscode/extensions/tonybaloney.vscode-pets-1.37.0/media`;
const CACHE = `${APP}/${DATA_REL}`;
const PALETTE = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]];
const GIF = makeGif({ width: 3, height: 1, palette: PALETTE, frames: [{ pixels: [1, 2, 3] }] });
const PNG = (() => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set([0, 0, 1, 0x5f], 16); // 351 wide
  png.set([0, 0, 1, 0x2c], 20); // 300 high
  return png;
})();
const DOG = ["idle", "lie", "swipe", "walk", "walk_fast"]; // the dog's sprite labels
const url = (rel) => rawUrl("1.37.0", rel);

// A file system in memory and a curl that serves `web` (url -> bytes, a status number,
// "drop" for a connection lost part-way, or "hang" for a download that never returns).
// Everything the code did is recorded. `clock.ms` is the time the code sees.
function fake({ files = {}, web = {}, curl = true, slowReaddir = false } = {}) {
  const disk = new Map(Object.entries(files));
  const calls = { curl: [], readdir: 0 };
  const clock = { ms: 1000 };
  const fs = {
    async exists(path) {
      return disk.has(path) || [...disk.keys()].some((k) => k.startsWith(`${path}/`));
    },
    async readdir(path) {
      calls.readdir++;
      if (slowReaddir) await new Promise((r) => setImmediate(r));
      const names = new Set();
      for (const k of disk.keys()) if (k.startsWith(`${path}/`)) names.add(k.slice(path.length + 1).split("/")[0]);
      if (names.size === 0) throw new Error("no such folder");
      return [...names];
    },
    async readFile(path, encoding) {
      if (!disk.has(path)) throw new Error(`no such file ${path}`);
      const bytes = disk.get(path);
      return encoding === "utf8" ? new TextDecoder().decode(bytes) : bytes;
    },
    async writeFile(path, contents) {
      disk.set(path, typeof contents === "string" ? new TextEncoder().encode(contents) : contents);
    },
    async mkdir() {},
    async unlink(path) {
      if (!disk.delete(path)) throw new Error(`no such file ${path}`);
    },
  };
  async function exec(command, args, options) {
    if (command !== "curl" || !curl) throw new Error("program not found");
    const part = args[args.indexOf("-o") + 1];
    const target = args.at(-1);
    calls.curl.push({ target, options, args });
    const answer = web[target] ?? 404;
    if (answer === "hang") return new Promise(() => {});
    // A real download takes a while, and the file is incomplete until it ends.
    if (answer instanceof Uint8Array) disk.set(part, answer.subarray(0, 5));
    await new Promise((r) => setImmediate(r));
    if (answer === "drop") {
      disk.set(part, GIF.subarray(0, 5));
      return { code: 56, stdout: "000", stderr: "" };
    }
    if (typeof answer === "number") {
      disk.set(part, new TextEncoder().encode("<html>error</html>"));
      return { code: 0, stdout: String(answer), stderr: "" };
    }
    // curl keeps writing to the file it opened: if someone else removed that name
    // meanwhile, the bytes go nowhere and the name stays gone.
    if (disk.has(part)) disk.set(part, answer);
    return { code: 0, stdout: "200", stderr: "" };
  }
  const art = createArt({ exec, fs, home: () => HOME, appHome: () => APP, now: () => clock.ms });
  return { art, disk, calls, clock };
}

const extensionWith = (rels, bytes = GIF) => Object.fromEntries(rels.map((rel) => [`${MEDIA}/${rel}`, bytes]));
const dogFiles = (color) => DOG.map((label) => `dog/${color}_${label}_8fps.gif`);
const leftovers = (disk) => [...disk.keys()].filter((k) => k.endsWith(".part"));

test("extensionMedia finds the newest installed extension", async () => {
  const { art } = fake({
    files: {
      [`${HOME}/.vscode/extensions/tonybaloney.vscode-pets-1.9.0/media/dog/x.gif`]: GIF,
      [`${MEDIA}/dog/x.gif`]: GIF,
    },
  });
  assert.equal(await art.extensionMedia(), MEDIA);
});

test("extensionMedia takes the newest version across every editor's folder", async () => {
  const cursor = `${HOME}/.cursor/extensions/tonybaloney.vscode-pets-1.38.0/media`;
  const { art } = fake({ files: { [`${MEDIA}/dog/x.gif`]: GIF, [`${cursor}/dog/x.gif`]: GIF } });
  assert.equal(await art.extensionMedia(), cursor);
});

test("no extension is believed for a while, then looked for again", async () => {
  const { art, calls, clock, disk } = fake();
  assert.equal(await art.extensionMedia(), null);
  assert.equal(await art.extensionMedia(), null);
  assert.equal(calls.readdir, 4); // the four editor folders, one time
  disk.set(`${MEDIA}/dog/x.gif`, GIF); // the person installs vscode-pets
  clock.ms += 29000;
  assert.equal(await art.extensionMedia(), null);
  clock.ms += 2000;
  assert.equal(await art.extensionMedia(), MEDIA);
});

test("a found extension is remembered", async () => {
  const { art, calls, clock } = fake({ files: extensionWith(["dog/x.gif"]) });
  await art.extensionMedia();
  const looks = calls.readdir;
  clock.ms += 3600000;
  assert.equal(await art.extensionMedia(), MEDIA);
  assert.equal(calls.readdir, looks);
});

test("callers that ask during the lookup get the same answer, not an early null", async () => {
  const { art } = fake({ files: extensionWith(["dog/x.gif"]), slowReaddir: true });
  const answers = await Promise.all([art.extensionMedia(), art.extensionMedia(), art.extensionMedia()]);
  assert.deepEqual(answers, [MEDIA, MEDIA, MEDIA]);
});

test("loadPet copies from the extension, mirrors each sprite and records its size", async () => {
  const { art, disk, calls } = fake({ files: extensionWith(dogFiles("brown")) });
  const meta = await art.loadPet("dog", "brown");
  assert.deepEqual(Object.keys(meta.sprites).sort(), DOG);
  assert.deepEqual(meta.sprites.walk, {
    right: "data/pets/dog/brown_walk_8fps.gif",
    left: "data/pets/dog/brown_walk_8fps.left.gif",
    width: 3,
    height: 1,
  });
  assert.deepEqual([...decode(disk.get(`${CACHE}/dog/brown_walk_8fps.left.gif`)).frames[0].pixels], [3, 2, 1]);
  assert.ok(disk.has(`${CACHE}/dog/brown.json`));
  assert.equal(calls.curl.length, 0);
});

test("loadPet downloads from the pinned tag when there is no extension", async () => {
  const web = Object.fromEntries(dogFiles("brown").map((rel) => [url(rel), GIF]));
  const { art, disk, calls } = fake({ web });
  const meta = await art.loadPet("dog", "brown");
  assert.deepEqual(Object.keys(meta.sprites).sort(), DOG);
  assert.equal(calls.curl.length, 5);
  assert.ok(calls.curl[0].target.startsWith("https://raw.githubusercontent.com/tonybaloney/vscode-pets/1.37.0/media/dog/"));
  for (const call of calls.curl) {
    assert.equal(call.options.timeout, 90000);
    assert.equal(call.args[call.args.indexOf("--proto") + 1], "=https");
    assert.ok(call.args.includes("--max-time") && call.args.includes("--max-filesize"));
  }
  assert.deepEqual(leftovers(disk), []);
});

test("an animation upstream does not have is skipped, not an error", async () => {
  const web = Object.fromEntries(dogFiles("brown").filter((rel) => !rel.includes("swipe")).map((rel) => [url(rel), GIF]));
  const { art, disk } = fake({ web });
  const meta = await art.loadPet("dog", "brown");
  assert.deepEqual(Object.keys(meta.sprites).sort(), DOG.filter((l) => l !== "swipe"));
  assert.ok(!disk.has(`${CACHE}/dog/brown_swipe_8fps.gif`));
  assert.deepEqual(leftovers(disk), []);
});

test("a file the extension lacks comes from GitHub", async () => {
  const most = dogFiles("brown").filter((rel) => !rel.includes("lie"));
  const { art, calls } = fake({ files: extensionWith(most), web: { [url("dog/brown_lie_8fps.gif")]: GIF } });
  const meta = await art.loadPet("dog", "brown");
  assert.ok(meta.sprites.lie);
  assert.deepEqual(calls.curl.map((c) => c.target), [url("dog/brown_lie_8fps.gif")]);
});

test("a server error fails the pet and caches nothing", async () => {
  const web = Object.fromEntries(dogFiles("brown").map((rel) => [url(rel), 503]));
  const { art, disk } = fake({ web });
  await assert.rejects(art.loadPet("dog", "brown"), /Download failed \(HTTP 503\)/);
  assert.ok(!disk.has(`${CACHE}/dog/brown.json`));
  assert.deepEqual(leftovers(disk), []);
});

test("a dropped connection fails the pet and leaves no partial file", async () => {
  const web = Object.fromEntries(dogFiles("brown").map((rel) => [url(rel), "drop"]));
  const { art, disk } = fake({ web });
  await assert.rejects(art.loadPet("dog", "brown"), /Download failed \(curl 56\)/);
  assert.deepEqual([...disk.keys()], []);
});

test("without the extension and without curl the message names both", async () => {
  const { art } = fake({ curl: false });
  await assert.rejects(art.loadPet("dog", "brown"), /either vscode-pets installed in an editor, or curl/);
});

test("a pet that is only in the extension is refused without it, with no download", async () => {
  const { art, calls } = fake();
  await assert.rejects(art.loadPet("cat", "black"), /Needs the vscode-pets extension installed in an editor/);
  assert.equal(calls.curl.length, 0);
});

test("a downloaded file that is not a GIF fails the pet with a plain message", async () => {
  const web = Object.fromEntries(dogFiles("brown").map((rel) => [url(rel), new TextEncoder().encode("<html>hello</html>")]));
  const { art, disk } = fake({ web });
  await assert.rejects(art.loadPet("dog", "brown"), /The brown dog's "\w+" sprite is not a valid GIF/);
  assert.ok(!disk.has(`${CACHE}/dog/brown.json`));
});

test("a sprite that cannot be mirrored is used unflipped", async () => {
  const cut = GIF.subarray(0, GIF.length - 3); // size still reads; the frames do not
  const files = { ...extensionWith(dogFiles("brown")), [`${MEDIA}/dog/brown_walk_8fps.gif`]: cut };
  const { art } = fake({ files });
  const meta = await art.loadPet("dog", "brown");
  assert.equal(meta.sprites.walk.left, meta.sprites.walk.right);
  assert.notEqual(meta.sprites.idle.left, meta.sprites.idle.right);
});

test("a second loadPet uses the cache", async () => {
  const web = Object.fromEntries(dogFiles("brown").map((rel) => [url(rel), GIF]));
  const { art, calls } = fake({ web });
  const first = await art.loadPet("dog", "brown");
  assert.deepEqual(await art.loadPet("dog", "brown"), first);
  assert.equal(calls.curl.length, 5);
});

test("a cache with any file missing is rebuilt", async () => {
  const web = Object.fromEntries(dogFiles("brown").map((rel) => [url(rel), GIF]));
  const { art, disk, calls } = fake({ web });
  await art.loadPet("dog", "brown");
  disk.delete(`${CACHE}/dog/brown_lie_8fps.left.gif`);
  await art.loadPet("dog", "brown");
  assert.equal(calls.curl.length, 10);
  assert.ok(disk.has(`${CACHE}/dog/brown_lie_8fps.left.gif`));
});

test("two loads of the same pet at once both finish, with whole files and nothing left over", async () => {
  const web = Object.fromEntries(dogFiles("brown").map((rel) => [url(rel), GIF]));
  const { art, disk } = fake({ web });
  const [a, b] = await Promise.all([art.loadPet("dog", "brown"), art.loadPet("dog", "brown")]);
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a.sprites).sort(), DOG);
  for (const rel of dogFiles("brown")) assert.deepEqual(disk.get(`${CACHE}/${rel}`), GIF, rel);
  assert.deepEqual(leftovers(disk), []);
});

// The time limit turns "waits for ever" into a failure instead of a stuck test run.
test("a load that never finishes does not hold up the next one", { timeout: 3000 }, async () => {
  const web = Object.fromEntries(dogFiles("brown").map((rel) => [url(rel), "hang"]));
  const { art } = fake({ web });
  let settled = false;
  art.loadPet("dog", "brown").finally(() => { settled = true; }); // a dialog closed mid-download
  await new Promise((r) => setImmediate(r));
  for (const rel of dogFiles("brown")) web[url(rel)] = GIF;
  assert.deepEqual(Object.keys((await art.loadPet("dog", "brown")).sprites).sort(), DOG);
  assert.equal(settled, false);
});

test("a cache whose recorded sizes are not numbers is rebuilt", async () => {
  const web = Object.fromEntries(dogFiles("brown").map((rel) => [url(rel), GIF]));
  const { art, disk, calls } = fake({ web });
  const meta = await art.loadPet("dog", "brown");
  meta.sprites.walk.width = "wide";
  disk.set(`${CACHE}/dog/brown.json`, new TextEncoder().encode(JSON.stringify(meta)));
  assert.equal((await art.loadPet("dog", "brown")).sprites.walk.width, 3);
  assert.equal(calls.curl.length, 10);
});

test("a colour with a space is stored with an underscore", async () => {
  const labels = ["idle", "stand", "swipe", "walk", "walk_fast"];
  const { art, disk } = fake({ files: extensionWith(labels.map((l) => `horse/socks_black_${l}_8fps.gif`)) });
  const meta = await art.loadPet("horse", "socks black");
  assert.equal(meta.sprites.walk.right, "data/pets/horse/socks_black_walk_8fps.gif");
  assert.ok(disk.has(`${CACHE}/horse/socks_black.json`));
});

test("loadTheme returns both pictures with their sizes", async () => {
  const rels = ["backgrounds/forest/background-dark-nano.png", "backgrounds/forest/foreground-dark-nano.png"];
  const { art } = fake({ files: extensionWith(rels, PNG) });
  assert.deepEqual(await art.loadTheme("forest", true, "nano"), {
    background: { path: "data/pets/backgrounds/forest/background-dark-nano.png", width: 351, height: 300 },
    foreground: { path: "data/pets/backgrounds/forest/foreground-dark-nano.png", width: 351, height: 300 },
  });
});

test("loadTheme gives null for a picture the theme does not have", async () => {
  const { art } = fake({ web: { [url("backgrounds/library/background-light-small.png")]: PNG } });
  const scene = await art.loadTheme("library", false, "small");
  assert.equal(scene.foreground, null);
  assert.equal(scene.background.width, 351);
});

test("a theme download cut short is not kept, so the next try fetches it again", async () => {
  const rel = "backgrounds/forest/background-dark-nano.png";
  const web = { [url(rel)]: "drop" };
  const { art, disk, calls } = fake({ web });
  await assert.rejects(art.loadTheme("forest", true, "nano"), /Download failed/);
  assert.deepEqual([...disk.keys()], []);
  web[url(rel)] = PNG;
  const scene = await art.loadTheme("forest", true, "nano");
  assert.equal(scene.background.width, 351);
  assert.equal(calls.curl.filter((c) => c.target === url(rel)).length, 2);
});

test("a theme picture that is not a PNG is removed and reported plainly", async () => {
  const rel = "backgrounds/forest/background-dark-nano.png";
  const { art, disk } = fake({ web: { [url(rel)]: new TextEncoder().encode("<html>a page that is long enough</html>") } });
  await assert.rejects(art.loadTheme("forest", true, "nano"), /The forest theme's background picture is not a valid PNG/);
  assert.ok(!disk.has(`${CACHE}/${rel}`));
});

test("two loads of the same theme at once both get whole pictures", async () => {
  const rels = ["backgrounds/forest/background-dark-nano.png", "backgrounds/forest/foreground-dark-nano.png"];
  const { art, disk } = fake({ web: Object.fromEntries(rels.map((rel) => [url(rel), PNG])) });
  const [a, b] = await Promise.all([art.loadTheme("forest", true, "nano"), art.loadTheme("forest", true, "nano")]);
  assert.deepEqual(a, b);
  assert.equal(a.background.width, 351);
  for (const rel of rels) assert.deepEqual(disk.get(`${CACHE}/${rel}`), PNG, rel);
  assert.deepEqual(leftovers(disk), []);
});

test("a load that failed is tried again the next time", async () => {
  const web = Object.fromEntries(dogFiles("brown").map((rel) => [url(rel), 503]));
  const { art } = fake({ web });
  await assert.rejects(art.loadPet("dog", "brown"), /Download failed/);
  for (const rel of dogFiles("brown")) web[url(rel)] = GIF;
  assert.deepEqual(Object.keys((await art.loadPet("dog", "brown")).sprites).sort(), DOG);
});
