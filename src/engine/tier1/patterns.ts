// Structured-token detectors: API keys (Cat 1), government IDs (Cat 3), IBAN/bank (Cat 5),
// PAN (Cat 6) and database credentials (Cat 7). Each regex is a single linear pass.
import { abaRoutingValid, ibanValid } from './checksums';
import { charClasses, shannonEntropy } from './entropy';
import type { Candidate } from './candidate';

interface TokenRule {
  type: string;
  label: string;
  re: RegExp;
  /** Capture group holding the secret (defaults to the whole match). */
  group?: number;
  minEntropy?: number;
  priority?: number;
}

const API_KEY_RULES: TokenRule[] = [
  { type: 'AWS_ACCESS_KEY', label: 'AWS access key ID', re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  {
    type: 'AWS_SECRET_KEY',
    label: 'AWS secret access key',
    re: /aws.{0,24}?(?:secret|private).{0,24}?[:=]\s*["']?([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+])/gi,
    group: 1,
    minEntropy: 4,
  },
  { type: 'GITHUB_TOKEN', label: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/g },
  { type: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{60,}/g, priority: 6 },
  { type: 'OPENAI_API_KEY', label: 'OpenAI API key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g },
  { type: 'SLACK_TOKEN', label: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { type: 'STRIPE_SECRET_KEY', label: 'Stripe live key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { type: 'GOOGLE_API_KEY', label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g },
  { type: 'JWT', label: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { type: 'PRIVATE_KEY', label: 'Private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g, priority: 6 },
  { type: 'AZURE_STORAGE_KEY', label: 'Azure storage account key', re: /AccountKey=([A-Za-z0-9+/]{80,}={0,2})/g, group: 1 },
  {
    type: 'API_KEY',
    label: 'Labelled API key / token',
    re: /\b(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key|client[_-]?secret|auth[_-]?token|bearer)["']?\s*[:=]?\s*["']?([A-Za-z0-9_\-+/.=]{20,})/gi,
    group: 1,
    minEntropy: 3.5,
    priority: 2,
  },
];

const PLACEHOLDER = /^(?:x{3,}|\*{3,}|\.{3,}|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|%\w+%|your[_-]?\w*|changeme|example\w*|placeholder|redacted|password|pass|secret|null|none|undefined|string)$/i;

function scanRules(text: string, rules: TokenRule[], out: Candidate[]) {
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
      const g = rule.group ?? 0;
      const value = m[g];
      if (!value) continue;
      const start = m.index + (g === 0 ? 0 : m[0].indexOf(value));
      if (PLACEHOLDER.test(value)) continue;
      if (rule.minEntropy !== undefined && shannonEntropy(value) < rule.minEntropy) continue;
      if (rule.type === 'API_KEY' && charClasses(value).count < 2) continue;
      out.push({
        start,
        end: start + value.length,
        category: 1,
        type: rule.type,
        label: rule.label,
        confidence: rule.type === 'API_KEY' ? 0.85 : 0.98,
        evidence: rule.minEntropy ? `format + H=${shannonEntropy(value).toFixed(2)}` : 'vendor token format',
        priority: rule.priority ?? 5,
      });
    }
  }
}

const DB_URI =
  /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver|oracle|cockroachdb|jdbc:[a-z]+(?::[a-z]+)?):\/\/([^\s:/@'"]+):([^\s@'"]+)@[^\s'"]+/gi;
const ADO_CONN = /\b(?:Server|Data Source|Host|Address)\s*=[^;'"\n]{1,120};[^'"\n]{0,200}?\b(?:Password|Pwd)\s*=\s*([^;'"\s]{3,})/gi;

function scanDbCredentials(text: string, out: Candidate[]) {
  DB_URI.lastIndex = 0;
  for (let m = DB_URI.exec(text); m; m = DB_URI.exec(text)) {
    const pwd = m[2]!;
    if (PLACEHOLDER.test(pwd)) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      category: 7,
      type: 'DB_CREDENTIAL',
      label: 'Database connection string with password',
      confidence: 0.97,
      evidence: 'URI with inline user:password',
      priority: 7,
    });
  }
  ADO_CONN.lastIndex = 0;
  for (let m = ADO_CONN.exec(text); m; m = ADO_CONN.exec(text)) {
    if (PLACEHOLDER.test(m[1]!)) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      category: 7,
      type: 'DB_CREDENTIAL',
      label: 'Database connection string with password',
      confidence: 0.95,
      evidence: 'ADO/ODBC string with Password=',
      priority: 7,
    });
  }
}

const PASSPORT = /\bpassport\s*(?:no\.?|number|num|#)?\s*[:#]?\s*([A-Z]{0,2}\d{6,9}|[A-Z]\d{7,8})\b/gi;
const DRIVER_LICENCE = /\b(?:driver'?s?\s*licen[cs]e|driving\s*licen[cs]e|DL)\s*(?:no\.?|number|num|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,14})\b/gi;
const UK_NINO = /\b[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g;
const IN_PAN = /\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g;
const BSB = /\bBSB\s*(?:no\.?|number|#)?\s*[:#]?\s*(\d{3}[- ]?\d{3})\b/gi;
const ACCOUNT_NO = /\b(?:acc(?:oun)?t|a\/c)\s*(?:no\.?|number|num|#)?\s*[:#]?\s*(\d[\d -]{4,14}\d)\b/gi;
const ROUTING = /\b(?:routing|ABA)\s*(?:no\.?|number|num|#)?\s*[:#]?\s*(\d{9})\b/gi;

function push(out: Candidate[], c: Omit<Candidate, 'priority'> & { priority?: number }) {
  out.push({ priority: 5, ...c });
}

function scanIds(text: string, out: Candidate[]) {
  PASSPORT.lastIndex = 0;
  for (let m = PASSPORT.exec(text); m; m = PASSPORT.exec(text)) {
    const v = m[1]!;
    const s = m.index + m[0].lastIndexOf(v);
    push(out, { start: s, end: s + v.length, category: 3, type: 'PASSPORT', label: 'Passport number', confidence: 0.9, evidence: 'labelled passport number' });
  }
  DRIVER_LICENCE.lastIndex = 0;
  for (let m = DRIVER_LICENCE.exec(text); m; m = DRIVER_LICENCE.exec(text)) {
    const v = m[1]!;
    if (!/\d/.test(v) || /^(?:no|number)$/i.test(v)) continue;
    const s = m.index + m[0].lastIndexOf(v);
    push(out, { start: s, end: s + v.length, category: 3, type: 'DRIVER_LICENCE', label: 'Driver licence number', confidence: 0.88, evidence: 'labelled licence number' });
  }
  UK_NINO.lastIndex = 0;
  for (let m = UK_NINO.exec(text); m; m = UK_NINO.exec(text)) {
    push(out, { start: m.index, end: m.index + m[0].length, category: 3, type: 'UK_NINO', label: 'UK National Insurance number', confidence: 0.9, evidence: 'NINO format' });
  }
  IN_PAN.lastIndex = 0;
  for (let m = IN_PAN.exec(text); m; m = IN_PAN.exec(text)) {
    push(out, { start: m.index, end: m.index + m[0].length, category: 6, type: 'PAN', label: 'Indian PAN', confidence: 0.92, evidence: 'PAN structure (entity code)' });
  }
}

function scanBanking(text: string, out: Candidate[]) {
  IBAN.lastIndex = 0;
  for (let m = IBAN.exec(text); m; m = IBAN.exec(text)) {
    let v = m[0];
    // The greedy tail may swallow a following word; trim until the checksum validates.
    while (v.length >= 15 && !ibanValid(v)) v = v.replace(/ ?[A-Z0-9]$/, '');
    if (v.length >= 15 && ibanValid(v)) {
      push(out, { start: m.index, end: m.index + v.length, category: 5, type: 'IBAN', label: 'IBAN', confidence: 0.97, evidence: 'mod-97 valid', priority: 6 });
    }
  }
  const accounts: { start: number; end: number }[] = [];
  ACCOUNT_NO.lastIndex = 0;
  for (let m = ACCOUNT_NO.exec(text); m; m = ACCOUNT_NO.exec(text)) {
    const v = m[1]!;
    const digits = v.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 12) continue;
    const s = m.index + m[0].lastIndexOf(v);
    accounts.push({ start: s, end: s + v.length });
  }
  const near = (s: number) => accounts.find((a) => Math.abs(a.start - s) < 120);
  BSB.lastIndex = 0;
  for (let m = BSB.exec(text); m; m = BSB.exec(text)) {
    const acct = near(m.index);
    if (!acct) continue;
    const start = Math.min(m.index, acct.start);
    const end = Math.max(m.index + m[0].length, acct.end);
    push(out, { start, end, category: 5, type: 'BANK_ACCOUNT', label: 'BSB + account number', confidence: 0.93, evidence: 'BSB with account number', priority: 6 });
  }
  ROUTING.lastIndex = 0;
  for (let m = ROUTING.exec(text); m; m = ROUTING.exec(text)) {
    if (!abaRoutingValid(m[1]!)) continue;
    const acct = near(m.index);
    if (!acct) continue;
    const start = Math.min(m.index, acct.start);
    const end = Math.max(m.index + m[0].length, acct.end);
    push(out, { start, end, category: 5, type: 'BANK_ACCOUNT', label: 'Routing + account number', confidence: 0.93, evidence: 'ABA checksum + account', priority: 6 });
  }
}

export function scanPatterns(text: string, out: Candidate[]): void {
  scanRules(text, API_KEY_RULES, out);
  scanDbCredentials(text, out);
  scanIds(text, out);
  scanBanking(text, out);
}

