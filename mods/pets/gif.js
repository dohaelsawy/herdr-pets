// Reads a GIF's size and writes a mirrored copy. Pure: bytes in, bytes out.
// Herdr's UI kit cannot flip an image, so left-facing sprites have to exist as files.

const u16 = (b, p) => b[p] | (b[p + 1] << 8);
// Far beyond any sprite (the largest upstream one is 696 x 460). A frame claiming
// more is not decoded: this code runs on Herdr's own thread.
const MAX_PIXELS = 4_000_000;
const tableLength = (packed) => (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);

export function readSize(bytes) {
  if (bytes.length < 13 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) throw new Error("not a GIF");
  return { width: u16(bytes, 6), height: u16(bytes, 8) };
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

function writeSubBlocks(out, data) {
  for (let i = 0; i < data.length; i += 255) {
    const n = Math.min(255, data.length - i);
    out.push(n);
    for (let j = 0; j < n; j++) out.push(data[i + j]);
  }
  out.push(0);
}

export function lzwDecode(minCode, data, count) {
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
  }
  if (op < count) throw new Error("GIF image data ends early");
  return out;
}

export function lzwEncode(minCode, pixels) {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const out = [];
  let size = minCode + 1;
  let next = eoi + 1;
  let datum = 0;
  let bits = 0;
  let table = new Map();
  const emit = (code) => {
    datum |= code << bits;
    bits += size;
    while (bits >= 8) {
      out.push(datum & 255);
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
      const hit = table.get(key);
      if (hit !== undefined) {
        cur = hit;
        continue;
      }
      emit(cur);
      if (next < 4096) {
        table.set(key, next++);
        // The reader grows its code size one code later than the writer adds an entry.
        if (next > 1 << size && size < 12) size++;
      } else {
        emit(clear);
        table = new Map();
        size = minCode + 1;
        next = eoi + 1;
      }
      cur = px;
    }
    emit(cur);
  }
  emit(eoi);
  if (bits > 0) out.push(datum & 255);
  return Uint8Array.from(out);
}

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
function parse(bytes) {
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
    let pixels = lzwDecode(minCode, data, w * h);
    if (packed & 0x40) pixels = deinterlace(pixels, w, h);
    blocks.push({ left, top, width: w, height: h, packed, table, minCode, pixels });
    p = end;
  }
  return { width, height, headEnd, blocks };
}

// The frames as palette indexes, for tests and debugging.
export function decode(bytes) {
  const g = parse(bytes);
  return {
    width: g.width,
    height: g.height,
    frames: g.blocks.filter((b) => !b.ext).map(({ left, top, width, height, pixels }) => ({ left, top, width, height, pixels })),
  };
}

// The same animation, mirrored left to right. Colours, delays, disposal,
// transparency and looping are copied through untouched.
export function flop(bytes) {
  const g = parse(bytes);
  const out = [];
  const copy = (from, to) => { for (let i = from; i < to; i++) out.push(bytes[i]); };
  const put16 = (v) => out.push(v & 255, (v >> 8) & 255);
  copy(0, g.headEnd);
  for (const b of g.blocks) {
    if (b.ext) {
      copy(b.ext[0], b.ext[1]);
      continue;
    }
    const { width: w, height: h, pixels } = b;
    for (let y = 0; y < h; y++) pixels.subarray(y * w, y * w + w).reverse();
    out.push(0x2c);
    put16(Math.max(0, g.width - b.left - w));
    put16(b.top);
    put16(w);
    put16(h);
    out.push(b.packed & ~0x40); // rows are written in order now
    copy(b.table[0], b.table[1]);
    out.push(b.minCode);
    writeSubBlocks(out, lzwEncode(b.minCode, pixels));
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}
