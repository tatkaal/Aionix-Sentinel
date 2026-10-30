// Compiles the Tier 2 Path A vocabulary into assets/engine/medical.fst.bin:
//   ICD-10-CM 2026 conditions (CMS, public domain) · RxNorm Current Prescribable Content (NLM,
//   no UMLS licence required) · curated synonyms, financial terms, first names, public figures.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileFst, type FstEntry } from '../src/engine/tier2/fst-build';
import { FST_CLASS, normalizeTerm } from '../src/engine/tier2/fst-format';

const root = resolve(import.meta.dirname, '..');
const cache = resolve(root, '.cache');
mkdirSync(cache, { recursive: true });

const ICD_URL = 'https://www.cms.gov/files/zip/2026-code-descriptions-tabular-order.zip';
const RXNORM_PAGE = 'https://www.nlm.nih.gov/research/umls/rxnorm/docs/rxnormfiles.html';
const RXNORM_FALLBACK = 'https://download.nlm.nih.gov/rxnorm/RxNorm_full_prescribe_10052026.zip';
// XLM-R SentencePiece vocabulary (250k pieces, ~100 languages) — its whole-word pieces stand in for
// "everyday words" outside English (Apache-2.0, via sentence-transformers).
const XLMR_TOKENIZER_URL = 'https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/tokenizer.json';

async function download(url: string, dest: string) {
  if (existsSync(dest)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function unzip(zip: string, member: string, destDir: string): string {
  const out = resolve(destDir, member);
  if (!existsSync(out)) execFileSync('unzip', ['-o', '-q', zip, member, '-d', destDir]);
  return out;
}

const lines = (file: string) =>
  readFileSync(resolve(root, 'data/lexicons', file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

// ── Inputs ───────────────────────────────────────────────────────────────────
await download(ICD_URL, resolve(cache, 'icd10cm-2026.zip'));
const icdFile = unzip(resolve(cache, 'icd10cm-2026.zip'), 'icd10cm_codes_2026.txt', resolve(cache, 'icd10cm-2026'));

let rxUrl = RXNORM_FALLBACK;
try {
  const page = await (await fetch(RXNORM_PAGE)).text();
  rxUrl = page.match(/https:\/\/download\.nlm\.nih\.gov\/rxnorm\/RxNorm_full_prescribe_\d+\.zip/)?.[0] ?? RXNORM_FALLBACK;
} catch {
  /* offline: use the pinned release */
}
const rxZip = resolve(cache, 'rxnorm-prescribe.zip');
await download(rxUrl, rxZip);
const rxFile = unzip(rxZip, 'rrf/RXNCONSO.RRF', resolve(cache, 'rxnorm'));

// Whole-word BERT vocabulary ≈ common English words; used to drop brand names that are words.
const vocab = new Set(
  readFileSync(resolve(root, 'assets/models/all-MiniLM-L6-v2/vocab.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((t) => /^[a-z]+$/.test(t)),
);
// Multilingual everyday words (≥ 7 letters after normalisation). Dev-split error analysis on
// AI4Privacy found French/Italian words fuzzy-matching RxNorm brands ("prochaine" → procaine,
// "stimato" → Stimate) once Path B surfaced person nodes in non-English text.
await download(XLMR_TOKENIZER_URL, resolve(cache, 'xlmr-tokenizer.json'));
const multilingual = new Set(
  (JSON.parse(readFileSync(resolve(cache, 'xlmr-tokenizer.json'), 'utf8')) as { model: { vocab: [string, number][] } }).model.vocab
    .map(([piece]) => piece)
    .filter((p) => p.startsWith('▁'))
    .map((p) => normalizeTerm(p.slice(1)))
    .filter((w) => /^[a-z]+$/.test(w) && w.length >= 7),
);
const stop = new Set(lines('medical-stoplist.txt'));
const synonyms = new Set(lines('medical-synonyms.txt').map(normalizeTerm));
const KEEP_COMMON_DRUGS = new Set(
  'aspirin insulin morphine codeine penicillin heparin warfarin lithium methadone ketamine cortisone prednisone ibuprofen paracetamol acetaminophen metformin oxycodone fentanyl tramadol diazepam valium xanax prozac zoloft viagra botox'.split(
    ' ',
  ),
);

const entries: FstEntry[] = [];
const stats: Record<string, number> = {};
const add = (term: string, output: string) => {
  const t = normalizeTerm(term);
  if (!t || t.length > 72) return;
  entries.push({ term: t, output });
  stats[output[0]!] = (stats[output[0]!] ?? 0) + 1;
};

// ── ICD-10-CM: chapters A–Q (diseases). R (symptoms), S–T (injuries), V–Y (external causes)
//    and Z (encounters/status) are excluded as too generic for disclosure detection.
const QUALIFIER = /\s*,\s*(unspecified|initial encounter|subsequent encounter|sequela|not elsewhere classified|other specified|in remission|not intractable|without.*|with.*)$/i;
const SPLIT = /,|\s(?:without|with|due to|in|involving|following|complicating|affecting|associated with|of|on)\s/i;
let icdCodes = 0;
for (const line of readFileSync(icdFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z][0-9A-Z]{2,6})\s+(.+)$/);
  if (!m) continue;
  const [, code, desc] = m as unknown as [string, string, string];
  if (!/^[A-Q]/.test(code)) continue;
  icdCodes++;
  const dotted = code.length > 3 ? `${code.slice(0, 3)}.${code.slice(3)}` : code;
  const out = `${FST_CLASS.condition}${dotted}`;
  let full = desc;
  while (QUALIFIER.test(full)) full = full.replace(QUALIFIER, '');
  const head = desc.split(SPLIT)[0]!.trim();
  for (const t of new Set([full, head])) {
    const norm = normalizeTerm(t);
    const words = norm.split(' ');
    if (words.length > 6 || norm.length < 4) continue;
    if (words.length === 1 && stop.has(norm)) continue;
    // A single-word heading that is an everyday English word ("changes", "absence") is too generic;
    // genuinely clinical ones (pneumonia, dementia …) come from the curated synonym list instead.
    if (words.length === 1 && vocab.has(norm) && !synonyms.has(norm)) continue;
    if (words.every((w) => stop.has(w) || w.length < 3)) continue;
    add(norm, out);
  }
}

for (const syn of lines('medical-synonyms.txt')) add(syn, `${FST_CLASS.condition}SYN`);

// ── RxNorm prescribable: ingredients (IN/PIN) and brand names (BN).
for (const line of readFileSync(rxFile, 'utf8').split(/\r?\n/)) {
  const f = line.split('|');
  if (f[11] !== 'RXNORM' || !['IN', 'PIN', 'BN'].includes(f[12]!)) continue;
  const norm = normalizeTerm(f[14]!);
  if (norm.length < 5 || /\d/.test(norm) || stop.has(norm)) continue;
  const words = norm.split(' ');
  const allCommon = words.every((w) => vocab.has(w));
  if (allCommon && !KEEP_COMMON_DRUGS.has(norm)) continue;
  // A one-word *brand* that is an everyday word in another language ("Activite") is not evidence of
  // a prescription. Ingredients (IN/PIN) are kept: their names are the drug.
  if (f[12] === 'BN' && words.length === 1 && multilingual.has(norm) && !KEEP_COMMON_DRUGS.has(norm)) continue;
  add(norm, `${f[12] === 'BN' ? FST_CLASS.brand : FST_CLASS.medication}${f[0]}`);
}

for (const t of lines('financial-terms.txt')) add(t, `${FST_CLASS.financial}`);
for (const line of lines('first-names.txt')) for (const n of line.split(/\s+/)) add(n, `${FST_CLASS.firstName}`);
for (const p of lines('public-figures.txt')) add(p, `${FST_CLASS.publicFigure}`);
for (const w of new Set([...vocab, ...multilingual])) if (w.length >= 7) add(w, `${FST_CLASS.commonWord}`);

const { bytes, nodes, words } = compileFst(entries);
mkdirSync(resolve(root, 'assets/engine'), { recursive: true });
writeFileSync(resolve(root, 'assets/engine/medical.fst.bin'), bytes);
console.log(`ICD-10-CM codes A–Q: ${icdCodes}`);
console.log(`entries by class: ${JSON.stringify(stats)}`);
console.log(`medical.fst.bin: ${words} unique entries · ${nodes} states · ${(bytes.length / 1048576).toFixed(2)} MB`);
writeFileSync(
  resolve(root, 'assets/engine/medical.fst.json'),
  JSON.stringify({ built: new Date().toISOString(), icdSource: ICD_URL, rxnormSource: rxUrl, entries: words, states: nodes, bytes: bytes.length, byClass: stats }, null, 2),
);
