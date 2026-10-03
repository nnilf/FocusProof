// Generates resources/icon.ico and resources/icon.png (the FocusProof mark) with no dependencies.
//   node scripts/make-icon.mjs
// Geometry matches src/renderer/app/components/Logo.tsx, on a dark rounded tile.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
const TILE = [17, 18, 20];
const GREEN = [25, 158, 112];

/** RGBA pixels, top row first. Coordinates are in the 64-unit logo space. */
function render(size) {
  const px = 64 / size;
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4; // supersamples per axis
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tile = 0;
      let mark = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) * px;
          const v = (y + (sy + 0.5) / SS) * px;
          // Rounded square 0..64, corner radius 14.
          const qx = Math.max(Math.abs(u - 32) - 18, 0);
          const qy = Math.max(Math.abs(v - 32) - 18, 0);
          tile += Math.hypot(qx, qy) <= 14 ? 1 : 0;
          const r = Math.hypot(u - 32, v - 32);
          mark += Math.abs(r - 18) <= 2.5 || r <= 7 ? 1 : 0;
        }
      }
      tile /= SS * SS;
      mark /= SS * SS;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) buf[i + c] = Math.round(GREEN[c] * mark + TILE[c] * (1 - mark));
      buf[i + 3] = Math.round(255 * tile);
    }
  }
  return buf;
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function png(size) {
  const rgba = render(size);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ICO frames: BMP for small sizes (widest compatibility), PNG for 256.
function bmp(size) {
  const rgba = render(size);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // colour + mask height
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = ((size - 1 - y) * size + x) * 4; // bottom-up, BGRA
      pixels[d] = rgba[s + 2];
      pixels[d + 1] = rgba[s + 1];
      pixels[d + 2] = rgba[s];
      pixels[d + 3] = rgba[s + 3];
    }
  }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size); // all zero: alpha channel is used
  return Buffer.concat([header, pixels, mask]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = sizes.map((s) => (s === 256 ? png(s) : bmp(s)));
const dir = Buffer.alloc(6 + 16 * sizes.length);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(sizes.length, 4);
let offset = dir.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  dir[e] = s === 256 ? 0 : s;
  dir[e + 1] = s === 256 ? 0 : s;
  dir.writeUInt16LE(1, e + 4);
  dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(frames[i].length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += frames[i].length;
});

writeFileSync(join(out, 'icon.ico'), Buffer.concat([dir, ...frames]));
writeFileSync(join(out, 'icon.png'), png(256));
console.log('Wrote resources/icon.ico and resources/icon.png');
