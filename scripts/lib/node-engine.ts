// The shipping engine, hosted in Node: same EngineHost as the offscreen document, with assets read
// from disk and MiniLM on onnxruntime-node. WebGPU is not available here, so Tier 2 runs Path A.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EngineHost, type PathBProvider } from '../../src/engine/host';
import { mergeAsync, scanSync } from '../../src/engine/pipeline';
import { createVaultDetector } from '../../src/engine/tier3/minhash-detector';
import { decodeVault } from '../../src/engine/tier3/vault-format';
import type { ScanInput, ScanResult } from '../../src/engine/types';
import { createNodeEmbedder } from './node-embedder';

/** `pathB` plugs in a CPU tagger (bake-off / trained model); Path B scans then run strictly on route B. */
export async function createNodeEngine(root: string, opts: { pathB?: PathBProvider } = {}) {
  const assets = resolve(root, 'assets');
  const modelDir = resolve(assets, 'models/all-MiniLM-L6-v2');
  const host = new EngineHost({
    loadBinary: async (p) => {
      const b = readFileSync(resolve(assets, p));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    createEmbedder: async () => ({ embedder: await createNodeEmbedder(modelDir), modelBytes: readFileSync(resolve(modelDir, 'model_quantized.onnx')).byteLength }),
    probeHardware: async () => ({
      webgpu: false,
      eligible: false,
      reason: 'Node.js runtime: WebGPU unavailable — Tier 2 Path A only',
      dtype: 'q4',
      vendor: '',
      architecture: '',
      description: '',
      isFallbackAdapter: false,
      maxStorageBufferBindingSize: 0,
      maxBufferSize: 0,
      shaderF16: false,
      deviceMemoryGB: null,
    }),
    ...(opts.pathB ? { pathB: opts.pathB } : {}),
    autoLoadPathB: false,
    enforceCeiling: false,
  });
  await host.init();
  if (opts.pathB) await host.loadPathB();
  const tier3a = createVaultDetector(decodeVault(readFileSync(resolve(assets, 'engine/corporate-vault.bin'))));

  const scan = async (input: ScanInput): Promise<ScanResult> => {
    const t0 = performance.now();
    const sync = scanSync(input, tier3a);
    const asyncPart = await host.scanAsync(input, { strictRoute: !!opts.pathB });
    return mergeAsync(sync, asyncPart, performance.now() - t0);
  };
  return { host, tier3a, scan };
}
