// Shared conventions for medical.fst.bin — a minimal acyclic finite-state transducer.
// Each entry is stored as `term + OUTPUT_SEP + output`, so the transducer's outputs live on the
// suffix paths after the separator and minimisation shares them across terms.

export const FST_MAGIC = 0x31465841; // "AXF1"
export const OUTPUT_SEP = 0x01;

/** Output classes (first character of the output string). */
export const FST_CLASS = {
  condition: 'C',
  /** RxNorm ingredient (IN/PIN) — the only medication class fuzzy matching may produce. */
  medication: 'M',
  /** RxNorm brand name (BN) — exact match only: coined brands sit one edit from everyday words
   *  in other languages ("Journavx" ~ "journaux", "Stimate" ~ "stimato"). */
  brand: 'B',
  financial: 'F',
  firstName: 'N',
  publicFigure: 'P',
  /** Everyday word (≥ 7 letters; English BERT + multilingual XLM-R vocabularies) — never a fuzzy-match candidate. */
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
