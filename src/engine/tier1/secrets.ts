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
const SKIP_TOKEN = /:\/\/|^[/~.\\]|^[A-Za-z]:\\|^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$|=>|&&|\|\||[=!]==?|\+=|::|^\d+([.,/-]\d+)*$/;

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
    if (L < 10 || SKIP_TOKEN.test(token)) continue;
    const classes = charClasses(token);
    if (classes.count < 4) continue;
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

export function scanSecrets(text: string, out: Candidate[]): void {
  scanLabelled(text, out);
  scanEntropy(text, out);
}
