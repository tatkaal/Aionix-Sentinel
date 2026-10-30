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
