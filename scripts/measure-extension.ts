// Loads the built extension in Chromium and records what the offscreen document actually measures:
// memory (method-labelled), Tier 2 route / Path B state and per-tier latency inside the extension.
// Usage: npm run build:ext:test && npx tsx scripts/measure-extension.ts  → bench-results/extension-measurements.json
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const extPath = resolve(root, 'dist-extension-test');
const server = spawn(process.execPath, [resolve(root, 'tests/e2e/serve-fixtures.mjs')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`, '--enable-unsafe-webgpu'],
});
try {
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  const status = () => popup.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'status' })) as Promise<{ engine: Record<string, unknown> | null }>;
  for (let i = 0; i < 120 && !(await status()).engine?.pathAReady; i++) await popup.waitForTimeout(500);

  // Drive realistic prompts through a portal fixture so Tier 2 / 3B run inside the offscreen document.
  const page = await context.newPage();
  await page.goto('http://localhost:4173/claude');
  const prompts = [
    'Discharge summary for patient Harriet Lindqvist: admitted with pneumonia, discharged on amoxicillin 500 mg.',
    'What are the common early symptoms of type 2 diabetes?',
    'Client Theo Marchetti: holdings $4,812,300.00, cash balance $198,699.76, margin loan $310,000.',
    'Please summarise the quarterly planning notes for the platform team and list open risks.',
  ];
  const latencies: { tier2: number; tier3b: number; route: string | null }[] = [];
  for (let round = 0; round < 5; round++) {
    for (const text of prompts) {
      const r = (await popup.evaluate(
        (t) => chrome.runtime.sendMessage({ target: 'background', type: 'scan-async', input: { text: t, attachments: [] } }),
        text,
      )) as { timings: { tier2: number; tier3b: number }; tier2Route: string | null };
      if (round > 0) latencies.push({ tier2: r.timings.tier2, tier3b: r.timings.tier3b, route: r.tier2Route });
    }
  }
  await page.close();
  // measureUserAgentSpecificMemory resolves after a GC; poll a few times for a settled reading.
  let engine: Record<string, unknown> | null = null;
  for (let i = 0; i < 12; i++) {
    engine = (await status()).engine;
    if (engine?.memoryMethod === 'measureUserAgentSpecificMemory') break;
    await popup.waitForTimeout(2500);
  }
  const p = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((q / 100) * xs.length))] ?? null;
  const report = {
    measuredAt: new Date().toISOString(),
    chromium: context.browser()?.version() ?? 'persistent context',
    engine,
    tier2: { p50: p(latencies.map((l) => l.tier2), 50), p95: p(latencies.map((l) => l.tier2), 95) },
    tier3b: { p50: p(latencies.map((l) => l.tier3b), 50), p95: p(latencies.map((l) => l.tier3b), 95) },
    routes: [...new Set(latencies.map((l) => l.route))],
    samples: latencies.length,
  };
  mkdirSync(resolve(root, 'bench-results'), { recursive: true });
  writeFileSync(resolve(root, 'bench-results/extension-measurements.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  server.kill();
}
