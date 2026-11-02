// "The model proposes, the rules decide" for Path B secrets and government IDs (ADR-007 addendum).
// A neural span becomes a finding only when deterministic evidence agrees: a secret must be
// password-shaped or sit near a credential cue, and must not be a placeholder, a code reference or one
// of our own redaction tags; a government ID must pass a known structure or checksum, or sit next to an
// ID label. The model adds recall where rules have no anchor; the rules keep its false alarms out.
import { aadhaarValid, abnValid, dniValid, ean13Valid, medicareValid, nirValid, ssnStructValid, tfnValid } from '../tier1/checksums';
import { PLACEHOLDER } from '../tier1/patterns';
import { CODE_REFERENCE, CREDENTIAL_CUE, ENV_NAME, NON_SECRET_VALUE, NOT_A_PASSWORD, PHRASE_CUES, passwordShaped, STRONG_SYMBOL } from '../tier1/secrets';
import type { CategoryId } from '../types';

export interface NeuralGates {
  /** Minimum tagger score for a secret span. */
  secretMinScore: number;
  /** Words before or after a secret span within which a credential cue counts. */
  secretCueWindow: number;
  /** Minimum tagger score for a government-ID span. */
  govIdMinScore: number;
  /** Words before or after a government-ID span within which an ID label counts. */
  govIdLabelWindow: number;
}

/**
 * Cues for the gate: Tier 1's credential words plus the verbs and objects people use when they state a
 * credential without naming it ("unlocks with", "the door code", "the wifi is"). Fixed before any
 * experiment; thresholds and windows are what dev-split selection tunes.
 */
const GATE_CUE = /^(?:codes?|codice|c[oó]digo|unlock(?:s|ed|ing)?|entsperr\w*|d[ée]verrouill\w*|wi-?fi|wlan|vpn|clave|chiave|mdp|pins?)$/i;
// Specific ID words only: generic "numéro" / "numero" / "Nummer" also label IMEIs and phone numbers (dev).
const ID_LABEL =
  /^(?:ids?|ssn|social|security|passports?|passeport|pasaporte|passaporto|reisepass|licen[cs]es?|permis|f[üu]hrerschein|national|nino|insurance|tfn|abn|pan|aadhaar|medicare|nir|s[ée]cu|s[ée]curit[ée]|sociale?|ausweis|personalausweis|steuer-?id|steuernummer|dni|nie|nif|codice|fiscale|bsn|personnummer|pesel|ahv|avs|tax)$/i;
// Algorithm and format names are what a credential is hashed or encoded with, not the credential.
const TECH_TERM = /^(?:argon2(?:id|i|d)?|bcrypt|scrypt|pbkdf2|sha-?(?:1|256|384|512)|md5|aes(?:-?\d+)?|rsa|hmac|base64|utf-?8|jwt|oauth2?|saml|ldap|kerberos|ntlm|totp|hotp)$/i;
const NINO = /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]$/i;
const CODICE_FISCALE = /^[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]$/i;
const PAN = /^[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]$/i;
const REDACTION_TAG = /\[REDACTED_[A-Z0-9_]+\]/;

interface Word {
  w: string;
  start: number;
  end: number;
}

function words(text: string): Word[] {
  const out: Word[] = [];
  const re = /[^\s"'`<>()[\]{},;]+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const w = m[0].replace(/[.,:!?]+$/, '').replace(/^[^\p{L}\p{N}]+/u, '');
    if (w) out.push({ w, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Word index range [first, last] covering a character span. */
function spanWords(ws: Word[], start: number, end: number): [number, number] | null {
  const idx = ws.flatMap((w, i) => (w.start < end && start < w.end ? [i] : []));
  return idx.length ? [idx[0]!, idx.at(-1)!] : null;
}

/**
 * The whole whitespace token around a span, minus a CLI flag or `key=` prefix: a tagger can cut a span out
 * of a longer token ("p$MYSQL_ROOT_" of "-p$MYSQL_ROOT_PASSWORD", the middle of a crypto address).
 */
function tokenAround(text: string, start: number, end: number): string {
  let s = start;
  let e = end;
  while (s > 0 && !/[\s"'`<>()[\]{},;]/.test(text[s - 1]!)) s--;
  while (e < text.length && !/[\s"'`<>()[\]{},;]/.test(text[e]!)) e++;
  return text
    .slice(s, e)
    .replace(/[.,:!?]+$/, '')
    .replace(/^--?[A-Za-z][\w-]*=?(?=\S)/, (flag) => (flag.length <= 2 || flag.endsWith('=') ? '' : flag))
    .replace(/^[A-Za-z_][\w.-]*[=:](?=\S)/, '');
}

/**
 * A cue before the value may sit in the previous sentence ("… the password for it. Usually it is admin"); a
 * cue after it must be in the same sentence ("X is my password"), not the start of the next one.
 */
function cueNear(text: string, ws: Word[], range: [number, number], window: number, test: (w: string) => boolean): string | null {
  const lo = Math.max(0, range[0] - window);
  let hi = range[1];
  while (hi < Math.min(ws.length - 1, range[1] + window) && !/[.!?\n]/.test(text.slice(ws[hi]!.end - 1, ws[hi + 1]!.start))) hi++;
  for (let i = lo; i <= hi; i++) {
    if (i >= range[0] && i <= range[1]) continue;
    if (test(ws[i]!.w)) return ws[i]!.w;
  }
  // Multi-word cues ("mot de passe", "log in") inside the same window of characters.
  const from = ws[lo]!.start;
  const to = ws[hi]!.end;
  PHRASE_CUES.lastIndex = 0;
  for (let m = PHRASE_CUES.exec(text); m; m = PHRASE_CUES.exec(text)) if (m.index >= from && m.index < to) return m[0];
  return null;
}

/** Evidence for a neural secret span, or null when the rules do not confirm it. */
export function confirmSecret(text: string, start: number, end: number, score: number, gates: NeuralGates): string | null {
  const value = text.slice(start, end).trim();
  if (score < gates.secretMinScore || value.length < 3 || /\s{2,}|\n/.test(value)) return null;
  const token = tokenAround(text, start, end);
  // A credential is a whole token: a span cut out of a longer word ("121kChi" of "121kChilean") is not one.
  // (The token drops trailing sentence punctuation, which may also end the value: "Summer2024!".)
  if (token !== value && token !== value.replace(/[.,:!?]+$/, '') && !value.includes(' ')) return null;
  for (const v of new Set([value, token])) {
    if (PLACEHOLDER.test(v) || NON_SECRET_VALUE.test(v) || CODE_REFERENCE.test(v) || ENV_NAME.test(v) || REDACTION_TAG.test(v) || TECH_TERM.test(v)) return null;
    if (NOT_A_PASSWORD.test(v) || /^\$/.test(v)) return null;
  }
  // Long random strings with no password punctuation are keys, tokens or addresses: Tier 1 decides keys by
  // format and label; here they need a credential cue like any other value.
  if ((token.length <= 24 || STRONG_SYMBOL.test(token)) && passwordShaped(token, true)) return 'password-shaped';
  const ws = words(text);
  const range = spanWords(ws, start, end);
  if (!range) return null;
  const cue = cueNear(text, ws, range, gates.secretCueWindow, (w) => CREDENTIAL_CUE.test(w) || GATE_CUE.test(w));
  return cue ? `credential cue "${cue}" within ${gates.secretCueWindow} words` : null;
}

/** Category and evidence for a neural government-ID span, or null when the rules do not confirm it. */
export function confirmGovId(text: string, start: number, end: number, score: number, gates: NeuralGates): { category: CategoryId; evidence: string } | null {
  if (score < gates.govIdMinScore) return null;
  const span = text.slice(start, end).trim();
  const digits = span.replace(/\D/g, '');
  const compact = span.replace(/[\s.-]/g, '').toUpperCase();
  // Amounts are not identifiers ("538616.25").
  if (/^\d{1,3}(?:[ ,.]\d{3})*[.,]\d{1,2}$|^\d+[.,]\d{1,2}$/.test(span)) return null;
  if (digits.length === 9 && digits === compact && tfnValid(digits)) return { category: 4, evidence: 'TFN Mod-11 valid' };
  if (digits.length === 11 && digits === compact && abnValid(digits)) return { category: 6, evidence: 'ABN Mod-89 valid' };
  if (digits.length === 12 && digits === compact && aadhaarValid(digits)) return { category: 6, evidence: 'Aadhaar Verhoeff valid' };
  if (PAN.test(compact)) return { category: 6, evidence: 'PAN structure' };
  if (digits.length === 9 && digits === compact && ssnStructValid(digits) && /^\d{3}[- ]\d{2}[- ]\d{4}$/.test(span)) return { category: 3, evidence: 'SSN structure' };
  if (digits.length === 13 && digits.startsWith('756') && ean13Valid(digits)) return { category: 3, evidence: 'AHV EAN-13 valid' };
  if ((digits.length === 10 || digits.length === 11) && digits === compact && medicareValid(digits)) return { category: 3, evidence: 'Medicare check digit valid' };
  if (nirValid(compact)) return { category: 3, evidence: 'NIR key (mod 97) valid' };
  if (dniValid(compact)) return { category: 3, evidence: 'DNI / NIE letter (mod 23) valid' };
  if (NINO.test(span) || CODICE_FISCALE.test(compact)) return { category: 3, evidence: 'national ID structure' };
  // Shapes that carry a checksum (TFN 9, ABN 11, Aadhaar 12 digits) and fail it are not that ID: a label
  // next to them ("is 123 456 789 a valid tax file number?") does not make them one.
  if (digits === compact && (/^\d{3} \d{3} \d{3}$/.test(span) || digits.length === 11 || digits.length === 12)) return null;
  const ws = words(text);
  const range = spanWords(ws, start, end);
  if (!range || digits.length < 5) return null;
  const label = cueNear(text, ws, range, gates.govIdLabelWindow, (w) => ID_LABEL.test(w));
  return label ? { category: 3, evidence: `ID label "${label}" within ${gates.govIdLabelWindow} words` } : null;
}
