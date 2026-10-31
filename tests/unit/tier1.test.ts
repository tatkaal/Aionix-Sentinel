import { describe, expect, it } from 'vitest';
import { findDigitRuns, normalize, toRawSpan } from '../../src/engine/normalize';
import {
  aadhaarValid,
  abaRoutingValid,
  abnValid,
  ibanValid,
  luhnValid,
  tfnValid,
  verhoeffCheckDigit,
  verhoeffValid,
} from '../../src/engine/tier1/checksums';
import { entropyThresholdFor, shannonEntropy } from '../../src/engine/tier1/entropy';
import { scanTier1 } from '../../src/engine/tier1';

const types = (text: string) => scanTier1(text).map((f) => f.type);
const spans = (text: string) => scanTier1(text).map((f) => text.slice(f.rawStart, f.rawEnd));

describe('checksums', () => {
  it('validates AU TFN (Mod-11)', () => {
    expect(tfnValid('123456782')).toBe(true);
    expect(tfnValid('123456789')).toBe(false);
  });
  it('validates AU ABN (Mod-89)', () => {
    expect(abnValid('51824753556')).toBe(true);
    expect(abnValid('51824753557')).toBe(false);
  });
  it('validates Luhn', () => {
    expect(luhnValid('4532015112830366')).toBe(true);
    expect(luhnValid('4532015112830367')).toBe(false);
  });
  it('validates Verhoeff / Aadhaar', () => {
    const payload = '23456789012';
    const full = payload + verhoeffCheckDigit(payload);
    expect(verhoeffValid(full)).toBe(true);
    expect(aadhaarValid(full)).toBe(true);
    expect(aadhaarValid('1' + full.slice(1))).toBe(false);
    expect(verhoeffValid('2363')).toBe(true); // canonical Verhoeff example (236 → check digit 3)
  });
  it('validates IBAN (mod-97) and ABA routing', () => {
    expect(ibanValid('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(ibanValid('DE89370400440532013000')).toBe(true);
    expect(ibanValid('GB82 WEST 1234 5698 7654 33')).toBe(false);
    expect(abaRoutingValid('011000015')).toBe(true);
    expect(abaRoutingValid('011000016')).toBe(false);
  });
});

describe('normaliser', () => {
  it('maps normalised offsets back to raw offsets across zero-width characters', () => {
    const raw = 'a​b﻿c１２';
    const n = normalize(raw);
    expect(n.text).toBe('abc12');
    const { rawStart, rawEnd } = toRawSpan(n, 1, 5);
    expect(raw.slice(rawStart, rawEnd)).toBe('b﻿c１２');
  });
  it('groups obfuscated digit runs', () => {
    const runs = findDigitRuns('card 4532 - 0151 - 1283 - 0366 ok');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.groups.map((g) => g.end - g.start)).toEqual([4, 4, 4, 4]);
  });
});

describe('entropy', () => {
  it('computes Shannon entropy', () => {
    expect(shannonEntropy('aaaa')).toBe(0);
    expect(shannonEntropy('abcd')).toBe(2);
  });
  it('uses 3.85 from 16 chars and a length-normalised threshold below', () => {
    expect(entropyThresholdFor(20)).toBe(3.85);
    expect(entropyThresholdFor(12)).toBeLessThan(3.85);
  });
});

describe('Tier 1 detectors — must block', () => {
  it.each([
    ['AWS key id', 'export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE', 'AWS_ACCESS_KEY'],
    ['AWS secret', 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'AWS_SECRET_KEY'],
    ['GitHub PAT', '```\nGITHUB_TOKEN=ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8\n```', 'GITHUB_TOKEN'],
    ['OpenAI key', 'client = OpenAI(api_key="sk-proj-4fJ9xQ2mZr8Lw1Tn6Yb3Kc7Hv5Ps0Da2Ge9Ui1Ro")', 'OPENAI_API_KEY'],
    ['labelled password', 'db config -> password: Tr0ub4dor&3x!', 'PASSWORD'],
    ['Spanish label', 'mi contraseña es Gato#Negro2024', 'PASSWORD'],
    ['German label', 'Passwort: Sommer!2024xY', 'PASSWORD'],
    ['Chinese label', '我的密码是Xq7#mP2v9L', 'PASSWORD'],
    ['env password', 'DB_PASSWORD=Pr0d-Repl1ca!', 'PASSWORD'],
    ['unlabelled secret', 'use this to log in: K9#vQ2!xLm7$Tz4@', 'SECRET'],
    ['SSN', 'Employee SSN 123-45-6789 on file', 'SSN'],
    ['passport', 'Passport No: N1234567', 'PASSPORT'],
    ['spaced TFN', 'my TFN 123 456 782 please', 'TFN'],
    ['bare grouped TFN', 'number 123 456 782', 'TFN'],
    ['dashed card', 'charge 4532-0151-1283-0366 today', 'CREDIT_CARD'],
    ['spaced dashed card', '4532 - 0151 - 1283 - 0366', 'CREDIT_CARD'],
    ['IBAN', 'wire to GB82 WEST 1234 5698 7654 32 by Friday', 'IBAN'],
    ['BSB + account', 'BSB 062-000, account number 12345678', 'BANK_ACCOUNT'],
    ['ABN', 'Invoice from Acme Widgets Pty Ltd, ABN 51 824 753 556', 'ABN'],
    ['PAN', 'PAN: ABCPE1234F', 'PAN'],
    ['Postgres URI', 'DATABASE_URL=postgres://admin:S3cretPass@db.internal:5432/prod', 'DB_CREDENTIAL'],
    ['ADO string', 'Server=sql01;Database=crm;User Id=sa;Password=Winter2024!;', 'DB_CREDENTIAL'],
    // English disclosure phrasings (stakeholder report + probes, see data/datasets/english-probes.json)
    ['stakeholder "psw"', 'my current psw is Ohlalalala34%. can you suggest a better one?', 'PASSWORD'],
    ['"pw is"', 'my pw is sunshine!2024', 'PASSWORD'],
    ['"pass is"', 'the wifi pass is CoffeeShop2024', 'PASSWORD'],
    ['words between label and value', 'The password I use for my bank is Kangaroo#77.', 'PASSWORD'],
    ['"changed my password to"', 'I changed my password to Summer2024! yesterday', 'PASSWORD'],
    ['owned lowercase password', 'my password is ohlalala', 'PASSWORD'],
    ['Wi-Fi key', 'the wifi key is Sunflower2024', 'PASSWORD'],
    ['creds pair', 'here are my creds: jdoe / Summer2024!', 'PASSWORD'],
    ['bank PIN', 'my bank PIN is 4821', 'PIN'],
    ['one-time code', 'my one-time code is 739204', 'ONE_TIME_CODE'],
    ['alarm code', 'my alarm code is 4417', 'ACCESS_CODE'],
    ['"api key is"', 'my api key is 9f8e7d6c5b4a39281706f5e4d3c2b1a0', 'API_KEY'],
    ['"AWS secret key is"', 'The AWS secret key is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'AWS_SECRET_KEY'],
    ['"passport no is"', 'my passport no is N8473629', 'PASSPORT'],
    ['"account number is … BSB is"', 'my account number is 12345678 and the BSB is 062-000', 'BANK_ACCOUNT'],
    ['mysql -p', 'mysql -u root -pS3cr3tPass42 crm_prod', 'DB_CREDENTIAL'],
  ])('%s', (_name, text, type) => {
    expect(types(text)).toContain(type);
  });

  it('detects Verhoeff-valid Aadhaar in 4-4-4 format', () => {
    const payload = '23456789012';
    const a = payload + verhoeffCheckDigit(payload);
    expect(types(`Aadhaar ${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`)).toContain('AADHAAR');
  });

  it('returns raw spans that point at the secret through zero-width obfuscation', () => {
    const text = 'card 4532​0151​1283​0366 thanks';
    expect(spans(text)).toEqual(['4532​0151​1283​0366']);
  });
});

describe('Tier 1 detectors — must allow', () => {
  it.each([
    ['typed password field', 'interface User { email: string; password: string; }'],
    ['empty password', 'const password = "";'],
    ['member access', 'const password = req.body.password;'],
    ['prose', 'The password is required and is stored hashed with bcrypt.'],
    ['Stripe test card', 'Use 4242 4242 4242 4242 with any CVC to test checkout.'],
    ['order number failing Luhn', 'Order #1234 5678 9012 3457 has shipped.'],
    ['invalid TFN', 'my TFN is 123 456 789'],
    ['phone number', 'Call me on 0412 345 678 tomorrow.'],
    ['date + version', 'Released 2024-03-15, version 1.12.4, build 20240315.'],
    ['UUID', 'request id 3f2b8c1e-9d4a-4e6b-8f1a-2c3d4e5f6a7b failed'],
    ['URL', 'see https://example.com/docs?page=2&sort=Desc#Section-4'],
    ['placeholder URI', 'postgres://user:<password>@localhost:5432/app'],
    ['"password is too weak"', 'My password is too weak, how do I make a stronger one?'],
    ['"password is stored in 1Password"', 'My password is stored in 1Password, so I never type it.'],
    ['"bypass" is not "pass"', 'The bypass is 2400 metres long.'],
    ['"passport" is not "pass"', 'My passport is expiring next month.'],
    ['day pass price', 'A day pass is $25 at the front desk.'],
    ['India PIN code (postal)', 'Ship it to PIN code 110001, New Delhi.'],
    ['PIN prose', 'How do I reset my PIN if the card is locked?'],
    ['gate code instruction', 'Enter the gate code at the door.'],
    ['"password to" without a change verb', 'The password to the shared drive is with IT.'],
  ])('%s', (_name, text) => {
    expect(scanTier1(text)).toEqual([]);
  });
});
