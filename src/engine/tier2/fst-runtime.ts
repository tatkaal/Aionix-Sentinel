// Runtime for medical.fst.bin. Walks a flat Uint32Array: no per-token object allocation on the
// exact-match path. Matches are longest-match at word starts on an offset-preserving normalised
// copy of the prompt; a bounded Levenshtein ≤ 1 search covers misspelt medication names.
import { FST_CLASS, FST_MAGIC, normalizeTermChar, OUTPUT_SEP, type FstClass } from './fst-format';

const HEADER = 4;
const MAX_TERM_CHARS = 72;

export interface FstMatch {
  /** Raw offsets in the original text. */
  start: number;
  end: number;
  term: string;
  outputs: string[];
  fuzzy: boolean;
}

export interface NormalizedLower {
  text: string;
  toRaw: Int32Array;
}

/** Lower-cases, strips accents and maps punctuation to spaces, keeping raw offsets. */
export function normalizeForFst(raw: string): NormalizedLower {
  const toRaw = new Int32Array(raw.length + 1);
  let text = '';
  let n = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = normalizeTermChar(raw[i]!);
    if (c === ' ' && text.endsWith(' ')) continue;
    text += c;
    toRaw[n++] = i;
  }
  toRaw[n] = raw.length;
  return { text, toRaw: toRaw.subarray(0, n + 1) };
}

export class Fst {
  private readonly w: Uint32Array;
  readonly nodeCount: number;
  readonly entryCount: number;
  readonly byteLength: number;

  constructor(buf: ArrayBuffer | Uint8Array) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const aligned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
    const all = new Uint32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength >>> 2);
    if (all[0] !== FST_MAGIC) throw new Error('medical.fst.bin: bad magic');
    this.nodeCount = all[2]!;
    this.entryCount = all[3]!;
    this.w = all.subarray(HEADER);
    this.byteLength = bytes.byteLength;
  }

  /** Follows the edge labelled `ch` from `node`; -1 when absent. Edges are sorted by label. */
  next(node: number, ch: number): number {
    const w = this.w;
    const count = w[node]! >>> 1;
    for (let i = 1; i <= count; i++) {
      const e = w[node + i]!;
      const c = e >>> 24;
      if (c === ch) return e & 0xffffff;
      if (c > ch) return -1;
    }
    return -1;
  }

  isFinal(node: number): boolean {
    return (this.w[node]! & 1) === 1;
  }

  /** Output strings reachable after the separator (a term can carry several classes). */
  outputs(node: number, limit = 6): string[] {
    const start = this.next(node, OUTPUT_SEP);
    if (start < 0) return [];
    const out: string[] = [];
    const walk = (n: number, acc: string) => {
      if (out.length >= limit) return;
      if (this.isFinal(n)) out.push(acc);
      const count = this.w[n]! >>> 1;
      for (let i = 1; i <= count && out.length < limit; i++) {
        const e = this.w[n + i]!;
        walk(e & 0xffffff, acc + String.fromCharCode(e >>> 24));
      }
    };
    walk(start, '');
    return out;
  }

  hasOutput(node: number): boolean {
    return this.next(node, OUTPUT_SEP) >= 0;
  }

  /** Exact lookup of a whole normalised term. */
  lookup(term: string): string[] {
    let node = 0;
    for (let i = 0; i < term.length; i++) {
      node = this.next(node, term.charCodeAt(i));
      if (node < 0) return [];
    }
    return this.outputs(node);
  }

  /** Longest-match scan at every word start. */
  scan(raw: string, opts: { fuzzy?: boolean } = {}): FstMatch[] {
    const { text, toRaw } = normalizeForFst(raw);
    const len = text.length;
    const matches: FstMatch[] = [];
    let i = 0;
    while (i < len) {
      if (text.charCodeAt(i) === 32 || (i > 0 && text.charCodeAt(i - 1) !== 32)) {
        i++;
        continue;
      }
      let node = 0;
      let bestEnd = -1;
      let bestOutputs: string[] = [];
      let commonWord = false;
      let firstWordEnd = -1;
      for (let j = i; j < len && j - i < MAX_TERM_CHARS; j++) {
        node = this.next(node, text.charCodeAt(j));
        if (node < 0) break;
        const atBoundary = j + 1 === len || text.charCodeAt(j + 1) === 32;
        if (atBoundary && firstWordEnd < 0) firstWordEnd = j + 1;
        if (atBoundary && this.hasOutput(node)) {
          const outs = this.outputs(node);
          const real = outs.filter((o) => o[0] !== FST_CLASS.commonWord);
          if (real.length) {
            bestEnd = j + 1;
            bestOutputs = real;
          }
          if (j + 1 === firstWordEnd && real.length < outs.length) commonWord = true;
        }
      }
      if (bestEnd > 0) {
        matches.push({ start: toRaw[i]!, end: toRaw[bestEnd - 1]! + 1, term: text.slice(i, bestEnd), outputs: bestOutputs, fuzzy: false });
        i = bestEnd;
        continue;
      }
      if (opts.fuzzy) {
        let e = i;
        while (e < len && text.charCodeAt(e) !== 32) e++;
        const word = text.slice(i, e);
        if (!commonWord && word.length >= 7 && /^[a-z]+$/.test(word)) {
          const hit = this.fuzzyWord(word, FST_CLASS.medication);
          if (hit) matches.push({ start: toRaw[i]!, end: toRaw[e - 1]! + 1, term: hit.term, outputs: hit.outputs, fuzzy: true });
        }
        i = e;
        continue;
      }
      i++;
    }
    return matches;
  }

  /** Damerau–Levenshtein (OSA) ≤ 1 search restricted to single-word terms of one output class. */
  fuzzyWord(word: string, cls: FstClass, budget = 1500): { term: string; outputs: string[] } | null {
    const L = word.length;
    const width = L + 1;
    const maxDepth = L + 1; // edit distance ≤ 1 ⇒ matched term length ≤ L + 1
    // One preallocated DP row per depth — the search allocates nothing per visited node.
    const rows = new Int32Array((maxDepth + 1) * width);
    for (let k = 0; k <= L; k++) rows[k] = k;
    const path = new Uint8Array(maxDepth);
    let visits = 0;
    let found: { term: string; outputs: string[] } | null = null;
    const dfs = (node: number, depth: number) => {
      if (found || ++visits > budget) return;
      const prev = depth * width;
      if (depth > 0 && rows[prev + L]! <= 1) {
        const outs = this.outputs(node).filter((o) => o[0] === cls);
        if (outs.length) {
          found = { term: String.fromCharCode(...path.subarray(0, depth)), outputs: outs };
          return;
        }
      }
      if (depth >= maxDepth) return;
      const cur = prev + width;
      const count = this.w[node]! >>> 1;
      for (let k = 1; k <= count; k++) {
        const e = this.w[node + k]!;
        const ch = e >>> 24;
        if (ch < 97 || ch > 122) continue; // letters only: stay within one word
        rows[cur] = rows[prev]! + 1;
        let min = rows[cur]!;
        const chPrev = depth > 0 ? path[depth - 1]! : -1;
        for (let x = 1; x <= L; x++) {
          const cost = word.charCodeAt(x - 1) === ch ? 0 : 1;
          let v = Math.min(rows[cur + x - 1]! + 1, rows[prev + x]! + 1, rows[prev + x - 1]! + cost);
          // Optimal string alignment: an adjacent transposition ("metfromin") costs 1.
          if (x > 1 && depth > 0 && word.charCodeAt(x - 1) === chPrev && word.charCodeAt(x - 2) === ch) {
            v = Math.min(v, rows[prev - width + x - 2]! + 1);
          }
          rows[cur + x] = v;
          if (v < min) min = v;
        }
        if (min <= 1) {
          path[depth] = ch;
          dfs(e & 0xffffff, depth + 1);
        }
        if (found) return;
      }
    };
    dfs(0, 0);
    return found;
  }
}

export function outputClass(o: string): FstClass {
  return o[0] as FstClass;
}
