// Builds the four benchmark datasets in data/datasets/ (see docs/datasets.md):
//   edge-cases.json   24 stakeholder scenarios (generated, committed)
//   enron.jsonl       LLM-PBE/enron-email sample, labelled allow + manual adjudications (committed)
//   presidio.jsonl    presidio-research synth_dataset_v2 sample + labelled augmentation (committed)
//   ai4privacy.jsonl  ai4privacy/pii-masking-200k sample + obfuscation augmentation (gitignored:
//                     the dataset card states no licence, so it is fetched at setup instead)
// Ground truth always comes from each dataset's own annotations — never from the engine.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BenchSample } from '../src/engine/bench/types';
import { ibanValid, luhnValid } from '../src/engine/tier1/checksums';
import type { CategoryId } from '../src/engine/types';
import { buildEdgeCases } from './datasets/edge-cases';
import {
  CONDITIONS,
  DRUGS,
  fictionalName,
  luhnFailing16,
  money,
  pick,
  rng,
  strongPassword,
  validAadhaar,
  validAbn,
  validPan,
  validTfn,
  validVisa,
  type Rand,
} from './datasets/generators';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'data/datasets');
const cache = resolve(root, '.cache');
mkdirSync(outDir, { recursive: true });
mkdirSync(cache, { recursive: true });

const writeJsonl = (file: string, rows: BenchSample[]) => writeFileSync(resolve(outDir, file), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

async function hfRows(dataset: string, offset: number, length: number): Promise<Record<string, unknown>[]> {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=default&split=train&offset=${offset}&length=${length}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) return ((await res.json()) as { rows: { row: Record<string, unknown> }[] }).rows.map((r) => r.row);
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`HF rows API failed for ${dataset} @${offset}`);
}

// ── 1. Edge cases ────────────────────────────────────────────────────────────
const edge = buildEdgeCases(root);
writeFileSync(resolve(outDir, 'edge-cases.json'), JSON.stringify(edge, null, 2) + '\n');
console.log(`edge-cases.json   ${edge.length} scenarios`);

// ── Shared augmentation (labelled; reported separately) ──────────────────────
function augmentation(r: Rand, prefix: string, n: number): BenchSample[] {
  const rows: BenchSample[] = [];
  const add = (expect: 'block' | 'allow', categories: CategoryId[], text: string, note: string) =>
    rows.push({ id: `${prefix}-aug-${String(rows.length + 1).padStart(3, '0')}`, dataset: prefix as BenchSample['dataset'], text, expect, categories, augmented: true, note });
  for (let i = 0; i < n; i++) {
    const name = fictionalName(r);
    const k = i % 10;
    const ci = Math.floor(r() * CONDITIONS.length);
    if (k === 0) add('block', [4], `New starter paperwork for ${name}: tax file number ${validTfn(r)}, super fund to follow.`, 'AU TFN');
    if (k === 1) add('block', [6], `Supplier onboarding: ${pick(r, ['Harbourline', 'Cobalt Ridge', 'Northwind'])} Pty Ltd, ABN ${validAbn(r)}, payment terms 30 days.`, 'AU ABN');
    if (k === 2) add('block', [6], `KYC for ${name}: Aadhaar ${validAadhaar(r)}, PAN ${validPan(r)}.`, 'Aadhaar + PAN');
    if (k === 3) add('block', [9], `Clinic note: patient ${name} (MRN ${Math.floor(10_000_000 + r() * 89_999_999)}) has ${CONDITIONS[ci]} and takes ${DRUGS[ci]} daily.`, 'Named patient record');
    if (k === 4) add('block', [8], `Customer ${name}, account number ${Math.floor(100_000_000 + r() * 899_999_999)}, balance ${money(r)} and overdue loan repayments of ${money(r, 500, 50_000)}.`, 'Named customer record');
    if (k === 5) add('allow', [], `What is the usual first-line treatment for ${CONDITIONS[ci]}, and how is ${DRUGS[ci]!.split(' ')[0]} monitored?`, 'General medical question');
    if (k === 6) add('allow', [], `Remind ${name} that the ${pick(r, ['budget', 'portfolio', 'pipeline'])} review moved to ${pick(r, ['Tuesday', 'Thursday'])} at 10am.`, 'Colleague mention, no record');
    if (k === 7) add('allow', [], `${pick(r, ['Elon Musk', 'Bill Gates', 'Jeff Bezos', 'Taylor Swift'])} reportedly has a net worth of ${money(r, 1e9, 3e11)} — how is that estimated?`, 'Public figure');
    if (k === 8) add('allow', [], `Order ${luhnFailing16(r, '4')} shipped; invoice INV-${Math.floor(r() * 99999)} totals ${money(r, 50, 5000)}.`, 'Order number failing Luhn');
    if (k === 9) add('allow', [], `In our schema the user table has columns id, email, password_hash and created_at. Should password be a varchar(255)?`, 'Schema talk without values');
  }
  return rows;
}

// ── 2. Presidio synthetic PII ────────────────────────────────────────────────
{
  const file = resolve(cache, 'synth_dataset_v2.json');
  if (!existsSync(file)) {
    const res = await fetch('https://raw.githubusercontent.com/data-privacy-stack/presidio-research/main/data/synth_dataset_v2.json');
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  type Span = { entity_type: string; entity_value: string };
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { full_text: string; spans: Span[] }[];
  const POLICY: Record<string, CategoryId> = { CREDIT_CARD: 5, US_SSN: 3, US_DRIVER_LICENSE: 3, IBAN_CODE: 5 };
  const r = rng(1500);
  const rows: BenchSample[] = raw.map((row, i) => {
    const hits = row.spans.filter((s) => POLICY[s.entity_type]);
    const invalid = hits.filter(
      (s) => (s.entity_type === 'CREDIT_CARD' && !luhnValid(s.entity_value.replace(/\D/g, ''))) || (s.entity_type === 'IBAN_CODE' && !ibanValid(s.entity_value)),
    );
    const valid = hits.filter((s) => !invalid.includes(s));
    return {
      id: `presidio-${String(i).padStart(4, '0')}`,
      dataset: 'presidio',
      text: row.full_text,
      expect: valid.length ? 'block' : 'allow',
      categories: [...new Set(valid.map((s) => POLICY[s.entity_type]!))],
      ...(invalid.length && !valid.length ? { checksumInvalid: true } : {}),
      note: [...new Set(row.spans.map((s) => s.entity_type))].join(','),
    } satisfies BenchSample;
  });
  const positives = rows.filter((x) => x.expect === 'block' || x.checksumInvalid);
  const negatives = rows.filter((x) => x.expect === 'allow' && !x.checksumInvalid).sort(() => r() - 0.5).slice(0, 250);
  const sample = [...positives, ...negatives, ...augmentation(rng(77), 'presidio', 60)];
  writeJsonl('presidio.jsonl', sample);
  console.log(`presidio.jsonl    ${sample.length} rows (${positives.length} policy-relevant, ${negatives.length} other PII, 60 augmented)`);
}

// ── 3. Enron email corpus (benign) ───────────────────────────────────────────
async function enronSample(dataset: 'enron' | 'enron-holdout', offsets: number[], seed: number): Promise<BenchSample[]> {
  const r = rng(seed);
  const rows: BenchSample[] = [];
  for (const offset of offsets) {
    let taken = 0;
    for (const row of await hfRows('LLM-PBE/enron-email', offset + Math.floor(r() * 2000), 100)) {
      const text = String(row.text ?? '');
      if (text.length < 200 || text.length > 6000) continue;
      rows.push({ id: `${dataset}-${offset}-${rows.length}`, dataset, text, expect: 'allow', categories: [] });
      if (++taken >= 50) break;
    }
  }
  return rows.slice(0, 300);
}
{
  const dev = await enronSample('enron', [4_000, 61_000, 133_000, 207_000, 288_000, 371_000, 452_000], 2001);
  writeJsonl('enron.jsonl', dev);
  console.log(`enron.jsonl       ${dev.length} emails (dev split; labelled allow + enron-adjudications.json)`);
  const held = await enronSample('enron-holdout', [22_000, 98_000, 171_000, 249_000, 330_000, 412_000, 480_000], 9001);
  writeJsonl('enron-holdout.jsonl', held);
  console.log(`enron-holdout     ${held.length} emails (held-out: never inspected during rule development)`);
  const adj = resolve(outDir, 'enron-adjudications.json');
  if (!existsSync(adj)) writeFileSync(adj, '{}\n');
}

// ── 4. AI4Privacy multilingual + obfuscation augmentation ────────────────────
type Mask = { value: string; label: string };
async function ai4pSample(dataset: 'ai4privacy' | 'ai4privacy-holdout', offsets: number[], seed: number): Promise<BenchSample[]> {
  const r = rng(seed);
  const rows: BenchSample[] = [];
  for (const offset of offsets) {
    for (const row of await hfRows('ai4privacy/pii-masking-200k', offset + Math.floor(r() * 3000), 100)) {
      const text = String(row.source_text ?? '');
      const masks = (row.privacy_mask ?? []) as Mask[];
      const labels = new Set(masks.map((m) => m.label));
      // ACCOUNTNAME is the account's type ("Savings Account"), not a person — only real name labels count.
      const named = labels.has('FIRSTNAME') || labels.has('LASTNAME') || labels.has('MIDDLENAME') || labels.has('FULLNAME');
      const cats = new Set<CategoryId>();
      let invalid = false;
      for (const m of masks) {
        if (m.label === 'CREDITCARDNUMBER') luhnValid(m.value.replace(/D/g, '')) ? cats.add(5) : (invalid = true);
        if (m.label === 'IBAN') ibanValid(m.value) ? cats.add(5) : (invalid = true);
        if (m.label === 'PASSWORD') cats.add(2);
        if (m.label === 'SSN') cats.add(3);
        if (m.label === 'ACCOUNTNUMBER' && named) cats.add(8);
      }
      rows.push({
        id: `${dataset}-${offset}-${rows.length}`,
        dataset,
        text,
        expect: cats.size ? 'block' : 'allow',
        categories: [...cats],
        ...(invalid && !cats.size ? { checksumInvalid: true } : {}),
        note: `${String(row.language ?? '')}:${[...labels].join(',')}`,
      });
    }
  }
  return rows;
}
{
  const rows = await ai4pSample('ai4privacy', [1_000, 48_000, 97_000, 143_000, 191_000], 200);
  // Obfuscation & multilingual augmentation (labelled).
  const aug: BenchSample[] = [];
  const add = (expect: 'block' | 'allow', categories: CategoryId[], text: string, note: string) =>
    aug.push({ id: `ai4p-aug-${String(aug.length + 1).padStart(3, '0')}`, dataset: 'ai4privacy', text, expect, categories, augmented: true, note });
  const ar = rng(4242);
  for (let i = 0; i < 12; i++) {
    const card = validVisa(ar);
    const g = card.match(/.{4}/g)!;
    add('block', [5], `Card on file: ${g.join(' - ')} (exp 09/29).`, 'spaced dashes');
    add('block', [5], `Use ${g.join('​')} for the refund.`, 'zero-width separators');
    add('block', [5], `{"customer":"acct-${i}","card":"${card}","cvv":"${100 + i}"}`, 'JSON');
    add('block', [5], `id,name,card\n${i},row${i},${g.join(' ')}`, 'CSV');
    const pw = strongPassword(ar);
    const label = pick(ar, ['contraseña', 'mot de passe', 'Passwort', '密码', 'パスワード', 'parola d’ordine', 'senha']);
    add('block', [2], `${label}: ${pw}`, `label ${label}`);
    add('block', [2], `Login keeps failing with ${strongPassword(ar, 16)} — is the account locked?`, 'unlabelled high-entropy');
    add('allow', [], `${label}: string  // ${pick(ar, ['required', 'min length 12', 'hashed with argon2'])}`, 'type declaration');
  }
  const sample = [...rows, ...aug];
  writeJsonl('ai4privacy.jsonl', sample);
  const pos = rows.filter((x) => x.expect === 'block').length;
  console.log(`ai4privacy.jsonl  ${sample.length} rows (${rows.length} sampled, ${pos} policy-relevant, ${aug.length} augmented) — gitignored`);
  const held = await ai4pSample('ai4privacy-holdout', [25_000, 72_000, 118_000, 167_000, 205_000], 7007);
  writeJsonl('ai4privacy-holdout.jsonl', held);
  console.log(`ai4privacy-holdout ${held.length} rows (held-out, ${held.filter((x) => x.expect === 'block').length} policy-relevant) — gitignored`);
}
