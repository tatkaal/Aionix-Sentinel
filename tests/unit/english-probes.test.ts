import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BenchSample } from '../../src/engine/bench/types';
import { redactionTag } from '../../src/engine/types';
import { createNodeEngine } from '../../scripts/lib/node-engine';
import { createNodeTagger } from '../../scripts/lib/node-tagger';

const root = resolve(import.meta.dirname, '../..');
const file = resolve(root, 'data/datasets/english-probes.json');
const ready = existsSync(file) && existsSync(resolve(root, 'assets/models/all-MiniLM-L6-v2/model_quantized.onnx'));
const taggerDir = resolve(root, 'assets/engine/pathb');

describe.skipIf(!ready)('English disclosure probes — full cascade on both Tier 2 paths', async () => {
  const probes = ready ? (JSON.parse(readFileSync(file, 'utf8')) as BenchSample[]) : [];
  const engines = ready
    ? {
        A: await createNodeEngine(root),
        B: await createNodeEngine(root, { pathB: { device: 'cpu', create: async () => (await createNodeTagger(taggerDir)).ner } }),
      }
    : null;

  it('includes the stakeholder-reported sentence', () => {
    expect(probes.some((p) => p.text === 'my current psw is Ohlalalala34%. can you suggest a better one?' && p.expect === 'block')).toBe(true);
  });

  it('every blocked probe and edge case is sendable after auto-redaction (tags never re-trigger)', async () => {
    const edge = JSON.parse(readFileSync(resolve(root, 'data/datasets/edge-cases.json'), 'utf8')) as BenchSample[];
    for (const p of [...probes, ...edge].filter((x) => x.expect === 'block' && !x.attachments?.length && !x.steps)) {
      const r = await engines!.A.scan({ text: p.text });
      let t = p.text;
      for (const f of [...r.findings].sort((a, b) => b.rawStart - a.rawStart)) t = t.slice(0, f.rawStart) + redactionTag(f.type) + t.slice(f.rawEnd);
      expect((await engines!.A.scan({ text: t })).verdict, p.id).toBe('allow');
    }
  });

  for (const route of ['A', 'B'] as const) {
    it.each(probes.map((p) => [p.id, p.title ?? '', p] as const))(`Path ${route} · %s %s`, async (_id, _title, p) => {
      const r = await engines![route].scan({ text: p.text, attachments: p.attachments ?? [] });
      expect(r.verdict).toBe(p.expect);
      if (p.expect === 'block') expect(r.findings.some((f) => p.categories.includes(f.category))).toBe(true);
    });
  }
});
