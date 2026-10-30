// Browser Path B tagger: the compact token classifier shipped in the extension package
// (engine/pathb/), on the same CPU-only ONNX Runtime wasm instance as MiniLM — no WebGPU, no
// second runtime, no network.
import { createTokenTagger, type TaggerConfig } from '../embed/token-tagger';
import type { OrtLike } from '../embed/minilm';
import type { UnigramJson } from '../embed/unigram';
import type { NeuralNer } from '../tier2/webgpu-path';
import { threadCount } from './ort-web-embedder';

export const PATHB_DIR = 'engine/pathb/';

/** engine/pathb/tagger.json — written by scripts/ml/package_pathb.py. */
export interface TaggerManifest extends TaggerConfig {
  model: string;
  tokenizer: string;
}

export async function createOrtWebTagger(baseUrl: string, onProgress?: (p: { file: string; loaded: number; total: number }) => void): Promise<NeuralNer> {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.wasmPaths = `${baseUrl}ort/`;
  ort.env.wasm.numThreads = threadCount();
  ort.env.wasm.proxy = false;
  const get = async (file: string) => {
    const res = await fetch(`${baseUrl}${PATHB_DIR}${file}`);
    if (!res.ok) throw new Error(`Path B ${file} missing (${res.status})`);
    return res;
  };
  const manifest = (await (await get('tagger.json')).json()) as TaggerManifest;
  const [model, tokenizer] = await Promise.all([get(manifest.model).then((r) => r.arrayBuffer()), get(manifest.tokenizer).then((r) => r.json() as Promise<UnigramJson>)]);
  onProgress?.({ file: manifest.model, loaded: model.byteLength, total: model.byteLength });
  return createTokenTagger(ort as unknown as OrtLike, new Uint8Array(model), tokenizer, manifest, {
    executionProviders: ['wasm'],
    // As for MiniLM: graph optimisation costs wasm memory without changing outputs.
    graphOptimizationLevel: 'disabled',
  });
}
