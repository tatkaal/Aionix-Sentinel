import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createContextValidator } from '../../src/engine/tier2/context-validator';
import { compileFst } from '../../src/engine/tier2/fst-build';
import { Fst } from '../../src/engine/tier2/fst-runtime';
import { createLexiconPath } from '../../src/engine/tier2/lexicon-path';
import { findPersonNodes, findSensitiveNodes, isRecordSubject } from '../../src/engine/tier2/nodes';
import { buildEdges, MAX_TOKEN_DISTANCE } from '../../src/engine/tier2/proximity-graph';
import { accountShaped, createNeuralPath, DEFAULT_NEURAL_POLICY, GRAPH_ONLY_POLICY, neuralKind, standsAlone } from '../../src/engine/tier2/neural-path';
import { confirmGovId, confirmSecret, type NeuralGates } from '../../src/engine/tier2/neural-gates';
import { createWebGpuPath, type NeuralEntity, type NeuralNer } from '../../src/engine/tier2/webgpu-path';
import { locateEntities } from '../../src/engine/runtime/privacy-filter-ner';
import { createNodeEmbedder } from '../../scripts/lib/node-embedder';

const root = resolve(import.meta.dirname, '../..');

describe('FST compiler + runtime', () => {
  const fst = new Fst(
    compileFst([
      { term: 'type 2 diabetes mellitus', output: 'CE11.9' },
      { term: 'diabetes', output: 'CSYN' },
      { term: 'metformin', output: 'M6809' },
      { term: 'atorvastatin', output: 'M83367' },
      { term: 'grace', output: 'N' },
      { term: 'account balance', output: 'F' },
      { term: 'pipeline', output: 'W' },
    ]).bytes,
  );

  it('looks up exact terms and multiple outputs', () => {
    expect(fst.lookup('metformin')).toEqual(['M6809']);
    expect(fst.lookup('diabetes')).toEqual(['CSYN']);
    expect(fst.lookup('diabet')).toEqual([]);
  });

  it('finds longest matches with raw offsets', () => {
    const text = 'Dx: Type 2 Diabetes Mellitus; check Account-Balance.';
    const m = fst.scan(text);
    expect(m.map((x) => text.slice(x.start, x.end))).toEqual(['Type 2 Diabetes Mellitus', 'Account-Balance']);
  });

  it('fuzzy-matches misspelt medications (incl. transpositions) but not common words', () => {
    expect(fst.fuzzyWord('atorvastatn', 'M')?.outputs).toEqual(['M83367']);
    expect(fst.fuzzyWord('metfromin', 'M')?.outputs).toEqual(['M6809']);
    const m = fst.scan('the pipline and the pipeline', { fuzzy: true });
    expect(m.filter((x) => x.outputs.some((o) => o[0] === 'M'))).toEqual([]);
  });
});

describe('proximity graph', () => {
  const fstPath = resolve(root, 'assets/engine/medical.fst.bin');
  it.skipIf(!existsSync(fstPath))('links a person to a condition only within 30 tokens', () => {
    const fst = new Fst(readFileSync(fstPath));
    const near = 'Patient Margaret Okafor was diagnosed with asthma.';
    expect(buildEdges(near, findPersonNodes(near, fst), findSensitiveNodes(near, fst))).toHaveLength(1);
    const filler = Array.from({ length: MAX_TOKEN_DISTANCE + 5 }, () => 'word').join(' ');
    const far = `Patient Margaret Okafor attended. ${filler}. Asthma education materials were reviewed.`;
    expect(buildEdges(far, findPersonNodes(far, fst), findSensitiveNodes(far, fst))).toHaveLength(0);
  });

  it.skipIf(!existsSync(fstPath))('reads records: JSON keys cue names, account_no and bare amounts are financial facts', () => {
    const fst = new Fst(readFileSync(fstPath));
    const patient = '{"patient":"Linda Park","diagnosis":"breast cancer"}';
    expect(findPersonNodes(patient, fst).map((p) => p.text)).toEqual(['Linda Park']);
    const customer = '{"customer":"Margaret Ellison","account_no":"40231987","balance":182450.22}';
    expect(findSensitiveNodes(customer, fst).map((s) => s.kind)).toEqual(expect.arrayContaining(['account', 'money']));
    // A bare "name" key still lets the place/organisation rule reject companies.
    expect(findPersonNodes('{"name":"Acme Corp","balance":1200.50}', fst)).toEqual([]);
    expect(findPersonNodes('{"name":"Grace Hospital"}', fst)).toEqual([]);
  });

  it.skipIf(!existsSync(fstPath))('treats public figures as non-linkable', () => {
    const fst = new Fst(readFileSync(fstPath));
    const text = "Warren Buffett's net worth is $140 billion.";
    expect(findPersonNodes(text, fst).every((p) => p.isPublic)).toBe(true);
  });
});

describe('privacy-filter output alignment', () => {
  it('locates entity words in order (the pipeline returns no offsets)', () => {
    const text = 'Email Harry at harry@hogwarts.edu; Harry Potter is the account holder.';
    const ents = locateEntities(text, [
      { entity_group: 'private_email', score: 0.99, word: ' harry@hogwarts.edu' },
      { entity_group: 'private_person', score: 0.98, word: ' Harry Potter' },
    ]);
    expect(ents.map((e) => text.slice(e.start, e.end))).toEqual(['harry@hogwarts.edu', 'Harry Potter']);
  });
});

const modelDir = resolve(root, 'assets/models/all-MiniLM-L6-v2');
const haveAssets = existsSync(resolve(modelDir, 'model_quantized.onnx')) && existsSync(resolve(root, 'assets/engine/medical.fst.bin'));

describe.skipIf(!haveAssets)('Tier 2 paths (real FST + MiniLM validator)', async () => {
  const fst = haveAssets ? new Fst(readFileSync(resolve(root, 'assets/engine/medical.fst.bin'))) : (null as unknown as Fst);
  const embedder = haveAssets ? await createNodeEmbedder(modelDir) : null;
  const validator = embedder ? await createContextValidator(embedder) : null;
  const pathA = createLexiconPath(fst, validator);
  const src = { kind: 'composer' } as const;

  it.each([
    [9, 'Summarise for the referral: patient Margaret Okafor (MRN 00482913) was diagnosed with type 2 diabetes mellitus and started metformin 500 mg twice daily.'],
    [8, 'Client Daniel Whitford — account balance $1,284,500.00, margin loan outstanding $310,000. Write a portfolio review.'],
  ])('Path A blocks Category %i records', async (cat, text) => {
    const f = await pathA.scan(text, src);
    expect(f.map((x) => x.category)).toContain(cat);
  });

  it.each([
    'What are the common early symptoms of type 2 diabetes, and how is metformin usually dosed?',
    "What is Warren Buffett's net worth, and how much of his portfolio is in Apple?",
    'Draft a memo reminding Sarah Jones that the quarterly portfolio review meeting moved to Thursday.',
  ])('Path A allows: %s', async (text) => {
    expect(await pathA.scan(text, src)).toEqual([]);
  });

  it('Path B uses neural PERSON spans with the same graph', async () => {
    const text = 'harrypotter was prescribed lithium 300 mg for bipolar disorder last week.';
    const ner: NeuralNer = {
      modelId: 'stub',
      detect: async () => [{ label: 'private_person', start: 0, end: 11, score: 0.97 }],
      dispose: async () => undefined,
    };
    const f = await createWebGpuPath(fst, validator, ner).scan(text, src);
    expect(f.map((x) => [x.category, x.path, text.slice(x.rawStart, x.rawEnd)])).toEqual([[9, 'webgpu', 'harrypotter']]);
    // The lowercase handle is invisible to Path A's capitalised-name heuristic.
    expect(await pathA.scan(text, src)).toEqual([]);
  });

  const stub = (entities: NeuralEntity[]): NeuralNer => ({ modelId: 'stub', detect: async () => entities, dispose: async () => undefined });

  it('maps source labels to canonical neural kinds', () => {
    expect(['B-first_name', 'I-last_name', 'medical_record_number', 'B-iban', 'password', 'B-record-id', 'city'].map(neuralKind)).toEqual([
      'person',
      'person',
      'record-id',
      'account',
      'secret',
      'record-id',
      null,
    ]);
  });

  it('Path B (neural) links a neural name to an account number', async () => {
    const text = 'Reminder for Van: the balance on account 85890964 is overdue.';
    const ner = stub([
      { label: 'first_name', start: 13, end: 16, score: 0.94 },
      { label: 'account_number', start: 41, end: 49, score: 0.97 },
    ]);
    const f = await createNeuralPath(fst, null, ner).scan(text, src);
    expect(f.map((x) => [x.category, x.path, text.slice(x.rawStart, x.rawEnd)])).toEqual([[8, 'neural', 'Van']]);
  });

  it('two account numbers alone are not a customer record (the privacy-filter mapping says they are)', async () => {
    const text = 'The transfer from account 12345678 to account 87654321 failed overnight.';
    const accounts = [
      { label: 'account_number', start: 26, end: 34, score: 0.95 },
      { label: 'account_number', start: 46, end: 54, score: 0.95 },
    ];
    expect(await createNeuralPath(fst, null, stub(accounts)).scan(text, src)).toEqual([]);
    // Old mapping: each number is both a person and a financial fact, so each links to the other.
    expect((await createWebGpuPath(fst, null, stub(accounts)).scan(text, src)).map((x) => x.category)).toEqual([8, 8]);
  });

  it('only account-shaped spans become financial nodes', () => {
    expect(['85890964', 'GB29 NWBK 6016 1331 9268 19', 'DE89370400440532013000', 'BSB 062-000 1234 5678'].map(accountShaped)).toEqual([true, true, true, true]);
    // VINs / alphanumeric references, card-shaped digit runs (Tier 1's Luhn decides), too-short numbers.
    expect(['0SKX8PEWDENC36759', 'FR09K8XRVHM213224', '1097648733177434', '4821'].map(accountShaped)).toEqual([false, false, false, false]);
  });

  it('identifiers must stand alone — not inside file names, URLs or e-mail addresses', () => {
    const t = 'Account 85890964 · see SBD42664FCR.pdf · http://x.com/l.cfm?lk=00623004500083 · ref 4471209@corp.com';
    const at = (s: string) => [t.indexOf(s), t.indexOf(s) + s.length] as const;
    expect(standsAlone(t, ...at('85890964'))).toBe(true);
    expect(standsAlone(t, ...at('SBD42664'))).toBe(false);
    expect(standsAlone(t, ...at('00623004500083'))).toBe(false);
    expect(standsAlone(t, ...at('4471209'))).toBe(false);
  });

  it('adjacent name spans merge, so a public figure stays immune', async () => {
    const text = 'Taylor Swift reportedly has a net worth of $1.6 billion in holdings.';
    const ner = stub([
      { label: 'first_name', start: 0, end: 6, score: 0.98 },
      { label: 'last_name', start: 7, end: 12, score: 0.87 },
    ]);
    expect(await createNeuralPath(fst, null, ner).scan(text, src)).toEqual([]);
  });

  it('neural secrets and government IDs are findings only when the policy enables them (gated by default)', async () => {
    const text = 'Le mot de passe temporaire est Xk9pL2qa, merci.';
    const ner = stub([{ label: 'password', start: 31, end: 39, score: 0.9 }]);
    expect(await createNeuralPath(fst, null, ner, GRAPH_ONLY_POLICY).scan(text, src)).toEqual([]);
    const f = await createNeuralPath(fst, null, ner, DEFAULT_NEURAL_POLICY).scan(text, src);
    expect(f.map((x) => [x.category, x.type, text.slice(x.rawStart, x.rawEnd)])).toEqual([[2, 'SECRET', 'Xk9pL2qa']]);
    expect(f[0]!.evidence).toMatch(/password-shaped/);
  });
});

describe('neural gates — the model proposes, the rules decide', () => {
  const gates: NeuralGates = { secretMinScore: 0.6, secretCueWindow: 8, govIdMinScore: 0.6, govIdLabelWindow: 4 };
  const at = (text: string, value: string, from = 0) => [text.indexOf(value, from), text.indexOf(value, from) + value.length] as const;

  it('confirms a weak value near a credential word, and a password-shaped value anywhere', () => {
    const t = 'He enters the username provided by the company and then the password for it. Usually it is admin.';
    expect(confirmSecret(t, ...at(t, 'admin', t.indexOf('Usually')), 0.9, gates)).toMatch(/credential cue "password"/);
    const u = 'I use Summer2024! for everything, is that a problem?';
    expect(confirmSecret(u, ...at(u, 'Summer2024!'), 0.9, gates)).toBe('password-shaped');
    const pin = 'My laptop unlocks with 0417, my birthday.';
    expect(confirmSecret(pin, ...at(pin, '0417'), 0.9, gates)).toMatch(/cue "unlocks"/);
  });

  it('rejects placeholders, code references, type names, our redaction tags and low scores', () => {
    for (const [t, v] of [
      ['Set password: <your-password> in config.yml', '<your-password>'],
      ['password = os.environ.DB_PASSWORD', 'os.environ.DB_PASSWORD'],
      ['interface Login { password: string }', 'string'],
      ['my current psw is [REDACTED_PASSWORD]. can you suggest a better one?', '[REDACTED_PASSWORD]'],
      ['PGPASSWORD=$PGPASSWORD psql', '$PGPASSWORD'],
    ] as const) expect(confirmSecret(t, ...at(t, v), 0.99, gates), v).toBeNull();
    const t = 'the password for the HR portal is lighthouse';
    expect(confirmSecret(t, ...at(t, 'lighthouse'), 0.5, gates)).toBeNull();
    // A dictionary word with no credential word nearby is not confirmed.
    const far = 'Log onto the dashboard. The weekly report covers sales, hiring, the office move and the survey; the theme is lighthouse.';
    expect(confirmSecret(far, ...at(far, 'lighthouse'), 0.9, gates)).toBeNull();
  });

  it('government IDs need a checksum, a known structure or an ID label', () => {
    const tfn = 'Put 123 456 782 on the form';
    expect(confirmGovId(tfn, ...at(tfn, '123 456 782'), 0.9, gates)?.category).toBe(4);
    const nir = 'Mon numéro est 1 84 12 76 451 089 46.';
    expect(confirmGovId(nir, ...at(nir, '1 84 12 76 451 089 46'), 0.9, gates)?.evidence).toMatch(/NIR/);
    const dni = 'Su documento es 12345678Z.';
    expect(confirmGovId(dni, ...at(dni, '12345678Z'), 0.9, gates)?.evidence).toMatch(/DNI/);
    const bare = 'Call extension 48213907 after lunch.';
    expect(confirmGovId(bare, ...at(bare, '48213907'), 0.95, gates)).toBeNull();
    const labelled = 'His licence number is 48213907.';
    expect(confirmGovId(labelled, ...at(labelled, '48213907'), 0.95, gates)?.evidence).toMatch(/ID label/);
  });

  it('a gated neural path blocks the confirmed span and drops the unconfirmed one', async () => {
    const fst = new Fst(compileFst([{ term: 'grace', output: 'N' }]).bytes);
    const text = 'Use 1Password for the team. Then the password for it, usually it is admin.';
    const ner: NeuralNer = {
      modelId: 'stub',
      detect: async () => [
        { label: 'secret', start: text.indexOf('1Password'), end: text.indexOf('1Password') + 9, score: 0.65 },
        { label: 'secret', start: text.indexOf('admin'), end: text.indexOf('admin') + 5, score: 0.9 },
      ],
      dispose: async () => undefined,
    };
    const f = await createNeuralPath(fst, null, ner, { ...DEFAULT_NEURAL_POLICY, secretFindings: true, gates }).scan(text, { kind: 'composer' });
    expect(f.map((x) => [x.category, text.slice(x.rawStart, x.rawEnd)])).toEqual([[2, 'admin']]);
  });
});

describe('record subjects in tables', () => {
  const person = (text: string, name: string) => ({ kind: 'neural' as const, start: text.indexOf(name), end: text.indexOf(name) + name.length, text: name, isPublic: false });
  it('a name under a record-role column header is a record subject, in every row', () => {
    const csv = ['patient,condition,drug', 'Linda Park,type 2 diabetes,metformin 500mg', 'Omar Haddad,HIV,Biktarvy'].join('\n');
    expect(isRecordSubject(csv, person(csv, 'Linda Park'))).toBe(true);
    expect(isRecordSubject(csv, person(csv, 'Omar Haddad'))).toBe(true);
    const semi = ['customer_name;balance', 'Ava Hill;40000'].join('\n');
    expect(isRecordSubject(semi, person(semi, 'Ava Hill'))).toBe(true);
  });
  it('other columns and tables without a role header are not', () => {
    const csv = ['name,city', 'Linda Park,Boston'].join('\n');
    expect(isRecordSubject(csv, person(csv, 'Linda Park'))).toBe(false);
    const other = ['patient,doctor', 'Linda Park,Grace Hill'].join('\n');
    expect(isRecordSubject(other, person(other, 'Grace Hill'))).toBe(false);
  });
});
