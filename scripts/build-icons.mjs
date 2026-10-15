#!/usr/bin/env node
/**
 * Draws the Traceback icon and writes:
 *   extension/icons/icon.svg, icon-16.png, icon-32.png, icon-48.png, icon-128.png
 *   public/favicon.svg
 *
 * Chrome and Brave reject SVG extension icons, so the PNGs are rasterised
 * here with 4×4 supersampling and encoded with node:zlib. No dependencies.
 *
 *   node scripts/build-icons.mjs          write the files
 *   node scripts/build-icons.mjs --check  fail if the committed files are stale
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SIZES = [16, 32, 48, 128];
const VIEWBOX = 128;
const RADIUS = 30;
const BACKGROUND = [0x6e, 0xe7, 0xc6];
const FOREGROUND = [0x07, 0x10, 0x16];
const BOLT = [
  [74, 17],
  [39, 70],
  [64, 70],
  [54, 111],
  [89, 56],
  [64, 56],
];
const SAMPLES = 4;

const hex = (rgb) => `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}"><rect width="${VIEWBOX}" height="${VIEWBOX}" rx="${RADIUS}" fill="${hex(BACKGROUND)}"/><path d="M${BOLT.map(([x, y]) => `${x} ${y}`).join('L')}Z" fill="${hex(FOREGROUND)}"/></svg>\n`;

function insideRoundedRect(x, y) {
  if (x < 0 || y < 0 || x > VIEWBOX || y > VIEWBOX) return false;
  const cx = Math.min(Math.max(x, RADIUS), VIEWBOX - RADIUS);
  const cy = Math.min(Math.max(y, RADIUS), VIEWBOX - RADIUS);
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function rasterise(size) {
  const scale = VIEWBOX / size;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let background = 0;
      let foreground = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) * scale;
          const y = (py + (sy + 0.5) / SAMPLES) * scale;
          if (!insideRoundedRect(x, y)) continue;
          if (insidePolygon(x, y, BOLT)) foreground += 1;
          else background += 1;
        }
      }
      const covered = background + foreground;
      if (!covered) continue;
      const offset = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        rgba[offset + channel] = Math.round((BACKGROUND[channel] * background + FOREGROUND[channel] * foreground) / covered);
      }
      rgba[offset + 3] = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return rgba;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outputs = new Map([
  ['extension/icons/icon.svg', Buffer.from(SVG)],
  ['public/favicon.svg', Buffer.from(SVG)],
  ...SIZES.map((size) => [`extension/icons/icon-${size}.png`, encodePng(size, rasterise(size))]),
]);

const check = process.argv.includes('--check');
const stale = [];
for (const [relative, content] of outputs) {
  const path = `${ROOT}${relative}`;
  if (check) {
    let current;
    try {
      current = readFileSync(path);
    } catch {
      current = undefined;
    }
    if (!current || !current.equals(content)) stale.push(relative);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`wrote ${relative} (${content.length} bytes)`);
}

if (check) {
  if (stale.length) {
    console.error(`Icons are out of date: ${stale.join(', ')}\nRun: npm run icons`);
    process.exit(1);
  }
  console.log('Icons are up to date.');
}
