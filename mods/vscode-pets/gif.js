// Reads a GIF's size and writes a mirrored copy. Pure: bytes in, bytes out.
// Herdr's UI kit cannot flip an image, so left-facing sprites have to exist as files.
//
// Herdr stops a script that runs for about half a second without a break, and the
// stop cannot be caught. A big sprite (totoro's is 27 frames of 600 x 396) takes
// longer than that to mirror. So the work is written as steps: every function with a
// * yields after each SLICE pixels, flop() runs the steps straight through, and
// flopAsync() takes a breath between them.

const u16 = (b, p) => b[p] | (b[p + 1] << 8);
const tableLength = (packed) => (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
// Far beyond any sprite (the largest upstream one is 696 x 460). A frame claiming
// more is not decoded.
const MAX_PIXELS = 4_000_000;
// Pixels of work between two breaths: a few milliseconds in Herdr's script engine.
export const SLICE = 16384;

export function readSize(bytes) {
  if (bytes.length < 13 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) throw new Error("not a GIF");
  return { width: u16(bytes, 6), height: u16(bytes, 8) };
}

// Runs a stepped function to its end without a break.
function finish(steps) {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

// GIF data is cut into sub-blocks: a length byte, that many bytes, ... and a 0 to end.
function readSubBlocks(b, p) {
  const parts = [];
  let total = 0;
  while (p < b.length && b[p] !== 0) {
    parts.push(b.subarray(p + 1, p + 1 + b[p]));
    total += b[p];
    p += b[p] + 1;
  }
  if (p >= b.length) throw new Error("GIF data runs past the end of the file");
  const data = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { data.set(part, at); at += part.length; }
  return { data, end: p + 1 };
}

function subBlocks(data) {
  const out = new Uint8Array(data.length + Math.ceil(data.length / 255) + 1);
  let o = 0;
  for (let i = 0; i < data.length; i += 255) {
    const n = Math.min(255, data.length - i);
    out[o++] = n;
    out.set(data.subarray(i, i + n), o);
    o += n;
  }
  out[o++] = 0;
  return out.subarray(0, o);
}

function* lzwDecodeSteps(minCode, data, count) {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  const out = new Uint8Array(count);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let size = minCode + 1;
  let mask = (1 << size) - 1;
  let avail = clear + 2;
  let old = -1;
  let first = 0;
  let datum = 0;
  let bits = 0;
  let op = 0;
  let breath = SLICE;
  for (let p = 0; p < data.length; p++) {
    datum |= data[p] << bits;
    bits += 8;
    while (bits >= size) {
      let code = datum & mask;
      datum >>= size;
      bits -= size;
      if (code === clear) {
        size = minCode + 1;
        mask = (1 << size) - 1;
        avail = clear + 2;
        old = -1;
        continue;
      }
      if (code === eoi) {
        if (op < count) throw new Error("GIF image data ends early");
        return out;
      }
      // A code may name a colour, an entry already made, or the one being made now.
      // Anything else is corrupt, and following it would never end.
      if (code > avail || (old === -1 && code >= clear)) throw new Error("bad GIF image data");
      if (old === -1) {
        if (op < count) out[op++] = suffix[code];
        old = code;
        first = code;
        continue;
      }
      const incoming = code;
      let sp = 0;
      if (code >= avail) {
        stack[sp++] = first;
        code = old;
      }
      while (code >= clear) {
        stack[sp++] = suffix[code];
        code = prefix[code];
      }
      first = suffix[code];
      stack[sp++] = first;
      if (avail < 4096) {
        prefix[avail] = old;
        suffix[avail] = first;
        avail++;
        if ((avail & mask) === 0 && avail < 4096) {
          size++;
          mask = (1 << size) - 1;
        }
      }
      old = incoming;
      while (sp > 0 && op < count) out[op++] = stack[--sp];
    }
    if (op >= breath) {
      breath = op + SLICE;
      yield;
    }
  }
  if (op < count) throw new Error("GIF image data ends early");
  return out;
}

// The writer's table of (code so far, next pixel) -> code, as two flat arrays:
// much quicker in Herdr's script engine than a Map.
const SLOTS = 8192; // a power of two, twice the 4096 codes there can be
function* lzwEncodeSteps(minCode, pixels) {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  // A code is at most 12 bits and there is at most one per pixel, plus the two ends.
  const out = new Uint8Array(pixels.length * 2 + 16);
  const keys = new Int32Array(SLOTS).fill(-1);
  const codes = new Uint16Array(SLOTS);
  let o = 0;
  let size = minCode + 1;
  let next = eoi + 1;
  let datum = 0;
  let bits = 0;
  const emit = (code) => {
    datum |= code << bits;
    bits += size;
    while (bits >= 8) {
      out[o++] = datum & 255;
      datum >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  if (pixels.length > 0) {
    let cur = pixels[0];
    for (let i = 1; i < pixels.length; i++) {
      const px = pixels[i];
      const key = (cur << 8) | px;
      let slot = (Math.imul(key, 0x9e3779b1) >>> 19) & (SLOTS - 1);
      while (keys[slot] !== -1 && keys[slot] !== key) slot = (slot + 1) & (SLOTS - 1);
      if (keys[slot] === key) {
        cur = codes[slot];
      } else {
        emit(cur);
        if (next < 4096) {
          keys[slot] = key;
          codes[slot] = next++;
          // The reader grows its code size one code later than the writer adds an entry.
          if (next > 1 << size && size < 12) size++;
        } else {
          emit(clear);
          keys.fill(-1);
          size = minCode + 1;
          next = eoi + 1;
        }
        cur = px;
      }
      if (i % SLICE === 0) yield;
    }
    emit(cur);
  }
  emit(eoi);
  if (bits > 0) out[o++] = datum & 255;
  return out.subarray(0, o);
}

export const lzwDecode = (minCode, data, count) => finish(lzwDecodeSteps(minCode, data, count));
export const lzwEncode = (minCode, pixels) => finish(lzwEncodeSteps(minCode, pixels));

// Interlaced frames store rows 0,8,16.. then 4,12.. then 2,6,10.. then 1,3,5..
function deinterlace(px, w, h) {
  const out = new Uint8Array(px.length);
  let row = 0;
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
    for (let y = start; y < h; y += step) {
      out.set(px.subarray(row * w, row * w + w), y * w);
      row++;
    }
  }
  return out;
}

// Walks the file: { width, height, headEnd, blocks }, each block either
// { ext: [start, end] } (copied through as is) or a decoded image.
function* parseSteps(bytes) {
  const { width, height } = readSize(bytes);
  let p = 13 + tableLength(bytes[10]);
  const headEnd = p;
  const blocks = [];
  for (;;) {
    if (p >= bytes.length) throw new Error("GIF ended without a trailer");
    const kind = bytes[p];
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      let q = p + 2;
      while (q < bytes.length && bytes[q] !== 0) q += bytes[q] + 1;
      if (q >= bytes.length) throw new Error("GIF extension runs past the end of the file");
      blocks.push({ ext: [p, q + 1] });
      p = q + 1;
      continue;
    }
    if (kind !== 0x2c) throw new Error(`unknown GIF block 0x${kind.toString(16)} at byte ${p}`);
    if (p + 11 > bytes.length) throw new Error("GIF ended inside an image header");
    const left = u16(bytes, p + 1);
    const top = u16(bytes, p + 3);
    const w = u16(bytes, p + 5);
    const h = u16(bytes, p + 7);
    const packed = bytes[p + 9];
    if (w * h > MAX_PIXELS) throw new Error("GIF frame is too large");
    const table = [p + 10, p + 10 + tableLength(packed)];
    const minCode = bytes[table[1]];
    if (!(minCode >= 2 && minCode <= 8)) throw new Error(`bad GIF code size ${minCode}`);
    const { data, end } = readSubBlocks(bytes, table[1] + 1);
    let pixels = yield* lzwDecodeSteps(minCode, data, w * h);
    if (packed & 0x40) pixels = deinterlace(pixels, w, h);
    blocks.push({ left, top, width: w, height: h, packed, table, minCode, pixels });
    p = end;
    yield;
  }
  return { width, height, headEnd, blocks };
}

// The frames as palette indexes, for tests and debugging.
export function decode(bytes) {
  const g = finish(parseSteps(bytes));
  return {
    width: g.width,
    height: g.height,
    frames: g.blocks.filter((b) => !b.ext).map(({ left, top, width, height, pixels }) => ({ left, top, width, height, pixels })),
  };
}

// The same animation, mirrored left to right, as steps. Colours, delays, disposal,
// transparency and looping are copied through untouched.
export function* flopSteps(bytes) {
  const g = yield* parseSteps(bytes);
  const parts = [bytes.subarray(0, g.headEnd)];
  for (const b of g.blocks) {
    if (b.ext) {
      parts.push(bytes.subarray(b.ext[0], b.ext[1]));
      continue;
    }
    const { width: w, height: h, pixels } = b;
    for (let y = 0; y < h; y++) pixels.subarray(y * w, y * w + w).reverse();
    const left = Math.max(0, g.width - b.left - w);
    parts.push(Uint8Array.from([
      0x2c, left & 255, left >> 8, b.top & 255, b.top >> 8, w & 255, w >> 8, h & 255, h >> 8,
      b.packed & ~0x40, // rows are written in order now
    ]));
    parts.push(bytes.subarray(b.table[0], b.table[1]));
    parts.push(Uint8Array.from([b.minCode]));
    parts.push(subBlocks(yield* lzwEncodeSteps(b.minCode, pixels)));
    yield;
  }
  parts.push(Uint8Array.from([0x3b]));
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

// For small files and for tests: straight through, no breaks.
export const flop = (bytes) => finish(flopSteps(bytes));

// For use inside Herdr: `breathe` is awaited between slices. It must hand control
// back to the app (any real asynchronous call does), or a big sprite is cut off.
export async function flopAsync(bytes, breathe) {
  const steps = flopSteps(bytes);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    await breathe();
  }
}
