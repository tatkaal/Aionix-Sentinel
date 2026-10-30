// Browser MiniLM embedder on the CPU-only ONNX Runtime wasm build (14 MB) — not the 27 MB
// asyncify/WebGPU build Transformers.js needs — to keep Path A's footprint small.
import { createMiniLmEmbedder, type Embedder, type OrtLike } from '../embed/minilm';

export const MINILM_MODEL_PATH = 'models/all-MiniLM-L6-v2/model_quantized.onnx';
export const MINILM_VOCAB_PATH = 'models/all-MiniLM-L6-v2/vocab.txt';

export function threadCount(): number {
  const g = globalThis as { crossOriginIsolated?: boolean; navigator?: { hardwareConcurrency?: number } };
  if (!g.crossOriginIsolated) return 1;
  return Math.max(1, Math.min(4, Math.floor((g.navigator?.hardwareConcurrency ?? 2) / 2)));
}

export async function createOrtWebEmbedder(baseUrl: string): Promise<{ embedder: Embedder; modelBytes: number }> {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.wasmPaths = `${baseUrl}ort/`;
  // Threads need SharedArrayBuffer (cross-origin isolation). Measured in Chrome: one short
  // embedding takes ~72 ms on 1 thread vs ~26 ms on 4.
  ort.env.wasm.numThreads = threadCount();
  ort.env.wasm.proxy = false;
  const [model, vocab] = await Promise.all([
    fetch(`${baseUrl}${MINILM_MODEL_PATH}`).then((r) => {
      if (!r.ok) throw new Error(`MiniLM model missing (${r.status}) — run "npm run data:models"`);
      return r.arrayBuffer();
    }),
    fetch(`${baseUrl}${MINILM_VOCAB_PATH}`).then((r) => r.text()),
  ]);
  const embedder = await createMiniLmEmbedder(ort as unknown as OrtLike, new Uint8Array(model), vocab, { executionProviders: ['wasm'] });
  return { embedder, modelBytes: model.byteLength };
}
