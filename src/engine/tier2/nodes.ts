// Graph nodes for Tier 2. PERSON nodes are identifiable private individuals (names, MRNs,
// customer IDs, dates of birth); SENSITIVE nodes are clinical or financial facts.
import { FST_CLASS } from './fst-format';
import type { Fst } from './fst-runtime';

export type PersonKind = 'name' | 'honorific' | 'mrn' | 'record-id' | 'dob' | 'account' | 'neural';
export type SensitiveKind = 'condition' | 'medication' | 'dosage' | 'icd-code' | 'financial-term' | 'money' | 'account';

export interface PersonNode {
  kind: PersonKind;
  start: number;
  end: number;
  text: string;
  /** Public figures are parsed but never linked (Warren Buffett is not a customer record). */
  isPublic: boolean;
}

export interface SensitiveNode {
  kind: SensitiveKind;
  domain: 'medical' | 'financial';
  start: number;
  end: number;
  term: string;
  code?: string;
}

// Cues must sit on the same line, directly before the name. A role word may also be a JSON / YAML /
// form key ("patient": "Linda Park", customer_name = Margaret Ellison).
const TITLE_BEFORE = /\b(?:mr|mrs|ms|miss|mx|dr|prof|sir|dame|madam)\.?[ \t]*$/i;
const ROLE_KEY =
  /\b(?:(?:patient|pt|client|customer|member|employee|claimant|policyholder|resident|insured|beneficiary|account[ _]holder|borrower|investor)(?:[ _]?(?:full[ _]?)?name)?|(?:full|legal)[ _]?name|named|called)["']?[ \t]*[:,=]?[ \t]*["']?[ \t]*$/i;
/** A bare `name` key cues a name but, unlike a person role, does not overrule the place/organisation check ("name": "Acme Corp"). */
const NAME_KEY = /\bname["']?[ \t]*[:=][ \t]*["']?[ \t]*$/i;
const GREETING_BEFORE = /(?:^|[\n.!?]\s*)(?:dear|hi|hello|hey|bonjour|cher|ch[eè]re|hallo|liebe|lieber|ciao|gentile|hola|estimad[oa]|caro|cara)[ \t]*$/i;
const TITLE_WORD = /^(?:mr|mrs|ms|miss|mx|dr|prof|sir|dame)$/i;
// Name parts are joined by spaces/tabs only — never across a line break ("Lisa\nTuesday").
const NAME_SEQ = /\b([A-Z][a-z]+(?:['’-][A-Z]?[a-z]+)?)((?:[ \t]+(?:[A-Z]\.[ \t]+)?[A-Z][a-z]+(?:['’-][A-Z]?[a-z]+)?){0,2})\b/g;
const PLACE_OR_ORG =
  /^(?:County|City|Street|St|Avenue|Ave|Road|Rd|Lane|Drive|Boulevard|Park|Lake|River|Mountain|Island|Valley|Bay|Beach|Hill|Hills|Heights|Square|Center|Centre|Hospital|Clinic|University|College|School|Institute|Bank|Group|Holdings|Partners|Capital|Company|Corporation|Corp|Inc|Ltd|LLC|Council|Department|Ministry|Foundation|Trust|Fund|Program|Programme|Project|Storage|Station|Airport|Hotel)$/;

/** Capitalised words that open sentences or headings rather than names. */
const CAPITALISED_COMMON = new Set(
  'the this that these those there their for from with name names cost costs total program plan team group service services account accounts note notes date time rate fund funds bank company business report reports dear hello thanks regards please subject attached however also then when where what which who our your'.split(
    ' ',
  ),
);
const IDENTIFIERS: [PersonKind, RegExp][] = [
  ['mrn', /\b(?:MRN|medical record (?:no\.?|number)|UR(?:N)?\s?(?:no\.?)?)\s*[:#]?\s*\d{5,10}\b/gi],
  ['record-id', /\b(?:patient|pt|customer|client|member|policy|claim)\s*(?:id|no\.?|number|#)\s*[:#]?\s*[A-Z0-9][A-Z0-9-]{3,}\b/gi],
  ['record-id', /\b[A-Z]{2,4}-\d{4,6}\b/g],
  ['dob', /\b(?:DOB|D\.O\.B\.?|date of birth|born(?: on)?)\s*[:#]?\s*(?:\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|[A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/gi],
];

const ROLE_WORD = /^(?:mr|mrs|ms|miss|mx|dr|prof|sir|dame|patient|client|customer|member|employee|claimant|policyholder|resident|borrower|investor)$/i;

// Roles that only ever introduce a record subject ("patient Linda Park", "customer": "…"), unlike
// "member", "employee" or a title ("Dr Smith recommends …" names the clinician, not a patient).
const RECORD_ROLE =
  /\b(?:patient|pt|client|customer|claimant|policyholder|insured|beneficiary|account[ _]holder|borrower)(?:[ _]?(?:full[ _]?)?name)?["']?[ \t]*[:,=]?[ \t]*["']?[ \t]*$/i;
const LABELLED_RECORD_ID = /^(?:patient|pt|customer|client|member|policy|claim)\b/i;

/**
 * A person introduced as the subject of a record: an explicit record role directly before the name,
 * or a record identifier (MRN, date of birth, labelled patient / customer ID).
 */
export function isRecordSubject(text: string, person: PersonNode): boolean {
  if (person.kind === 'mrn' || person.kind === 'dob') return true;
  if (person.kind === 'record-id') return LABELLED_RECORD_ID.test(person.text);
  return RECORD_ROLE.test(text.slice(Math.max(0, person.start - 28), person.start));
}

export function findPersonNodes(text: string, fst: Fst): PersonNode[] {
  const out: PersonNode[] = [];
  NAME_SEQ.lastIndex = 0;
  const isCommon = (w: string) => CAPITALISED_COMMON.has(w.toLowerCase()) || fst.lookup(w.toLowerCase()).some((o) => o[0] === FST_CLASS.commonWord);
  for (let m = NAME_SEQ.exec(text); m; m = NAME_SEQ.exec(text)) {
    let words = m[0].split(/[ \t]+/);
    let start = m.index;
    const before = text.slice(Math.max(0, m.index - 28), m.index);
    let title = TITLE_BEFORE.test(before);
    const roleKey = ROLE_KEY.test(before);
    let role = roleKey || NAME_KEY.test(before) || GREETING_BEFORE.test(before);
    // "Client Daniel Whitford" / "Patient Margaret Okafor": the role word is a cue, not a name part.
    while (words.length > 1 && ROLE_WORD.test(words[0]!.replace(/\.$/, ''))) {
      if (TITLE_WORD.test(words[0]!.replace(/\.$/, ''))) title = true;
      else role = true;
      start = text.indexOf(words[1]!, start + words[0]!.length);
      words = words.slice(1);
    }
    const full = words.join(' ');
    if (ROLE_WORD.test(full)) continue;
    const isFirstName = fst.lookup(words[0]!.toLowerCase()).some((o) => o[0] === FST_CLASS.firstName);
    // "Sarah Mitchell": a known surname is a name part even though "mitchell" is also a vocabulary word.
    const isSurname = words.length > 1 && fst.lookup(words.at(-1)!.toLowerCase()).some((o) => o[0] === FST_CLASS.surname);
    const accepted =
      title || // "Mr Patel", "Dr. Okafor"
      (role && (isFirstName || (words.length > 1 && !isCommon(words[0]!)))) || // "client Theo Marchetti"
      (isFirstName && words.length > 1 && (isSurname || !isCommon(words[1]!))); // "Margaret Okafor", "Sarah Mitchell"
    if (!accepted) continue;
    // "Scott County", "Grace Hospital", "Jordan Street" are places and organisations — unless a record
    // role names a person ("patient Linda Park", "customer": "Ava Hill").
    if (words.length > 1 && PLACE_OR_ORG.test(words.at(-1)!) && !RECORD_ROLE.test(text.slice(Math.max(0, start - 28), start))) continue;
    const cue = title || role;
    const isPublic = fst.lookup(full.toLowerCase()).some((o) => o[0] === FST_CLASS.publicFigure);
    out.push({ kind: cue ? 'honorific' : 'name', start, end: start + text.slice(start).indexOf(words.at(-1)!) + words.at(-1)!.length, text: full, isPublic });
  }
  for (const [kind, re] of IDENTIFIERS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (out.some((p) => m!.index < p.end && p.start < m!.index + m![0].length)) continue;
      out.push({ kind, start: m.index, end: m.index + m[0].length, text: m[0], isPublic: false });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const DOSAGE = /\b\d+(?:\.\d+)?\s?(?:mg|mcg|µg|ug|g|ml|mL|units?|iu|IU|mmol)\b(?:\s?\/\s?(?:kg|m2|m²|day|d|dose))?/g;
const ICD_CODE = /\b[A-Q]\d{2}\.\d{1,4}\b/g;
// Includes record keys: account_no, account_number, accountNumber, acct_id.
const ACCOUNT_LABELLED =
  /\b(?:acc(?:oun)?t(?:[_-]?(?:no|num(?:ber)?|id))?|a\/c|iban|compte|konto(?:nummer)?|conto|cuenta|conta)\b[^\n\d]{0,40}?(?:no\.?|number|num|numéro|nummer|numero|número|#)?\s*[:#(]?\s*[A-Z]{0,2}\d[\d -]{5,24}\d\b/gi;
const MONEY =/(?:[$€£¥₹]\s?|\b(?:AUD|USD|EUR|GBP|INR|CAD|NZD|SGD)\s?)\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|mn|million|bn|billion))?\b/gi;
/** Amounts in records without a currency sign: "balance": 182450.22, outstanding_amount=9120. */
const MONEY_FIELD =
  /\b(?:[a-z]+[_ ])?(?:balance|amount|salary|income|net[_ ]?worth|credit[_ ]?limit|debt|loan|owed|outstanding|arrears|premium|payment)["']?[ \t]*[:=][ \t]*["']?-?\d(?:[\d,]{2,}(?:\.\d{1,2})?|\.\d{2}|\d*\.\d{1,2})\b/gi;

export function findSensitiveNodes(text: string, fst: Fst): SensitiveNode[] {
  const out: SensitiveNode[] = [];
  for (const m of fst.scan(text, { fuzzy: true })) {
    const cond = m.outputs.find((o) => o[0] === FST_CLASS.condition);
    const med = m.outputs.find((o) => o[0] === FST_CLASS.medication || o[0] === FST_CLASS.brand);
    const fin = m.outputs.find((o) => o[0] === FST_CLASS.financial);
    const term = text.slice(m.start, m.end);
    if (cond) out.push({ kind: 'condition', domain: 'medical', start: m.start, end: m.end, term, code: cond.slice(1) });
    else if (med) out.push({ kind: 'medication', domain: 'medical', start: m.start, end: m.end, term, code: `RxCUI ${med.slice(1)}` });
    else if (fin) out.push({ kind: 'financial-term', domain: 'financial', start: m.start, end: m.end, term });
  }
  const regexNodes: [SensitiveKind, 'medical' | 'financial', RegExp][] = [
    ['dosage', 'medical', DOSAGE],
    ['icd-code', 'medical', ICD_CODE],
    ['money', 'financial', MONEY],
    ['money', 'financial', MONEY_FIELD],
    ['account', 'financial', ACCOUNT_LABELLED],
  ];
  for (const [kind, domain, re] of regexNodes) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      out.push({ kind, domain, start: m.index, end: m.index + m[0].length, term: m[0] });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
