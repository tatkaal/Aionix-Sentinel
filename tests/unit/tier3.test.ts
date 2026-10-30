import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BloomFilter } from '../../src/engine/tier3/bloom';
import { decodeEdm, createEdmDetector } from '../../src/engine/tier3/edm';
import { estimateJaccard, minhashSignature } from '../../src/engine/tier3/minhash';
import { createVaultDetector } from '../../src/engine/tier3/minhash-detector';
import { buildAsset, decodeVault, encodeVault } from '../../src/engine/tier3/vault-format';
import { createNodeEmbedder } from '../../scripts/lib/node-embedder';

const root = resolve(import.meta.dirname, '../..');
const vaultText = (f: string) => readFileSync(resolve(root, 'data/vault', f), 'utf8');
const composer = { kind: 'composer' } as const;

describe('Bloom filter', () => {
  it('has no false negatives and stays near its target FP rate', () => {
    const bf = BloomFilter.create(5000, 1e-3);
    for (let i = 0; i < 5000; i++) bf.add((i * 2654435761) >>> 0);
    for (let i = 0; i < 5000; i++) expect(bf.has((i * 2654435761) >>> 0)).toBe(true);
    let fp = 0;
    for (let i = 0; i < 100_000; i++) if (bf.has((0x9e3779b9 + i * 40503) >>> 0)) fp++;
    expect(fp / 100_000).toBeLessThan(3e-3);
  });
});

describe('MinHash', () => {
  it('estimates Jaccard similarity', () => {
    const a = Uint32Array.from({ length: 400 }, (_, i) => i * 7919);
    const b = Uint32Array.from({ length: 400 }, (_, i) => (i + 200) * 7919);
    expect(estimateJaccard(minhashSignature(a), minhashSignature(a))).toBe(1);
    const j = estimateJaccard(minhashSignature(a), minhashSignature(b)); // true J = 200/600
    expect(j).toBeGreaterThan(0.15);
    expect(j).toBeLessThan(0.55);
  });
});

describe('Tier 3 Path A — vault fingerprinting', () => {
  const assets = [
    buildAsset('alpha', 'Alpha Liquidity Router', 'code', 10, vaultText('alpha-liquidity-router.ts')),
    buildAsset('chronos', 'Project Chronos memo', 'prose', 10, vaultText('project-chronos-memo.md')),
    buildAsset('crm', 'HNW CRM export', 'table', 8, vaultText('hnw-crm-export.csv')),
  ];
  const detector = createVaultDetector(decodeVault(encodeVault(assets)));

  it('round-trips corporate-vault.bin', () => {
    const decoded = decodeVault(encodeVault(assets));
    expect(decoded.map((a) => [a.id, a.shingleCount, a.category])).toEqual(assets.map((a) => [a.id, a.shingleCount, a.category]));
  });

  it('catches a 15-line excerpt of proprietary code inside a question', () => {
    const lines = vaultText('alpha-liquidity-router.ts').split('\n').slice(54, 69).join('\n');
    const prompt = `Can you optimise this function for me?\n\n${lines}\n\nThanks!`;
    const f = detector.scan(prompt, composer);
    expect(f).toHaveLength(1);
    expect(f[0]!.category).toBe(10);
    expect(prompt.slice(f[0]!.rawStart, f[0]!.rawEnd)).toContain('scoreVenue');
  });

  it('catches a single memo paragraph', () => {
    const para = vaultText('project-chronos-memo.md').split('\n\n').find((p) => p.startsWith('The indicative price'))!;
    expect(detector.scan(`Please summarise: ${para}`, composer).map((x) => x.category)).toEqual([10]);
  });

  it('maps CRM rows to Category 8', () => {
    const rows = vaultText('hnw-crm-export.csv').split('\n').slice(3, 5).join('\n');
    expect(detector.scan(`Format these as a table:\n${rows}`, composer).map((x) => x.category)).toEqual([8]);
  });

  it('ignores benign prose and generic code', () => {
    const benign = [
      'The board meeting is scheduled for next Tuesday. Please review the attached agenda and send any comments to the company secretary before the end of the week.',
      'function add(a: number, b: number): number { return a + b; } // returns the sum of the two values passed into the function',
      'We are planning a team offsite in March and would like suggestions for venues near the city with good transport links and catering options.',
    ];
    for (const b of benign) expect(detector.scan(b, composer)).toEqual([]);
  });
});

const modelDir = resolve(root, 'assets/models/all-MiniLM-L6-v2');
const edmBin = resolve(root, 'assets/engine/vault-edm.bin');
describe.skipIf(!existsSync(resolve(modelDir, 'model_quantized.onnx')) || !existsSync(edmBin))('Tier 3 Path B — exact data match', () => {
  it('matches CRM rows by salted field hashes and vault chunks by embedding', async () => {
    const embedder = await createNodeEmbedder(modelDir);
    const edm = await createEdmDetector(decodeEdm(readFileSync(edmBin)), embedder);

    const row = vaultText('hnw-crm-export.csv').split('\n')[7]!.split(',');
    const byFields = await edm.scan(`Can you check the margin call for ${row[1]}, account ${row[3]}?`, composer);
    expect(byFields.some((f) => f.path === 'edm' && f.category === 8)).toBe(true);

    const para = vaultText('project-chronos-memo.md').split('\n\n').find((p) => p.startsWith('Corvane operates'))!;
    const byVector = await edm.scan(para, composer);
    expect(byVector.some((f) => f.evidence.startsWith('MiniLM cosine'))).toBe(true);

    const benign = await edm.scan('Write a short poem about autumn leaves falling in a quiet park near the river at dusk.', composer);
    expect(benign).toEqual([]);
    await embedder.dispose();
  });
});
