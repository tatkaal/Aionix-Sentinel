// Admin CI/CD hashing pipeline: compiles data/vault/* into assets/engine/corporate-vault.bin
// (Bloom + MinHash for Tier 3 Path A) and, when MiniLM is available, assets/engine/vault-edm.bin
// (embeddings + salted CRM field hashes for Tier 3 Path B). No document text is shipped.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CategoryId } from '../src/engine/types';
import { buildAsset, encodeVault, type AssetKind } from '../src/engine/tier3/vault-format';
import { buildEdmIndexData, encodeEdm } from '../src/engine/tier3/edm';
import { createNodeEmbedder } from './lib/node-embedder';

interface ManifestEntry {
  id: string;
  title: string;
  file: string;
  kind: AssetKind;
  category: CategoryId;
}

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'data/vault/manifest.json'), 'utf8')) as ManifestEntry[];
const outDir = resolve(root, 'assets/engine');
mkdirSync(outDir, { recursive: true });

const docs = manifest.map((m) => ({ ...m, text: readFileSync(resolve(root, 'data/vault', m.file), 'utf8') }));

const assets = docs.map((d) => buildAsset(d.id, d.title, d.kind, d.category, d.text));
const bin = encodeVault(assets);
writeFileSync(resolve(outDir, 'corporate-vault.bin'), bin);
console.log(`corporate-vault.bin  ${(bin.length / 1024).toFixed(1)} KB`);
for (const a of assets) {
  console.log(
    `  ${a.id.padEnd(22)} shingles=${String(a.shingleCount).padStart(5)} bloom=${a.bloom.m} bits k=${a.bloom.k} p≈${a.bloom.falsePositiveRate(a.shingleCount).toExponential(1)}`,
  );
}

const modelDir = resolve(root, 'assets/models/all-MiniLM-L6-v2');
if (!existsSync(resolve(modelDir, 'model_quantized.onnx'))) {
  console.warn('[build-vault] MiniLM not found — run "npm run data:models" to build vault-edm.bin (Tier 3 Path B).');
} else {
  const embedder = await createNodeEmbedder(modelDir);
  const salt = process.env.AIONIX_EDM_SALT ?? 'aionix-edm-demo-salt';
  const data = await buildEdmIndexData(docs, embedder, salt);
  const edm = encodeEdm(data);
  writeFileSync(resolve(outDir, 'vault-edm.bin'), edm);
  console.log(`vault-edm.bin        ${(edm.length / 1024).toFixed(1)} KB  (${data.chunks.length} vectors, ${data.fieldHashes.length} CRM field hashes)`);
}
