// BERT (uncased) WordPiece tokenizer for all-MiniLM-L6-v2. Self-contained so Tier 2 Path A and
// Tier 3 Path B need only the CPU ONNX Runtime wasm — not the full Transformers.js stack.

export interface Encoded {
  ids: number[];
  /** Raw character span for each id ([CLS]/[SEP] get [-1, -1]). */
  spans: [number, number][];
}

function isPunctuation(cp: number, ch: string): boolean {
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) return true;
  return /\p{P}/u.test(ch);
}

function isCjk(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) ||
    (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}

function normalizeWord(w: string): string {
  return w.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
}

export class WordPieceTokenizer {
  private readonly vocab: Map<string, number>;
  readonly clsId: number;
  readonly sepId: number;
  readonly unkId: number;
  readonly padId: number;

  constructor(vocabText: string) {
    this.vocab = new Map();
    vocabText.split(/\r?\n/).forEach((tok, i) => {
      if (tok.length) this.vocab.set(tok, i);
    });
    this.clsId = this.vocab.get('[CLS]') ?? 101;
    this.sepId = this.vocab.get('[SEP]') ?? 102;
    this.unkId = this.vocab.get('[UNK]') ?? 100;
    this.padId = this.vocab.get('[PAD]') ?? 0;
  }

  /** Splits into basic tokens (whitespace / punctuation / CJK) with raw offsets. */
  private basic(text: string): { word: string; start: number; end: number }[] {
    const out: { word: string; start: number; end: number }[] = [];
    let cur = '';
    let curStart = 0;
    const flush = (end: number) => {
      if (cur) out.push({ word: cur, start: curStart, end });
      cur = '';
    };
    let i = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      const len = ch.length;
      if (cp === 0 || cp === 0xfffd || (cp < 32 && ch !== '\t' && ch !== '\n' && ch !== '\r')) {
        flush(i);
      } else if (/\s/u.test(ch)) {
        flush(i);
      } else if (isPunctuation(cp, ch) || isCjk(cp)) {
        flush(i);
        out.push({ word: ch, start: i, end: i + len });
      } else {
        if (!cur) curStart = i;
        cur += ch;
      }
      i += len;
    }
    flush(i);
    return out;
  }

  encode(text: string, maxLength = 256): Encoded {
    const ids: number[] = [this.clsId];
    const spans: [number, number][] = [[-1, -1]];
    const limit = maxLength - 1;
    outer: for (const { word, start, end } of this.basic(text)) {
      const norm = normalizeWord(word);
      if (!norm) continue;
      if (norm.length > 100) {
        ids.push(this.unkId);
        spans.push([start, end]);
        if (ids.length >= limit) break;
        continue;
      }
      const pieces: number[] = [];
      let s = 0;
      let bad = false;
      while (s < norm.length) {
        let e = norm.length;
        let found = -1;
        while (s < e) {
          const sub = (s > 0 ? '##' : '') + norm.slice(s, e);
          const id = this.vocab.get(sub);
          if (id !== undefined) {
            found = id;
            break;
          }
          e--;
        }
        if (found < 0) {
          bad = true;
          break;
        }
        pieces.push(found);
        s = e;
      }
      for (const id of bad ? [this.unkId] : pieces) {
        ids.push(id);
        spans.push([start, end]);
        if (ids.length >= limit) break outer;
      }
    }
    ids.push(this.sepId);
    spans.push([-1, -1]);
    return { ids, spans };
  }
}
