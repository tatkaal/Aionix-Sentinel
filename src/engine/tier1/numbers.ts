// Checksum-validated numeric identifiers found in (possibly obfuscated) digit runs:
// payment cards (Cat 5), SSN (Cat 3), AU TFN (Cat 4), ABN and Aadhaar (Cat 6).
import { findDigitRuns, groupDigits } from '../normalize';
import { aadhaarValid, abnValid, cardNetwork, luhnValid, ssnStructValid, TEST_CARD_ALLOWLIST, tfnValid } from './checksums';
import { labelNear, type Candidate } from './candidate';

const TFN_LABEL = /\bTFN\b|tax\s*file/i;
const SSN_LABEL = /\bSSN\b|social\s*security/i;
const ABN_CONTEXT = /\bABN\b|business\s*number|\bpty\.?\s*ltd\b|\blimited\b|\bltd\b|\btrust\b|\bholdings\b|\binc\b|\bcorp(?:oration)?\b|\bgroup\b/i;
const AADHAAR_LABEL = /aadhaa?r|\bUID(?:AI)?\b|आधार/i;

type Classified = Candidate | 'consume' | null;

function sizesEqual(sizes: number[], pattern: number[]) {
  return sizes.length === pattern.length && sizes.every((s, i) => s === pattern[i]);
}

function classify(text: string, digits: string, sizes: number[], start: number, end: number): Classified {
  const L = digits.length;
  if (L >= 13 && L <= 19) {
    if (TEST_CARD_ALLOWLIST.has(digits)) return 'consume';
    const network = cardNetwork(digits);
    if (network && luhnValid(digits)) {
      return { start, end, category: 5, type: 'CREDIT_CARD', label: `${network} card number`, confidence: 0.97, evidence: `Luhn valid · ${network}`, priority: 6 };
    }
    return null;
  }
  if (L === 12) {
    if (aadhaarValid(digits) && (sizesEqual(sizes, [4, 4, 4]) || labelNear(text, start, end, AADHAAR_LABEL))) {
      return { start, end, category: 6, type: 'AADHAAR', label: 'Aadhaar number', confidence: 0.95, evidence: 'Verhoeff D5 valid', priority: 6 };
    }
    return null;
  }
  if (L === 11) {
    if (abnValid(digits) && labelNear(text, start, end, ABN_CONTEXT, 80, 80)) {
      return { start, end, category: 6, type: 'ABN', label: 'Australian Business Number', confidence: 0.94, evidence: 'Mod-89 valid + entity context', priority: 6 };
    }
    return null;
  }
  if (L === 9) {
    const tfnLabel = labelNear(text, start, end, TFN_LABEL);
    if (tfnLabel || sizesEqual(sizes, [3, 3, 3])) {
      if (tfnValid(digits)) {
        return { start, end, category: 4, type: 'TFN', label: 'AU Tax File Number', confidence: tfnLabel ? 0.97 : 0.9, evidence: 'Mod-11 valid', priority: 6 };
      }
      if (tfnLabel) return 'consume';
    }
    if (ssnStructValid(digits) && (sizesEqual(sizes, [3, 2, 4]) || labelNear(text, start, end, SSN_LABEL))) {
      return { start, end, category: 3, type: 'SSN', label: 'US Social Security number', confidence: 0.94, evidence: 'SSN structure', priority: 6 };
    }
    return null;
  }
  return null;
}

export function scanNumbers(text: string, out: Candidate[]): void {
  for (const run of findDigitRuns(text)) {
    const gs = run.groups;
    let gi = 0;
    while (gi < gs.length) {
      let advanced = false;
      for (let gj = gs.length - 1; gj >= gi; gj--) {
        const start = gs[gi]!.start;
        const end = gs[gj]!.end;
        let len = 0;
        for (let g = gi; g <= gj; g++) len += gs[g]!.end - gs[g]!.start;
        if (len > 19 || len < 9) continue;
        const sizes = gs.slice(gi, gj + 1).map((g) => g.end - g.start);
        const result = classify(text, groupDigits(text, gs, gi, gj), sizes, start, end);
        if (result) {
          if (result !== 'consume') out.push(result);
          gi = gj + 1;
          advanced = true;
          break;
        }
      }
      if (!advanced) gi++;
    }
  }
}
