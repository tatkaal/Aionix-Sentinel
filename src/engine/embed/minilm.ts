// all-MiniLM-L6-v2 (INT8) sentence embeddings: mean pooling over the attention mask + L2 norm.
// Runtime-agnostic: pass onnxruntime-web (offscreen / worker) or onnxruntime-node (bench, CI).
import { WordPieceTokenizer } from './wordpiece';

export const MINILM_DIMS = 384;

export interface Embedder {
  readonly dims: number;
  embed(texts: string[]): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}

interface OrtTensorLike {
  data: unknown;
  dims: readonly number[];
}

interface OrtSessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
  release?(): Promise<void>;
}

/** The subset of the ONNX Runtime JS API (web or node) this module needs. */
export interface OrtLike {
  Tensor: new (type: 'int64', data: BigInt64Array, dims: number[]) => unknown;
  InferenceSession: { create(model: Uint8Array, options?: Record<string, unknown>): Promise<OrtSessionLike> };
}

export async function createMiniLmEmbedder(
  ort: OrtLike,
  modelBytes: Uint8Array,
  vocabText: string,
  sessionOptions: Record<string, unknown> = {},
  maxLength = 256,
): Promise<Embedder> {
  const tokenizer = new WordPieceTokenizer(vocabText);
  const session = await ort.InferenceSession.create(modelBytes, { graphOptimizationLevel: 'all', ...sessionOptions });
  const wantsTypeIds = session.inputNames.includes('token_type_ids');
  const outName = session.outputNames.includes('last_hidden_state') ? 'last_hidden_state' : session.outputNames[0]!;

  // The INT8 model quantizes activations dynamically with one scale per batch, so padding and
  // batch composition shift results by ~1%. Running one text per inference keeps index-time and
  // query-time vectors bit-identical (verified against Transformers.js: cosine 1.000000).
  const embedOne = async (text: string): Promise<Float32Array> => {
    const [v] = await embedBatch([text]);
    return v!;
  };

  const embedBatch = async (texts: string[]): Promise<Float32Array[]> => {
      const encoded = texts.map((t) => tokenizer.encode(t, maxLength).ids);
      const seq = Math.max(...encoded.map((e) => e.length));
      const batch = encoded.length;
      const ids = new BigInt64Array(batch * seq);
      const mask = new BigInt64Array(batch * seq);
      encoded.forEach((e, b) => {
        for (let i = 0; i < seq; i++) {
          ids[b * seq + i] = BigInt(i < e.length ? e[i]! : tokenizer.padId);
          mask[b * seq + i] = i < e.length ? 1n : 0n;
        }
      });
      const feeds: Record<string, unknown> = {
        input_ids: new ort.Tensor('int64', ids, [batch, seq]),
        attention_mask: new ort.Tensor('int64', mask, [batch, seq]),
      };
      if (wantsTypeIds) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(batch * seq), [batch, seq]);
      const out = await session.run(feeds);
      const hidden = out[outName]!.data as Float32Array;
      const dim = out[outName]!.dims[2] ?? MINILM_DIMS;
      const vectors: Float32Array[] = [];
      for (let b = 0; b < batch; b++) {
        const v = new Float32Array(dim);
        const n = encoded[b]!.length;
        for (let t = 0; t < n; t++) {
          const base = (b * seq + t) * dim;
          for (let d = 0; d < dim; d++) v[d]! += hidden[base + d]!;
        }
        let norm = 0;
        for (let d = 0; d < dim; d++) {
          v[d]! /= n;
          norm += v[d]! * v[d]!;
        }
        norm = Math.sqrt(norm) || 1;
        for (let d = 0; d < dim; d++) v[d]! /= norm;
        vectors.push(v);
      }
      return vectors;
  };

  // Tier 2's validator and Tier 3's EDM embed the same paragraph chunks, and re-scans after a
  // redaction repeat most of them — a small LRU keeps each distinct text to one inference.
  const cache = new Map<string, Float32Array>();
  const CACHE_MAX = 256;

  return {
    dims: MINILM_DIMS,
    async embed(texts) {
      const out: Float32Array[] = [];
      for (const t of texts) {
        let v = cache.get(t);
        if (v) {
          cache.delete(t);
        } else {
          v = await embedOne(t);
          if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
        }
        cache.set(t, v);
        out.push(v);
      }
      return out;
    },
    async dispose() {
      await session.release?.();
    },
  };
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}
