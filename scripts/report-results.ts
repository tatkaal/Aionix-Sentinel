// Renders the "Measured results" section of README.md from recorded benchmark files:
//   bench-results/path-a.json, path-b.json      Node runs of the full cascade (npm run bench [-- --path-b])
//   bench-results/browser-runs*.json             Workbench runs exported from the browser (Path A; earlier privacy-filter Path B)
//   bench-results/bakeoff-dev.json               Path B candidate bake-off on the dev splits (scripts/bakeoff.ts)
//   bench-results/extension-measurements-path-{a,b}.json   npm run measure:ext
// Usage: npm run report
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RunSummary } from '../src/engine/bench/harness';
import { DATASETS } from '../src/engine/bench/types';

const root = resolve(import.meta.dirname, '..');
const read = <T,>(file: string): T | null => (existsSync(resolve(root, file)) ? (JSON.parse(readFileSync(resolve(root, file), 'utf8')) as T) : null);

type NodeRun = { generatedAt: string; runtime: { node: string; cpu: string }; engine: { pathBModel?: string | null }; summaries: RunSummary[] };
type Browser = { recordedAt: string; hardware: Record<string, string>; runs: Record<string, { summary: RunSummary; hardware: string }> };
const nodeA = read<NodeRun>('bench-results/path-a.json')!;
const nodeB = read<NodeRun>('bench-results/path-b.json');
const browserA = read<Browser>('bench-results/browser-runs.json');
const earlierB = read<Browser>('bench-results/browser-runs-privacy-filter.json');

const f3 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(3));
const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`);
const ms = (v: number | null | undefined) => (v == null ? '—' : `${v < 10 ? v.toFixed(1) : v.toFixed(0)} ms`);
const find = (run: NodeRun | null, id: string) => run?.summaries.find((s) => s.dataset === id);

const lines: string[] = [];
lines.push(
  'Document-level detection, positive = "must block". **Dev** splits were used for error analysis while developing rules and for selecting the Path B model (optimistic); **held-out** splits were never inspected or tuned on. Both paths: the full cascade in Node on the same machine.',
  '',
);
lines.push('| Dataset | Split | n | Path A P / R | Path A F2 | Path A FPR | Path A p50 / p95 | Path B P / R | Path B F2 | Path B FPR | Path B p50 / p95 |');
lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const d of DATASETS) {
  const a = find(nodeA, d.id);
  const b = find(nodeB, d.id);
  if (!a) continue;
  const pr = (s: RunSummary | undefined) => (s ? `${f3(s.metrics.precision)} / ${f3(s.metrics.recall)}` : '—');
  const lat = (s: RunSummary | undefined) => (s ? `${ms(s.latency.p50)} / ${ms(s.latency.p95)}` : '—');
  lines.push(`| ${d.label} | ${d.split} | ${a.observations} | ${pr(a)} | ${f3(a.metrics.f2)} | ${pct(a.metrics.fpr)} | ${lat(a)} | ${pr(b)} | ${f3(b?.metrics.f2)} | ${pct(b?.metrics.fpr)} | ${lat(b)} |`);
}
lines.push('');
const meets = (s: RunSummary) => (s.metrics.f2 === null || s.metrics.f2 >= 0.978) && (s.metrics.fpr === null || s.metrics.fpr < 0.0002);
for (const [label, run] of [['Path A', nodeA], ['Path B', nodeB]] as const) {
  if (!run) continue;
  const rows = DATASETS.map((d) => ({ d, s: find(run, d.id) })).filter((x) => x.s);
  lines.push(`Blueprint targets (F2 ≥ 0.978, FPR < 0.02%) on ${label}: met on ${rows.filter((x) => meets(x.s!)).map((x) => x.d.label).join(', ') || 'none'}; **not met on ${rows.filter((x) => !meets(x.s!)).map((x) => x.d.label).join(', ') || 'none'}.**`);
}
lines.push('');

const ha = find(nodeA, 'ai4privacy-holdout');
const hb = find(nodeB, 'ai4privacy-holdout');
const ea = find(nodeA, 'enron-holdout');
const eb = find(nodeB, 'enron-holdout');
if (ha && hb && ea && eb) {
  lines.push(
    `- **Path B vs Path A, held-out.** AI4Privacy (80% French, German and Italian) recall ${f3(ha.metrics.recall)} → ${f3(hb.metrics.recall)}, F2 ${f3(ha.metrics.f2)} → ${f3(hb.metrics.f2)}, FPR ${pct(ha.metrics.fpr)} → ${pct(hb.metrics.fpr)}. Enron FPR ${pct(ea.metrics.fpr)} → ${pct(eb.metrics.fpr)}.`,
  );
}
if (earlierB) {
  const pa = earlierB.runs['ai4privacy-holdout:B']?.summary;
  const pe = earlierB.runs['enron-holdout:B']?.summary;
  if (pa && pe) {
    lines.push(
      `- **Earlier Path B** (${earlierB.hardware.pathB}, recorded ${earlierB.recordedAt.slice(0, 10)}): held-out AI4Privacy F2 ${f3(pa.metrics.f2)} at FPR ${pct(pa.metrics.fpr)}; Enron FPR ${pct(pe.metrics.fpr)}. It needed 958 MB of host memory and was replaced (ADR-007).`,
    );
  }
}
lines.push(`- **Node runs:** Path A ${nodeA.generatedAt.slice(0, 10)}${nodeB ? `, Path B ${nodeB.generatedAt.slice(0, 10)} (${nodeB.engine.pathBModel})` : ''}; Node ${nodeA.runtime.node}, ${nodeA.runtime.cpu}. Latency is the whole cascade per observation.`);
if (browserA) lines.push(`- **Browser run (Path A):** recorded ${browserA.recordedAt.slice(0, 10)} in the Workbench engine worker, ${browserA.hardware.pathA}; same detections as the Node run.`);

type ExtMeasure = {
  mode: string;
  offscreenMemory: { mb: number; method: string };
  engine: { pathBState: string; pathBModel?: string | null };
  pathBOutcome?: { state: string; reason: string; loadMs: number | null } | null;
  tier2: { p50: number; p95: number };
  tier3b: { p50: number; p95: number };
  routes: (string | null)[];
};
for (const route of ['a', 'b']) {
  const m = read<ExtMeasure>(`bench-results/extension-measurements-path-${route}.json`);
  if (!m) continue;
  lines.push(`- **Inside the extension** (${m.mode}, Chromium via Playwright): offscreen memory ${m.offscreenMemory.mb.toFixed(1)} MB (${m.offscreenMemory.method}); Tier 2 route ${m.routes.join('/')}, p50 / p95 ${ms(m.tier2.p50)} / ${ms(m.tier2.p95)}; Tier 3B p50 / p95 ${ms(m.tier3b.p50)} / ${ms(m.tier3b.p95)}.`);
  if (m.pathBOutcome && route === 'b') lines.push(`  - Path B ${m.pathBOutcome.state}${m.pathBOutcome.loadMs != null ? ` after ${m.pathBOutcome.loadMs.toFixed(0)} ms` : ''}: ${m.pathBOutcome.reason}.`);
}

type Bakeoff = {
  pathA: RunSummary[];
  candidates: Record<string, { meta: { onnxMB?: number; quantization?: { argmaxAgreement: number } | null; onnx: string }; modelLatency: Record<string, { p50: number | null; p95: number | null }>; policies: Record<string, RunSummary[]> }>;
};
const bake = read<Bakeoff>('bench-results/bakeoff-dev.json');
if (bake) {
  lines.push('', '**Path B bake-off** (dev splits only, `graph` policy, full cascade; tagger latency is ONNX Runtime CPU with 4 threads, per text):', '');
  lines.push('| Candidate | Weights | INT8 vs fp32 token agreement | AI4Privacy dev F2 / FPR | Enron dev FPR | Presidio dev F2 | Tagger p50 / p95 on Enron |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  const at = (xs: RunSummary[], id: string) => xs.find((s) => s.dataset === id);
  const pa = bake.pathA;
  lines.push(`| Path A (no tagger) | — | — | ${f3(at(pa, 'ai4privacy')?.metrics.f2)} / ${pct(at(pa, 'ai4privacy')?.metrics.fpr)} | ${pct(at(pa, 'enron')?.metrics.fpr)} | ${f3(at(pa, 'presidio')?.metrics.f2)} | — |`);
  for (const [name, c] of Object.entries(bake.candidates)) {
    const g = c.policies.graph ?? [];
    const q = c.meta.quantization;
    lines.push(
      `| ${name} | ${c.meta.onnxMB != null ? `${c.meta.onnxMB} MB ${c.meta.onnx.includes('int8') ? 'INT8' : 'fp32'}` : '—'} | ${q ? `${(q.argmaxAgreement * 100).toFixed(2)}%` : 'n/a (fp32)'} | ${f3(at(g, 'ai4privacy')?.metrics.f2)} / ${pct(at(g, 'ai4privacy')?.metrics.fpr)} | ${pct(at(g, 'enron')?.metrics.fpr)} | ${f3(at(g, 'presidio')?.metrics.f2)} | ${ms(c.modelLatency.enron?.p50)} / ${ms(c.modelLatency.enron?.p95)} |`,
    );
  }
}

const readme = resolve(root, 'README.md');
const text = readFileSync(readme, 'utf8');
writeFileSync(readme, text.replace(/<!-- results:start -->[\s\S]*<!-- results:end -->/, `<!-- results:start -->\n${lines.join('\n')}\n<!-- results:end -->`));
console.log(lines.join('\n'));
