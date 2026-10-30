// Renders the "Measured results" section of README.md from recorded benchmark files:
//   bench-results/path-a.json         Node CI baseline (npm run bench)
//   bench-results/browser-runs.json   Workbench runs (Path A and Path B) exported from the browser
//   bench-results/extension-measurements-path-{a,b}.json   npm run measure:ext
// Usage: npm run report
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RunSummary } from '../src/engine/bench/harness';
import { DATASETS } from '../src/engine/bench/types';

const root = resolve(import.meta.dirname, '..');
const node = JSON.parse(readFileSync(resolve(root, 'bench-results/path-a.json'), 'utf8')) as {
  generatedAt: string;
  runtime: { node: string; cpu: string };
  summaries: RunSummary[];
};
const browserFile = resolve(root, 'bench-results/browser-runs.json');
const browser = existsSync(browserFile)
  ? (JSON.parse(readFileSync(browserFile, 'utf8')) as { recordedAt: string; userAgent: string; hardware: Record<string, string>; runs: Record<string, { summary: RunSummary; hardware: string }> })
  : null;

const f3 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(3));
const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`);
const ms = (v: number | null | undefined) => (v == null ? '—' : `${v < 10 ? v.toFixed(1) : v.toFixed(0)} ms`);

const lines: string[] = [];
lines.push('Document-level detection, positive = "must block". **Dev** splits were used for error analysis while developing rules (optimistic); **held-out** splits were never inspected or tuned on.', '');
lines.push('| Dataset | Split | n | Path A P / R | Path A F2 | Path A FPR | Path A p50 / p95 | Path B F2 | Path B FPR | Path B p50 / p95 |');
lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const d of DATASETS) {
  const a = browser?.runs[`${d.id}:A`]?.summary ?? node.summaries.find((s) => s.dataset === d.id);
  const b = browser?.runs[`${d.id}:B`]?.summary;
  if (!a) continue;
  lines.push(
    `| ${d.label} | ${d.split === 'dev' ? 'dev' : d.split} | ${a.observations} | ${f3(a.metrics.precision)} / ${f3(a.metrics.recall)} | ${f3(a.metrics.f2)} | ${pct(a.metrics.fpr)} | ${ms(a.latency.p50)} / ${ms(a.latency.p95)} | ${f3(b?.metrics.f2)} | ${pct(b?.metrics.fpr)} | ${b ? `${ms(b.latency.p50)} / ${ms(b.latency.p95)}` : '—'} |`,
  );
}
lines.push('');
const meets = (s: RunSummary) => (s.metrics.f2 === null || s.metrics.f2 >= 0.978) && (s.metrics.fpr === null || s.metrics.fpr < 0.0002);
const verdicts = DATASETS.map((d) => ({ d, a: browser?.runs[`${d.id}:A`]?.summary ?? node.summaries.find((s) => s.dataset === d.id) })).filter((x) => x.a);
const met = verdicts.filter((x) => meets(x.a!)).map((x) => x.d.label);
const missed = verdicts.filter((x) => !meets(x.a!)).map((x) => x.d.label);
lines.push(`Blueprint targets (F2 ≥ 0.978, FPR < 0.02%), on Path A:`);
lines.push(`- Met: ${met.join(', ') || 'none'}.`);
lines.push(`- **Not met: ${missed.join(', ') || 'none'}.**`);
lines.push('');
if (browser) {
  const fpTypes: Record<string, number> = {};
  let fpTotal = 0;
  for (const [key, run] of Object.entries(browser.runs)) {
    if (!key.endsWith(':B')) continue;
    for (const m of run.summary.misclassified) {
      if (m.expect !== 'allow') continue;
      fpTotal++;
      for (const t of m.types) fpTypes[t] = (fpTypes[t] ?? 0) + 1;
    }
  }
  const top = Object.entries(fpTypes).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (fpTotal) {
    lines.push(
      `- **Path B trade-off.** Path B raises held-out AI4Privacy recall, but its false alarms are much higher. Across its ${fpTotal} false positives, the most frequent finding types are ${top.map(([t, n]) => `\`${t}\` (${n})`).join(', ')}.`,
    );
    lines.push(
      '  - Diagnosis: privacy-filter `account_number` spans are used both as identifiers and as financial values, so two unrelated numbers can form a "customer record".',
      '  - Next step: treat neural account numbers as financial values only, then re-benchmark.',
    );
  }
  lines.push(`- **Browser runs:** recorded ${browser.recordedAt.slice(0, 10)} in the Workbench engine worker (the same modules as the offscreen document).`);
  lines.push(`  - Path A: ${browser.hardware.pathA}.`);
  lines.push(`  - Path B: ${browser.hardware.pathB}.`);
  lines.push('  - Latency is end-to-end per observation: Tier 1 + 3A on the main thread, plus the worker round-trip for Tier 2 + 3B.');
}
lines.push(`- **Node CI baseline:** ${node.generatedAt.slice(0, 10)}, Node ${node.runtime.node}, ${node.runtime.cpu}. It produces the same Path A detections as the browser run.`);
type ExtMeasure = {
  mode: string;
  offscreenMemory: { mb: number; method: string };
  engine: { route: string; pathBState: string; pathBReason: string };
  pathBOutcome?: { state: string; reason: string; loadMs: number | null } | null;
  tier2: { p50: number; p95: number };
  tier3b: { p50: number; p95: number };
  routes: (string | null)[];
};
for (const route of ['a', 'b']) {
  const file = resolve(root, `bench-results/extension-measurements-path-${route}.json`);
  if (!existsSync(file)) continue;
  const m = JSON.parse(readFileSync(file, 'utf8')) as ExtMeasure;
  lines.push(`- **Inside the extension** (${m.mode}, Chromium via Playwright):`);
  lines.push(`  - Offscreen memory: ${m.offscreenMemory.mb.toFixed(1)} MB (${m.offscreenMemory.method}).`);
  lines.push(`  - Tier 2 route(s): ${m.routes.join('/')}. Path B: ${m.engine.pathBState}.`);
  if (m.pathBOutcome) {
    const load = m.pathBOutcome.loadMs === null ? '' : ` after a ${(m.pathBOutcome.loadMs / 1000).toFixed(0)} s load`;
    lines.push(`  - Path B outcome${load}: ${m.pathBOutcome.reason}.`);
  }
  lines.push(`  - Tier 2 p50 / p95: ${ms(m.tier2.p50)} / ${ms(m.tier2.p95)}. Tier 3B p50 / p95: ${ms(m.tier3b.p50)} / ${ms(m.tier3b.p95)}.`);
}

const readme = resolve(root, 'README.md');
const text = readFileSync(readme, 'utf8');
const out = text.replace(/<!-- results:start -->[\s\S]*<!-- results:end -->/, `<!-- results:start -->\n${lines.join('\n')}\n<!-- results:end -->`);
writeFileSync(readme, out);
console.log(lines.join('\n'));
