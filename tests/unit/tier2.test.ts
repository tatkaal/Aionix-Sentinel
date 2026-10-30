import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createContextValidator } from '../../src/engine/tier2/context-validator';
import { compileFst } from '../../src/engine/tier2/fst-build';
import { Fst } from '../../src/engine/tier2/fst-runtime';
import { createLexiconPath } from '../../src/engine/tier2/lexicon-path';
import { findPersonNodes, findSensitiveNodes } from '../../src/engine/tier2/nodes';
import { buildEdges, MAX_TOKEN_DISTANCE } from '../../src/engine/tier2/proximity-graph';
import { createWebGpuPath, type NeuralNer } from '../../src/engine/tier2/webgpu-path';
import { locateEntities } from '../../src/engine/runtime/privacy-filter-ner';
import { createNodeEmbedder } from '../../scripts/lib/node-embedder';

const root = resolve(import.meta.dirname, '../..');

describe('FST compiler + runtime', () => {
  const fst = new Fst(
    compileFst([
      { term: 'type 2 diabetes mellitus', output: 'CE11.9' },
      { term: 'diabetes', output: 'CSYN' },
      { term: 'metformin', output: 'M6809' },
      { term: 'atorvastatin', output: 'M83367' },
      { term: 'grace', output: 'N' },
      { term: 'account balance', output: 'F' },
      { term: 'pipeline', output: 'W' },
    ]).bytes,
  );

  it('looks up exact terms and multiple outputs', () => {
    expect(fst.lookup('metformin')).toEqual(['M6809']);
    expect(fst.lookup('diabetes')).toEqual(['CSYN']);
    expect(fst.lookup('diabet')).toEqual([]);
  });

  it('finds longest matches with raw offsets', () => {
    const text = 'Dx: Type 2 Diabetes Mellitus; check Account-Balance.';
    const m = fst.scan(text);
    expect(m.map((x) => text.slice(x.start, x.end))).toEqual(['Type 2 Diabetes Mellitus', 'Account-Balance']);
  });

  it('fuzzy-matches misspelt medications (incl. transpositions) but not common words', () => {
    expect(fst.fuzzyWord('atorvastatn', 'M')?.outputs).toEqual(['M83367']);
    expect(fst.fuzzyWord('metfromin', 'M')?.outputs).toEqual(['M6809']);
    const m = fst.scan('the pipline and the pipeline', { fuzzy: true });
    expect(m.filter((x) => x.outputs.some((o) => o[0] === 'M'))).toEqual([]);
  });
});

describe('proximity graph', () => {
  const fstPath = resolve(root, 'assets/engine/medical.fst.bin');
  it.skipIf(!existsSync(fstPath))('links a person to a condition only within 30 tokens', () => {
    const fst = new Fst(readFileSync(fstPath));
    const near = 'Patient Margaret Okafor was diagnosed with asthma.';
    expect(buildEdges(near, findPersonNodes(near, fst), findSensitiveNodes(near, fst))).toHaveLength(1);
    const filler = Array.from({ length: MAX_TOKEN_DISTANCE + 5 }, () => 'word').join(' ');
    const far = `Patient Margaret Okafor attended. ${filler}. Asthma education materials were reviewed.`;
    expect(buildEdges(far, findPersonNodes(far, fst), findSensitiveNodes(far, fst))).toHaveLength(0);
  });

  it.skipIf(!existsSync(fstPath))('treats public figures as non-linkable', () => {
    const fst = new Fst(readFileSync(fstPath));
    const text = "Warren Buffett's net worth is $140 billion.";
    expect(findPersonNodes(text, fst).every((p) => p.isPublic)).toBe(true);
  });
});

describe('privacy-filter output alignment', () => {
  it('locates entity words in order (the pipeline returns no offsets)', () => {
    const text = 'Email Harry at harry@hogwarts.edu; Harry Potter is the account holder.';
    const ents = locateEntities(text, [
      { entity_group: 'private_email', score: 0.99, word: ' harry@hogwarts.edu' },
      { entity_group: 'private_person', score: 0.98, word: ' Harry Potter' },
    ]);
    expect(ents.map((e) => text.slice(e.start, e.end))).toEqual(['harry@hogwarts.edu', 'Harry Potter']);
  });
});

const modelDir = resolve(root, 'assets/models/all-MiniLM-L6-v2');
const haveAssets = existsSync(resolve(modelDir, 'model_quantized.onnx')) && existsSync(resolve(root, 'assets/engine/medical.fst.bin'));

describe.skipIf(!haveAssets)('Tier 2 paths (real FST + MiniLM validator)', async () => {
  const fst = haveAssets ? new Fst(readFileSync(resolve(root, 'assets/engine/medical.fst.bin'))) : (null as unknown as Fst);
  const embedder = haveAssets ? await createNodeEmbedder(modelDir) : null;
  const validator = embedder ? await createContextValidator(embedder) : null;
  const pathA = createLexiconPath(fst, validator);
  const src = { kind: 'composer' } as const;

  it.each([
    [9, 'Summarise for the referral: patient Margaret Okafor (MRN 00482913) was diagnosed with type 2 diabetes mellitus and started metformin 500 mg twice daily.'],
    [8, 'Client Daniel Whitford — account balance $1,284,500.00, margin loan outstanding $310,000. Write a portfolio review.'],
  ])('Path A blocks Category %i records', async (cat, text) => {
    const f = await pathA.scan(text, src);
    expect(f.map((x) => x.category)).toContain(cat);
  });

  it.each([
    'What are the common early symptoms of type 2 diabetes, and how is metformin usually dosed?',
    "What is Warren Buffett's net worth, and how much of his portfolio is in Apple?",
    'Draft a memo reminding Sarah Jones that the quarterly portfolio review meeting moved to Thursday.',
  ])('Path A allows: %s', async (text) => {
    expect(await pathA.scan(text, src)).toEqual([]);
  });

  it('Path B uses neural PERSON spans with the same graph', async () => {
    const text = 'harrypotter was prescribed lithium 300 mg for bipolar disorder last week.';
    const ner: NeuralNer = {
      modelId: 'stub',
      detect: async () => [{ label: 'private_person', start: 0, end: 11, score: 0.97 }],
      dispose: async () => undefined,
    };
    const f = await createWebGpuPath(fst, validator, ner).scan(text, src);
    expect(f.map((x) => [x.category, x.path, text.slice(x.rawStart, x.rawEnd)])).toEqual([[9, 'webgpu', 'harrypotter']]);
    // The lowercase handle is invisible to Path A's capitalised-name heuristic.
    expect(await pathA.scan(text, src)).toEqual([]);
  });
});
