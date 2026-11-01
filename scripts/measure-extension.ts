// Loads the built extension in Chromium and records what the offscreen document actually measures:
// memory (method-labelled), Tier 2 route / Path B state and per-tier latency inside the extension.
// Usage: npm run build:ext:test && npm run measure:ext [-- --path-a-only]
//   --path-a-only  the extension's fallback state: a remembered Path B eviction and a recycled
//                  offscreen document, i.e. pure Path A (Path B runs on any CPU, so no flag disables it)
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
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`, `--remote-debugging-port=${DEBUG_PORT}`],
});

/** Raw CDP session on the current offscreen document (it changes when the background recycles it). */
async function offscreenCdp() {
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
  return { cdp, close: () => ws.close() };
}
try {
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  const status = () => popup.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'status' })) as Promise<{ engine: Record<string, unknown> | null }>;
  for (let i = 0; i < 120 && !(await status()).engine?.pathAReady; i++) await popup.waitForTimeout(500);
  let pathBOutcome: Record<string, unknown> | null = null;
  if (pathAOnly) {
    const o = await offscreenCdp();
    await o.cdp('Runtime.evaluate', { expression: "localStorage.setItem('aionix.pathB.evicted.v2', 'measurement: Path A only')" });
    o.close();
    await popup.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'recycle-offscreen' }));
    for (let i = 0; i < 120; i++) {
      const e = (await status()).engine;
      if (e?.pathAReady && /remembered/.test(String(e.pathBReason))) break;
      await popup.waitForTimeout(500);
    }
  } else {
    // Wait for a terminal Path B state (the tagger ships with the extension; this takes < 1 s).
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
  const p = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((q / 100) * xs.length))] ?? null;
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

  // Send → decision as the user experiences it: the real content script on the fixture portal, from
  // just before the Enter key press to the prompt reaching the page's own send handler (clean) or the
  // drawer opening (blocked). Includes Playwright's key dispatch, so it slightly overstates the delay.
  const portal = await context.newPage();
  await portal.goto('http://localhost:4173/chatgpt');
  await portal.evaluate(() => {
    const t = { sent: [] as number[], drawer: [] as number[] };
    (window as unknown as { __aionixT: typeof t }).__aionixT = t;
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n instanceof HTMLElement && n.classList.contains('sent') && t.sent.push(performance.now())))).observe(document.getElementById('log')!, { childList: true });
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n instanceof HTMLElement && n.tagName === 'AIONIX-SENTINEL-DRAWER' && t.drawer.push(performance.now())))).observe(document.documentElement, { childList: true, subtree: true });
  });
  const editor = portal.locator('[contenteditable="true"]');
  const counts = () => portal.evaluate(() => ({ sent: (window as unknown as { __aionixT: { sent: number[] } }).__aionixT.sent.length, drawer: (window as unknown as { __aionixT: { drawer: number[] } }).__aionixT.drawer.length }));
  async function sendOnce(text: string, expect: 'sent' | 'drawer'): Promise<number> {
    await editor.fill(text);
    const before = await counts();
    const t0 = await portal.evaluate(() => performance.now());
    await editor.press('Enter');
    try {
      await portal.waitForFunction(([k, n]) => (window as unknown as { __aionixT: Record<string, number[]> }).__aionixT[k as string]!.length > (n as number), [expect, before[expect]] as const, { timeout: 5000 });
    } catch {
      const seen = await portal.evaluate(() => ({ log: document.getElementById('log')!.innerText.slice(-200), drawer: document.querySelector('aionix-sentinel-drawer')?.shadowRoot?.textContent?.slice(0, 200) ?? null }));
      throw new Error(`expected ${expect} for ${JSON.stringify(text)}; page shows ${JSON.stringify(seen)}`);
    }
    const t1 = await portal.evaluate((k) => (window as unknown as { __aionixT: Record<string, number[]> }).__aionixT[k]!.at(-1)!, expect);
    if (expect === 'drawer') {
      await portal.locator('aionix-sentinel-drawer').getByRole('button', { name: 'Close' }).click();
      await portal.locator('aionix-sentinel-drawer').waitFor({ state: 'detached' });
      await editor.fill('');
    }
    return t1 - t0;
  }
  const subjects = ['the release checklist', 'our vendor shortlist', 'the Q3 roadmap', 'the onboarding guide', 'the incident timeline', 'the hiring plan', 'the API changelog', 'the support macros', 'the design review', 'the pricing FAQ', 'the migration plan', 'the retro notes'];
  const clean: number[] = [];
  for (const [i, s] of subjects.entries()) clean.push(await sendOnce(`Draft a short summary of ${s} for the team, version ${i + 2}.`, 'sent'));
  const blockedT2: number[] = [];
  for (const [i, n] of names.entries()) blockedT2.push(await sendOnce(`Patient ${n} was admitted with ${conditions[i]} and started metformin ${500 + i * 250} mg.`, 'drawer'));
  const blockedT1: number[] = [];
  for (let i = 0; i < 5; i++) blockedT1.push(await sendOnce(`my current psw is Ohlalala${i}${i + 3}%x — can you suggest a better one?`, 'drawer'));
  await portal.close();
  const dist = (xs: number[]) => ({ n: xs.length, p50: +p(xs, 50)!.toFixed(1), p95: +p(xs, 95)!.toFixed(1), max: +Math.max(...xs).toFixed(1) });
  // Ground truth: attach to the offscreen document over raw CDP, force a GC, then measure inside it.
  // (Chrome resolves measureUserAgentSpecificMemory at the next GC, which an idle page may not run.)
  const { cdp, close } = await offscreenCdp();
  // A reading without the document's own JavaScript attribution did not capture its heap (seen once
  // after a recycle: "Shared" only, 6.6 MB) — retry rather than record it.
  let direct: { mb: number; byType: Record<string, number> } | null = null;
  for (let attempt = 0; attempt < 5 && !direct; attempt++) {
    await cdp('HeapProfiler.collectGarbage');
    const r = (
      await cdp('Runtime.evaluate', {
        expression:
          'performance.measureUserAgentSpecificMemory().then(r => ({ mb: r.bytes / 1048576, byType: Object.fromEntries(r.breakdown.filter(b => b.bytes > 1e5).map(b => [b.types.join("+") + " @ " + b.attribution.map(a => a.scope + ":" + (a.url || "").split("/").pop()).join(","), +(b.bytes / 1048576).toFixed(1)])) }))',
        awaitPromise: true,
        returnByValue: true,
      })
    ).result?.result?.value as { mb: number; byType: Record<string, number> };
    if (Object.keys(r.byType).some((k) => k.startsWith('JavaScript @ Window:offscreen.html'))) direct = r;
    else {
      console.error(`measurement ${attempt + 1} lacked the document's JavaScript attribution (${JSON.stringify(r.byType)}); retrying`);
      await popup.waitForTimeout(3000);
    }
  }
  close();
  if (!direct) throw new Error('no attributable offscreen memory reading after 5 attempts');
  const engine = (await status()).engine;
  const report = {
    mode: pathAOnly ? 'path-a-only (Path B evicted, recycled document)' : 'auto (Path B allowed)',
    measuredAt: new Date().toISOString(),
    offscreenMemory: { mb: +direct.mb.toFixed(1), method: 'measureUserAgentSpecificMemory after forced GC (raw CDP, offscreen document)', byType: direct.byType },
    pathBOutcome,
    engine,
    tier2: { p50: p(latencies.map((l) => l.tier2), 50), p95: p(latencies.map((l) => l.tier2), 95) },
    tier3b: { p50: p(latencies.map((l) => l.tier3b), 50), p95: p(latencies.map((l) => l.tier3b), 95) },
    routes: [...new Set(latencies.map((l) => l.route))],
    samples: latencies.length,
    sendToDecision: { method: 'fixture portal, Enter → page send handler (clean) or drawer shown (blocked), ms', clean: dist(clean), blockedTier2: dist(blockedT2), blockedTier1: dist(blockedT1) },
  };
  mkdirSync(resolve(root, 'bench-results'), { recursive: true });
  writeFileSync(resolve(root, `bench-results/extension-measurements-path-${pathAOnly ? 'a' : 'b'}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  server.kill();
}
