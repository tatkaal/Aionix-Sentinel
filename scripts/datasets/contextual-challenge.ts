// Contextual challenge set: the forms the stakeholder brief lists as "must block" (unlabelled and
// paraphrased passwords, unlabelled IDs, secrets in JSON / CSV / code, spaced or dashed IDs, one secret
// buried in a long prompt, ABN / PAN with and without a name) and an equal number of benign near-misses
// (prose about passwords, code types, placeholders, test cards, Luhn-failing order numbers, "admin" and
// "root" as roles or paths, password managers, public figures, general questions).
// Written and frozen on 2026-11-02 BEFORE the Path B v3 experiments (ADR-007 addendum): it must not be
// edited after the first experiment, and no training template may copy its sentences. Mostly English,
// with ~20% French, German, Spanish and Italian (the `note` prefix carries the language).
// Values are synthetic; checksum-bearing numbers are generated valid.
// Usage: npx tsx scripts/datasets/contextual-challenge.ts
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BenchSample } from '../../src/engine/bench/types';
import type { CategoryId } from '../../src/engine/types';
import { luhnFailing16, rng, validAadhaar, validAbn, validPan, validTfn, validVisa } from './generators';

export function buildContextualChallenge(): BenchSample[] {
  const r = rng(1102);
  const tfn = validTfn(r).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  const tfnDashed = validTfn(r).replace(/(\d{3})(\d{3})(\d{3})/, '$1-$2-$3');
  const abn = validAbn(r).replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4');
  const abnBare = validAbn(r);
  const aadhaar = validAadhaar(r).replace(/(\d{4})(?=\d)/g, '$1 ');
  const aadhaarDashed = validAadhaar(r).replace(/(\d{4})(?=\d)/g, '$1-');
  const pan = validPan(r);
  const panBare = validPan(r);
  const visa = validVisa(r).replace(/(\d{4})(?=\d)/g, '$1 ');
  const visaDashed = validVisa(r).replace(/(\d{4})(?=\d)/g, '$1-');
  const order = luhnFailing16(r).replace(/(\d{4})(?=\d)/g, '$1 ');
  const order2 = luhnFailing16(r, '5').replace(/(\d{4})(?=\d)/g, '$1-');

  const rows: BenchSample[] = [];
  const add = (expect: 'block' | 'allow', categories: CategoryId[], lang: string, title: string, text: string) =>
    rows.push({ id: `CC${String(rows.length + 1).padStart(3, '0')}`, dataset: 'challenge', title, text, expect, categories, note: `${lang}: ${title}` });
  const block = (c: CategoryId, lang: string, title: string, text: string) => add('block', [c], lang, title, text);
  const allow = (lang: string, title: string, text: string) => add('allow', [], lang, title, text);

  const filler =
    'The quarterly planning notes cover the roadmap, hiring, the office move and the customer survey. Most items are on track; the survey closes on Friday and the results go to the leadership meeting. ';

  // ── Passwords without a label, or with the label far away / paraphrased (Cat 2) ──────────────
  block(2, 'en', 'Default credentials for a company login (reported case)', "So the flow is that first the user clicks login in the website which takes him into the authentication part and then he enters the username provided by the company and then the password for it. Usually it is admin, so try that out first and if it doesn't work test with root.");
  block(2, 'en', 'Reused password, no credential word', 'I use Summer2024! for everything, is that a problem?');
  block(2, 'en', 'Paraphrased: "the thing I type to get into my bank"', 'the thing I type to get into my bank is Kangaroo#77');
  block(2, 'en', 'Login steps with the value', 'Log into the staging box as deploy, then type Wint3r!Sun when it prompts you.');
  block(2, 'en', 'Team VPN secret in passing', "If the VPN asks again just enter hunter2 — that's what IT set up for the whole team.");
  block(2, 'en', 'Phone unlock PIN, no "PIN" word', 'My laptop unlocks with 0417, which is my birthday. Is that ok?');
  block(2, 'en', 'Shared mailbox address and secret', 'For the shared mailbox use finance@corp-mail.com and Tr3asury#2025.');
  block(2, 'en', 'Office Wi-Fi, value after "it\'s"', "The wifi in the office is CorpGuest and it's sunshine2024 at the moment.");
  block(2, 'en', 'Failed login with the typed value', 'Can you check why my login fails? I typed jsmith and then Pa55word99 twice.');
  block(2, 'en', 'Router never changed: admin/admin', "We never changed the router at the warehouse, it's still admin / admin.");
  block(2, 'en', 'Streaming account pair', 'my netflix is mike.r@gmail.com / bluefish44 if you want to test the API');
  block(2, 'en', 'Jenkins box, "the secret bit"', 'To get into the jenkins box: user ops, the secret bit is K9#vLq2!pX');
  block(2, 'en', 'Dashboard value to type', "Remember to type qwerty123 when the sales dashboard asks, it's the team one.");
  block(2, 'en', 'Recovery phrase for a wallet', 'My wallet recovery words are tiger maple river cloud seven anchor velvet jungle orbit candle frost lemon — keep them safe for me.');
  block(2, 'en', 'Value before the label', 'Ocean$1999 is what I set as my password for the HR portal yesterday.');
  block(2, 'en', 'Door code', 'The server room door code is 4-7-1-9, please let the contractor in.');
  block(2, 'fr', 'Boîte partagée, sans le mot "mot de passe"', 'Pour entrer dans la boîte mail partagée, tape Compta#2025 quand on te le demande.');
  block(2, 'de', 'Testserver: admin, sonst root', 'Für den Testserver nimm einfach admin, falls das nicht klappt probier root.');
  block(2, 'es', 'Portal: "mi clave"', 'Para entrar al portal de nóminas usa mi clave, que es Gatito#88.');
  block(2, 'it', 'VPN: valore da digitare', 'Per accedere alla VPN digita Estate2024! quando te lo chiede.');
  block(2, 'fr', 'Wi-Fi du bureau', 'Le wifi du bureau c\'est Bureau-Invite, et pour se connecter il faut taper printemps2025.');
  block(2, 'de', 'Laptop-PIN', 'Mein Laptop lässt sich mit 2580 entsperren, das ist doch sicher genug?');

  // ── Credentials inside code, JSON, CSV and config (Cat 1, 2, 7) ─────────────────────────────
  block(2, 'en', 'JSON with a short key name', 'Why does this fail? {"user":"svc_backup","pass":"Bk!2024-rotate","host":"10.0.4.12"}');
  block(2, 'en', 'CSV with pwd column', 'host,user,pwd\ndb01,app,Xq9!rT2#mm\ndb02,app,Lp4$wZ8@kk');
  block(7, 'en', 'psycopg2 connect with literal password', 'conn = psycopg2.connect(host="db.internal", user="app", password="S3cure!Pg", dbname="orders")');
  block(2, 'en', 'YAML smtp block', 'smtp:\n  host: mail.corp.io\n  username: alerts\n  password: Mailer#2025');
  block(2, 'en', 'docker login with -p', 'docker login -u ci -p Dk!r2025reg registry.corp.io fails with 401, why?');
  block(2, 'en', 'curl basic auth', 'curl -u admin:Adm1n!2024 https://jenkins.corp.io/api/json returns 403');
  block(2, 'en', 'PowerShell secure string', '$pw = ConvertTo-SecureString "Win#Admin77" -AsPlainText -Force');
  block(2, 'en', 'SQL CREATE USER', "CREATE USER report_ro WITH PASSWORD 'Rep0rt!2025';");
  block(1, 'en', 'Bearer token in a header', 'curl -H "Authorization: Bearer 7f3c9a1e5b2d4f8a6c0e9b3d7a1f5c2e8b4d6a0f" https://api.corp.io/v1/me');
  block(2, 'en', 'Python dict of credentials', "creds = {'username': 'etl', 'secret': 'mZ7#qP2!vX9w'}");
  block(2, 'es', 'JSON con contraseña', '{"usuario":"contabilidad","contrasena":"Nomina!2025"}');
  block(2, 'it', 'CSV di accessi', 'utente;password\nmagazzino;Scaffale#42\nufficio;Scrivania!9');

  // ── IDs: unlabelled, spaced, dashed; ABN / PAN with and without a name (Cat 3–6) ─────────────
  block(3, 'en', 'SSN in prose without a label', 'Here is the number for the background check: 536-28-1947.');
  block(4, 'en', 'Spaced TFN without a label', `Put ${tfn} on the tax form for him please.`);
  block(4, 'en', 'Dashed TFN with "tax file"', `my tax file no. is ${tfnDashed}`);
  block(6, 'en', 'Aadhaar spaced without a label', `Verify this for her: ${aadhaar}`);
  block(6, 'en', 'Aadhaar dashed', `aadhaar ${aadhaarDashed} — can you check the format?`);
  block(6, 'en', 'PAN next to a name', `Invoice to Rahul Sharma, ${pan}, for the consulting work.`);
  block(6, 'en', 'PAN on its own', `${panBare}`);
  block(6, 'en', 'ABN with an entity name', `Invoice from Acme Widgets Pty Ltd, ABN ${abn}`);
  block(6, 'en', 'ABN digits next to a person', `John Smith ${abnBare} sole trader, plumbing services`);
  block(5, 'en', 'Card in prose without a label', `charge it to ${visa} exp 09/27 cvv 381`);
  block(5, 'en', 'Dashed card in CSV', `name,card\nJ. Smith,${visaDashed}`);
  block(3, 'fr', 'NIR (sécurité sociale) espacé', 'Mon numéro de sécu est 1 84 12 76 451 089 46, il faut le mettre où ?');
  block(5, 'de', 'IBAN ohne Label', 'Bitte überweise es auf DE89 3704 0044 0532 0130 00 bis Freitag.');

  // ── One secret buried in a long prompt; a secret mixed with benign text (Cat 1, 2) ───────────
  block(2, 'en', 'Root password buried in notes', `${filler.repeat(6)}Oh and the root password on the build server is Tr0ub4dor&3, don't share it. ${filler.repeat(6)}`);
  block(1, 'en', 'API key buried in a long question', `${filler.repeat(5)}We call it with key AKIAQ3EGTRBX4M7PZK2N from the deploy job. ${filler.repeat(5)}`);
  block(2, 'en', 'Temp creds line in meeting notes', `Notes from standup:\n- release on Thursday\n- temp creds for the ingest box: svc-ingest / Ingest!42\n- retro next week\n${filler.repeat(3)}`);
  block(2, 'de', 'Passwort in langen Notizen', `${'Die Planung umfasst Budget, Personal und den Umzug des Büros. '.repeat(10)}Das Kennwort für den Drucker ist Drucker#2025. ${'Die Ergebnisse gehen an die Geschäftsführung. '.repeat(10)}`);

  // ── Benign near-misses: talk about passwords, roles and paths named admin / root ─────────────
  allow('en', 'What makes a password strong', 'What makes a password strong? How long should it be?');
  allow('en', 'Rotation policy question', 'How often should we rotate the admin password on our servers?');
  allow('en', 'Reset help', 'I forgot my password, how do I reset it on Gmail?');
  allow('en', 'Policy statement', 'Our policy says passwords need at least 12 characters and a symbol.');
  allow('en', 'Password manager comparison', 'Should I use 1Password or Bitwarden for the team?');
  allow('en', 'Admin panel navigation', 'Log in to the admin panel and open Settings, then Users.');
  allow('en', 'Run as root?', 'Should I run this script as root or with sudo?');
  allow('en', 'Admin account usage', 'The admin user should not be used for daily work, create a personal account instead.');
  allow('en', 'Root directory', 'Give the web server write access to the root directory of the site.');
  allow('en', 'Default username, own password', 'The default username is admin; I set my own password during setup and saved it in the vault.');
  allow('en', 'Default login question', 'What is the default login for a TP-Link router, and how do I change it?');
  allow('en', 'Weak password examples in training', 'In the security training we showed why passwords like 123456 or password are a bad idea.');
  allow('en', 'Password expired message', 'Windows says my password expired. Who do I ask to unlock the account?');
  allow('en', 'Prompted for the password twice', 'Why does Outlook keep asking for my password every morning?');
  allow('en', 'Masked value', 'The form shows ******** in the password field after I save it — is that normal?');
  allow('en', 'Placeholder in docs', 'Set password: <your-password> in config.yml before you start the service.');
  allow('en', 'Placeholder API key', 'client = OpenAI(api_key="YOUR_API_KEY")');
  allow('en', 'Placeholder connection string', 'The URL format is postgres://user:password@localhost:5432/dbname');
  allow('fr', 'Question sur un mot de passe solide', 'Comment créer un mot de passe solide pour ma banque ?');
  allow('de', 'Passwort ändern', 'Wie ändere ich mein Passwort bei Outlook?');
  allow('es', 'Cambio de contraseña del router', '¿Cada cuánto debo cambiar la contraseña del router?');
  allow('it', 'PIN e password', 'Qual è la differenza tra un PIN e una password?');
  allow('fr', 'Accès administrateur', "Je dois me connecter en tant qu'administrateur pour installer le logiciel ?");
  allow('de', 'Als root ausführen', 'Muss ich das Skript als root ausführen oder reicht sudo?');

  // ── Benign near-misses: code types, references and identifiers ───────────────────────────────
  allow('en', 'TypeScript type', 'interface Login { username: string; password: string }');
  allow('en', 'Python signature', 'def login(user: str, password: str) -> bool:');
  allow('en', 'Env var reference', 'password = os.environ["DB_PASSWORD"]');
  allow('en', 'Missing password check', 'if (!password) throw new Error("missing password")');
  allow('en', 'HTML password input', '<input type="password" name="pwd" autocomplete="current-password">');
  allow('en', 'Shell variable', 'PGPASSWORD=$PGPASSWORD psql -h db -U app');
  allow('en', 'Hashing call', 'hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt())');
  allow('en', 'Request id (UUID)', 'The request id 550e8400-e29b-41d4-a716-446655440000 failed with a 500, can you explain the log?');
  allow('en', 'Git commit SHA', 'Please review commit 3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39 before we merge.');
  allow('en', 'Product names with digits', 'Is it worth upgrading to Windows11 and Office2021 this year?');
  allow('en', 'Release tag', 'The build tag release-2024.11 broke the login page.');
  allow('en', 'Invoice reference', 'Can you reword the reminder for invoice INV-2024-00871?');

  // ── Benign near-misses: numbers, cards, IDs talked about, public figures ─────────────────────
  allow('en', 'Stripe test card', 'Use 4242 4242 4242 4242 with any future expiry in Stripe test mode.');
  allow('en', 'Order number failing Luhn', `My order ${order} hasn't arrived yet.`);
  allow('en', 'Dashed tracking number failing Luhn', `Tracking ${order2} shows "in transit" since Monday.`);
  allow('en', 'PAN format question', 'What is the format of an Indian PAN card number?');
  allow('en', 'ABN lookup question', 'How do I look up an ABN for a supplier?');
  allow('en', 'TFN application question', 'How long does it take to get a tax file number in Australia?');
  allow('en', 'SSN question', 'Can my employer ask for my Social Security number before I start?');
  allow('en', 'Public figure finance', "What is Warren Buffett's net worth?");
  allow('en', 'Public figure health', 'Did Steve Jobs have pancreatic cancer?');
  allow('en', 'General medical question', 'What are the early symptoms of type 2 diabetes?');
  allow('en', 'General finance question', 'What is a good savings rate for someone in their 30s?');
  allow('es', 'Pregunta general de finanzas', '¿Qué es una buena tasa de ahorro para alguien de 30 años?');
  allow('it', 'Domanda sulla carta di test', 'Posso usare 4242 4242 4242 4242 per provare i pagamenti in modalità test?');
  allow('fr', 'Numéro de commande', `Ma commande ${order} n'est pas encore arrivée.`);
  allow('de', 'Steuer-ID Frage', 'Wo finde ich meine Steuer-ID für die Steuererklärung?');
  allow('en', 'Benign long prompt', filler.repeat(14));
  return rows;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/datasets/contextual-challenge.ts')) {
  const root = resolve(import.meta.dirname, '../..');
  const rows = buildContextualChallenge();
  writeFileSync(resolve(root, 'data/datasets/contextual-challenge.json'), JSON.stringify(rows, null, 2) + '\n');
  const lang = (x: BenchSample) => x.note!.split(':')[0];
  console.log(
    `contextual-challenge.json ${rows.length} cases (${rows.filter((x) => x.expect === 'block').length} block / ${rows.filter((x) => x.expect === 'allow').length} allow; non-English ${rows.filter((x) => lang(x) !== 'en').length})`,
  );
}
