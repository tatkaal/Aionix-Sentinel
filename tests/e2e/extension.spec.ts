// End-to-end: loads the test build of the MV3 extension into Chromium and drives the three portal
// fixtures. Exercises the content script, MAIN-world backstop, background SW, offscreen engine
// (Tier 2 Path A + Tier 3 Path B on ONNX Runtime wasm) and the Shadow DOM drawer together.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const extPath = resolve(import.meta.dirname, '../../dist-extension-test');
let context: BrowserContext;
let extId = '';

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  });
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  extId = new URL(sw.url()).host;
  // Wait for the offscreen engine (FST + MiniLM + EDM) so Tier 2 answers inside its SLA.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await expect
    .poll(
      () =>
        popup.evaluate(async () => {
          const s = (await chrome.runtime.sendMessage({ target: 'background', type: 'status' })) as { engine?: { pathAReady?: boolean } };
          return s?.engine?.pathAReady ?? false;
        }),
      { timeout: 60_000, intervals: [500] },
    )
    .toBe(true);
  await popup.close();
});

test.afterAll(async () => {
  await context?.close();
});

async function open(portal: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`http://localhost:4173/${portal}`);
  return page;
}

const drawer = (page: Page) => page.locator('aionix-sentinel-drawer');
const sent = (page: Page) => page.locator('#log .sent');

for (const portal of ['claude', 'chatgpt', 'gemini']) {
  test(`${portal}: blocks a secret on Enter and lets a clean prompt through`, async () => {
    const page = await open(portal);
    const editor = page.locator('[contenteditable="true"]');
    await editor.fill('debug this: aws_access_key_id = AKIAQ3EGTRBX4M7PZK2N');
    await editor.press('Enter');
    await expect(drawer(page).getByText('Send blocked')).toBeVisible();
    await expect(sent(page)).toHaveCount(0);

    await drawer(page).getByRole('button', { name: /Auto-redact/ }).click();
    await expect(editor).toContainText('[REDACTED_AWS_ACCESS_KEY]');
    await editor.press('Enter');
    await expect(sent(page)).toHaveCount(1);
    await expect(sent(page).first()).toContainText('SENT:debug this: aws_access_key_id = [REDACTED_AWS_ACCESS_KEY]');
    await page.close();
  });
}

// Live 2026-11-02: each portal serves a plain textarea that takes typing and an early Enter before its
// app hydrates, and for a moment it sits next to the real editor. The first message typed there once
// reached the network backstop instead of the composer check.
const EARLY_INPUT: Record<string, string> = {
  chatgpt: '#pending-home-input',
  claude: '#static-composer-input',
  gemini: '.initial-input-area textarea',
};
for (const portal of ['chatgpt', 'claude', 'gemini']) {
  test(`${portal}: an Enter in the pre-hydration input is checked like the composer, and redaction sends`, async () => {
    const page = await open(`${portal}-early`);
    const early = page.locator(EARLY_INPUT[portal]!);
    await early.fill('So i want to get the best protection for my application login. Curerntly i am using HeyJude781@ as my password.');
    await early.press('Enter');
    await expect(drawer(page).getByText('Send blocked')).toBeVisible();
    await expect(drawer(page).getByText('in composer').first()).toBeVisible();
    await expect(sent(page)).toHaveCount(0);

    await drawer(page).getByRole('button', { name: /Auto-redact/ }).click();
    await expect(early).toHaveValue(/\[REDACTED_[A-Z_]+\]/);
    await early.press('Enter');
    await expect(sent(page)).toHaveCount(1);
    await expect(sent(page).first()).not.toContainText('HeyJude781@');
    await page.close();
  });
}

test('chatgpt: a clean prompt typed before hydration is sent once the app loads', async () => {
  const page = await open('chatgpt-early?hydrate=1500');
  const early = page.locator('#pending-home-input');
  await early.fill('Summarise the main causes of the 2008 financial crisis in five bullet points.');
  await early.press('Enter');
  await expect(sent(page)).toHaveCount(1, { timeout: 5000 });
  await expect(sent(page).first()).toContainText('SENT:Summarise the main causes');
  await expect(drawer(page)).toHaveCount(0);
  await page.close();
});

test('backstop runs the full cascade: a record that skipped the composer is stopped, a clean prompt goes out', async () => {
  const page = await open('claude');
  await page.locator('#direct-api-record').click();
  await expect(page.locator('#log')).toContainText('RECORD-BLOCKED');
  await expect(drawer(page).getByText('Medical records').first()).toBeVisible();
  await expect(drawer(page).getByText(/in outgoing request/).first()).toBeVisible();
  await drawer(page).getByRole('button', { name: 'Dismiss' }).click();

  await page.locator('#direct-api-clean').click();
  await expect(page.locator('#log')).toContainText('CLEAN-SENT');
  await page.close();
});

test('claude: Tier 2 (offscreen) blocks a named patient record, allows a general question', async () => {
  const page = await open('claude');
  const editor = page.locator('[contenteditable="true"]');
  await editor.fill('Discharge summary for patient Harriet Lindqvist: admitted with pneumonia, discharged on amoxicillin 500 mg.');
  await editor.press('Enter');
  await expect(drawer(page).getByText('Medical records').first()).toBeVisible();
  await expect(drawer(page).getByText(/Tier 2 · Path A Lexicon/).first()).toBeVisible();
  await expect(sent(page)).toHaveCount(0);

  await drawer(page).getByRole('button', { name: 'Close' }).click();
  await editor.fill('What are the common early symptoms of type 2 diabetes?');
  await editor.press('Enter');
  await expect(sent(page)).toHaveCount(1);
  await page.close();
});

test('chatgpt: a flagged pasted-content chip blocks, and removing the chip lifts the block', async () => {
  const page = await open('chatgpt');
  const filler = 'The migration runbook covers pooling, retries, logging and rollback steps. '.repeat(20);
  const big = `${filler}\nstaging DATABASE_URL=postgres://deploy:Qx7!vR2#pLm9@staging-db.internal:5432/app\n${filler}`;
  await page.locator('[contenteditable="true"]').focus();
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    document.querySelector('[contenteditable="true"]')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, big);
  await expect(page.locator('[data-testid="file-thumbnail"]')).toHaveCount(1);
  await page.locator('[contenteditable="true"]').fill('summarise the attachment');
  await page.locator('[contenteditable="true"]').press('Enter');
  await expect(drawer(page).getByText('Database credentials')).toBeVisible();

  await drawer(page).getByRole('button', { name: 'Remove file' }).click();
  await expect(drawer(page).getByText('Block lifted')).toBeVisible();
  await expect(page.locator('[data-testid="file-thumbnail"]')).toHaveCount(0);
  await page.close();
});

const pasteInto = (page: Page, text: string) =>
  page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    document.querySelector('[contenteditable="true"]')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);

test('chatgpt: a long paste is checked before ChatGPT can turn it into an uploaded file', async () => {
  const page = await open('chatgpt');
  const filler = 'The engineering handbook covers planning, reviews, testing and release steps. '.repeat(60);
  await page.locator('[contenteditable="true"]').focus();
  await pasteInto(page, `${filler}\nstaging DATABASE_URL=postgres://deploy:Qx7!vR2#pLm9@staging-db.internal:5432/app\n${filler}`);
  await expect(drawer(page).getByText('The paste was not added')).toBeVisible();
  await expect(drawer(page).getByText('in pasted text').first()).toBeVisible();
  await expect(page.locator('[data-testid="file-thumbnail"]')).toHaveCount(0);
  await expect(page.locator('[contenteditable="true"]')).toHaveText('');
  await drawer(page).getByRole('button', { name: 'Dismiss' }).click();

  // A clean paste of the same size reaches the portal unchanged and still becomes its chip.
  await pasteInto(page, filler);
  await expect(page.locator('[data-testid="file-thumbnail"]')).toHaveCount(1);
  await expect(drawer(page)).toHaveCount(0);
  await page.close();
});

test('claude: a long paste stays a chip until Send, and removing the chip lifts the block', async () => {
  const page = await open('claude');
  const filler = 'The engineering handbook covers planning, reviews, testing and release steps. '.repeat(60);
  await page.locator('[contenteditable="true"]').focus();
  await pasteInto(page, `${filler}\nstaging DATABASE_URL=postgres://deploy:Qx7!vR2#pLm9@staging-db.internal:5432/app\n${filler}`);
  await expect(page.locator('[data-testid="file-thumbnail"]')).toHaveCount(1);
  await page.locator('[contenteditable="true"]').fill('summarise the attachment');
  await page.locator('[contenteditable="true"]').press('Enter');
  await expect(drawer(page).getByText('Database credentials')).toBeVisible();
  await drawer(page).getByRole('button', { name: 'Remove file' }).click();
  await expect(drawer(page).getByText('Block lifted')).toBeVisible();
  await expect(sent(page)).toHaveCount(0);

  // The "Block lifted" notice hides itself after 2.6 s; that timer must not close a drawer shown since.
  await page.locator('#direct-api-record').click();
  await expect(drawer(page).getByText('Medical records').first()).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(drawer(page).getByText('Medical records').first()).toBeVisible();
  await page.close();
});

test('gemini: the MAIN-world backstop stops a request that bypassed the composer', async () => {
  const page = await open('gemini');
  await page.locator('#direct-api').click();
  await expect(page.locator('#log')).toContainText('DIRECT-BLOCKED');
  await expect(drawer(page).getByText('Send blocked')).toBeVisible();
  await page.close();
});

test('telemetry is zero-knowledge: records hold categories and fingerprints, never text', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/popup.html`);
  const audit = await page.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'export-audit' }));
  const json = JSON.stringify(audit);
  if (!(audit as { records?: unknown[] }).records?.length) {
    const [sw] = context.serviceWorkers();
    console.log('audit:', json.slice(0, 300), 'storage:', await sw?.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)).slice(0, 300)));
  }
  expect((audit as { records: unknown[] }).records.length).toBeGreaterThan(0);
  expect(json).not.toContain('AKIAQ3EGTRBX4M7PZK2N');
  expect(json).not.toContain('Lindqvist');
  expect(json).toMatch(/"fingerprint":"[0-9a-f]{12}"/);
  await page.close();
});

test('chatgpt signed out (textarea + form-encoded body): blocks the stakeholder password, redacts, and the backstop reads the form', async () => {
  const page = await open('chatgpt-anon');
  const box = page.locator('textarea[name="prompt"]');
  await box.fill('my current psw is Ohlalalala34%. can you suggest a better one?');
  await box.press('Enter');
  await expect(drawer(page).getByText('Passwords & secrets').first()).toBeVisible();
  await expect(sent(page)).toHaveCount(0);

  await drawer(page).getByRole('button', { name: /Auto-redact/ }).click();
  await expect(box).toHaveValue(/\[REDACTED_PASSWORD\]/);
  await box.press('Enter');
  await expect(sent(page)).toHaveCount(1);
  await expect(sent(page).first()).not.toContainText('Ohlalalala34');

  await page.locator('#direct-api').click();
  await expect(page.locator('#log')).toContainText('DIRECT-BLOCKED');
  await page.close();
});

test('options page: protected data blocks copies, exact records and lifts when removed', async () => {
  const opts = await context.newPage();
  await opts.goto(`chrome-extension://${extId}/options.html`);
  for (const sample of ['settlement-netting-engine', 'halcyon-patients']) {
    await opts.locator(`[data-sample="${sample}"]`).click();
    await opts.locator('[data-action="protect"]').click();
    await expect(opts.getByRole('status')).toContainText('The text itself was not stored');
  }
  await expect(opts.getByTestId('protected-list').locator('li')).toHaveCount(2);
  const stored = await opts.evaluate(() => chrome.storage.local.get(null));
  expect(JSON.stringify(stored)).not.toMatch(/HALCYON_NETTING_CUTOFF|Ignatius Holloway|81547302/);

  const page = await open('claude');
  const editor = page.locator('[contenteditable="true"]');
  const code = ['/** Splits a payment run so no single RTGS instruction exceeds the counterparty\'s halcyon limit. */',
    'export function splitForRtgs(cp: string, amount: Decimal, halcyonLimit: Decimal): Decimal[] {',
    '  const parts: Decimal[] = [];', '  let remaining = amount.abs();', '  while (remaining.greaterThan(halcyonLimit)) {',
    '    parts.push(halcyonLimit);', '    remaining = remaining.minus(halcyonLimit);', '  }'].join('\n');
  await editor.fill(`Refactor this for readability:\n\n${code}`);
  await editor.press('Enter');
  await expect(drawer(page).getByText(/Matches vault asset/).first()).toBeVisible();
  await drawer(page).getByRole('button', { name: 'Close' }).click();

  await editor.fill('Please reschedule Ignatius Holloway (MRN 81547302) to Thursday.');
  await editor.press('Enter');
  await expect(drawer(page).getByText('Medical records').first()).toBeVisible();
  await drawer(page).getByRole('button', { name: 'Close' }).click();

  await opts.getByRole('button', { name: 'Remove all' }).click();
  await expect(opts.getByText('Nothing protected yet')).toBeVisible();
  await page.waitForTimeout(500);
  await editor.fill(`Refactor this for readability:\n\n${code}`);
  await editor.press('Enter');
  await expect(sent(page)).toHaveCount(1);
  await page.close();
  await opts.close();
});

test('offscreen check unavailable: a clean-on-Tier-1 prompt is held for the user, not sent silently', async () => {
  const [sw] = context.serviceWorkers();
  const page = await open('claude');
  const editor = page.locator('[contenteditable="true"]');
  await editor.fill('Client Daniel Whitford — account balance $1,284,500.00, margin loan outstanding $310,000.');
  // Make the offscreen engine unreachable: close it and let re-creation hang (restored below).
  await sw!.evaluate(async () => {
    const g = globalThis as unknown as { __create?: typeof chrome.offscreen.createDocument };
    g.__create = chrome.offscreen.createDocument;
    chrome.offscreen.createDocument = () => new Promise<void>(() => undefined);
    await chrome.offscreen.closeDocument();
  });
  await editor.press('Enter');
  await expect(drawer(page).getByText('Check incomplete')).toBeVisible();
  await expect(sent(page)).toHaveCount(0);
  await drawer(page).getByRole('button', { name: 'Send anyway' }).click();
  await expect(sent(page)).toHaveCount(1);
  await page.close();
  await sw!.evaluate(() => {
    const g = globalThis as unknown as { __create?: typeof chrome.offscreen.createDocument };
    chrome.offscreen.createDocument = g.__create!;
  });
  // Let the engine finish starting so later tests see it ready.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await expect
    .poll(() => popup.evaluate(async () => ((await chrome.runtime.sendMessage({ target: 'background', type: 'status' })) as { engine?: { pathAReady?: boolean } })?.engine?.pathAReady ?? false), { timeout: 60_000, intervals: [500] })
    .toBe(true);
  await popup.close();
});

test('the engine loads once: an idle-stopped service worker leaves the offscreen engine running', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  const startedAt = () =>
    popup.evaluate(async () => ((await chrome.runtime.sendMessage({ target: 'background', type: 'status', quick: true })) as { engine?: { startedAt?: number } })?.engine?.startedAt ?? null);
  const before = await startedAt();
  expect(before).toBeGreaterThan(0);
  await expect(popup.getByTestId('engine-uptime')).toContainText('Engine loaded once at');

  // Stop the worker the way Chrome does after ~30 s idle, then wake it with the next message.
  const cdp = await context.newCDPSession(popup);
  const versions: string[] = [];
  cdp.on('ServiceWorker.workerVersionUpdated', (e: { versions: { versionId: string; runningStatus: string }[] }) => {
    for (const v of e.versions) if (v.runningStatus === 'running' && !versions.includes(v.versionId)) versions.push(v.versionId);
  });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => versions.length, { timeout: 5000 }).toBeGreaterThan(0);
  for (const versionId of versions) await cdp.send('ServiceWorker.stopWorker', { versionId });
  await popup.waitForTimeout(500);

  expect(await startedAt()).toBe(before);
  await cdp.detach();
  await popup.close();
});
