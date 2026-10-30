// Builds the Manifest V3 extension into dist-extension/ (or dist-extension-test/ with --test).
// Content scripts are classic IIFE bundles (MV3 content scripts cannot be ES modules);
// the service worker, popup and offscreen document are ES modules. Output is unminified
// so reviewers (and the Workbench Source view) can read exactly what ships.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const isTest = process.argv.includes('--test');
const outDir = resolve(root, isTest ? 'dist-extension-test' : 'dist-extension');
const extSrc = resolve(root, 'src/extension');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const define = {
  'process.env.NODE_ENV': JSON.stringify('production'),
  __AIONIX_TEST_BUILD__: JSON.stringify(isTest),
};

const base = {
  configFile: false,
  root,
  logLevel: 'warn',
  define,
  publicDir: false,
};

// 1) Classic content scripts — one IIFE bundle each, no code splitting.
const iifeEntries = [
  ['content-script', resolve(extSrc, 'content/content-script.ts')],
  ['main-world-interceptor', resolve(extSrc, 'main-world-interceptor.ts')],
];
for (const [name, entry] of iifeEntries) {
  await build({
    ...base,
    build: {
      outDir,
      emptyOutDir: false,
      minify: false,
      target: 'es2022',
      lib: { entry, formats: ['iife'], name: `Aionix_${name.replace(/-/g, '_')}`, fileName: () => `${name}.js` },
    },
  });
}

// 2) ES-module surfaces: service worker, popup, offscreen document.
await build({
  ...base,
  root: extSrc,
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir,
    emptyOutDir: false,
    minify: false,
    target: 'es2022',
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(extSrc, 'popup.html'),
        'offscreen-onnx-worker': resolve(extSrc, 'offscreen.html'),
        'background-sw': resolve(extSrc, 'background-sw.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});

// 3) Manifest (test builds also match the local Playwright fixture server).
const manifest = JSON.parse(readFileSync(resolve(extSrc, 'manifest.json'), 'utf8'));
if (isTest) {
  const local = 'http://localhost:4173/*';
  for (const cs of manifest.content_scripts) cs.matches.push(local);
  manifest.host_permissions.push(local);
  manifest.name += ' (test build)';
}
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 4) Runtime assets: engine binaries, MiniLM, ONNX Runtime wasm (local => zero remote code), icons.
const copies = [
  ['assets/engine', 'engine'],
  ['assets/models', 'models'],
  ['assets/ort', 'ort'],
  ['assets/icons', 'icons'],
];
for (const [from, to] of copies) {
  const src = resolve(root, from);
  if (existsSync(src)) cpSync(src, resolve(outDir, to), { recursive: true });
  else console.warn(`[build-extension] missing ${from} — run "npm run setup" first`);
}

// 5) Fixed-name brand fonts so the Shadow DOM drawer can register them via FontFace.
const fonts = [
  ['plus-jakarta-sans', 'plus-jakarta-sans-latin-wght-normal.woff2'],
  ['dm-sans', 'dm-sans-latin-wght-normal.woff2'],
  ['jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2'],
];
mkdirSync(resolve(outDir, 'fonts'), { recursive: true });
for (const [pkg, file] of fonts) {
  cpSync(resolve(root, 'node_modules/@fontsource-variable', pkg, 'files', file), resolve(outDir, 'fonts', `${pkg}.woff2`));
}

console.log(`[build-extension] ${isTest ? 'test ' : ''}build written to ${outDir}`);
