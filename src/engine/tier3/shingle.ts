// Word-level k-shingling with raw offsets. The same function runs at index time (CI/CD vault
// build) and at query time (prompt + attachment chips), so hashes line up exactly.
import { fnv1a32 } from './hash';

export const SHINGLE_K = 5;

const STOPWORDS = new Set(
  'a an and are as at be been but by can could did do does for from had has have he her his i if in into is it its may me might my no not of on or our she should so such than that the their them then there these they this those to up us was we were what when which who will with would you your'.split(
    ' ',
  ),
);

/** Lines that carry no proprietary signal (imports, licence banners, blank/comment-only lines). */
const BOILERPLATE_LINE =
  /^\s*(?:import\s.+from\s|import\s+['"]|export\s+\*\s+from|from\s+\S+\s+import\s|#include\s|using\s+[\w.]+;|package\s+[\w.]+;|require\(|\/\/|#!|\/\*+|\*\/?\s|\*$|<!--|---\s*$|\s*$)/;

export function stripBoilerplate(text: string): string {
  return text
    .split('\n')
    .map((line) => (BOILERPLATE_LINE.test(line) ? '' : line))
    .join('\n');
}

export interface Token {
  text: string;
  start: number;
  end: number;
}

const TOKEN_RE = /[A-Za-z0-9_]+/g;

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(text); m; m = TOKEN_RE.exec(text)) {
    out.push({ text: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export interface Shingle {
  hash: number;
  /** Index of the first token of the shingle. */
  token: number;
  /** True when every word is a stopword — such shingles are generic and never counted. */
  generic: boolean;
}

export function shingles(tokens: Token[], k = SHINGLE_K): Shingle[] {
  const out: Shingle[] = [];
  for (let i = 0; i + k <= tokens.length; i++) {
    let s = tokens[i]!.text;
    let generic = STOPWORDS.has(s);
    for (let j = 1; j < k; j++) {
      const t = tokens[i + j]!.text;
      s += ' ' + t;
      if (!STOPWORDS.has(t)) generic = false;
    }
    out.push({ hash: fnv1a32(s), token: i, generic });
  }
  return out;
}

/** Distinct non-generic shingle hashes of a document (index time). */
export function documentShingleSet(text: string, k = SHINGLE_K): Uint32Array {
  const set = new Set<number>();
  for (const s of shingles(tokenize(stripBoilerplate(text)), k)) if (!s.generic) set.add(s.hash);
  return Uint32Array.from(set);
}
