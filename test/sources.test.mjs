import { test } from "node:test";
import assert from "node:assert/strict";
import { newestExtension, spriteName, leftName, rawUrl, themeFiles, fit, pngSize, EXTENSION_ONLY } from "../mods/pets/sources.js";
import { TYPES } from "../mods/pets/pets.js";

test("newestExtension compares versions as numbers", () => {
  const names = ["ms-python.python-2024.1.0", "tonybaloney.vscode-pets-1.9.0", "tonybaloney.vscode-pets-1.37.0", "tonybaloney.vscode-pets-1.36.2"];
  assert.equal(newestExtension(names), "tonybaloney.vscode-pets-1.37.0");
  assert.equal(newestExtension(["ms-python.python-2024.1.0"]), null);
  assert.equal(newestExtension([]), null);
});

test("spriteName follows upstream's file names", () => {
  assert.equal(spriteName("brown", "walk"), "brown_walk_8fps.gif");
  assert.equal(spriteName("socks black", "walk_fast"), "socks_black_walk_fast_8fps.gif");
  assert.equal(spriteName("brown_tabby", "wallclimb"), "brown_tabby_wallclimb_8fps.gif");
});

test("leftName names the mirrored copy", () => {
  assert.equal(leftName("brown_walk_8fps.gif"), "brown_walk_8fps.left.gif");
});

test("rawUrl points at the pinned tag", () => {
  assert.equal(rawUrl("1.37.0", "dog/brown_walk_8fps.gif"), "https://raw.githubusercontent.com/tonybaloney/vscode-pets/1.37.0/media/dog/brown_walk_8fps.gif");
  assert.equal(rawUrl("1.37.0", "rubber-duck/a b.gif"), "https://raw.githubusercontent.com/tonybaloney/vscode-pets/1.37.0/media/rubber-duck/a%20b.gif");
});

test("themeFiles names the two pictures for a size and appearance", () => {
  assert.deepEqual(themeFiles("forest", true, "nano"), {
    background: "backgrounds/forest/background-dark-nano.png",
    foreground: "backgrounds/forest/foreground-dark-nano.png",
  });
  assert.equal(themeFiles("beach", false, "large").background, "backgrounds/beach/background-light-large.png");
});

test("fit shrinks into the box and never enlarges", () => {
  assert.deepEqual(fit(174, 115, 30), { w: 30, h: 20 });
  assert.deepEqual(fit(65, 115, 55), { w: 31, h: 55 });
  assert.deepEqual(fit(52, 52, 110), { w: 52, h: 52 });
});

test("pngSize reads the header and rejects other files", () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set([0, 0, 1, 0x5f], 16); // 351
  png.set([0, 0, 1, 0x2c], 20); // 300
  assert.deepEqual(pngSize(png), { width: 351, height: 300 });
  assert.throws(() => pngSize(new Uint8Array(24)), /not a PNG/);
});

test("the extension-only pets are real pet types", () => {
  for (const type of EXTENSION_ONLY) assert.ok(TYPES.includes(type), type);
});
