import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BenchSample } from '../../src/engine/bench/types';
import { createNodeEngine } from '../../scripts/lib/node-engine';

const root = resolve(import.meta.dirname, '../..');
const file = resolve(root, 'data/datasets/edge-cases.json');
const ready = existsSync(file) && existsSync(resolve(root, 'assets/models/all-MiniLM-L6-v2/model_quantized.onnx'));

describe.skipIf(!ready)('24 stakeholder edge cases — full cascade, Tier 2 Path A', async () => {
  const cases = ready ? (JSON.parse(readFileSync(file, 'utf8')) as BenchSample[]) : [];
  const engine = ready ? await createNodeEngine(root) : null;

  it('has all 24 scenarios', () => expect(cases).toHaveLength(24));

  it.each(cases.map((c) => [c.id, c.title ?? '', c] as const))('%s %s', async (_id, _title, c) => {
    const steps = c.steps ?? [{ text: c.text, attachments: c.attachments, expect: c.expect }];
    for (const step of steps) {
      const r = await engine!.scan({ text: step.text, attachments: step.attachments ?? [] });
      expect(r.verdict, `${c.id}: ${step.attachments?.length ?? 0} attachment(s)`).toBe(step.expect);
      if (step.expect === 'block' && c.categories.length) {
        expect(r.findings.some((f) => c.categories.includes(f.category))).toBe(true);
      }
    }
  });

  it('EC23 points the finding at the buried token, not the surrounding prose', async () => {
    const c = cases.find((x) => x.id === 'EC23')!;
    const r = await engine!.scan({ text: c.text });
    expect(r.findings.map((f) => c.text.slice(f.rawStart, f.rawEnd))).toEqual(['ghp_7Rk2Lm9Qx4Tz8Vb1Nc6Hd3Pw5Ys0Ja2Ge7Uf']);
  });
});
