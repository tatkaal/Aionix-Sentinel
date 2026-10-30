import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeBio } from '../../src/engine/embed/token-tagger';
import { createUnigramTokenizer, type UnigramJson } from '../../src/engine/embed/unigram';

const root = resolve(import.meta.dirname, '../..');
const tokenizerPath = [resolve(root, 'assets/engine/pathb/tokenizer.json'), resolve(root, '.cache/ml/models/mminilm-l12-trim30k/tokenizer.json')].find(existsSync);
const cases = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/unigram-parity.json'), 'utf8')) as { text: string; ids: number[]; offsets: [number, number][] }[];

describe.skipIf(!tokenizerPath)('Path B Unigram tokenizer (parity with Hugging Face tokenizers)', () => {
  const tok = tokenizerPath ? createUnigramTokenizer(JSON.parse(readFileSync(tokenizerPath, 'utf8')) as UnigramJson) : null;
  it.each(cases.map((c) => [JSON.stringify(c.text).slice(0, 50), c] as const))('%s', (_, c) => {
    const enc = tok!.encode(c.text);
    expect(enc.ids).toEqual(c.ids);
    expect(enc.offsets).toEqual(c.offsets);
  });
});

describe('BIO decoding', () => {
  it('joins B/I runs of one kind into a span and averages their scores', () => {
    const labels = ['O', 'B-person', 'I-person', 'B-account', 'I-account'];
    const rows = [
      [0.1, 0.8, 0.05, 0.05, 0], // "Hi" → person? no: argmax B-person
      [0.9, 0.05, 0.05, 0, 0],
      [0.05, 0.9, 0.05, 0, 0],
      [0.05, 0.05, 0.9, 0, 0],
      [0.05, 0, 0, 0.9, 0.05],
      [0.05, 0, 0, 0.05, 0.9],
    ];
    const offsets: [number, number][] = [[0, 2], [3, 3], [4, 8], [8, 12], [20, 24], [24, 28]];
    const spans = decodeBio(new Float32Array(rows.flat()), labels.length, offsets, labels);
    expect(spans.map((s) => [s.label, s.start, s.end])).toEqual([
      ['person', 0, 2],
      ['person', 4, 12],
      ['account', 20, 28],
    ]);
    expect(spans[1]!.score).toBeCloseTo(0.9, 4);
  });
});
