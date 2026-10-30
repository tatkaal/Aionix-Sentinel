// The 24 stakeholder acceptance scenarios (docs/edge-cases.md), compiled into
// data/datasets/edge-cases.json. Values are synthetic; vault excerpts come from data/vault.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { luhnValid } from '../../src/engine/tier1/checksums';
import type { BenchSample } from '../../src/engine/bench/types';
import { luhnFailing16, rng, validAadhaar } from './generators';

export function buildEdgeCases(root: string): BenchSample[] {
  const r = rng(24);
  const vault = (f: string) => readFileSync(resolve(root, 'data/vault', f), 'utf8');
  const routerLines = vault('alpha-liquidity-router.ts').split('\n');
  const memoParas = vault('project-chronos-memo.md').split('\n\n');
  const memoChip = memoParas.slice(3, 7).join('\n\n');
  if (memoChip.length < 1200) throw new Error('memo chip must be ≥ 1,200 chars to become an attachment chip');
  const order = luhnFailing16(r, '4716');
  if (luhnValid(order)) throw new Error('order number must fail Luhn');

  const benign = [
    'The quarterly planning cycle starts next week and every team lead should bring an updated roadmap.',
    'Please remember that the office kitchen will be closed on Friday afternoon for maintenance.',
    'Our customer satisfaction survey closed with a strong response rate, and the themes were consistent.',
    'The design review highlighted accessibility gaps in the onboarding flow that we will fix this sprint.',
    'Travel requests for the regional conference must be approved by your manager before booking.',
    'We are migrating the analytics dashboards to the new warehouse and expect a short read-only window.',
    'The hiring panel for the platform role meets on Wednesday; interview notes are due the same day.',
    'Remember to rotate the on-call schedule so that nobody covers two consecutive weekends.',
    'Marketing would like feedback on the draft launch blog post by the end of the week.',
    'The facilities team confirmed that the new desks will arrive before the end of the month.',
  ];
  const words: string[] = [];
  while (words.length < 1500) words.push(...pick10(benign, words.length).split(' '));
  const secret = 'ghp_7Rk2Lm9Qx4Tz8Vb1Nc6Hd3Pw5Ys0Ja2Ge7Uf';
  const at = 900;
  const buried = [...words.slice(0, at), `(temporary deploy token: ${secret})`, ...words.slice(at, 1500)].join(' ');

  const cases: [string, 'block' | 'allow', number[], string][] = [
    ['AWS access key pair in a debugging question', 'block', [1], "I'm getting AccessDenied from S3 — here is my config:\n[default]\naws_access_key_id = AKIAQ3EGTRBX4M7PZK2N\naws_secret_access_key = 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\nregion = ap-southeast-2"],
    ['OpenAI and GitHub tokens inside a code block', 'block', [1], 'Why does this script 401?\n```python\nclient = OpenAI(api_key="sk-proj-Qm3x9Rf2Lp7Tz4Wc8Vn1Hb6Kd0Sy5Ge2Ja7Uo4Xi")\nrepo = Github("ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8")\n```'],
    ['Labelled password in a config snippet', 'block', [2], "Here's the staging config, why won't the reporting job connect?\nhost: reports.staging.internal\nuser: svc_reporting\npassword: Tr0ub4dor&3x!"],
    ['Non-English credential labels', 'block', [2], 'Notas del turno: la contraseña del servidor es Gato#Negro2024. Für das Backup: Passwort: Sommer!2024xY. 测试环境 密码是Xq7#mP2v9L'],
    ['Unlabelled high-entropy password', 'block', [2], 'Can you check why login fails with K9#vQ2!xLm7$Tz4@ for the svc account? It worked yesterday.'],
    ['Code declaring empty password fields', 'allow', [], 'Review this TypeScript:\n```ts\ninterface Credentials { username: string; password: string; }\nconst password = "";\nif (!password) throw new Error("password is required");\n```'],
    ['SSN and passport number', 'block', [3], 'Complete the background check form: SSN 524-71-9036, passport number N4829173, start date next Monday.'],
    ['Spaced valid AU TFN', 'block', [4], 'Payroll asked me to confirm my TFN: 123 456 782 — can you draft a short reply?'],
    ['9-digit number failing the TFN checksum', 'allow', [], 'Is 123 456 789 a valid tax file number format, or is the checksum wrong?'],
    ['Luhn-valid card written with dashes', 'block', [5], 'Please refund the duplicate charge on card 4532-0151-1283-0366 and confirm by email.'],
    ['Benign test card 4242 4242 4242 4242', 'allow', [], 'Our checkout tests use 4242 4242 4242 4242 with any future expiry. Why does 3-D Secure not trigger?'],
    ['16-digit order number failing Luhn', 'allow', [], `Where is order ${order.replace(/(\d{4})(?=\d)/g, '$1 ')}? The tracking page shows nothing.`],
    ['IBAN in a payment instruction', 'block', [5], 'Please wire EUR 12,500 to IBAN DE89 3704 0044 0532 0130 00 for the supplier invoice.'],
    ['ABN next to an entity name', 'block', [6], 'Invoice from Brightline Analytics Pty Ltd (ABN 51 824 753 556) is 30 days overdue — draft a reminder.'],
    ['Verhoeff-valid Aadhaar and Indian PAN', 'block', [6], `KYC documents for the vendor: Aadhaar ${validAadhaar(r)} and PAN ABCPE1234F. Summarise what is still missing.`],
    ['Postgres connection string with credentials', 'block', [7], 'Our job fails with timeout using DATABASE_URL=postgres://admin:S3cretPass!@prod-db.internal:5432/ledger — any ideas?'],
    ['Named customer with balances', 'block', [8], 'Prepare a portfolio review for client Theo Marchetti: holdings $4,812,300.00, cash balance $198,699.76, margin loan $310,000.'],
    ["Public-figure finance question (Warren Buffett)", 'allow', [], "What is Warren Buffett's net worth, and how much of Berkshire's portfolio is in Apple?"],
    ['General finance question', 'allow', [], 'How does a mortgage offset account work compared with a redraw facility, and which saves more interest?'],
    ['Named patient with diagnosis and dosage', 'block', [9], 'Discharge summary for patient Harriet Lindqvist (DOB 14/02/1961): admitted with community-acquired pneumonia, discharged on amoxicillin 500 mg three times daily.'],
    ['General medical question', 'allow', [], 'What are the common early symptoms of type 2 diabetes, and how is metformin usually dosed?'],
    ['15-line excerpt of proprietary vault code', 'block', [10], `Can you make this faster?\n\n${routerLines.slice(54, 69).join('\n')}`],
    ['One secret buried in a 1,500-word benign prompt', 'block', [1], buried],
  ];

  const samples: BenchSample[] = cases.map(([title, expect, categories, text], i) => ({
    id: `EC${String(i + 1).padStart(2, '0')}`,
    dataset: 'edge',
    title,
    text,
    expect,
    categories: categories as BenchSample['categories'],
  }));

  samples.push({
    id: 'EC24',
    dataset: 'edge',
    title: 'Large paste becomes pasted-content.txt chip, then the chip is removed',
    text: 'Summarise the attached memo for my team in five bullet points.',
    attachments: [{ id: 'chip-1', name: 'pasted-content.txt', text: memoChip }],
    expect: 'block',
    categories: [10],
    steps: [
      { text: 'Summarise the attached memo for my team in five bullet points.', attachments: [{ id: 'chip-1', name: 'pasted-content.txt', text: memoChip }], expect: 'block' },
      { text: 'Summarise the attached memo for my team in five bullet points.', attachments: [], expect: 'allow' },
    ],
  });
  return samples;
}

function pick10(xs: string[], n: number): string {
  return xs[(n * 7) % xs.length]!;
}
