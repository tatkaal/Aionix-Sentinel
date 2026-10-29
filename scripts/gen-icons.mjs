// Renders the official Aonix mark (assets/brand/aonix-mark.svg) into the MV3 icon sizes.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const mark = readFileSync(resolve(root, 'assets/brand/aonix-mark.svg'), 'utf8');
const inner = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const outDir = resolve(root, 'assets/icons');
mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  // Toolbar sizes are transparent; store/management sizes sit on an obsidian tile for contrast.
  const tile = size >= 48;
  const pad = tile ? 0.2 : 0.04;
  const w = 327;
  const h = 255;
  const box = Math.max(w, h) / (1 - pad * 2);
  const ox = (box - w) / 2;
  const oy = (box - h) / 2;
  const bg = tile ? `<rect width="${box}" height="${box}" rx="${box * 0.22}" fill="#090A10"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}">${bg}<g transform="translate(${ox} ${oy})">${inner}</g></svg>`;
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(resolve(outDir, `icon-${size}.png`), png);
  console.log(`icon-${size}.png`);
}
