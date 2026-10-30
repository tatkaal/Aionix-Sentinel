import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ort from 'onnxruntime-node';
import { createMiniLmEmbedder, type Embedder, type OrtLike } from '../../src/engine/embed/minilm';

/** MiniLM on onnxruntime-node — same model bytes and tokenizer as the browser path. */
export async function createNodeEmbedder(modelDir: string): Promise<Embedder> {
  const model = readFileSync(resolve(modelDir, 'model_quantized.onnx'));
  const vocab = readFileSync(resolve(modelDir, 'vocab.txt'), 'utf8');
  return createMiniLmEmbedder(ort as unknown as OrtLike, new Uint8Array(model), vocab, { intraOpNumThreads: 1 });
}
