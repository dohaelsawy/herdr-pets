import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readSize, decode, flop, lzwEncode, lzwDecode } from "../mods/pets/gif.js";
import { makeGif, controlBlocks, gifWithImageData } from "./helpers.mjs";

const PALETTE = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]];

test("readSize reads the logical screen size", () => {
  const gif = makeGif({ width: 5, height: 3, palette: PALETTE, frames: [{ pixels: new Array(15).fill(1) }] });
  assert.deepEqual(readSize(gif), { width: 5, height: 3 });
});

test("readSize rejects a file that is not a GIF", () => {
  assert.throws(() => readSize(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])), /not a GIF/);
});

test("LZW round-trips data long enough to reset its table", () => {
  const pixels = new Uint8Array(60000);
  let seed = 7;
  for (let i = 0; i < pixels.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = (seed >> 16) & 3;
  }
  assert.deepEqual(lzwDecode(2, lzwEncode(2, pixels), pixels.length), pixels);
});

test("flop mirrors each row", () => {
  const gif = makeGif({ width: 3, height: 2, palette: PALETTE, frames: [{ pixels: [1, 2, 3, 0, 1, 2] }] });
  assert.deepEqual([...decode(flop(gif)).frames[0].pixels], [3, 2, 1, 2, 1, 0]);
});

test("flop moves a frame that covers part of the screen to the mirrored side", () => {
  const gif = makeGif({
    width: 10, height: 4, palette: PALETTE,
    frames: [{ pixels: new Array(40).fill(0) }, { left: 1, top: 2, width: 3, height: 1, pixels: [1, 2, 3] }],
  });
  const f = decode(flop(gif)).frames[1];
  assert.deepEqual({ left: f.left, top: f.top, width: f.width, height: f.height }, { left: 6, top: 2, width: 3, height: 1 });
  assert.deepEqual([...f.pixels], [3, 2, 1]);
});

test("flopping twice gives back the original frames", () => {
  const gif = makeGif({
    width: 6, height: 5, palette: PALETTE,
    frames: [
      { pixels: Array.from({ length: 30 }, (_, i) => i % 4) },
      { left: 2, top: 1, width: 3, height: 3, pixels: [1, 1, 2, 3, 0, 0, 2, 2, 1], delay: 30, transparent: 0 },
    ],
  });
  assert.deepEqual(decode(flop(flop(gif))), decode(gif));
});

test("flop keeps delays, transparency and looping", () => {
  const gif = makeGif({
    width: 2, height: 1, palette: PALETTE,
    frames: [{ pixels: [1, 2], delay: 12 }, { pixels: [2, 1], delay: 40, transparent: 3 }],
  });
  const out = flop(gif);
  assert.deepEqual(controlBlocks(out), controlBlocks(gif));
  assert.ok(Buffer.from(out).includes("NETSCAPE2.0"));
});

test("flop reads an interlaced frame and writes it in row order", () => {
  const pixels = Array.from({ length: 4 * 9 }, (_, i) => (i + Math.floor(i / 4)) % 4);
  const plain = makeGif({ width: 4, height: 9, palette: PALETTE, frames: [{ pixels }] });
  const laced = makeGif({ width: 4, height: 9, palette: PALETTE, frames: [{ pixels, interlaced: true }] });
  assert.deepEqual(decode(laced), decode(plain));
  assert.deepEqual(decode(flop(laced)), decode(flop(plain)));
});

test("flop rejects a truncated file", () => {
  const gif = makeGif({ width: 2, height: 1, palette: PALETTE, frames: [{ pixels: [1, 2] }] });
  assert.throws(() => flop(gif.subarray(0, gif.length - 3)));
});

test("flop handles 256 colours and image data longer than one block", () => {
  const palette = Array.from({ length: 256 }, (_, i) => [i, 255 - i, (i * 7) % 256]);
  let seed = 3;
  const pixels = Array.from({ length: 64 * 48 }, () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed >> 16) & 255;
  });
  const gif = makeGif({ width: 64, height: 48, palette, frames: [{ pixels }] });
  assert.ok(gif.length > 1000); // far past one 255-byte block
  const out = decode(flop(gif));
  assert.deepEqual([...out.frames[0].pixels.subarray(0, 64)], pixels.slice(0, 64).reverse());
  assert.deepEqual(decode(flop(flop(gif))), decode(gif));
});

// Codes are 3 bits wide here: 4 is "clear", 5 is "end", 6 is the first free code.
const pack3 = (...codes) => {
  let datum = 0, bits = 0;
  const out = [];
  for (const c of codes) { datum |= c << bits; bits += 3; while (bits >= 8) { out.push(datum & 255); datum >>= 8; bits -= 8; } }
  if (bits > 0) out.push(datum & 255);
  return out;
};

test("image data that names a code not yet defined is rejected, not looped on", () => {
  // After "clear, 0" the only code that may follow is 0..3 or 6; 7 points at nothing.
  const bad = gifWithImageData({ width: 4, height: 4, data: pack3(4, 0, 7, 7, 7, 7, 7, 7) });
  assert.throws(() => flop(bad), /bad GIF image data/);
  // A first code that is not a plain colour is just as meaningless.
  assert.throws(() => flop(gifWithImageData({ width: 4, height: 4, data: pack3(4, 6, 0) })), /bad GIF image data/);
});

test("image data that ends before the frame is full is rejected", () => {
  const short = gifWithImageData({ width: 4, height: 4, data: pack3(4, 1, 2, 5) }); // 2 of 16 pixels
  assert.throws(() => flop(short), /GIF image data ends early/);
});

test("a frame far larger than any sprite is rejected before decoding", () => {
  const huge = gifWithImageData({ width: 5000, height: 5000, data: pack3(4, 1, 5) });
  assert.throws(() => flop(huge), /GIF frame is too large/);
});

test("a file cut inside an image header says so", () => {
  const gif = makeGif({ width: 2, height: 1, palette: PALETTE, frames: [{ pixels: [1, 2] }], loop: false });
  const at = gif.indexOf(0x2c, 13 + 12); // the image descriptor, after the header and palette
  assert.throws(() => flop(gif.subarray(0, at + 4)), /GIF ended inside an image header/);
});

// Runs only on a machine with vscode-pets installed; the art is read, never copied here.
async function installedMedia() {
  for (const dir of [".vscode", ".vscode-insiders", ".cursor", ".vscode-oss"]) {
    const ext = join(homedir(), dir, "extensions");
    const found = (await readdir(ext).catch(() => [])).filter((n) => n.startsWith("tonybaloney.vscode-pets-")).sort();
    if (found.length) return join(ext, found.at(-1), "media");
  }
  return null;
}

test("flop round-trips every sprite of an installed vscode-pets", async (t) => {
  const media = await installedMedia();
  if (!media) return t.skip("vscode-pets is not installed");
  let count = 0;
  for (const type of await readdir(media, { withFileTypes: true })) {
    if (!type.isDirectory()) continue;
    for (const name of await readdir(join(media, type.name))) {
      if (!name.endsWith(".gif")) continue;
      const bytes = new Uint8Array(await readFile(join(media, type.name, name)));
      assert.deepEqual(decode(flop(flop(bytes))), decode(bytes), `${type.name}/${name}`);
      count++;
    }
  }
  assert.ok(count > 0);
});
