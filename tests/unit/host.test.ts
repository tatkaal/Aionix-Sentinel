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
    pathB: { device: 'webgpu', create: async () => slowNer },
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
        pathB: {
          device: 'webgpu',
          create: async (_dtype, onProgress) => {
            loads++;
            // ~0.9 GB of weights pass through host memory, as with the real q4 privacy-filter.
            onProgress({ file: 'onnx/model_q4.onnx_data', loaded: 917_000_000, total: 917_000_000 });
            return { modelId: 'stub', detect: async () => [], dispose: async () => undefined };
          },
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

  it('a CPU Path B tagger loads and routes without any WebGPU adapter', async () => {
    const at = input.text.indexOf('Harriet');
    const h = new EngineHost({
      loadBinary: async (p) => {
        const b = readFileSync(resolve(assets, p));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
      createEmbedder: async () => ({ embedder: await createNodeEmbedder(modelDir), modelBytes: 0 }),
      probeHardware: async () => ({
        webgpu: false, eligible: false, reason: 'no adapter', dtype: 'q4', vendor: '', architecture: '', description: '',
        isFallbackAdapter: false, maxStorageBufferBindingSize: 0, maxBufferSize: 0, shaderF16: false, deviceMemoryGB: null,
      }),
      pathB: { device: 'cpu', create: async () => ({ modelId: 'stub-tagger', detect: async () => [{ label: 'B-person', start: at, end: at + 17, score: 0.95 }], dispose: async () => undefined }) },
      autoLoadPathB: true,
      enforceCeiling: true,
    });
    await h.init();
    await h.loadPathB();
    const s = await h.status();
    expect([s.pathBState, s.route, s.pathBModel]).toEqual(['ready', 'B', 'stub-tagger']);
    const r = await h.scanAsync(input, { strictRoute: true });
    expect(r.tier2Route).toBe('B');
    expect(r.findings.some((f) => f.category === 9 && f.path === 'neural')).toBe(true);
  });

  it('evicts Path B only when an over-ceiling reading holds on fresh follow-ups (steady state, not load buffers)', async () => {
    const g = globalThis as { crossOriginIsolated?: boolean };
    const perf = performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<unknown> };
    const saved = { iso: g.crossOriginIsolated, measure: perf.measureUserAgentSpecificMemory };
    let readings: number[] = [];
    g.crossOriginIsolated = true;
    perf.measureUserAgentSpecificMemory = async () => {
      const mb = readings.length > 1 ? readings.shift()! : readings[0]!;
      return { bytes: mb * 1048576, breakdown: [{ bytes: mb * 1048576, types: ['JavaScript'], attribution: [] }] };
    };
    const run = async (sequence: number[]) => {
      readings = [...sequence];
      let stored: string | null = null;
      const h = new EngineHost({
        loadBinary: async (p) => {
          const b = readFileSync(resolve(assets, p));
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        },
        createEmbedder: async () => ({ embedder: await createNodeEmbedder(modelDir), modelBytes: 0 }),
        probeHardware: async () => ({
          webgpu: false, eligible: false, reason: 'not probed', dtype: 'q4', vendor: '', architecture: '', description: '',
          isFallbackAdapter: false, maxStorageBufferBindingSize: 0, maxBufferSize: 0, shaderF16: false, deviceMemoryGB: null,
        }),
        pathB: { device: 'cpu', create: async () => ({ modelId: 'stub-tagger', detect: async () => [], dispose: async () => undefined }) },
        autoLoadPathB: false,
        enforceCeiling: true,
        evictionStore: { get: () => stored, set: (r) => void (stored = r) },
      });
      await h.init();
      await h.loadPathB();
      return { status: await h.status(0), stored };
    };
    try {
      const transient = await run([212, 118]);
      expect(transient.status.pathBState).toBe('ready');
      expect(transient.status.pathBReason).toMatch(/host 118 MB after load/);
      expect(transient.stored).toBeNull();

      const steady = await run([212, 205, 220]);
      expect(steady.status.pathBState).toBe('evicted');
      expect(steady.status.pathBReason).toMatch(/host memory 205 MB > 150 MB ceiling/);
      expect(steady.stored).toMatch(/205 MB/);
    } finally {
      g.crossOriginIsolated = saved.iso;
      perf.measureUserAgentSpecificMemory = saved.measure;
    }
  });
});
