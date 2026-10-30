// SentencePiece Unigram tokenizer with offsets, for the trimmed XLM-R vocabulary of the Path B tagger.
// Reproduces the pipeline written by scripts/ml/trim_vocab.py (Hugging Face `tokenizers`):
// no normaliser · split on Unicode whitespace · '▁' prefix per word · Viterbi over pieces with their
// log-probabilities · characters no piece covers become <unk>, and adjacent <unk>s fuse.
// Offsets are UTF-16 code units into the input, like every other engine offset.

export interface UnigramJson {
  model: { type: 'Unigram'; unk_id: number; vocab: [string, number][] };
}

export interface UnigramEncoding {
  ids: number[];
  /** [start, end) per token, UTF-16 code units. */
  offsets: [number, number][];
}

interface TrieNode {
  next: Map<number, TrieNode>;
  id: number;
  score: number;
}

const node = (): TrieNode => ({ next: new Map(), id: -1, score: 0 });
const SPACE = 0x2581; // ▁
// Rust's char::is_whitespace (Unicode White_Space), which `WhitespaceSplit` uses.
const WHITESPACE = /[\t-\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

export function createUnigramTokenizer(json: UnigramJson) {
  const { vocab, unk_id: unkId } = json.model;
  const root = node();
  let minScore = Infinity;
  vocab.forEach(([piece, score], id) => {
    if (id === unkId) return;
    let n = root;
    for (const ch of piece) {
      const cp = ch.codePointAt(0)!;
      let child = n.next.get(cp);
      if (!child) n.next.set(cp, (child = node()));
      n = child;
    }
    n.id = id;
    n.score = score;
    minScore = Math.min(minScore, score);
  });
  const unkScore = minScore - 10;

  /** Viterbi over one word (code points of '▁' + word); returns [id, cpStart, cpEnd] triples. */
  function segment(cps: number[]): [number, number, number][] {
    const n = cps.length;
    const best = new Float64Array(n + 1).fill(-Infinity);
    const from = new Int32Array(n + 1).fill(-1);
    const via = new Int32Array(n + 1).fill(-1);
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      let t: TrieNode | undefined = root;
      let single = false;
      for (let j = i; j < n && t; j++) {
        t = t.next.get(cps[j]!);
        if (!t) break;
        if (t.id >= 0) {
          if (j === i) single = true;
          const s = best[i]! + t.score;
          if (s > best[j + 1]!) {
            best[j + 1] = s;
            from[j + 1] = i;
            via[j + 1] = t.id;
          }
        }
      }
      if (!single) {
        const s = best[i]! + unkScore;
        if (s > best[i + 1]!) {
          best[i + 1] = s;
          from[i + 1] = i;
          via[i + 1] = unkId;
        }
      }
    }
    const out: [number, number, number][] = [];
    for (let e = n; e > 0; e = from[e]!) out.push([via[e]!, from[e]!, e]);
    out.reverse();
    // Fuse consecutive unknowns, as `tokenizers` does for Unigram.
    const fused: [number, number, number][] = [];
    for (const t of out) {
      const last = fused.at(-1);
      if (last && last[0] === unkId && t[0] === unkId) last[2] = t[2];
      else fused.push(t);
    }
    return fused;
  }

  return {
    unkId,
    vocabSize: vocab.length,
    encode(text: string): UnigramEncoding {
      const ids: number[] = [];
      const offsets: [number, number][] = [];
      let at = 0;
      const words: [number, number][] = [];
      WHITESPACE.lastIndex = 0;
      for (let m = WHITESPACE.exec(text); m; m = WHITESPACE.exec(text)) {
        if (m.index > at) words.push([at, m.index]);
        at = m.index + m[0].length;
      }
      if (at < text.length) words.push([at, text.length]);
      for (const [ws, we] of words) {
        // Code points of '▁' + word, and the UTF-16 offset where each code point starts (▁ → ws).
        const cps = [SPACE];
        const pos = [ws];
        for (let k = ws; k < we; ) {
          const cp = text.codePointAt(k)!;
          cps.push(cp);
          pos.push(k);
          k += cp > 0xffff ? 2 : 1;
        }
        pos.push(we);
        for (const [id, s, e] of segment(cps)) {
          ids.push(id);
          // The '▁' (code point 0) has no source character. Like `tokenizers`, a bare '▁' token
          // takes the span of the word's first character; longer tokens start at the word.
          offsets.push([pos[s]!, e === 1 ? pos[2]! : pos[e]!]);
        }
      }
      return { ids, offsets };
    },
  };
}

export type UnigramTokenizer = ReturnType<typeof createUnigramTokenizer>;
