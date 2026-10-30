// Seeded generators for checksum-valid identifiers and fictional people used in labelled
// augmentation rows. Nothing here is a real person or a real issued number.
import { abnValid, luhnValid, verhoeffCheckDigit } from '../../src/engine/tier1/checksums';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = ReturnType<typeof rng>;
export const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const digits = (r: Rand, n: number) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');

export function validTfn(r: Rand): string {
  const w = [1, 4, 3, 7, 5, 8, 6, 9, 10];
  for (;;) {
    const d = digits(r, 8);
    let s = 0;
    for (let i = 0; i < 8; i++) s += +d[i]! * w[i]!;
    const last = ((11 - (s % 11)) * 10) % 11; // 10·x ≡ −s (mod 11) ⇒ x ≡ 10·(−s)
    if (last < 10) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}${last}`;
  }
}

export function validAbn(r: Rand): string {
  for (;;) {
    const d = `${1 + Math.floor(r() * 9)}${digits(r, 10)}`;
    if (abnValid(d)) return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  }
}

export function validAadhaar(r: Rand): string {
  const payload = `${2 + Math.floor(r() * 8)}${digits(r, 10)}`;
  const full = payload + verhoeffCheckDigit(payload);
  return `${full.slice(0, 4)} ${full.slice(4, 8)} ${full.slice(8)}`;
}

export function validPan(r: Rand): string {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const l = () => pick(r, L.split(''));
  return `${l()}${l()}${l()}P${l()}${digits(r, 4)}${l()}`;
}

export function validVisa(r: Rand): string {
  for (;;) {
    const d = `4${digits(r, 15)}`;
    if (luhnValid(d)) return d;
  }
}

export function luhnFailing16(r: Rand, prefix = '4'): string {
  for (;;) {
    const d = `${prefix}${digits(r, 16 - prefix.length)}`;
    if (!luhnValid(d)) return d;
  }
}

export function strongPassword(r: Rand, len = 14): string {
  const sets = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%&*?'];
  const chars = sets.map((s) => pick(r, s.split('')));
  while (chars.length < len) chars.push(pick(r, pick(r, sets).split('')));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

const GIVEN = ['Harriet', 'Theo', 'Imogen', 'Rafael', 'Priyanka', 'Callum', 'Ingrid', 'Kwame', 'Saoirse', 'Mateo', 'Lucinda', 'Arjun', 'Freya', 'Desmond', 'Noor', 'Tomasz'];
const FAMILY = ['Lindqvist', 'Marchetti', 'Okonjo', 'Ferreira', 'Raghavan', 'Whitlock', 'Achterberg', 'Mensah', 'Kilbride', 'Navarro', 'Pemberton', 'Iyer', 'Halvorsen', 'Castellano', 'Haddad', 'Kowalski'];
export const fictionalName = (r: Rand) => `${pick(r, GIVEN)} ${pick(r, FAMILY)}`;

export const CONDITIONS = ['type 2 diabetes mellitus', 'chronic obstructive pulmonary disease', 'major depressive disorder', 'atrial fibrillation', 'rheumatoid arthritis', 'stage III colon cancer', 'bipolar disorder', 'chronic kidney disease', 'hepatitis C', 'multiple sclerosis'];
export const DRUGS = ['metformin 1000 mg', 'tiotropium 18 mcg', 'sertraline 100 mg', 'apixaban 5 mg', 'methotrexate 15 mg', 'oxaliplatin 85 mg/m2', 'lithium 450 mg', 'furosemide 40 mg', 'sofosbuvir 400 mg', 'ocrelizumab 600 mg'];

export function money(r: Rand, min = 1_000, max = 5_000_000): string {
  const v = Math.round(min + r() * (max - min));
  return `$${v.toLocaleString('en-US')}.${String(Math.floor(r() * 100)).padStart(2, '0')}`;
}
