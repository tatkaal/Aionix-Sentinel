// Loads the built extension in Chromium and records what the offscreen document actually measures:
// memory (method-labelled), Tier 2 route / Path B state and per-tier latency inside the extension.
// Usage: npm run build:ext:test && npm run measure:ext [-- --path-a-only]
//   --path-a-only  GPU disabled → the hardware probe rejects Path B → pure Path A steady state
//   (default)      waits until Path B is ready / evicted / failed, then measures
// Output: bench-results/extension-measurements-path-{a,b}.json
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const DEBUG_PORT = 9335;
const pathAOnly = process.argv.includes('--path-a-only');
const extPath = resolve(root, 'dist-extension-test');
const server = spawn(process.execPath, [resolve(root, 'tests/e2e/serve-fixtures.mjs')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`, `--remote-debugging-port=${DEBUG_PORT}`, ...(pathAOnly ? ['--disable-gpu'] : [])],
});
try {
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  const status = () => popup.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'status' })) as Promise<{ engine: Record<string, unknown> | null }>;
  for (let i = 0; i < 120 && !(await status()).engine?.pathAReady; i++) await popup.waitForTimeout(500);
  let pathBOutcome: Record<string, unknown> | null = null;
  if (!pathAOnly) {
    // A fresh profile downloads ~0.8 GB of Path B weights; wait for a terminal state (≤ 15 min).
    for (let i = 0; i < 900; i++) {
      const e = (await status()).engine;
      if (['ready', 'evicted', 'failed', 'unavailable'].includes(String(e?.pathBState))) {
        pathBOutcome = { state: e!.pathBState, reason: e!.pathBReason, loadMs: (e!.loadMs as { pathB: number | null }).pathB, memoryMB: e!.memoryMB, memoryMethod: e!.memoryMethod };
        break;
      }
      await popup.waitForTimeout(1000);
    }
    // An eviction recycles the offscreen document; measure the replacement once it is up.
    if (pathBOutcome?.state === 'evicted') {
      for (let i = 0; i < 120 && !/remembered/.test(String((await status()).engine?.pathBReason)); i++) await popup.waitForTimeout(500);
    }
  }

  // Distinct prompts every round so the embedding cache cannot flatter the latency numbers.
  const names = ['Harriet Lindqvist', 'Theo Marchetti', 'Imogen Okonjo', 'Rafael Ferreira', 'Saoirse Kilbride'];
  const conditions = ['pneumonia', 'atrial fibrillation', 'type 2 diabetes mellitus', 'major depressive disorder', 'rheumatoid arthritis'];
  const topics = ['the quarterly planning notes', 'the onboarding checklist', 'the vendor shortlist', 'the incident retrospective', 'the hiring plan'];
  const promptsFor = (r: number) => [
    `Discharge summary for patient ${names[r]}: admitted with ${conditions[r]}, discharged on amoxicillin ${250 * (r + 1)} mg.`,
    `What are the common early symptoms of ${conditions[(r + 2) % 5]}?`,
    `Client ${names[(r + 1) % 5]}: holdings $${(4.8 + r).toFixed(1)}m, cash balance $${198 + r},699.76, margin loan $${310 + r},000.`,
    `Please summarise ${topics[r]} for the platform team and list the open risks.`,
  ];
  const latencies: { tier2: number; tier3b: number; route: string | null }[] = [];
  for (let round = 0; round < 5; round++) {
    for (const text of promptsFor(round)) {
      const r = (await popup.evaluate(
        (t) => chrome.runtime.sendMessage({ target: 'background', type: 'scan-async', input: { text: t, attachments: [] } }),
        text,
      )) as { timings: { tier2: number; tier3b: number }; tier2Route: string | null };
      if (round > 0) latencies.push({ tier2: r.timings.tier2, tier3b: r.timings.tier3b, route: r.tier2Route });
    }
  }
  // Ground truth: attach to the offscreen document over raw CDP, force a GC, then measure inside it.
  // (Chrome resolves measureUserAgentSpecificMemory at the next GC, which an idle page may not run.)
  const targets = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()) as { url: string; webSocketDebuggerUrl: string }[];
  const ws = new WebSocket(targets.find((t) => t.url.endsWith('offscreen.html'))!.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const waiting = new Map<number, (v: { result?: { result?: { value?: unknown } } }) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as { id: number };
    waiting.get(m.id)?.(m as never);
  };
  const cdp = (method: string, params: unknown = {}) =>
    new Promise<{ result?: { result?: { value?: unknown } } }>((r) => {
      const id = ++seq;
      waiting.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await cdp('HeapProfiler.collectGarbage');
  const direct = (
    await cdp('Runtime.evaluate', {
      expression:
        'performance.measureUserAgentSpecificMemory().then(r => ({ mb: r.bytes / 1048576, byType: Object.fromEntries(r.breakdown.filter(b => b.bytes > 1e5).map(b => [b.types.join("+") + " @ " + b.attribution.map(a => a.scope + ":" + (a.url || "").split("/").pop()).join(","), +(b.bytes / 1048576).toFixed(1)])) }))',
      awaitPromise: true,
      returnByValue: true,
    })
  ).result?.result?.value as { mb: number; byType: Record<string, number> };
  ws.close();
  const engine = (await status()).engine;
  const p = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((q / 100) * xs.length))] ?? null;
  const report = {
    mode: pathAOnly ? 'path-a-only (GPU disabled)' : 'auto (Path B allowed)',
    measuredAt: new Date().toISOString(),
    offscreenMemory: { mb: +direct.mb.toFixed(1), method: 'measureUserAgentSpecificMemory after forced GC (raw CDP, offscreen document)', byType: direct.byType },
    pathBOutcome,
    engine,
    tier2: { p50: p(latencies.map((l) => l.tier2), 50), p95: p(latencies.map((l) => l.tier2), 95) },
    tier3b: { p50: p(latencies.map((l) => l.tier3b), 50), p95: p(latencies.map((l) => l.tier3b), 95) },
    routes: [...new Set(latencies.map((l) => l.route))],
    samples: latencies.length,
  };
  mkdirSync(resolve(root, 'bench-results'), { recursive: true });
  writeFileSync(resolve(root, `bench-results/extension-measurements-path-${pathAOnly ? 'a' : 'b'}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  server.kill();
}
