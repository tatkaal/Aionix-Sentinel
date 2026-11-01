/** Shannon entropy in bits per character. */
export function shannonEntropy(s: string): number {
  const len = s.length;
  if (len === 0) return 0;
  const counts = new Map<number, number>();
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let h = 0;
  for (const n of counts.values()) {
    const p = n / len;
    h -= p * Math.log2(p);
  }
  return h;
}

export interface CharClasses {
  lower: boolean;
  upper: boolean;
  digit: boolean;
  symbol: boolean;
  count: number;
}

export function charClasses(s: string): CharClasses {
  let lower = false;
  let upper = false;
  let digit = false;
  let symbol = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 97 && c <= 122) lower = true;
    else if (c >= 65 && c <= 90) upper = true;
    else if (c >= 48 && c <= 57) digit = true;
    else if (c > 32) symbol = true;
  }
  return { lower, upper, digit, symbol, count: +lower + +upper + +digit + +symbol };
}

/** Planned threshold for unlabelled secrets. */
export const ENTROPY_THRESHOLD = 3.85;

/**
 * Entropy threshold adjusted for short tokens. A string of length L can reach at most log2(L)
 * bits/char, so for L < 16 a fixed 3.85 is unreachable. Short tokens instead must be
 * near-maximal (log2(L) − 0.35). From 16 characters on, the planned 3.85 applies unchanged.
 */
export function entropyThresholdFor(length: number): number {
  return length >= 16 ? ENTROPY_THRESHOLD : Math.log2(length) - 0.35;
}
