// Shared conventions for medical.fst.bin — a minimal acyclic finite-state transducer.
// Each entry is stored as `term + OUTPUT_SEP + output`, so the transducer's outputs live on the
// suffix paths after the separator and minimisation shares them across terms.

export const FST_MAGIC = 0x31465841; // "AXF1"
export const OUTPUT_SEP = 0x01;

/** Output classes (first character of the output string). */
export const FST_CLASS = {
  condition: 'C',
  medication: 'M',
  financial: 'F',
  firstName: 'N',
  publicFigure: 'P',
  /** Common English word (≥ 7 letters) — never a fuzzy-match candidate. */
  commonWord: 'W',
} as const;
export type FstClass = (typeof FST_CLASS)[keyof typeof FST_CLASS];

/** Canonical term form used at build time and (char-by-char) at match time. */
export function normalizeTermChar(ch: string): string {
  const lower = ch.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
  const c = lower[0] ?? ' ';
  if (c === '’' || c === '`') return "'";
  return /[a-z0-9']/.test(c) ? c : ' ';
}

export function normalizeTerm(term: string): string {
  let out = '';
  for (const ch of term) out += normalizeTermChar(ch);
  return out.replace(/\s+/g, ' ').trim();
}
