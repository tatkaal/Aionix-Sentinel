// English disclosure probes: how people actually type sensitive data into a chat box, across
// Categories 1–10, plus benign near-misses for each. Authored after the stakeholder reported
// "my current psw is Ohlalalala34%. can you suggest a better one?" passing unblocked.
// This set was used to find and fix gaps, so it is a regression suite (split: curated), not an
// unbiased estimate. Values are synthetic; checksum-bearing numbers are generated valid.
// Usage: npx tsx scripts/datasets/english-probes.ts   (also run by fetch-datasets.ts)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BenchSample } from '../../src/engine/bench/types';
import type { CategoryId } from '../../src/engine/types';
import { rng, validAadhaar, validAbn, validTfn, validVisa } from './generators';

export function buildEnglishProbes(root: string): BenchSample[] {
  const r = rng(2026);
  const tfn = validTfn(r).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  const abn = validAbn(r).replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4');
  const visa = validVisa(r).replace(/(\d{4})(?=\d)/g, '$1 ');
  const aadhaar = validAadhaar(r).replace(/(\d{4})(?=\d)/g, '$1 ');
  const router = readFileSync(resolve(root, 'data/vault/alpha-liquidity-router.ts'), 'utf8').split('\n');
  const memo = readFileSync(resolve(root, 'data/vault/project-chronos-memo.md'), 'utf8').split('\n\n');
  const crm = readFileSync(resolve(root, 'data/vault/hnw-crm-export.csv'), 'utf8').split('\n');
  const rows: BenchSample[] = [];
  const add = (expect: 'block' | 'allow', categories: CategoryId[], title: string, text: string) =>
    rows.push({ id: `EP${String(rows.length + 1).padStart(3, '0')}`, dataset: 'probes', title, text, expect, categories });
  const block = (c: CategoryId, title: string, text: string) => add('block', [c], title, text);
  const allow = (title: string, text: string) => add('allow', [], title, text);

  // ── Category 1: API keys & tokens ─────────────────────────────────────────
  block(1, 'OpenAI key pasted in a question', 'Why does this fail? client = OpenAI(api_key="sk-proj-Qm8xT2vL9pR4kW7nZ1cB5yH3jF6dS0aE2gU8iO4t")');
  block(1, 'Unprefixed key, "my api key is"', 'my api key is 9f8e7d6c5b4a39281706f5e4d3c2b1a0 but the request returns 401, any idea why?');
  block(1, 'GitHub token in prose', 'use this token to clone the repo: ghp_7Rk2Lm9Qx4Tz8Vb1Nc6Hd3Pw5Ys0Ja2Ge7Uf');
  block(1, 'AWS secret key said in words', 'The AWS secret key is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY, can you check my IAM policy?');
  block(1, 'Bearer JWT in a curl', 'curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6ImFkbWluIn0.Xk3pQ8vR2mT9wL4nZ7cB1yH5jF0dS6aE" https://api.internal/v1/users');
  block(1, 'Access token "is"', 'our slack access token is xoxb-2048-1793-Hq8vT2mR9pL4kW7nZ1cB5yH3 — why is the bot offline?');
  allow('How to rotate an API key', 'How do I rotate my OpenAI API key safely without downtime?');
  allow('Where to find the key', 'Where do I find my API key in the Stripe dashboard?');
  allow('Key handling advice', 'Should the api key live in an environment variable or in a secrets manager?');

  // ── Category 2: passwords, PINs, one-time codes ──────────────────────────
  block(2, 'Stakeholder report: "psw"', 'my current psw is Ohlalalala34%. can you suggest a better one?');
  block(2, '"password is" + low-entropy value', 'my password is Ohlalalala34% — is it strong enough?');
  block(2, '"pw is"', 'my pw is sunshine!2024, should I change it?');
  block(2, '"pwd:"', 'pwd: Tr0ub4dor&3');
  block(2, '"pass is"', 'the wifi pass is CoffeeShop2024, can you write it on the welcome card?');
  block(2, 'Words between label and value', 'the password for our office wifi is BlueHarbor88! — can you make a sign for the lobby?');
  block(2, '"password I use for my bank is"', 'The password I use for my bank is Kangaroo#77. Is that safe?');
  block(2, '"changed my password to"', 'I changed my password to Summer2024! yesterday, is that secure enough?');
  block(2, '"set the password to"', 'I set the admin password to Qw3rty!Zx on the new router, please document it.');
  block(2, 'Lowercase non-word password, owned', 'my password is ohlalala');
  block(2, 'Lower + digit password', 'username: m.chen  password: hunter2');
  block(2, 'Credentials pair with slash', 'The admin credentials are admin / Xk9#pL2qRv for the staging box.');
  block(2, 'Bank PIN', 'my bank PIN is 4821, can you remind me to change it next month?');
  block(2, 'PIN with colon', 'Card PIN: 7390');
  block(2, 'Door passcode', 'the passcode for the server room door is 482913');
  block(2, 'One-time code', 'my one-time code is 739204, can you log in for me?');
  block(2, 'Verification code', 'verification code: 551938 — what do I do with it?');
  block(2, 'Self-owned password question', 'Can you check if Winter2025$ is a strong password? It is the one I use for my bank.');
  block(2, '"creds" with user / password pair', 'here are my creds: jdoe / Summer2024!');
  block(2, 'Juxtaposed "password <value>"', "password Summer2024! didn't work for the VPN, what else can I try?");
  block(2, 'Service password', 'my netflix password is Summer2024!, can my brother use it?');
  block(2, 'Quoted passphrase', "my passphrase is 'correct horse battery staple'");
  block(2, 'Wi-Fi key', 'the wifi key is Sunflower2024 if guests ask');
  block(2, 'WPA2 key with colon', 'our WPA2 key: GreenTea!889');
  block(2, 'Alarm code', 'my alarm code is 4417, can you add it to the house notes?');
  block(2, 'Gate code', 'the gate code is 2580');
  block(2, 'Safe combination', 'safe combination: 12-34-56');
  allow('Password manager question', 'What is a good password manager for a small team?');
  allow('"password is too weak"', 'My password is too weak, how do I make a stronger one?');
  allow('Password policy', 'The password must be at least 12 characters long and include a symbol.');
  allow('"password is required"', 'Password is required for this field, but the form still submits without it.');
  allow('Forgot password', 'I forgot my password, how do I reset it?');
  allow('"password is stored in"', 'My password is stored in 1Password, so I never type it.');
  allow('PIN length question', 'What is the default PIN length for most Australian bank cards?');
  allow('Reset PIN question', 'How do I reset my PIN if the card is locked?');
  allow('Passcode email', 'Did you get the passcode email from IT this morning?');
  allow('Verification code prose', 'The verification code expires after ten minutes, so enter it quickly.');
  allow('Gate code instruction', 'Enter the gate code at the door and wait for the green light.');
  allow('Network key UI', 'The network key icon is greyed out in Windows settings.');
  allow('Wi-Fi key naming', 'What is the wifi key for guests usually called on a router?');
  allow('Passphrase advice', 'Use a passphrase like four random words instead of a short password.');
  allow('Password hygiene', 'What does password hygiene mean for a small business?');

  // ── Category 3: government IDs ────────────────────────────────────────────
  block(3, 'SSN with dashes', 'my SSN is 536-28-1947, can you fill in the W-4 for me?');
  block(3, 'SSN spaced, spelled out label', 'my social security number is 536 28 1947');
  block(3, 'SSN no separators', 'SSN 536281947 — is this on the form?');
  block(3, 'Passport "no is"', 'my passport no is N8473629, does it need a visa for Japan?');
  block(3, 'Passport number', 'Passport number: PA1234567, expiry 2031.');
  block(3, 'Driver licence', "my driver's license number is D1234-5678-9012");
  allow('Passport renewal', 'What documents do I need to renew my passport?');
  allow('SSN timing', 'How long does a new SSN application usually take?');

  // ── Category 4: AU TFN ────────────────────────────────────────────────────
  block(4, 'TFN "is"', `my TFN is ${tfn}, can you check my tax return?`);
  block(4, 'Tax file number, no separators', `tax file number: ${tfn.replace(/ /g, '')}`);
  allow('TFN declaration timing', 'When is the TFN declaration due for a new employee?');

  // ── Category 5: payment cards & bank accounts ─────────────────────────────
  block(5, 'Card with expiry and CVV', `my card number is ${visa}, exp 09/27, cvv 123`);
  block(5, 'Card dashed in prose', `charge it to ${visa.replace(/ /g, '-')} please`);
  block(5, 'BSB and account "is"', 'my account number is 12345678 and the BSB is 062-000');
  block(5, 'BSB + acc abbreviated', 'bsb 062-000 acc 1234 5678');
  block(5, 'IBAN spaced', 'Please wire it to IBAN GB82 WEST 1234 5698 7654 32.');
  block(5, 'Routing + account "is"', 'my routing number is 021000021 and my account number is 123456789');
  allow('BSB vs account', 'What is the difference between a BSB and an account number?');
  allow('Test card', 'For the sandbox, use the test card 4242 4242 4242 4242 with any future expiry.');
  allow('Card acceptance', 'Do you take Visa and Mastercard at the front desk?');

  // ── Category 6: ABN / PAN / Aadhaar ───────────────────────────────────────
  block(6, 'ABN with entity', `our ABN is ${abn} for Corvane Logistics Pty Ltd`);
  block(6, 'Indian PAN', 'my PAN is ABCPE1234F, is it linked to my bank?');
  block(6, 'Aadhaar', `my aadhaar is ${aadhaar}`);
  allow('ABN application', 'How do I apply for an ABN as a sole trader?');

  // ── Category 7: database credentials ──────────────────────────────────────
  block(7, 'Postgres URI', 'it fails to connect: postgres://admin:S3cr3tPass!@db.internal:5432/prod');
  block(7, 'Mongo SRV URI', 'MONGO_URL=mongodb+srv://svc:Pa55w0rd99@cluster0.example.net/app');
  block(7, 'ADO.NET string', 'Server=sql01;Database=crm;User Id=sa;Password=Winter2025!;');
  block(7, 'mysql -p on the command line', 'I run mysql -u root -pS3cr3tPass42 crm_prod and get access denied');
  block(2, 'Database password in prose', 'the prod database password is Xk9#pL2qRv, why can my app not log in?');
  allow('Connection-string question', 'How do I write a postgres connection string for a local database?');
  allow('Placeholder URI', 'The format is postgres://user:password@host:5432/dbname');

  // ── Category 8: customer financial records (context) ─────────────────────
  block(8, 'Named client with balances', 'Client Daniel Whitford — account balance $1,284,500.00, margin loan outstanding $310,000. Write a portfolio review.');
  block(8, 'Mortgage arrears', 'Sarah Mitchell owes $412,000 on her mortgage and has missed two repayments. Draft a hardship letter.');
  block(8, 'Savings + account number', 'My customer Priya Nair has $87,250 in her savings account (account 30471298). Suggest a term deposit.');
  allow('Market statistic', 'What is the average mortgage balance in Australia right now?');
  allow('Public figure wealth', "What is Warren Buffett's net worth, and how much of his portfolio is in Apple?");
  allow('Named person, no financial facts', 'Draft a memo reminding Sarah Jones that the portfolio review moved to Thursday.');

  // ── Category 9: medical records (context) ────────────────────────────────
  block(9, 'Patient with MRN and diagnosis', 'Summarise for the referral: patient Margaret Okafor (MRN 00482913) was diagnosed with type 2 diabetes mellitus and started metformin 500 mg twice daily.');
  block(9, 'Named person, condition and drug', 'John Davies is on warfarin 5 mg for atrial fibrillation; can you write his care plan?');
  block(9, 'Sick note for a named person', 'Write a sick note for Emily Clarke, who has major depressive disorder and needs two weeks off.');
  allow('Symptom question', 'What are the early symptoms of type 2 diabetes?');
  allow('Drug interaction question', 'Is it safe to take ibuprofen while on warfarin?');
  allow('Self cold', 'I have a cold, any tips to sleep better?');

  // ── Category 10: corporate IP (vault fingerprints / exact data match) ───
  block(10, '15-line excerpt of the proprietary router', `Can you optimise this?\n\n${router.slice(10, 25).join('\n')}`);
  block(10, 'Paragraph from the confidential memo', `Rewrite this for the board deck:\n\n${memo[3]}`);
  block(8, 'Row copied from the CRM export', `Is this client a good fit for the new fund?\n${crm[0]}\n${crm[3]}`);
  allow('Generic code question', 'How do I debounce a function in TypeScript without a library?');
  return rows;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/datasets/english-probes.ts')) {
  const root = resolve(import.meta.dirname, '../..');
  const probes = buildEnglishProbes(root);
  writeFileSync(resolve(root, 'data/datasets/english-probes.json'), JSON.stringify(probes, null, 2) + '\n');
  console.log(`english-probes.json ${probes.length} probes (${probes.filter((p) => p.expect === 'block').length} block / ${probes.filter((p) => p.expect === 'allow').length} allow)`);
}
