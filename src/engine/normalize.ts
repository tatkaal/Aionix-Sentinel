// Offset-preserving normaliser. Every normalised character remembers the raw index it came from
// (`toRaw`), so findings computed on the cleaned stream map back to exact DOM offsets for redaction.

export interface Normalized {
  text: string;
  /** toRaw[i] = raw index of normalised char i; toRaw[text.length] = raw.length. */
  toRaw: Int32Array;
}

function isZeroWidth(c: number): boolean {
  return (c >= 0x200b && c <= 0x200d) || c === 0x2060 || c === 0xfeff || c === 0x00ad;
}

/** Separators people use to obfuscate numbers: spaces, NBSP/thin spaces, dashes, dots. */
export function isNumberSeparator(c: number): boolean {
  return (
    c === 0x20 ||
    c === 0x09 ||
    c === 0xa0 ||
    c === 0x2009 ||
    c === 0x202f ||
    c === 0x2d /* - */ ||
    c === 0x2010 ||
    c === 0x2011 ||
    c === 0x2012 ||
    c === 0x2013 ||
    c === 0x2e /* . */
  );
}

/**
 * Stream 1 ("clean"): drops zero-width/soft-hyphen characters and folds full-width digits to ASCII.
 * With `stripSeparators`, stream 2 also drops whitespace, dashes and dots.
 */
export function normalize(raw: string, stripSeparators = false): Normalized {
  const len = raw.length;
  const codes = new Uint16Array(len);
  const toRaw = new Int32Array(len + 1);
  let n = 0;
  for (let i = 0; i < len; i++) {
    let c = raw.charCodeAt(i);
    if (isZeroWidth(c)) continue;
    if (stripSeparators && (isNumberSeparator(c) || c === 0x0a || c === 0x0d)) continue;
    if (c >= 0xff10 && c <= 0xff19) c = c - 0xff10 + 0x30;
    codes[n] = c;
    toRaw[n] = i;
    n++;
  }
  toRaw[n] = len;
  let text = '';
  const CHUNK = 8192;
  for (let i = 0; i < n; i += CHUNK) {
    text += String.fromCharCode.apply(null, codes.subarray(i, Math.min(n, i + CHUNK)) as unknown as number[]);
  }
  return { text, toRaw: toRaw.subarray(0, n + 1) };
}

/** Maps a half-open normalised span [start, end) to raw offsets. */
export function toRawSpan(norm: Normalized, start: number, end: number): { rawStart: number; rawEnd: number } {
  const rawStart = norm.toRaw[start]!;
  const rawEnd = end > start ? norm.toRaw[end - 1]! + 1 : rawStart;
  return { rawStart, rawEnd };
}

export interface DigitGroup {
  start: number;
  end: number;
}

export interface DigitRun {
  start: number;
  end: number;
  groups: DigitGroup[];
}

const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const isWordChar = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f;

/**
 * Finds digit runs whose groups are separated by at most `maxGap` separator characters,
 * e.g. "4532 - 0151 - 1283 - 0366" → one run with four groups.
 * Runs glued to letters (e.g. inside "AKIA…" or "INV2023") are skipped.
 */
export function findDigitRuns(text: string, maxGap = 3): DigitRun[] {
  const runs: DigitRun[] = [];
  const len = text.length;
  let i = 0;
  while (i < len) {
    if (!isDigit(text.charCodeAt(i))) {
      i++;
      continue;
    }
    const prev = i > 0 ? text.charCodeAt(i - 1) : 0;
    const glued = i > 0 && isWordChar(prev);
    const groups: DigitGroup[] = [];
    let j = i;
    for (;;) {
      const gs = j;
      while (j < len && isDigit(text.charCodeAt(j))) j++;
      groups.push({ start: gs, end: j });
      let k = j;
      let gap = 0;
      while (k < len && gap <= maxGap && isNumberSeparator(text.charCodeAt(k))) {
        k++;
        gap++;
      }
      if (gap > 0 && gap <= maxGap && k < len && isDigit(text.charCodeAt(k))) {
        j = k;
        continue;
      }
      break;
    }
    const next = j < len ? text.charCodeAt(j) : 0;
    if (!glued && !isWordChar(next)) runs.push({ start: i, end: j, groups });
    i = j;
  }
  return runs;
}

export function groupDigits(text: string, groups: DigitGroup[], from: number, to: number): string {
  let s = '';
  for (let g = from; g <= to; g++) s += text.slice(groups[g]!.start, groups[g]!.end);
  return s;
}
