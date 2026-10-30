// Fetches the locally bundled model (MiniLM-L6 INT8) and copies the ONNX Runtime wasm binaries
// into assets/ so both the extension and the Workbench load them from their own origin
// (zero remote code). Path B weights (openai/privacy-filter) are data fetched at runtime instead.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const modelDir = resolve(root, 'assets/models/all-MiniLM-L6-v2');
const ortDir = resolve(root, 'assets/ort');
mkdirSync(modelDir, { recursive: true });
mkdirSync(ortDir, { recursive: true });

const downloads = [
  ['https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx', resolve(modelDir, 'model_quantized.onnx')],
  ['https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/vocab.txt', resolve(modelDir, 'vocab.txt')],
];

const manifest = {};
for (const [url, dest] of downloads) {
  if (!existsSync(dest)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
  const bytes = readFileSync(dest);
  manifest[dest.slice(modelDir.length + 1)] = { source: url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  console.log(`${dest.slice(root.length + 1)}  ${(bytes.length / 1048576).toFixed(2)} MB`);
}
writeFileSync(resolve(modelDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// CPU build for Path A / Tier 3B (onnxruntime-web/wasm) and the asyncify build Transformers.js
// uses for Path B (onnxruntime-web/webgpu).
const ortDist = resolve(root, 'node_modules/onnxruntime-web/dist');
for (const f of [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
]) {
  copyFileSync(resolve(ortDist, f), resolve(ortDir, f));
  console.log(`assets/ort/${f}`);
}
