// Captures the screenshots for the live-test guide (docs/live-test/*.png) by driving the real
// extension in Chromium:
//   - live chatgpt.com and gemini.google.com (signed out — no accounts used) with the production build,
//   - the local Claude replica (tests/e2e/fixtures, http://localhost:4173/claude) with the test build,
//     because claude.ai requires a sign-in,
//   - the popup and the options page (protected data + live test kit).
// Safety net: any request whose body carries the text of a prompt that is expected to be blocked is
// aborted locally, so a regression can never send test data to a portal. Only prompts the kit marks
// "expect: sent" (benign questions) actually reach the live AIs.
// Usage: npm run build && npm run build:ext:test && npx tsx scripts/capture-live-guide.ts
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { KitPrompt, TestKit } from '../src/engine/bench/test-kit';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'docs/live-test');
mkdirSync(out, { recursive: true });
const kit = JSON.parse(readFileSync(resolve(root, 'assets/engine/test-kit.json'), 'utf8')) as TestKit;
const prompt = (cat: number, title: string): KitPrompt => {
  const p = kit.categories.find((c) => c.id === cat)!.prompts.find((x) => x.title === title);
  if (!p) throw new Error(`kit prompt not found: ${cat} · ${title}`);
  return p;
};
// Leak marker for the large-paste trials: the flagged memo text, not the benign handbook filler around it.
const memoMarker = readFileSync(resolve(root, 'data/vault/project-chronos-memo.md'), 'utf8').split('\n\n')[3]!.slice(0, 48);
const results: { shot: string; portal: string; title: string; expect: string; observed: string; note?: string; engine?: string }[] = [];
let statusPage: Page | null = null;
/** Engine state before each trial, so a failed async verdict can be told apart from a detection miss. */
const engineState = async () => {
  if (!statusPage) return 'n/a';
  const s = (await statusPage.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'status' })).catch((e) => ({ err: String(e) }))) as { engine?: { pathBState: string; route: string } | null; err?: string };
  return s?.engine ? `${s.engine.pathBState}/${s.engine.route}` : `engine unavailable ${s?.err ?? ''}`;
};
const leaks: string[] = [];
let marker: string | null = null;

// Outlines the composer the prompt was typed into (the drawer is self-evident).
const HIGHLIGHT = `
  [data-aionix-highlight] { outline: 3px solid #9553fb !important; outline-offset: 3px; border-radius: 12px; }
`;

async function launch(ext: string): Promise<{ ctx: BrowserContext; extId: string }> {
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: false,
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await ctx.route('**/*', (route) => {
    const req = route.request();
    if (req.method() === 'POST' && marker) {
      let body = req.postData() ?? '';
      try {
        body = decodeURIComponent(body.replace(/\+/g, ' '));
      } catch {
        /* keep raw */
      }
      if (body.includes(marker)) {
        leaks.push(`${new URL(req.url()).pathname} carried "${marker.slice(0, 40)}"`);
        return route.abort();
      }
    }
    return route.continue();
  });
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/popup.html`);
  for (let i = 0; i < 120; i++) {
    const s = (await p.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'status' }))) as { engine?: { pathAReady?: boolean; pathBState?: string } };
    if (s?.engine?.pathAReady && s.engine.pathBState !== 'loading' && s.engine.pathBState !== 'idle') break;
    await p.waitForTimeout(500);
  }
  await p.close();
  return { ctx, extId };
}

async function shoot(page: Page, name: string) {
  await page.addStyleTag({ content: HIGHLIGHT }).catch(() => undefined);
  await page.screenshot({ path: resolve(out, `${name}.png`) });
}

// The production drawer is a closed shadow root (its panel is not measurable from the page), so a
// trial counts as blocked when the drawer host is attached and the prompt is still in the composer;
// a real send clears the composer.
const outcome = async (page: Page, portal: string, text: string): Promise<'block' | 'sent'> => {
  const host = await page.evaluate(() => !!document.querySelector('aionix-sentinel-drawer')?.isConnected);
  const sel = portal === 'chatgpt' ? 'textarea[name="prompt"], #prompt-textarea' : portal === 'gemini' ? 'rich-textarea .ql-editor' : '[contenteditable="true"]';
  const current = await page
    .locator(sel)
    .first()
    .evaluate((n) => ('value' in n ? (n as HTMLTextAreaElement).value : (n as HTMLElement).innerText))
    .catch(() => '');
  const kept = current.replace(/\s+/g, ' ').trim().startsWith(text.replace(/\s+/g, ' ').trim().slice(0, 30));
  return host && kept ? 'block' : 'sent';
};

async function composerOf(page: Page, portal: string) {
  const sel = portal === 'chatgpt' ? 'textarea[name="prompt"], #prompt-textarea' : portal === 'gemini' ? 'rich-textarea .ql-editor' : '[contenteditable="true"]';
  const el = page.locator(sel).first();
  await el.waitFor({ timeout: 30_000 });
  await el.evaluate((n) => n.closest('form, fieldset, .composer, rich-textarea')?.setAttribute('data-aionix-highlight', ''));
  return el;
}

async function closeDrawer(page: Page) {
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.evaluate(() => document.querySelector('aionix-sentinel-drawer')?.remove());
}

/** Types a kit prompt into a portal composer, presses Enter and records what happened. */
async function trial(page: Page, portal: string, shot: string, p: KitPrompt, opts: { send?: boolean } = {}) {
  const engine = await engineState();
  const box = await composerOf(page, portal);
  marker = p.expect === 'block' ? p.text.slice(0, 48) : null;
  await box.click();
  await box.fill(p.text);
  await page.waitForTimeout(300);
  if (p.expect === 'block' || opts.send) await box.press('Enter');
  await page.waitForTimeout(p.expect === 'block' ? 2200 : 7000);
  const observed = await outcome(page, portal, p.text);
  await shoot(page, shot);
  results.push({ shot, portal, title: p.title, expect: p.expect === 'allow' ? 'sent' : 'block', observed, note: p.note, engine });
  marker = null;
}

const server = spawn(process.execPath, [resolve(root, 'tests/e2e/serve-fixtures.mjs')], { stdio: 'ignore' });
try {
  // ── Live portals with the production build ────────────────────────────────
  const prod = await launch(resolve(root, 'dist-extension'));
  const { ctx, extId } = prod;

  // Popup + options (protected data + test kit)
  const popup = await ctx.newPage();
  statusPage = popup;
  await popup.setViewportSize({ width: 380, height: 640 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForTimeout(2500);
  await popup.screenshot({ path: resolve(out, '01-popup.png') });

  const opts = await ctx.newPage();
  await opts.goto(`chrome-extension://${extId}/options.html#data`);
  await opts.waitForTimeout(1500);
  await opts.screenshot({ path: resolve(out, '02-options-protected-data-empty.png') });
  await opts.locator('[data-sample="halcyon-patients"]').click();
  await opts.waitForTimeout(400);
  await opts.screenshot({ path: resolve(out, '03-options-sample-loaded.png') });
  await opts.locator('[data-action="protect"]').click();
  await opts.getByRole('status').waitFor();
  for (const s of ['halcyon-customers', 'settlement-netting-engine', 'halcyon-pricing-memo']) {
    await opts.locator(`[data-sample="${s}"]`).click();
    await opts.locator('[data-action="protect"]').click();
    await opts.waitForTimeout(1200);
  }
  await opts.waitForTimeout(800);
  await opts.screenshot({ path: resolve(out, '04-options-protected.png'), fullPage: true });
  await opts.goto(`chrome-extension://${extId}/options.html#kit`);
  await opts.waitForTimeout(800);
  await opts.getByRole('radio', { name: '2', exact: true }).click();
  await opts.screenshot({ path: resolve(out, '05-options-test-kit.png') });
  await opts.getByRole('radio', { name: '24 edge cases' }).click();
  await opts.screenshot({ path: resolve(out, '06-options-edge-cases.png') });

  // Live ChatGPT (signed out)
  const gpt = await ctx.newPage();
  await gpt.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await gpt.waitForTimeout(6000);
  const gptTrials: [string, KitPrompt][] = [
    ['10-chatgpt-cat2-stakeholder-psw', prompt(2, 'Stakeholder report ("psw")')],
    ['12-chatgpt-cat1-openai-key', prompt(1, 'OpenAI key in code')],
    ['13-chatgpt-cat3-ssn', prompt(3, 'SSN with dashes')],
    ['14-chatgpt-cat4-tfn', prompt(4, 'Valid TFN')],
    ['15-chatgpt-cat5-card', prompt(5, 'Card with expiry and CVV')],
    ['16-chatgpt-cat6-abn', prompt(6, 'ABN with entity')],
    ['17-chatgpt-cat7-postgres', prompt(7, 'Postgres URI')],
    ['18-chatgpt-cat8-named-client', prompt(8, 'Named client with balances (context)')],
    ['19-chatgpt-cat8-protected-customer', prompt(8, 'Customer from your protected CSV')],
    ['20-chatgpt-cat9-patient', prompt(9, 'Patient with MRN and diagnosis (context)')],
    ['21-chatgpt-cat9-protected-patient', prompt(9, 'Patient from your protected CSV')],
    ['22-chatgpt-cat10-vault-code', prompt(10, '15 lines of the bundled proprietary router')],
    ['23-chatgpt-cat10-protected-code', prompt(10, 'Excerpt of your protected code')],
    // Formats the stakeholder brief lists: unlabelled password, JSON, CSV.
    ['26-chatgpt-cat2-unlabelled-password', prompt(2, 'Unlabelled password (strength question)')],
    ['27-chatgpt-cat8-customer-json', prompt(8, 'Customer record as JSON (context)')],
    ['28-chatgpt-cat3-ssn-csv', prompt(3, 'SSNs in a CSV')],
  ];
  for (const [shot, p] of gptTrials) {
    await trial(gpt, 'chatgpt', shot, p);
    // The production drawer is a closed shadow root; its actions are shown on the replica below.
    await closeDrawer(gpt);
    const box = await composerOf(gpt, 'chatgpt');
    await box.fill('');
  }
  // Large paste (real clipboard paste, ~22,000 characters). ChatGPT turns a paste this long into
  // pasted.txt, a file it uploads when attached, so Aionix checks it at paste time: a flagged paste is
  // kept out of the composer entirely (nothing to upload, nothing to send).
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://chatgpt.com' });
  {
    const memoPaste = prompt(10, 'Large paste → pasted-content chip');
    const engine = await engineState();
    const box = await composerOf(gpt, 'chatgpt');
    marker = memoMarker;
    await gpt.evaluate((t) => navigator.clipboard.writeText(t), memoPaste.paste!);
    await box.click();
    await gpt.keyboard.press('Control+V');
    await gpt.waitForTimeout(2200);
    const drawerUp = await gpt.evaluate(() => !!document.querySelector('aionix-sentinel-drawer')?.isConnected);
    const inComposer = await box.evaluate((n) => ('value' in n ? (n as HTMLTextAreaElement).value : (n as HTMLElement).innerText).length);
    await shoot(gpt, '29-chatgpt-large-paste');
    results.push({ shot: '29-chatgpt-large-paste', portal: 'chatgpt', title: `Large paste (${memoPaste.paste!.length.toLocaleString()} chars) checked at paste time`, expect: 'block', observed: drawerUp && inComposer < 100 ? 'block' : 'sent', note: memoPaste.note, engine });
    marker = null;
    await closeDrawer(gpt);
    await box.fill('');
  }
  // Allowed: a benign question goes through to the live AI.
  await trial(gpt, 'chatgpt', '24-chatgpt-allowed-question', prompt(9, 'Symptom question'), { send: true });

  // Backstop: a request that bypasses the composer is refused inside the page.
  const backstop = await gpt.evaluate(async () => {
    try {
      await fetch('/unauth-mweb/conversation/updates', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ prompt: 'deploy key: aws_access_key_id = AKIAQ3EGTRBX4M7PZK2N' }).toString() });
      return 'request went through';
    } catch (e) {
      return `rejected: ${(e as Error).message}`;
    }
  });
  await gpt.waitForTimeout(1500);
  await shoot(gpt, '25-chatgpt-backstop');
  results.push({ shot: '25-chatgpt-backstop', portal: 'chatgpt', title: 'Direct fetch bypassing the composer', expect: 'block', observed: backstop.startsWith('rejected') ? 'block' : 'sent', note: backstop });

  // Live Gemini (signed out)
  const gem = await ctx.newPage();
  await gem.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await gem.waitForTimeout(7000);
  for (const [shot, p] of [
    ['30-gemini-cat2-bank-pin', prompt(2, 'Bank PIN')],
    ['31-gemini-cat5-iban', prompt(5, 'IBAN')],
    ['32-gemini-cat9-named-person', prompt(9, 'Named person, condition and drug (context)')],
    ['33-gemini-cat10-protected-memo', prompt(10, 'Paragraph of your protected document')],
    ['34-gemini-cat9-patients-csv', prompt(9, 'Patients as CSV (context)')],
  ] as [string, KitPrompt][]) {
    await trial(gem, 'gemini', shot, p);
    await closeDrawer(gem);
    await (await composerOf(gem, 'gemini')).fill('');
  }
  // Benign look-alike: code that mentions a password without a value goes through to Gemini.
  await trial(gem, 'gemini', '35-gemini-allowed-code-password-field', prompt(2, 'Code reading a password from the environment'), { send: true });

  // Popup after the session: counters and recent blocks.
  await popup.reload();
  await popup.waitForTimeout(2500);
  await popup.screenshot({ path: resolve(out, '40-popup-after-tests.png') });
  const audit = await popup.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'export-audit' }));
  writeFileSync(resolve(out, 'audit-sample.json'), JSON.stringify({ ...(audit as object), records: (audit as { records: unknown[] }).records.slice(-3) }, null, 2) + '\n');
  await ctx.close();

  // ── Claude replica with the test build (claude.ai needs a sign-in) ────────
  const test = await launch(resolve(root, 'dist-extension-test'));
  const cl = await test.ctx.newPage();
  await cl.goto('http://localhost:4173/claude');
  await cl.waitForTimeout(1000);
  // Drawer actions on a prompt with two findings.
  const editor = await composerOf(cl, 'claude');
  marker = 'my current psw';
  await editor.fill('my current psw is Ohlalalala34%. Also my bank PIN is 4821 — can you suggest a better password?');
  await editor.press('Enter');
  await cl.waitForTimeout(1500);
  await shoot(cl, '50-claude-replica-two-findings');
  await cl.locator('aionix-sentinel-drawer').getByRole('button', { name: 'Redact' }).first().click();
  await cl.waitForTimeout(1500);
  await shoot(cl, '51-claude-replica-redact-one');
  await cl.locator('aionix-sentinel-drawer').getByRole('button', { name: /Auto-redact/ }).click();
  await cl.waitForTimeout(1500);
  await shoot(cl, '52-claude-replica-auto-redacted');
  marker = null;
  await editor.press('Enter');
  await cl.waitForTimeout(1500);
  await shoot(cl, '53-claude-replica-sent-redacted');
  // Large paste → pasted-content chip → block → remove chip → block lifted.
  const memoChip = prompt(10, 'Large paste → pasted-content chip');
  marker = memoMarker;
  await editor.focus();
  await cl.evaluate((text) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    document.querySelector('[contenteditable="true"]')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, memoChip.paste!);
  await editor.fill(memoChip.text);
  await cl.waitForTimeout(500);
  await shoot(cl, '54-claude-replica-chip-flagged');
  await editor.press('Enter');
  await cl.waitForTimeout(1800);
  await shoot(cl, '55-claude-replica-chip-blocked');
  await cl.locator('aionix-sentinel-drawer').getByRole('button', { name: 'Remove file' }).click();
  await cl.waitForTimeout(1500);
  await shoot(cl, '56-claude-replica-chip-removed');
  marker = null;
  // A request that skipped the composer check (here a direct API call with a patient record and no
  // Tier 1 hit) gets the full cascade at the network layer.
  await closeDrawer(cl);
  marker = 'Discharge summary for patient Harriet';
  await cl.locator('#direct-api-record').click();
  await cl.waitForTimeout(1500);
  await shoot(cl, '58-claude-replica-backstop-record');
  results.push({ shot: '58-claude-replica-backstop-record', portal: 'claude-replica', title: 'Patient record sent past the composer (network check, full cascade)', expect: 'block', observed: (await cl.locator('#log').innerText()).includes('RECORD-BLOCKED') ? 'block' : 'sent' });
  marker = null;
  await closeDrawer(cl);
  // Typed before the page finished loading: ChatGPT's pre-hydration input sits next to the real editor.
  {
    const early = await test.ctx.newPage();
    await early.goto('http://localhost:4173/chatgpt-early');
    const box = early.locator('#pending-home-input');
    const text = 'So i want to get the best protection for my application login. Curerntly i am using HeyJude781@ as my password.';
    marker = text.slice(0, 48);
    await box.fill(text);
    await box.press('Enter');
    await early.waitForTimeout(1200);
    await early.addStyleTag({ content: '#early textarea { outline: 3px solid #9553fb; outline-offset: 3px; }' });
    await shoot(early, '59-chatgpt-replica-early-input');
    results.push({ shot: '59-chatgpt-replica-early-input', portal: 'chatgpt-replica', title: 'Enter in the pre-hydration input (first message after load)', expect: 'block', observed: (await early.locator('#log .sent').count()) === 0 && (await early.evaluate(() => !!document.querySelector('aionix-sentinel-drawer'))) ? 'block' : 'sent' });
    marker = null;
    await early.close();
  }
  // Held: the offscreen engine is made unreachable (as seen once in a live run) — the prompt is held.
  const [testSw] = test.ctx.serviceWorkers();
  await testSw!.evaluate(async () => {
    const g = globalThis as unknown as { __create?: typeof chrome.offscreen.createDocument };
    g.__create = chrome.offscreen.createDocument;
    chrome.offscreen.createDocument = () => new Promise<void>(() => undefined);
    await chrome.offscreen.closeDocument();
  });
  await closeDrawer(cl);
  const held = prompt(8, 'Named client with balances (context)');
  marker = held.text.slice(0, 48);
  await editor.fill(held.text);
  await editor.press('Enter');
  await cl.waitForTimeout(1800);
  await shoot(cl, '57-claude-replica-held');
  results.push({ shot: '57-claude-replica-held', portal: 'claude-replica', title: 'Offscreen check unavailable', expect: 'held', observed: (await outcome(cl, 'claude', held.text)) === 'block' ? 'held' : 'sent' });
  marker = null;
  await testSw!.evaluate(() => {
    chrome.offscreen.createDocument = (globalThis as unknown as { __create: typeof chrome.offscreen.createDocument }).__create;
  });
  await test.ctx.close();
} finally {
  server.kill();
  writeFileSync(resolve(out, 'capture-results.json'), JSON.stringify({ capturedAt: new Date().toISOString(), leaks, results }, null, 2) + '\n');
  console.log(JSON.stringify({ leaks, mismatches: results.filter((r) => r.expect !== r.observed) }, null, 2));
}
