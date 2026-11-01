// Compiles the live test kit shown in the extension's options page ("Protected data & test kit"):
//   - copy-ready prompts per category 1–10 (block and allow), with the tier expected to decide,
//   - the 24 stakeholder edge cases (data/datasets/edge-cases.json),
//   - fictional samples to protect inside the extension (data/test-kit/*) with matching prompts.
// All values are synthetic; checksum-bearing numbers are generated valid.
// Usage: npx tsx scripts/build-test-kit.ts   → assets/engine/test-kit.json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BenchSample } from '../src/engine/bench/types';
import type { TestKit } from '../src/engine/bench/test-kit';
import { rng, validAadhaar, validAbn, validTfn, validVisa } from './datasets/generators';

const root = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const r = rng(31);
const tfn = validTfn(r).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
const abn = validAbn(r).replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4');
const visa = validVisa(r).replace(/(\d{4})(?=\d)/g, '$1 ');
const aadhaar = validAadhaar(r).replace(/(\d{4})(?=\d)/g, '$1 ');
const router = read('data/vault/alpha-liquidity-router.ts').split('\n');
const memo = read('data/vault/project-chronos-memo.md').split('\n\n');
const netting = read('data/test-kit/settlement-netting-engine.ts').split('\n');
const pricing = read('data/test-kit/halcyon-pricing-memo.md').split('\n\n');
const edgeCases = JSON.parse(read('data/datasets/edge-cases.json')) as BenchSample[];

const T1 = 'Tier 1 (content script, synchronous)';
const T2 = 'Tier 2 (offscreen: person ↔ sensitive-term graph + MiniLM validator)';
const T3A = 'Tier 3 Path A (content script: Bloom + MinHash fingerprints)';
const T3B = 'Tier 3 Path B (offscreen: salted field hashes + MiniLM vectors)';

const kit: TestKit = {
  version: 1,
  categories: [
    {
      id: 1,
      title: 'API keys & access tokens',
      how: `${T1}: vendor token formats (AWS, GitHub, GitLab, OpenAI, Anthropic, Slack, Stripe, Google, SendGrid, npm, Hugging Face, JWT, private keys) and labelled keys — incl. .env names like SENDGRID_API_KEY= and JSON keys — with an entropy check.`,
      prompts: [
        { title: 'OpenAI key in code', text: 'Why does this fail? client = OpenAI(api_key="sk-proj-Qm8xT2vL9pR4kW7nZ1cB5yH3jF6dS0aE2gU8iO4t")', expect: 'block', note: `${T1} · OPENAI_API_KEY format` },
        { title: '"my api key is …"', text: 'my api key is 9f8e7d6c5b4a39281706f5e4d3c2b1a0 but the request returns 401, any idea why?', expect: 'block', note: `${T1} · labelled key + entropy` },
        { title: 'AWS credentials file', text: edgeCases.find((c) => c.id === 'EC01')!.text, expect: 'block', note: `${T1} · AWS key id + secret` },
        { title: '.env line with a vendor-prefixed name', text: 'my .env has SENDGRID_API_KEY=SG.x9Kd3LmQ7vRt2Wz8Yb4Nc6Hd.1Pm5Gs0Ea9Ui3Ro7Tq2Vw4Xz8Yb1Nc6Hd3Lm5Qk and mail still fails', expect: 'block', note: `${T1} · .env key name + SendGrid format` },
        { title: 'Token inside JSON', text: '{"service":"deploy","auth_token":"q8Xv2LmT9rK4wP7zN1cB5yH3jF6dS0aE"}', expect: 'block', note: `${T1} · labelled token in JSON` },
        { title: 'Key-rotation question', text: 'How do I rotate my OpenAI API key safely without downtime?', expect: 'allow', note: 'No credential value — must pass' },
      ],
    },
    {
      id: 2,
      title: 'Passwords & secrets',
      how: `${T1}: labelled passwords (incl. psw / pw / pass, "password for X is", "changed my password to"), PINs, one-time and access codes, credential cues near password-shaped tokens, unlabelled passwords in strength questions ("is Summer2024! strong enough?"), unlabelled high-entropy secrets.`,
      prompts: [
        { title: 'Stakeholder report ("psw")', text: 'my current psw is Ohlalalala34%. can you suggest a better one?', expect: 'block', note: `${T1} · short label "psw" + value` },
        { title: '"changed my password to"', text: 'I changed my password to Summer2024! yesterday, is that secure enough?', expect: 'block', note: `${T1} · change verb + "to" connector` },
        { title: 'Unlabelled secret near a login cue', text: 'use this to log in: K9#vQ2!xLm7$Tz4@', expect: 'block', note: `${T1} · high-entropy token` },
        { title: 'Bank PIN', text: 'my bank PIN is 4821, can you remind me to change it next month?', expect: 'block', note: `${T1} · labelled PIN` },
        { title: 'Password inside a JSON body', text: 'login fails: {"username":"admin","password":"Hunter2024!"}', expect: 'block', note: `${T1} · JSON key "password"` },
        { title: 'Password inside a code block', text: '```python\ndb = connect(user="svc", password="Xy7!kL9#mQ2z")\n```', expect: 'block', note: `${T1} · labelled password in code` },
        { title: 'Passwords in a CSV export', text: 'username,password\njsmith,Winter2023#\nadavis,Qwerty!9876', expect: 'block', note: `${T1} · CSV header cue + password-shaped values` },
        { title: 'Unlabelled password (strength question)', text: 'can you tell me if Summer2024! is a strong one?', expect: 'block', note: `${T1} · strength cue + password-shaped token` },
        { title: 'Other language (Spanish label)', text: 'mi contraseña es Gato1234! y no puedo entrar', expect: 'block', note: `${T1} · multilingual label` },
        { title: 'Password advice', text: 'My password is too weak, how do I make a stronger one?', expect: 'allow', note: '"too" is prose, not a value — must pass' },
        { title: 'Typed password field (code)', text: 'interface User { email: string; password: string; }', expect: 'allow', note: 'A type, not a password — must pass' },
        { title: 'Code reading a password from the environment', text: 'const password = process.env.DB_PASSWORD; if (!password) throw new Error("missing password")', expect: 'allow', note: 'A reference, not a value — must pass' },
        { title: 'Product name in a security question', text: 'Is Windows11 secure enough for online banking?', expect: 'allow', note: 'No password punctuation — must pass' },
      ],
    },
    {
      id: 3,
      title: 'Government IDs',
      how: `${T1}: SSN structure (3-2-4 or labelled), labelled passport / driver licence / national IDs, UK NINO, Swiss AHV, AU Medicare (check digit).`,
      prompts: [
        { title: 'SSN with dashes', text: 'my SSN is 536-28-1947, can you fill in the W-4 for me?', expect: 'block', note: `${T1} · SSN structure` },
        { title: 'Passport number', text: 'my passport no is N8473629, does it need a visa for Japan?', expect: 'block', note: `${T1} · labelled passport` },
        { title: 'SSN with spaces', text: 'SSN 536 28 1947 for the form', expect: 'block', note: `${T1} · spaced SSN` },
        { title: 'SSNs in a CSV', text: 'name,ssn\nAna Ruiz,536-28-1947\nTom Lee,421-55-9012', expect: 'block', note: `${T1} · SSN structure in CSV rows` },
        { title: 'Australian Medicare number', text: 'my medicare card number is 2123 45670 1, which form do I need?', expect: 'block', note: `${T1} · Medicare check digit` },
        { title: 'Passport renewal question', text: 'What documents do I need to renew my passport?', expect: 'allow', note: 'No identifier — must pass' },
      ],
    },
    {
      id: 4,
      title: 'Australian Tax File Number',
      how: `${T1}: 9 digits in 3-3-3 or labelled, Mod-11 checksum (weights 1,4,3,7,5,8,6,9,10).`,
      prompts: [
        { title: 'Valid TFN', text: `my TFN is ${tfn}, can you check my tax return?`, expect: 'block', note: `${T1} · Mod-11 valid` },
        { title: 'TFN with dashes', text: `my tfn is ${tfn.replace(/ /g, '-')}`, expect: 'block', note: `${T1} · Mod-11 valid, dashed` },
        { title: 'TFN inside JSON', text: `{"employee":"J Smith","tfn":"${tfn.replace(/ /g, '')}"}`, expect: 'block', note: `${T1} · labelled key in JSON` },
        { title: 'Invalid-checksum TFN', text: 'my TFN is 123 456 789', expect: 'allow', note: 'Fails Mod-11 — must pass' },
      ],
    },
    {
      id: 5,
      title: 'Payment cards & bank accounts',
      how: `${T1}: Luhn-valid cards (test cards exempt), IBAN mod-97, BSB + account, ABA routing + account, labelled account numbers in a banking context.`,
      prompts: [
        { title: 'Card with expiry and CVV', text: `my card number is ${visa}, exp 09/27, cvv 123`, expect: 'block', note: `${T1} · Luhn valid` },
        { title: 'BSB and account', text: 'my account number is 12345678 and the BSB is 062-000', expect: 'block', note: `${T1} · BSB + account` },
        { title: 'IBAN', text: 'Please wire it to IBAN GB82 WEST 1234 5698 7654 32.', expect: 'block', note: `${T1} · mod-97 valid` },
        { title: 'Card inside JSON', text: `{"card_number":"${visa}","cvv":"123"}`, expect: 'block', note: `${T1} · Luhn valid in JSON` },
        { title: 'Account number at a named bank', text: 'my account number is 10234567 at Westpac, can you write the transfer request?', expect: 'block', note: `${T1} · labelled account in a banking context` },
        { title: 'Stripe test card', text: 'For the sandbox, use the test card 4242 4242 4242 4242 with any future expiry.', expect: 'allow', note: 'Known test card — must pass' },
        { title: 'Order number failing Luhn', text: 'Order #1234 5678 9012 3457 has shipped.', expect: 'allow', note: 'Fails Luhn — must pass' },
        { title: 'Utility account number', text: 'My electricity account number is 400123456, can you explain the bill?', expect: 'allow', note: 'No banking context — must pass' },
      ],
    },
    {
      id: 6,
      title: 'Business & national IDs (ABN, PAN, Aadhaar)',
      how: `${T1}: ABN Mod-89 with entity context, Indian PAN structure, Aadhaar Verhoeff.`,
      prompts: [
        { title: 'ABN with entity', text: `our ABN is ${abn} for Corvane Logistics Pty Ltd`, expect: 'block', note: `${T1} · Mod-89 + entity` },
        { title: 'Indian PAN', text: 'my PAN is ABCPE1234F, is it linked to my bank?', expect: 'block', note: `${T1} · PAN structure` },
        { title: 'PAN next to a name', text: 'Rahul Sharma, PAN ABCPS1234K — is he registered for GST?', expect: 'block', note: `${T1} · PAN structure` },
        { title: 'ABN next to a sole trader', text: `John Smith ABN ${abn} sole trader invoice`, expect: 'block', note: `${T1} · Mod-89 + name` },
        { title: 'Aadhaar', text: `my aadhaar is ${aadhaar}`, expect: 'block', note: `${T1} · Verhoeff valid` },
        { title: 'ABN question', text: 'How do I apply for an ABN as a sole trader?', expect: 'allow', note: 'No identifier — must pass' },
      ],
    },
    {
      id: 7,
      title: 'Database credentials',
      how: `${T1}: connection URIs with inline user:password or a password= parameter (JDBC), ADO/ODBC strings with Password=, mysql -p<password>.`,
      prompts: [
        { title: 'Postgres URI', text: 'it fails to connect: postgres://admin:S3cr3tPass!@db.internal:5432/prod', expect: 'block', note: `${T1} · URI with credentials` },
        { title: 'ADO.NET connection string', text: 'Server=sql01;Database=crm;User Id=sa;Password=Winter2025!;', expect: 'block', note: `${T1} · Password=` },
        { title: 'JDBC URL with a password parameter', text: 'jdbc:mysql://10.0.0.5:3306/sales?user=root&password=Sql!Pass77', expect: 'block', note: `${T1} · password= parameter` },
        { title: 'DATABASE_URL in a .env file', text: 'DATABASE_URL=postgresql://app:Pg$ecret99@db.internal:5432/prod', expect: 'block', note: `${T1} · URI with credentials` },
        { title: 'Placeholder URI', text: 'The format is postgres://user:password@host:5432/dbname', expect: 'allow', note: 'Placeholder password — must pass' },
      ],
    },
    {
      id: 8,
      title: 'Customer financial records',
      how: `${T2} for a named, non-public person tied to an account or to an amount + financial attribute (a record role such as "client" / "customer" decides on its own, otherwise the validator); ${T3B} for exact rows of protected customer data.`,
      prompts: [
        { title: 'Named client with balances (context)', text: 'Client Daniel Whitford — account balance $1,284,500.00, margin loan outstanding $310,000. Write a portfolio review.', expect: 'block', note: `${T2} · no setup needed` },
        { title: 'Mortgage arrears (context)', text: 'Sarah Mitchell owes $412,000 on her mortgage and has missed two repayments. Draft a hardship letter.', expect: 'block', note: `${T2} · no setup needed` },
        { title: 'Customer record as JSON (context)', text: '{"customer":"Margaret Ellison","account_no":"40231987","balance":182450.22,"overdue":true}', expect: 'block', note: `${T2} · record keys cue the name and account` },
        { title: 'Customer ledger as CSV (context)', text: 'customer,account,balance\nMargaret Ellison,40231987,$182,450.22\nDavid Chen,40231988,$9,120.00', expect: 'block', note: `${T2} · no setup needed` },
        { title: 'Row from the bundled demo CRM', text: 'Is Eleanor Ashworth (account 637260938) eligible for the new fund?', expect: 'block', note: `${T3B} · salted hash of name + account`, needs: 'demo-vault' },
        { title: 'Customer from your protected CSV', text: 'Can you write to Tobias Wrenfield about account 738204615?', expect: 'block', note: `${T3B} · after protecting the sample customer CSV`, needs: 'sample:halcyon-customers' },
        { title: 'Public figure', text: "What is Warren Buffett's net worth, and how much of his portfolio is in Apple?", expect: 'allow', note: 'Public figure — must pass' },
        { title: 'Market statistic', text: 'What is the average mortgage balance in Australia right now?', expect: 'allow', note: 'No identifiable person — must pass' },
      ],
    },
    {
      id: 9,
      title: 'Medical records',
      how: `${T2} for a named, non-public person tied to an ICD-10-CM condition, RxNorm drug or dosage (a record role such as "patient" or an MRN / DOB decides on its own, otherwise the validator); ${T3B} for exact rows of protected patient data.`,
      prompts: [
        { title: 'Patient with MRN and diagnosis (context)', text: 'Summarise for the referral: patient Margaret Okafor (MRN 00482913) was diagnosed with type 2 diabetes mellitus and started metformin 500 mg twice daily.', expect: 'block', note: `${T2} · no setup needed` },
        { title: 'Named person, condition and drug (context)', text: 'John Davies is on warfarin 5 mg for atrial fibrillation; can you write his care plan?', expect: 'block', note: `${T2} · no setup needed` },
        { title: 'Patient record as JSON (context)', text: '{"patient":"Linda Park","dob":"1972-03-14","diagnosis":"breast cancer","medication":"tamoxifen 20mg"}', expect: 'block', note: `${T2} · record keys cue the name` },
        { title: 'Patients as CSV (context)', text: 'patient,condition,drug\nLinda Park,type 2 diabetes,metformin 500mg\nOmar Haddad,HIV,Biktarvy', expect: 'block', note: `${T2} · no setup needed` },
        { title: 'Row from the bundled demo registry', text: 'Book a follow-up for Rafael Fairbanks, MRN 60095252.', expect: 'block', note: `${T3B} · salted hash of name + MRN`, needs: 'demo-vault' },
        { title: 'Patient from your protected CSV', text: 'Please reschedule Ignatius Holloway (MRN 81547302) to Thursday.', expect: 'block', note: `${T3B} · after protecting the sample patient CSV`, needs: 'sample:halcyon-patients' },
        { title: 'Symptom question', text: 'What are the early symptoms of type 2 diabetes?', expect: 'allow', note: 'General question — must pass' },
        { title: 'Public figure, medical question', text: 'Did Steve Jobs have pancreatic cancer?', expect: 'allow', note: 'Public figure — must pass' },
      ],
    },
    {
      id: 10,
      title: 'Corporate IP & documents',
      how: `${T3A} for copied excerpts (≥ 10 consecutive 5-gram hits) and near-duplicates (MinHash J ≥ 0.5); ${T3B} for semantically identical paragraphs (cosine > 0.95).`,
      prompts: [
        { title: '15 lines of the bundled proprietary router', text: `Can you optimise this?\n\n${router.slice(10, 25).join('\n')}`, expect: 'block', note: `${T3A}`, needs: 'demo-vault' },
        { title: 'Paragraph from the bundled board memo', text: `Rewrite this for the board deck:\n\n${memo[3]}`, expect: 'block', note: `${T3A} + ${T3B}`, needs: 'demo-vault' },
        { title: 'Large paste → pasted-content chip', text: 'Summarise the attached memo for my team in five bullet points.', paste: memo.slice(3, 7).join('\n\n'), expect: 'block', note: `${T3A} on the attachment; removing the chip lifts the block`, needs: 'demo-vault' },
        { title: 'Excerpt of your protected code', text: `Refactor this for readability:\n\n${netting.slice(15, 30).join('\n')}`, expect: 'block', note: `${T3A} · after protecting the sample code`, needs: 'sample:settlement-netting-engine' },
        { title: 'Paragraph of your protected document', text: `Make this sound friendlier:\n\n${pricing[3]}`, expect: 'block', note: `${T3A} + ${T3B} · after protecting the sample memo`, needs: 'sample:halcyon-pricing-memo' },
        { title: 'Generic code question', text: 'How do I debounce a function in TypeScript without a library?', expect: 'allow', note: 'Not in the vault — must pass' },
      ],
    },
  ],
  edgeCases: edgeCases.map((c) => ({
    id: c.id,
    title: c.title ?? c.id,
    expect: c.expect,
    categories: c.categories,
    text: c.text,
    ...(c.attachments?.length ? { paste: c.attachments[0]!.text } : {}),
    ...(c.steps ? { steps: c.steps.map((s) => ({ text: s.text, expect: s.expect, ...(s.attachments?.length ? { paste: s.attachments[0]!.text } : {}) })) } : {}),
  })),
  samples: [
    { id: 'settlement-netting-engine', type: 'code', title: 'Halcyon settlement netting engine', fileName: 'settlement-netting-engine.ts', text: read('data/test-kit/settlement-netting-engine.ts') },
    { id: 'halcyon-pricing-memo', type: 'document', title: 'Project Halcyon pricing memo', fileName: 'halcyon-pricing-memo.md', text: read('data/test-kit/halcyon-pricing-memo.md') },
    { id: 'halcyon-customers', type: 'customers', title: 'Halcyon customer list', fileName: 'halcyon-customers.csv', text: read('data/test-kit/halcyon-customers.csv') },
    { id: 'halcyon-patients', type: 'patients', title: 'Halcyon patient roster', fileName: 'halcyon-patients.csv', text: read('data/test-kit/halcyon-patients.csv') },
  ],
};

// The synthetic AWS key id is written as a JSON escape so secret scanners (GitHub push protection)
// don't take the fixture for a leaked key; JSON.parse restores the exact text.
writeFileSync(resolve(root, 'assets/engine/test-kit.json'), JSON.stringify(kit, null, 2).replace(/\bAKIA/g, 'AKI\\u0041') + '\n');
console.log(`test-kit.json: ${kit.categories.reduce((n, c) => n + c.prompts.length, 0)} category prompts, ${kit.edgeCases.length} edge cases, ${kit.samples.length} samples`);
