// Tier 2 Path B neural NER: openai/privacy-filter (Apache-2.0) through Transformers.js on WebGPU.
// Weights are *data* fetched once from the Hugging Face Hub and cached by the browser; the ONNX
// Runtime code itself is served locally (wasmPaths), so no remote code executes.
import type { NeuralEntity, NeuralNer } from '../tier2/webgpu-path';

export const PRIVACY_FILTER_MODEL = 'openai/privacy-filter';

export interface LoadProgress {
  file: string;
  loaded: number;
  total: number;
}

interface RawEntity {
  entity_group?: string;
  entity?: string;
  score: number;
  word: string;
}

/** The pipeline returns words without offsets; locate them in order in the source text. */
export function locateEntities(text: string, raw: RawEntity[]): NeuralEntity[] {
  const out: NeuralEntity[] = [];
  let cursor = 0;
  const lower = text.toLowerCase();
  for (const r of raw) {
    const word = r.word.trim();
    if (!word) continue;
    let at = text.indexOf(word, cursor);
    if (at < 0) at = lower.indexOf(word.toLowerCase(), cursor);
    if (at < 0) continue;
    const label = (r.entity_group ?? r.entity ?? '').replace(/^[BIES]-/, '');
    out.push({ label, start: at, end: at + word.length, score: r.score });
    cursor = at + word.length;
  }
  return out;
}

export async function createPrivacyFilterNer(
  baseUrl: string,
  dtype: 'q4' | 'q4f16',
  onProgress?: (p: LoadProgress) => void,
): Promise<NeuralNer> {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number; proxy?: boolean } };
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = {
      mjs: `${baseUrl}ort/ort-wasm-simd-threaded.asyncify.mjs`,
      wasm: `${baseUrl}ort/ort-wasm-simd-threaded.asyncify.wasm`,
    };
    onnx.wasm.numThreads = 1;
  }
  const classifier = await pipeline('token-classification', PRIVACY_FILTER_MODEL, {
    device: 'webgpu',
    dtype,
    progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file) onProgress?.({ file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
    },
  });
  return {
    modelId: `${PRIVACY_FILTER_MODEL} (${dtype}, WebGPU)`,
    async detect(text) {
      const raw = (await classifier(text, { aggregation_strategy: 'simple' })) as unknown as RawEntity[];
      return locateEntities(text, raw);
    },
    async dispose() {
      await classifier.dispose();
    },
  };
}
