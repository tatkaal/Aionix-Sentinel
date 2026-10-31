import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeEdm } from '../../src/engine/tier3/edm';
import { decodeCustomAsset, fingerprintCustom, fromBase64, PROTECTED_TYPES, toBase64 } from '../../src/engine/tier3/custom-vault';
import type { TestKit } from '../../src/engine/bench/test-kit';
import { createNodeEngine } from '../../scripts/lib/node-engine';

const root = resolve(import.meta.dirname, '../..');
const kitFile = resolve(root, 'assets/engine/test-kit.json');
const ready = existsSync(kitFile) && existsSync(resolve(root, 'assets/models/all-MiniLM-L6-v2/model_quantized.onnx'));

describe.skipIf(!ready)('live test kit — every prompt behaves as the options page says', async () => {
  const kit = ready ? (JSON.parse(readFileSync(kitFile, 'utf8')) as TestKit) : ({ categories: [], edgeCases: [], samples: [] } as unknown as TestKit);
  const engine = ready ? await createNodeEngine(root) : null;

  const scan = (text: string, paste?: string) =>
    engine!.scan({ text, attachments: paste ? [{ id: 'chip-1', name: 'pasted-content.txt', text: paste }] : [] });

  it('prompts that need a protected sample pass before it is protected', async () => {
    for (const c of kit.categories) {
      for (const p of c.prompts.filter((x) => x.needs?.startsWith('sample:') && c.id !== 8 && c.id !== 9)) {
        expect((await scan(p.text, p.paste)).verdict, p.title).toBe('allow');
      }
    }
  });

  it('protecting the samples stores fingerprints only, and they survive an encode/decode round trip', async () => {
    for (const s of kit.samples) {
      const fp = fingerprintCustom(`sample:${s.id}`, s.title, s.type, s.text);
      const asset = decodeCustomAsset({ vault: fp.vault })!;
      expect(asset.shingleCount).toBe(fp.shingles);
      // No readable trace of the document in the persisted fingerprints.
      const bytes = new TextDecoder('latin1').decode(fromBase64(fp.vault));
      for (const marker of ['HALCYON_NETTING', 'Wrenfield', 'Holloway', 'basis points']) expect(bytes).not.toContain(marker);
      engine!.tier3a.addAsset(asset);
      const edm = await engine!.host.indexProtected({ id: `sample:${s.id}`, title: s.title, kind: PROTECTED_TYPES[s.type].kind, category: PROTECTED_TYPES[s.type].category, text: s.text });
      const part = decodeEdm(fromBase64(toBase64(edm)));
      expect(JSON.stringify(part.fieldHashes)).not.toMatch(/Wrenfield|Holloway|81547302/);
    }
  });

  for (const cat of kit.categories) {
    it.each(cat.prompts.map((p) => [p.title, p] as const))(`Category ${cat.id} · %s`, async (_t, p) => {
      const r = await scan(p.text, p.paste);
      expect(r.verdict).toBe(p.expect);
      if (p.expect === 'block') expect(r.findings.some((f) => f.category === cat.id)).toBe(true);
    });
  }

  it('removing a protected sample stops the exact-match block', async () => {
    const p = kit.categories.find((c) => c.id === 9)!.prompts.find((x) => x.needs === 'sample:halcyon-patients')!;
    expect((await scan(p.text)).verdict).toBe('block');
    await engine!.host.syncProtected(kit.samples.filter((s) => s.id !== 'halcyon-patients').map((s) => ({ id: `sample:${s.id}`, edm: null })));
    const r = await scan(p.text);
    expect(r.findings.some((f) => f.path === 'edm')).toBe(false);
  });
});
