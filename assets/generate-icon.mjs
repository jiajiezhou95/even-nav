// Original Even Nav route-and-forward-arrow mark. No external artwork.
// CLI 0.2.0: 24x24 PNG, <=1 MiB, transparent or opaque #F4F4F4,
// with lit pixels consumed as complete 2x2 blocks in raster order.
import sharp from 'sharp';
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const grid = [
  '............',
  '.....##.....',
  '....####....',
  '...######...',
  '..########..',
  '.....##.....',
  '.....##.....',
  '..#####.....',
  '..#####.....',
  '..##........',
  '..##........',
  '............',
];
const pixels = Buffer.alloc(24 * 24 * 4);
const rectangles = [];
for (let y = 0; y < 12; y++) {
  assert.equal(grid[y].length, 12);
  for (let x = 0; x < 12; x++) if (grid[y][x] === '#') {
    rectangles.push(`<rect x="${x * 2}" y="${y * 2}" width="2" height="2"/>`);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const offset = ((y * 2 + dy) * 24 + x * 2 + dx) * 4;
      pixels.set([244, 244, 244, 255], offset);
    }
  }
}
const pngPath = fileURLToPath(new URL('./even-nav-icon.png', import.meta.url));
await sharp(pixels, { raw: { width: 24, height: 24, channels: 4 } })
  .png({ compressionLevel: 9, palette: false }).toFile(pngPath);
await writeFile(new URL('./even-nav-icon.svg', import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" shape-rendering="crispEdges"><title>Even Nav</title><desc>Original route turning toward a forward navigation arrow</desc><g fill="#f4f4f4">${rectangles.join('')}</g></svg>\n`);

// Decode the written artifact, independently validating the CLI's pixel rules.
const encoded = await readFile(pngPath);
assert.ok(encoded.length <= 1024 * 1024);
const { data, info } = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
assert.equal(info.width, 24); assert.equal(info.height, 24);
const lit = new Uint8Array(576), consumed = new Uint8Array(576);
for (let index = 0; index < 576; index++) {
  const rgba = [...data.subarray(index * 4, index * 4 + 4)];
  if (rgba[3] === 0) continue;
  assert.deepEqual(rgba, [244, 244, 244, 255], `Invalid pixel ${index % 24},${Math.floor(index / 24)}`);
  lit[index] = 1;
}
let blocks = 0;
for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
  const index = y * 24 + x;
  if (!lit[index] || consumed[index]) continue;
  assert.ok(x < 23 && y < 23 && lit[index + 1] && lit[index + 24] && lit[index + 25], `Incomplete block at ${x},${y}`);
  for (const p of [index, index + 1, index + 24, index + 25]) consumed[p] = 1;
  blocks++;
}
console.log(JSON.stringify({ status: 'PASS', path: pngPath, width: info.width, height: info.height, bytes: encoded.length, litPixels: lit.reduce((a, b) => a + b, 0), blocks }));
