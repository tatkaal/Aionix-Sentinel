// Category 2: labelled passwords (multilingual) and unlabelled high-entropy secrets.
import { charClasses, entropyThresholdFor, shannonEntropy } from './entropy';
import type { Candidate } from './candidate';

// Full password words match anywhere (DB_PASSWORD, PGPASSWORD); short forms only as whole words
// ("psw", "pw", "pass", "wifi key") so "bypass" or "passport" never become labels.
const LABEL =
  "(?:(?<full>pass(?:word|wd|phrase|code)|pwd|passwort|kennwort|contrase(?:ñ|n)a|senha|wachtwoord|mot de passe|parola d['’]ordine|пароль|密码|密碼|パスワード|비밀번호|كلمة المرور|पासवर्ड)|(?<![\\p{L}\\p{N}])(?<short>psw|pswd|pw|p/w|pass|mdp|clave|(?:wi-?fi|wpa[23]?|wep|network|wireless)\\s+key))";

// "password for our office wifi is …", "password I use for my bank is …": a connector word, then
// at most four more words, between the label and its value.
const BETWEEN = "(?:\\s+(?:for|to|of|on|at|in|that|which|i|we|you)(?:\\s+[\\p{L}\\p{N}'’.-]+){0,4}?)?";

const PASSWORD_RE = new RegExp(
  LABEL +
    '(?![a-z])["\'`]?' +
    BETWEEN +
    '\\s*(?:(?<sym>=>|->|[:=：])|(?<word>(?:is|es|est|ist|era|was|to)(?=\\s)|は|是|为|為))\\s*(?:(?:now|still|currently)\\s+)?' +
    '(?:"(?<q1>[^"\\n]*)"|\'(?<q2>[^\'\\n]*)\'|`(?<q3>[^`\\n]*)`|(?<bare>[^\\s"\'`,;]+))',
  'giu',
);

/** "… password to X" is a value only after a change verb ("I changed my password to X"). */
const CHANGE_VERB = /\b(?:change[ds]?|changing|set(?:ting)?|reset(?:ting)?|update[ds]?|updating|switch(?:ed|ing)?|made)\b[^.!?\n]{0,30}$/i;
/** Ownership before the label: "my password is ohlalala" is a disclosure; "the password is stored" is not. */
const OWNED = /\b(?:my|our|his|her|their|your|the (?:new|current|old|admin|root|wifi|default)|current|new)\s+(?:[\p{L}-]+\s+){0,2}$/iu;
/** Words that follow "password is" in prose about passwords rather than in a disclosure. */
const PROSE_VALUE =
  /^(?:too|not|very|so|being|still|now|also|only|just|the|a|an|stored|saved|hashed|salted|encrypted|encoded|hidden|masked|shown|visible|required|mandatory|optional|needed|necessary|incorrect|wrong|invalid|valid|correct|expired|expiring|weak|strong|secure|insecure|safe|unsafe|compromised|leaked|reset|changed|updated|set|sent|emailed|missing|empty|blank|same|different|unique|long|short|case|managed|rotated|unknown|known|easy|hard|simple|complex|good|bad|fine|ok|okay|ready|due|locked|disabled|enabled|working|broken|protected|generated|random|temporary|shared|forgotten|lost|there|here|what|which|whatever|something|nothing|same|in|on|at|for|to|of|with|by|from)$/i;

function isMoneyOrMeasure(v: string): boolean {
  return /^(?:[$€£¥₹]\s?\d|\d[\d,.]*\s?(?:%|k|m|am|pm)$)/i.test(v);
}

/** Values that are types, keywords or placeholders — i.e. code *about* passwords, not passwords. */
const NON_SECRET_VALUE =
  /^(?:string|str|String|int|integer|number|bool|boolean|char|varchar(?:\(\d+\))?|text|bytes?|null|none|nil|undefined|true|false|required|optional|any|object|hash(?:ed)?|field|input|column|secret|password|pass|pwd|example|placeholder|redacted|changeme|your[_-]?\w*|z\.string\(\)\S*|SecureString|Option<.*>|str\s*\|\s*None)$/i;

const CODE_REFERENCE =
  /^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|.*\(.*|\$\{.*\}|\{\{.*\}\}|<[^>]*>|%[\w(]+%?|\?|:[A-Za-z_]\w*|@\w+|\*+|x{3,}|\.{3,}|[/~][^\s]*|[A-Za-z]:\\.*)$/;

interface LabelContext {
  wordConnector: boolean;
  /** "pass", "pw": weaker labels need a stronger value. */
  shortLabel: boolean;
  owned: boolean;
  /** What follows the value ("… is stored in the vault" continues as prose). */
  after: string;
  quoted: boolean;
}

function classifyPasswordValue(value: string, ctx: LabelContext): number | null {
  // Our own redaction tag ("my psw is [REDACTED_PASSWORD]") is not a value — otherwise a redacted
  // prompt would stay blocked.
  if (/^\[REDACTED_[A-Z0-9_]+\]/.test(value)) return null;
  const v = value.replace(/[.,;:!?)\]]+$/, '');
  if (v.length < 4) return null;
  if (NON_SECRET_VALUE.test(v) || CODE_REFERENCE.test(v)) return null;
  const classes = charClasses(v).count;
  if (ctx.shortLabel && (classes < 2 || isMoneyOrMeasure(v))) return null;
  if (ctx.wordConnector && !ctx.quoted && /^[a-z]+$/.test(v)) {
    // A plain lowercase word after "is": prose ("the password is stored hashed") unless it is owned,
    // not a prose word, and ends the clause ("my password is ohlalala").
    if (!ctx.owned || PROSE_VALUE.test(v) || !/^\s*(?:$|[.,;:!?]|and\b|but\b|so\b|—|-\s)/i.test(ctx.after)) return null;
    return 0.8;
  }
  if (ctx.wordConnector && PROSE_VALUE.test(v)) return null;
  // Identifier-like right-hand sides in code (`password = userPassword`) are references, not secrets.
  if (!ctx.wordConnector && /^[a-z_$][A-Za-z_$]*$/.test(v) && /[A-Z_]/.test(v)) return null;
  return classes >= 2 ? 0.92 : 0.78;
}

function scanLabelled(text: string, out: Candidate[]) {
  PASSWORD_RE.lastIndex = 0;
  for (let m = PASSWORD_RE.exec(text); m; m = PASSWORD_RE.exec(text)) {
    const g = m.groups!;
    const value = g.q1 ?? g.q2 ?? g.q3 ?? g.bare;
    if (value === undefined) continue;
    const before = text.slice(Math.max(0, m.index - 48), m.index);
    if (g.word?.toLowerCase() === 'to' && !CHANGE_VERB.test(before)) continue;
    const conf = classifyPasswordValue(value, {
      wordConnector: g.word !== undefined,
      shortLabel: g.short !== undefined,
      owned: OWNED.test(before),
      after: text.slice(m.index + m[0].length, m.index + m[0].length + 12),
      quoted: g.bare === undefined,
    });
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
  /^(?:pass(?:word|wd|phrase|code)s?|passw[oö]rt(?:er)?|kennw[oö]rt(?:er)?|contrase(?:ñ|n)as?|senhas?|mdp|credentials?|creds?|credenziali|identifiants?|login|logon|signin|anmelden|anmeldedaten|zugang(?:sdaten)?|zugreifen|zuzugreifen|connecter|connectez|connexion|accedere|acceder|accéder|access|protected|secured|protégé|geschützt|token|pin)$/i;
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
  // Word+digits(+symbol) ("Summer2024!", "Kangaroo#77") is the most common human password shape: two
  // class switches, provided it carries ≥ 2 digits — "1Password" (a product) and "&Personal" (a menu
  // label after "Logon to …", Enron dev) do not.
  const digits = t.replace(/\D/g, '').length;
  const shaped = c.count >= 3 ? switches >= 3 || (switches >= 2 && digits >= 2) : c.count === 2 && c.upper && c.lower && t.length >= 10 && switches >= 4;
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

// "my bank PIN is 4821", "Card PIN: 7390". Not "PIN code" — in India that is a postal code.
const PIN_RE = /(?<![\p{L}\p{N}])PIN(?:\s*(?:number|no\.?))?\s*(?:is|was|[:=#-])\s*(\d{4,8})(?!\d)/giu;
// One-time / verification codes: short-lived, but a live credential while valid.
const OTP_RE =
  /(?<![\p{L}\p{N}])(?:OTP|one[-\s]?time\s+(?:pass(?:word|code)|code|pin)|verification\s+code|(?:2FA|MFA|two[-\s]factor)\s+code|auth(?:entication)?\s+code|security\s+code|log[-\s]?in\s+code|sign[-\s]?in\s+code)\s*(?:is|was|[:=#-])?\s*(\d{4,8})(?!\d)/giu;

// Physical access codes: "my alarm code is 4417", "the gate code is 2580", "safe combination: 12-34-56".
const ACCESS_CODE_RE =
  /(?<![\p{L}\p{N}])(?:alarm|door|gate|garage|safe|lock|locker|keypad|entry|building|lockbox|key\s*safe)\s+(?:code|combination|combo)\s*(?:is|was|[:=#-])\s*(\d{3,8}|\d{1,3}(?:[-\s]\d{1,3}){1,3})(?!\d)/giu;

function scanCodes(text: string, out: Candidate[]) {
  for (const [re, type, label] of [
    [PIN_RE, 'PIN', 'PIN'],
    [OTP_RE, 'ONE_TIME_CODE', 'One-time / verification code'],
    [ACCESS_CODE_RE, 'ACCESS_CODE', 'Access code'],
  ] as const) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const v = m[1]!;
      const start = m.index + m[0].lastIndexOf(v);
      out.push({ start, end: start + v.length, category: 2, type, label, confidence: 0.86, evidence: `labelled ${label.toLowerCase()}`, priority: 4 });
    }
  }
}

export function scanSecrets(text: string, out: Candidate[]): void {
  scanLabelled(text, out);
  scanCodes(text, out);
  scanCredentialContext(text, out);
  scanEntropy(text, out);
}
