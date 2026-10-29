// Mathematical validators for Tier 1. All functions take a pure digit string (already normalised).

/** Luhn mod-10 (payment cards). */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/** Benign test/sandbox card numbers that must never block (Stripe/Braintree documentation cards). */
export const TEST_CARD_ALLOWLIST: ReadonlySet<string> = new Set([
  '4242424242424242',
  '4000000000000002',
  '5555555555554444',
  '4111111111111111',
  '4000056655665556',
  '5105105105105100',
  '378282246310005',
  '6011111111111117',
]);

/** Issuer identification prefixes for the major networks (filters Luhn-passing order numbers). */
export function cardNetwork(d: string): string | null {
  const n2 = +d.slice(0, 2);
  const n3 = +d.slice(0, 3);
  const n4 = +d.slice(0, 4);
  const n6 = +d.slice(0, 6);
  const L = d.length;
  if (d[0] === '4' && (L === 13 || L === 16 || L === 19)) return 'Visa';
  if (((n2 >= 51 && n2 <= 55) || (n4 >= 2221 && n4 <= 2720)) && L === 16) return 'Mastercard';
  if ((n2 === 34 || n2 === 37) && L === 15) return 'Amex';
  if ((n4 === 6011 || n2 === 65 || (n3 >= 644 && n3 <= 649) || (n6 >= 622126 && n6 <= 622925)) && L >= 16) return 'Discover';
  if (n4 >= 3528 && n4 <= 3589 && L >= 16) return 'JCB';
  if (((n3 >= 300 && n3 <= 305) || n2 === 36 || n2 === 38) && L >= 14) return 'Diners';
  if (n2 === 62 && L >= 16) return 'UnionPay';
  if ((n2 === 50 || (n2 >= 56 && n2 <= 69)) && L >= 12) return 'Maestro';
  return null;
}

const TFN_WEIGHTS = [1, 4, 3, 7, 5, 8, 6, 9, 10];

/** Australian Tax File Number: 9 digits, Σ dᵢ·wᵢ ≡ 0 (mod 11). */
export function tfnValid(digits: string): boolean {
  if (digits.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (digits.charCodeAt(i) - 48) * TFN_WEIGHTS[i]!;
  return sum % 11 === 0;
}

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** Australian Business Number: subtract 1 from the first digit, Σ dᵢ·wᵢ ≡ 0 (mod 89). */
export function abnValid(digits: string): boolean {
  if (digits.length !== 11 || digits[0] === '0') return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    let d = digits.charCodeAt(i) - 48;
    if (i === 0) d -= 1;
    sum += d * ABN_WEIGHTS[i]!;
  }
  return sum % 89 === 0;
}

// Verhoeff (dihedral group D5) tables.
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
export const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeffValid(digits: string): boolean {
  let c = 0;
  const L = digits.length;
  for (let i = 0; i < L; i++) {
    const d = digits.charCodeAt(L - 1 - i) - 48;
    c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![d]!]!;
  }
  return c === 0;
}

/** Computes the Verhoeff check digit for a payload (used by dataset augmentation and tests). */
export function verhoeffCheckDigit(payload: string): number {
  let c = 0;
  const L = payload.length;
  for (let i = 0; i < L; i++) {
    const d = payload.charCodeAt(L - 1 - i) - 48;
    c = VERHOEFF_D[c]![VERHOEFF_P[(i + 1) % 8]![d]!]!;
  }
  return VERHOEFF_INV[c]!;
}

/** Aadhaar: 12 digits, first digit 2–9, Verhoeff-valid. */
export function aadhaarValid(digits: string): boolean {
  return /^[2-9]\d{11}$/.test(digits) && verhoeffValid(digits);
}

const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, CH: 21, CR: 22, CY: 28, CZ: 24,
  DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18,
  GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LI: 21,
  LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24,
  PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SE: 24, SI: 19, SK: 24, SM: 27, TN: 24, TR: 26,
  UA: 29, VG: 24, XK: 20,
};

/** IBAN: country length table + ISO 7064 mod-97 == 1. Input may contain spaces. */
export function ibanValid(input: string): boolean {
  const s = input.replace(/\s+/g, '').toUpperCase();
  const expected = IBAN_LENGTHS[s.slice(0, 2)];
  if (!expected || s.length !== expected || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const val = code >= 65 ? String(code - 55) : ch;
    for (const v of val) rem = (rem * 10 + (v.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

/** US ABA routing number: 3·d1 + 7·d2 + 1·d3 + … ≡ 0 (mod 10). */
export function abaRoutingValid(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (digits.charCodeAt(i) - 48) * w[i]!;
  return sum % 10 === 0 && sum > 0;
}

/** US SSN structural rules (area ≠ 000/666/9xx, group ≠ 00, serial ≠ 0000). */
export function ssnStructValid(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const area = digits.slice(0, 3);
  return area !== '000' && area !== '666' && area[0] !== '9' && digits.slice(3, 5) !== '00' && digits.slice(5) !== '0000';
}
