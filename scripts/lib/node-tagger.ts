import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ort from 'onnxruntime-node';
import type { OrtLike } from '../../src/engine/embed/minilm';
import { createTokenTagger } from '../../src/engine/embed/token-tagger';
import type { UnigramJson } from '../../src/engine/embed/unigram';
import type { TaggerManifest } from '../../src/engine/runtime/ort-web-tagger';
import type { NeuralNer } from '../../src/engine/tier2/webgpu-path';

/** The shipped Path B tagger (assets/engine/pathb) on onnxruntime-node — same bytes as the extension. */
export async function createNodeTagger(dir: string, threads = 4): Promise<{ ner: NeuralNer; bytes: number }> {
  const manifest = JSON.parse(readFileSync(resolve(dir, 'tagger.json'), 'utf8')) as TaggerManifest;
  const model = readFileSync(resolve(dir, manifest.model));
  const tokenizer = JSON.parse(readFileSync(resolve(dir, manifest.tokenizer), 'utf8')) as UnigramJson;
  const ner = await createTokenTagger(ort as unknown as OrtLike, new Uint8Array(model), tokenizer, manifest, { intraOpNumThreads: threads });
  return { ner, bytes: model.byteLength };
}
