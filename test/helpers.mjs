// Builds small GIFs in code, so the tests ship no art.
import { lzwEncode } from "../mods/vscode-pets/gif.js";

const le16 = (v) => [v & 255, (v >> 8) & 255];

function subBlocks(data) {
  const out = [];
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.subarray(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

function interlace(pixels, w, h) {
  const out = new Uint8Array(pixels.length);
  let row = 0;
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
    for (let y = start; y < h; y += step) {
      out.set(pixels.subarray(y * w, y * w + w), row * w);
      row++;
    }
  }
  return out;
}

// palette: [[r,g,b], ...] with 2, 4, 8 ... 256 entries. frames: { left, top, width, height,
// pixels (palette indexes, row by row), delay (1/100 s), transparent (index), interlaced }.
export function makeGif({ width, height, palette, frames, loop = true }) {
  const bits = Math.log2(palette.length);
  if (!Number.isInteger(bits) || bits < 1 || bits > 8) throw new Error("makeGif wants 2, 4, 8 ... 256 colours");
  const minCode = Math.max(2, bits);
  const out = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le16(width), ...le16(height), 0x80 | (bits - 1), 0, 0];
  for (const [r, g, b] of palette) out.push(r, g, b);
  if (loop) out.push(0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0);
  for (const f of frames) {
    const hasAlpha = f.transparent !== undefined;
    out.push(0x21, 0xf9, 4, (2 << 2) | (hasAlpha ? 1 : 0), ...le16(f.delay ?? 12), hasAlpha ? f.transparent : 0, 0);
    const fw = f.width ?? width;
    const fh = f.height ?? height;
    out.push(0x2c, ...le16(f.left ?? 0), ...le16(f.top ?? 0), ...le16(fw), ...le16(fh), f.interlaced ? 0x40 : 0);
    const px = Uint8Array.from(f.pixels);
    out.push(minCode, ...subBlocks(lzwEncode(minCode, f.interlaced ? interlace(px, fw, fh) : px)));
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}

// A one-frame GIF whose image data is the given raw bytes, for malformed-data tests.
export function gifWithImageData({ width, height, minCode = 2, data }) {
  const out = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le16(width), ...le16(height), 0x80 | 1, 0, 0];
  out.push(0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255);
  out.push(0x2c, ...le16(0), ...le16(0), ...le16(width), ...le16(height), 0, minCode, ...subBlocks(Uint8Array.from(data)), 0x3b);
  return Uint8Array.from(out);
}

// Every Graphic Control Extension's bytes, in order: delays, disposal, transparency.
export function controlBlocks(bytes) {
  const found = [];
  for (let i = 0; i + 7 < bytes.length; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 4 && bytes[i + 7] === 0) {
      found.push([...bytes.subarray(i + 3, i + 7)]);
    }
  }
  return found;
}

// A random source that replays the given numbers, then repeats the last one.
export function seq(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}
