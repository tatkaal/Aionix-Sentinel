// npm run bench        → runs every dataset through the full cascade (Tier 1 + 3A + Tier 2 Path A
//                        + 3B) and writes bench-results/path-a.json
// npm run bench:gate   → same, then exits non-zero if any release-gate threshold is missed.
// npm run bench -- --path-b → Tier 2 on Path B instead: the shipped tagger (assets/engine/pathb) on
//                        onnxruntime-node, strictly routed → bench-results/path-b.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { applyAdjudications, runBenchmark, summarise, type RunSummary } from '../src/engine/bench/harness';
import { DATASETS, type Adjudication, type BenchSample, type DatasetId } from '../src/engine/bench/types';
import { createNodeEngine } from './lib/node-engine';
import { createNodeTagger } from './lib/node-tagger';

const root = resolve(import.meta.dirname, '..');
const gate = process.argv.includes('--gate');
const verbose = process.argv.includes('--verbose');
const route = process.argv.includes('--path-b') ? 'B' : 'A';

function load(file: string): BenchSample[] | null {
  const p = resolve(root, 'data/datasets', file);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, 'utf8');
  return file.endsWith('.json') ? (JSON.parse(raw) as BenchSample[]) : raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as BenchSample);
}

const adjudications = JSON.parse(readFileSync(resolve(root, 'data/datasets/enron-adjudications.json'), 'utf8')) as Record<string, Adjudication>;
const taggerDir = resolve(root, 'assets/engine/pathb');
const { scan, host } = await createNodeEngine(root, route === 'B' ? { pathB: { device: 'cpu', create: async () => (await createNodeTagger(taggerDir)).ner } } : {});

// Warm-up so JIT / session initialisation does not distort latency percentiles.
for (const t of ['warm up', 'Patient Ana Lee has asthma.', 'card 4532-0151-1283-0366']) await scan({ text: t });

const summaries: RunSummary[] = [];
// English-only views of mixed-language datasets (rows the dataset itself annotates as `en:`).
const english: Record<string, RunSummary> = {};
const fmt = (x: number | null, pct = false) => (x === null ? '  —  ' : pct ? `${(x * 100).toFixed(2)}%` : x.toFixed(3));
for (const ds of DATASETS) {
  let samples = load(ds.file);
  if (!samples) {
    console.warn(`skip ${ds.id}: data/datasets/${ds.file} missing — run "npm run data:datasets"`);
    continue;
  }
  if (ds.id.startsWith('enron')) samples = applyAdjudications(samples, adjudications);
  const { summary, results } = await runBenchmark(ds.id as DatasetId, route, samples, scan);
  summaries.push(summary);
  const lang = new Map(samples.map((x) => [x.id, x.note?.split(':')[0]]));
  if ([...lang.values()].some((l) => l && l !== 'en' && /^[a-z]{2}$/.test(l))) {
    const en = results.filter((x) => lang.get(x.id.split('#')[0]!) === 'en');
    english[ds.id] = summarise(ds.id as DatasetId, route, en, 0);
    const e = english[ds.id]!.metrics;
    console.log(`  └ English only            n=${String(en.length).padStart(4)}  TP ${e.tp} FP ${e.fp} TN ${e.tn} FN ${e.fn}  P ${fmt(e.precision)} R ${fmt(e.recall)} F2 ${fmt(e.f2)} FPR ${fmt(e.fpr, true)}`);
  }
  const m = summary.metrics;
  console.log(
    `${ds.label.padEnd(28)} n=${String(summary.observations).padStart(4)}  TP ${m.tp} FP ${m.fp} TN ${m.tn} FN ${m.fn}  P ${fmt(m.precision)} R ${fmt(m.recall)} F1 ${fmt(m.f1)} F2 ${fmt(m.f2)} FPR ${fmt(m.fpr, true)}  p50 ${summary.latency.p50?.toFixed(1)}ms p95 ${summary.latency.p95?.toFixed(1)}ms p99 ${summary.latency.p99?.toFixed(1)}ms`,
  );
  if (verbose) for (const x of summary.misclassified) console.log(`   ✗ ${x.id} expected ${x.expect}, got ${x.predicted} ${x.types.join(',')}`);
}

const status = await host.status();
mkdirSync(resolve(root, 'bench-results'), { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  runtime: { kind: 'node', node: process.version, cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length },
  route,
  engine: { fstEntries: status.fstEntries, fstBytes: status.fstBytes, edmVectors: status.edmVectors, edmFields: status.edmFields, pathB: status.pathBReason, pathBModel: status.pathBModel },
  summaries,
  english,
};
const outFile = `bench-results/path-${route.toLowerCase()}.json`;
writeFileSync(resolve(root, outFile), JSON.stringify(report, null, 2) + '\n');
console.log(`wrote ${outFile}`);

if (gate) {
  type Gate = { minF2?: number; maxFpr?: number; minAccuracy?: number };
  const all = JSON.parse(readFileSync(resolve(root, 'bench-gate.json'), 'utf8')) as Record<string, Gate> & { pathB: Record<string, Gate> };
  const thresholds: Record<string, Gate> = route === 'B' ? all.pathB : all;
  let failed = false;
  for (const s of summaries) {
    const t = thresholds[s.dataset];
    if (!t) continue;
    const checks: [string, boolean][] = [];
    if (t.minF2 !== undefined) checks.push([`F2 ${fmt(s.metrics.f2)} ≥ ${t.minF2}`, (s.metrics.f2 ?? 0) >= t.minF2]);
    if (t.maxFpr !== undefined) checks.push([`FPR ${fmt(s.metrics.fpr, true)} ≤ ${(t.maxFpr * 100).toFixed(2)}%`, (s.metrics.fpr ?? 0) <= t.maxFpr]);
    if (t.minAccuracy !== undefined) checks.push([`accuracy ${fmt(s.metrics.accuracy)} ≥ ${t.minAccuracy}`, s.metrics.accuracy >= t.minAccuracy]);
    for (const [label, ok] of checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.dataset.padEnd(11)} ${label}`);
      if (!ok) failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}
