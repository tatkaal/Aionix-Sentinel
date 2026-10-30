// Category 2: labelled passwords (multilingual) and unlabelled high-entropy secrets.
import { charClasses, entropyThresholdFor, shannonEntropy } from './entropy';
import type { Candidate } from './candidate';

const LABEL =
  "(?:pass(?:word|wd|phrase|code)|pwd|passwort|kennwort|contrase(?:ñ|n)a|clave|senha|wachtwoord|mot de passe|mdp|parola d['’]ordine|пароль|密码|密碼|パスワード|비밀번호|كلمة المرور|पासवर्ड)";

const PASSWORD_RE = new RegExp(
  LABEL +
    '(?![a-z])["\'`]?\\s*' +
    '(?:(?<sym>=>|->|[:=：])|(?<word>(?:is|es|est|ist|era|was)(?=\\s)|は|是|为|為))\\s*' +
    '(?:"(?<q1>[^"\\n]*)"|\'(?<q2>[^\'\\n]*)\'|`(?<q3>[^`\\n]*)`|(?<bare>[^\\s"\'`,;]+))',
  'giu',
);

/** Values that are types, keywords or placeholders — i.e. code *about* passwords, not passwords. */
const NON_SECRET_VALUE =
  /^(?:string|str|String|int|integer|number|bool|boolean|char|varchar(?:\(\d+\))?|text|bytes?|null|none|nil|undefined|true|false|required|optional|any|object|hash(?:ed)?|field|input|column|secret|password|pass|pwd|example|placeholder|redacted|changeme|your[_-]?\w*|z\.string\(\)\S*|SecureString|Option<.*>|str\s*\|\s*None)$/i;

const CODE_REFERENCE =
  /^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|.*\(.*|\$\{.*\}|\{\{.*\}\}|<[^>]*>|%[\w(]+%?|\?|:[A-Za-z_]\w*|@\w+|\*+|x{3,}|\.{3,}|[/~][^\s]*|[A-Za-z]:\\.*)$/;

function classifyPasswordValue(value: string, wordConnector: boolean): number | null {
  const v = value.replace(/[.,;)\]]+$/, '');
  if (v.length < 4) return null;
  if (NON_SECRET_VALUE.test(v) || CODE_REFERENCE.test(v)) return null;
  // Prose ("the password is stored hashed") — a plain lowercase word after "is" is not a credential.
  if (wordConnector && /^[a-z]+$/.test(v)) return null;
  // Identifier-like right-hand sides in code (`password = userPassword`) are references, not secrets.
  if (!wordConnector && /^[a-z_$][A-Za-z_$]*$/.test(v) && /[A-Z_]/.test(v)) return null;
  return charClasses(v).count >= 2 ? 0.92 : 0.78;
}

function scanLabelled(text: string, out: Candidate[]) {
  PASSWORD_RE.lastIndex = 0;
  for (let m = PASSWORD_RE.exec(text); m; m = PASSWORD_RE.exec(text)) {
    const g = m.groups!;
    const value = g.q1 ?? g.q2 ?? g.q3 ?? g.bare;
    if (value === undefined) continue;
    const conf = classifyPasswordValue(value, g.word !== undefined);
    if (conf === null) continue;
    const trimmed = value.replace(/[.,;)\]]+$/, '');
    const start = m.index + m[0].length - value.length - (g.bare === undefined ? 1 : 0);
    out.push({
      start,
      end: start + trimmed.length,
      category: 2,
      type: 'PASSWORD',
      label: 'Labelled password',
      confidence: conf,
      evidence: `credential label + ${charClasses(trimmed).count} char classes`,
      priority: 4,
    });
  }
}

const TOKEN_RE = /[^\s"'`<>()[\]{},;]{10,64}/g;
const STRONG_SYMBOL = /[!@#$%^&*?~=+]/;
/** Shapes that carry 4 character classes but are not secrets: e-mail-ish, encoded, files, paths. */
const NOT_A_PASSWORD = new RegExp(
  [
    String.raw`@[\w-]+\.[a-z]{2,}`, // e-mail-ish
    String.raw`(?:\+[0-9A-F]{2}){2,}|%[0-9A-F]{2}|^IMCEA`, // URL / Exchange encoding
    String.raw`\\|\.(?:[a-z]{2,4}|[A-Z]{2,4})$`, // paths, file names
    String.raw`^-{2,}|NextPart`, // MIME boundaries
    String.raw`^(?:[A-Z][a-z]+){2,}$`, // CamelCase words / product names
    String.raw`^[A-Z][a-z]+[._][A-Z][a-z]+\d*$`, // name-based usernames (First_Last71)
    String.raw`^[A-Za-zÀ-ÿ]+(?:-[A-Za-zÀ-ÿ]+)+$`, // hyphenated words
    String.raw`^(?:[13LM][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,90}|0x[a-fA-F0-9]{40})$`, // crypto addresses
  ].join('|'),
);
const SKIP_TOKEN =/:\/\/|^[/~.\\]|^[A-Za-z]:\\|^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$|=>|&&|\|\||[=!]==?|\+=|::|^\d+([.,/-]\d+)*$/;

function scanEntropy(text: string, out: Candidate[]) {
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(text); m; m = TOKEN_RE.exec(text)) {
    let token = m[0].replace(/[.,:;]+$/, '');
    // `key=value` / `key: value` pairs: judge only the value side.
    let offset = 0;
    const eq = token.search(/[=:](?=[^=:]{10,}$)/);
    if (eq > 0 && /^[A-Za-z_][\w.-]*$/.test(token.slice(0, eq))) {
      offset = eq + 1;
      token = token.slice(offset);
    }
    const L = token.length;
    if (L < 10 || SKIP_TOKEN.test(token) || NOT_A_PASSWORD.test(token)) continue;
    const classes = charClasses(token);
    if (classes.count < 4) continue;
    // The symbol class must come from password punctuation, not from separators such as . - _ \ /
    // that make file names, paths and identifiers look "four-class".
    if (!STRONG_SYMBOL.test(token)) continue;
    const h = shannonEntropy(token);
    if (h < entropyThresholdFor(L)) continue;
    const start = m.index + offset;
    out.push({
      start,
      end: start + L,
      category: 2,
      type: 'SECRET',
      label: 'Unlabelled high-entropy secret',
      confidence: 0.8,
      evidence: `H=${h.toFixed(2)} bits/char · 4 classes`,
      priority: 1,
    });
  }
}

// Credential cues (multilingual): password words incl. plurals, login / access verbs, "protected with".
const CREDENTIAL_CUE =
  /^(?:pass(?:word|wd|phrase|code)s?|passw[oö]rt(?:er)?|kennw[oö]rt(?:er)?|contrase(?:ñ|n)as?|senhas?|mdp|credentials?|credenziali|identifiants?|login|logon|signin|anmelden|anmeldedaten|zugang(?:sdaten)?|zugreifen|zuzugreifen|connecter|connectez|connexion|accedere|acceder|accéder|access|protected|secured|protégé|geschützt|token|pin)$/i;
const PHRASE_CUES = /mots? de passe|parola d['’]ordine|log in|sign in|se connecter|password (?:has been |was )?(?:changed|reset|set) to/gi;

/** Random-looking credential: high character diversity and mixed classes, not a word or path. */
function passwordShaped(t: string): boolean {
  if (t.length < 8 || t.length > 40 || /^\d+$/.test(t) || NOT_A_PASSWORD.test(t) || /[/:@]/.test(t)) return false;
  const c = charClasses(t);
  let switches = 0;
  for (let i = 1; i < t.length; i++) {
    const a = t[i - 1]!;
    const b = t[i]!;
    if (/[a-z]/.test(a) !== /[a-z]/.test(b) || /[A-Z]/.test(a) !== /[A-Z]/.test(b)) switches++;
  }
  const shaped = c.count >= 3 ? switches >= 3 : c.count === 2 && c.upper && c.lower && t.length >= 10 && switches >= 4;
  return shaped && shannonEntropy(t) >= Math.log2(t.length) - 0.6;
}

function scanCredentialContext(text: string, out: Candidate[]) {
  const words: { w: string; start: number; end: number }[] = [];
  const re = /[^\s"'`<>()[\]{},;]+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const w = m[0].replace(/[.,:!?]+$/, '');
    words.push({ w, start: m.index, end: m.index + w.length });
  }
  const cueIdx = new Set<number>();
  words.forEach((x, i) => CREDENTIAL_CUE.test(x.w.replace(/^[^\p{L}]+/u, '')) && cueIdx.add(i));
  PHRASE_CUES.lastIndex = 0;
  for (let m = PHRASE_CUES.exec(text); m; m = PHRASE_CUES.exec(text)) {
    const end = m.index + m[0].length;
    const i = words.findIndex((x) => x.start >= end - 1);
    if (i > 0) cueIdx.add(i - 1);
  }
  const seen = new Set<number>();
  for (const ci of cueIdx) {
    for (let j = Math.max(0, ci - 3); j <= Math.min(words.length - 1, ci + 6); j++) {
      if (j === ci || seen.has(j) || !passwordShaped(words[j]!.w)) continue;
      seen.add(j);
      out.push({
        start: words[j]!.start,
        end: words[j]!.end,
        category: 2,
        type: 'PASSWORD',
        label: 'Credential near a login / password cue',
        confidence: 0.85,
        evidence: `credential cue “${words[ci]!.w}” + random-looking token`,
        priority: 3,
      });
    }
  }
}

export function scanSecrets(text: string, out: Candidate[]): void {
  scanLabelled(text, out);
  scanCredentialContext(text, out);
  scanEntropy(text, out);
}
