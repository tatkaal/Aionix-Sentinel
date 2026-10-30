// Path B token classifier: Unigram tokenizer → ONNX token classification → BIO spans with offsets.
// Runtime-agnostic (onnxruntime-web in the offscreen document / worker, onnxruntime-node in the
// bench). Windowing and decoding mirror scripts/ml/tag_datasets.py, which the bake-off used.
import type { NeuralEntity, NeuralNer } from '../tier2/webgpu-path';
import type { OrtLike } from './minilm';
import { createUnigramTokenizer, type UnigramJson } from './unigram';

const STRIDE = 64;

export interface TaggerConfig {
  modelId: string;
  /** Index → label, e.g. ['O', 'B-person', 'I-person', …]. */
  labels: string[];
  clsId: number;
  sepId: number;
  maxLength: number;
}

/** Spans from per-token label probabilities; mirrors Tagger.decode in tag_datasets.py. */
export function decodeBio(probs: Float32Array, numLabels: number, offsets: [number, number][], labels: string[]): NeuralEntity[] {
  const spans: (NeuralEntity & { p: number[] })[] = [];
  let cur: (NeuralEntity & { p: number[] }) | null = null;
  for (let i = 0; i < offsets.length; i++) {
    let arg = 0;
    for (let k = 1; k < numLabels; k++) if (probs[i * numLabels + k]! > probs[i * numLabels + arg]!) arg = k;
    const p = probs[i * numLabels + arg]!;
    const label = labels[arg]!;
    const [s, e] = offsets[i]!;
    if (label === 'O' || e <= s) {
      if (label === 'O') cur = null;
      continue;
    }
    const dash = label.indexOf('-');
    const prefix = dash > 0 ? label.slice(0, dash) : 'B';
    const kind = dash > 0 ? label.slice(dash + 1) : label;
    if (cur && kind === cur.label && (prefix === 'I' || prefix === 'E')) {
      cur.end = e;
      cur.p.push(p);
    } else {
      cur = { label: kind, start: s, end: e, score: 0, p: [p] };
      spans.push(cur);
    }
  }
  return spans.map(({ p, ...sp }) => ({ ...sp, score: Math.round((p.reduce((a, b) => a + b, 0) / p.length) * 1e4) / 1e4 }));
}

export async function createTokenTagger(ort: OrtLike, modelBytes: Uint8Array, tokenizerJson: UnigramJson, cfg: TaggerConfig, sessionOptions: Record<string, unknown> = {}): Promise<NeuralNer> {
  const tokenizer = createUnigramTokenizer(tokenizerJson);
  const session = await ort.InferenceSession.create(modelBytes, { graphOptimizationLevel: 'all', ...sessionOptions });
  const wantsTypeIds = session.inputNames.includes('token_type_ids');
  const L = cfg.labels.length;
  const body = cfg.maxLength - 2;

  return {
    modelId: cfg.modelId,
    async detect(text) {
      const { ids, offsets } = tokenizer.encode(text);
      const n = ids.length;
      if (!n) return [];
      const probs = new Float32Array(n * L);
      for (let start = 0; ; start = Math.max(start + 1, Math.min(n, start + body) - STRIDE)) {
        const end = Math.min(n, start + body);
        const seq = end - start + 2;
        const input = new BigInt64Array(seq);
        input[0] = BigInt(cfg.clsId);
        for (let i = start; i < end; i++) input[i - start + 1] = BigInt(ids[i]!);
        input[seq - 1] = BigInt(cfg.sepId);
        const feeds: Record<string, unknown> = {
          input_ids: new ort.Tensor('int64', input, [1, seq]),
          attention_mask: new ort.Tensor('int64', new BigInt64Array(seq).fill(1n), [1, seq]),
        };
        if (wantsTypeIds) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(seq), [1, seq]);
        const logits = (await session.run(feeds)).logits!.data as Float32Array;
        // Keep each token from the window where it is furthest from an edge.
        const keepFrom = start === 0 ? start : start + STRIDE / 2;
        const keepTo = end === n ? end : end - STRIDE / 2;
        for (let t = keepFrom; t < keepTo; t++) {
          const row = (t - start + 1) * L;
          let max = -Infinity;
          for (let k = 0; k < L; k++) max = Math.max(max, logits[row + k]!);
          let sum = 0;
          for (let k = 0; k < L; k++) sum += probs[t * L + k] = Math.exp(logits[row + k]! - max);
          for (let k = 0; k < L; k++) probs[t * L + k]! /= sum;
        }
        if (end === n) break;
      }
      return decodeBio(probs, L, offsets, cfg.labels);
    },
    async dispose() {
      await session.release?.();
    },
  };
}
