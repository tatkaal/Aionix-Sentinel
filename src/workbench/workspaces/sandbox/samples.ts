// Quick test prompts for the Sandbox. All values are synthetic (documented example keys,
// checksum-valid but unissued numbers, fictional people).

export interface SamplePrompt {
  id: string;
  label: string;
  expect: 'block' | 'allow';
  mode: 'type' | 'paste';
  text: string;
}

const LARGE_PASTE_FILLER = Array.from(
  { length: 14 },
  (_, i) =>
    `Section ${i + 1}: The migration runbook covers connection pooling, retry budgets, structured logging and the rollback checklist. Owners confirm each step in the change ticket before the maintenance window closes.`,
).join('\n');

export const SAMPLE_PROMPTS: SamplePrompt[] = [
  {
    id: 'aws',
    label: 'AWS keys in a debug question',
    expect: 'block',
    mode: 'type',
    text: 'Why does boto3 say access denied? My config:\naws_access_key_id = AKIAIOSFODNN7EXAMPLE\naws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  },
  {
    id: 'card',
    label: 'Customer card + TFN',
    expect: 'block',
    mode: 'type',
    text: 'Draft a refund email for Priya Raman. Card 4532-0151-1283-0366 was double charged; her TFN is 123 456 782 for the tax receipt.',
  },
  {
    id: 'patient',
    label: 'Named patient + diagnosis',
    expect: 'block',
    mode: 'type',
    text: 'Summarise for the referral: patient Margaret Okafor (MRN 00482913) was diagnosed with type 2 diabetes mellitus and started metformin 500 mg twice daily.',
  },
  {
    id: 'ledger',
    label: 'Named customer ledger',
    expect: 'block',
    mode: 'type',
    text: 'Client Daniel Whitford — account balance $1,284,500.00, margin loan outstanding $310,000, last wire transfer $75,000 to his trust account. Write a portfolio review.',
  },
  {
    id: 'clean-code',
    label: 'Clean coding question',
    expect: 'allow',
    mode: 'type',
    text: 'How do I validate that a password field is at least 12 characters in a React form? The type is `password: string`.',
  },
  {
    id: 'test-card',
    label: 'Stripe test card',
    expect: 'allow',
    mode: 'type',
    text: 'Our checkout tests use 4242 4242 4242 4242 with any future expiry. Why does the 3-D Secure flow not trigger?',
  },
  {
    id: 'medical-general',
    label: 'General medical question',
    expect: 'allow',
    mode: 'type',
    text: 'What are the common early symptoms of type 2 diabetes, and how is metformin usually dosed?',
  },
  {
    id: 'large-paste',
    label: 'Large paste with buried secret',
    expect: 'block',
    mode: 'paste',
    text: `${LARGE_PASTE_FILLER}\nAppendix: staging DATABASE_URL=postgres://deploy:Qx7!vR2#pLm9@staging-db.internal:5432/app\n${LARGE_PASTE_FILLER}`,
  },
];
