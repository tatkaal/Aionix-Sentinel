import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EngineHost, PATH_B_BUDGET_MS } from '../../src/engine/host';
import type { NeuralNer } from '../../src/engine/tier2/webgpu-path';
import { createNodeEmbedder } from '../../scripts/lib/node-embedder';

const root = resolve(import.meta.dirname, '../..');
const assets = resolve(root, 'assets');
const modelDir = resolve(assets, 'models/all-MiniLM-L6-v2');
const ready = existsSync(resolve(modelDir, 'model_quantized.onnx'));

function host(nerDelayMs: number) {
  const slowNer: NeuralNer = {
    modelId: 'stub-slow',
    detect: (text) =>
      new Promise((r) => setTimeout(() => r([{ label: 'private_person', start: text.indexOf('Harriet'), end: text.indexOf('Harriet') + 17, score: 0.99 }]), nerDelayMs)),
    dispose: async () => undefined,
  };
  return new EngineHost({
    loadBinary: async (p) => {
      const b = readFileSync(resolve(assets, p));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    createEmbedder: async () => ({ embedder: await createNodeEmbedder(modelDir), modelBytes: 0 }),
    probeHardware: async () => ({
      webgpu: true,
      eligible: true,
      reason: 'stub GPU',
      dtype: 'q4',
      vendor: 'stub',
      architecture: '',
      description: '',
      isFallbackAdapter: false,
      maxStorageBufferBindingSize: 2 ** 31,
      maxBufferSize: 2 ** 31,
      shaderF16: false,
      deviceMemoryGB: 8,
    }),
    createNeuralNer: async () => slowNer,
    autoLoadPathB: false,
    enforceCeiling: false,
  });
}

describe.skipIf(!ready)('engine host routing', () => {
  const input = { text: 'Discharge summary for patient Harriet Lindqvist: admitted with pneumonia, discharged on amoxicillin 500 mg.' };

  it('falls back to Path A when Path B exceeds the Tier 2 budget, but benchmarks can force strict Path B', async () => {
    const h = host(PATH_B_BUDGET_MS + 400);
    await h.setRouteMode('force-b');
    expect((await h.status()).pathBState).toBe('ready');

    const fast = await h.scanAsync(input);
    expect(fast.tier2Route).toBe('A');
    expect(fast.degradedReason).toMatch(/exceeded/);
    expect(fast.findings.some((f) => f.category === 9 && f.path === 'lexicon')).toBe(true);

    const strict = await h.scanAsync(input, { strictRoute: true });
    expect(strict.tier2Route).toBe('B');
    expect(strict.findings.some((f) => f.category === 9 && f.path === 'webgpu')).toBe(true);
  });

  it('evicts Path B above the memory ceiling and remembers the eviction across restarts', async () => {
    let stored: string | null = null;
    const evictionStore = { get: () => stored, set: (r: string) => void (stored = r) };
    let loads = 0;
    const make = () =>
      new EngineHost({
        loadBinary: async (p) => {
          const b = readFileSync(resolve(assets, p));
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        },
        createEmbedder: async () => ({ embedder: await createNodeEmbedder(modelDir), modelBytes: 0 }),
        probeHardware: async () => ({
          webgpu: true, eligible: true, reason: 'stub GPU', dtype: 'q4', vendor: 'stub', architecture: '', description: '',
          isFallbackAdapter: false, maxStorageBufferBindingSize: 2 ** 31, maxBufferSize: 2 ** 31, shaderF16: false, deviceMemoryGB: 8,
        }),
        createNeuralNer: async (_dtype, onProgress) => {
          loads++;
          // ~0.9 GB of weights pass through host memory, as with the real q4 privacy-filter.
          onProgress({ file: 'onnx/model_q4.onnx_data', loaded: 917_000_000, total: 917_000_000 });
          return { modelId: 'stub', detect: async () => [], dispose: async () => undefined };
        },
        autoLoadPathB: true,
        enforceCeiling: true,
        evictionStore,
      });

    const first = make();
    await first.init();
    await first.loadPathB(); // joins the auto-load started by init
    const s1 = await first.status();
    expect(s1.pathBState).toBe('evicted');
    expect(s1.route).toBe('A');
    expect(s1.pathBReason).toMatch(/> 150 MB ceiling/);
    expect(stored).toMatch(/ceiling/);

    const second = make();
    await second.init();
    expect((await second.status()).pathBState).toBe('evicted');
    expect(loads).toBe(1); // the restart did not re-download the weights
  });

  it('uses Path B directly when it answers inside the budget', async () => {
    const h = host(10);
    await h.setRouteMode('force-b');
    const r = await h.scanAsync(input);
    expect(r.tier2Route).toBe('B');
    expect(r.degradedReason).toBeUndefined();
  });
});
