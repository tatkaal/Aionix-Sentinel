// Path B bake-off on the DEV splits: replays cached tagger spans (scripts/ml/tag_datasets.py) through
// the shipping cascade with a CPU Path B provider, for each graph policy, beside Path A.
// Model latency comes from the tagging run (ONNX Runtime CPU, recorded per text), because the
// replay itself costs nothing.
// Usage: npx tsx scripts/bakeoff.ts [cache name ...]   (default: every .cache/ml/ner/* entry)
//        --holdout  score the held-out splits instead (only for the finally selected configuration)
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyAdjudications, runBenchmark, type RunSummary } from '../src/engine/bench/harness';
import { percentile } from '../src/engine/bench/metrics';
import { DATASETS, type Adjudication, type BenchSample, type DatasetId } from '../src/engine/bench/types';
import { DEFAULT_NEURAL_POLICY, type NeuralPolicy } from '../src/engine/tier2/neural-path';
import type { NeuralEntity, NeuralNer } from '../src/engine/tier2/webgpu-path';
import { createNodeEngine } from './lib/node-engine';

const root = resolve(import.meta.dirname, '..');
const holdout = process.argv.includes('--holdout');
const nerRoot = resolve(root, '.cache/ml/ner');
const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const candidates = names.length ? names : existsSync(nerRoot) ? readdirSync(nerRoot).filter((d) => statSync(resolve(nerRoot, d)).isDirectory()) : [];
const datasets = DATASETS.filter((d) => (holdout ? d.id.endsWith('-holdout') : !d.id.endsWith('-holdout')));

// Secret findings and neural-only names were dropped after the first dev bake-off: secrets cost
// 6–21% FPR for every candidate, and neural-only names never beat the union with Path A's names.
const POLICIES: Record<string, NeuralPolicy> = {
  graph: DEFAULT_NEURAL_POLICY,
  'graph+gov': { ...DEFAULT_NEURAL_POLICY, govIdFindings: true },
};

const adjudications = JSON.parse(readFileSync(resolve(root, 'data/datasets/enron-adjudications.json'), 'utf8')) as Record<string, Adjudication>;
function samples(file: string, id: string): BenchSample[] {
  const raw = readFileSync(resolve(root, 'data/datasets', file), 'utf8');
  const s = file.endsWith('.json') ? (JSON.parse(raw) as BenchSample[]) : raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as BenchSample);
  return id.startsWith('enron') ? applyAdjudications(s, adjudications) : s;
}

interface CachedRow {
  id: string;
  text: string;
  entities: NeuralEntity[];
  ms: number;
  tokens: number;
}

const fmt = (x: number | null, pct = false) => (x === null ? '—' : pct ? `${(x * 100).toFixed(2)}%` : x.toFixed(3));
const line = (label: string, s: RunSummary) =>
  `${label.padEnd(44)} ${s.dataset.padEnd(18)} TP ${String(s.metrics.tp).padStart(3)} FP ${String(s.metrics.fp).padStart(3)} FN ${String(s.metrics.fn).padStart(3)}  F2 ${fmt(s.metrics.f2)}  FPR ${fmt(s.metrics.fpr, true)}`;

const report: { generatedAt: string; split: string; pathA: RunSummary[]; candidates: Record<string, unknown> } = {
  generatedAt: new Date().toISOString(),
  split: holdout ? 'holdout' : 'dev',
  pathA: [],
  candidates: {},
};

// Path A reference, same cascade.
{
  const { scan } = await createNodeEngine(root);
  for (const d of datasets) {
    const { summary } = await runBenchmark(d.id as DatasetId, 'A', samples(d.file, d.id), scan);
    report.pathA.push(summary);
    console.log(line('Path A (lexicon)', summary));
  }
}

for (const name of candidates) {
  const dir = resolve(nerRoot, name);
  const byText = new Map<string, CachedRow>();
  const modelLatency: Record<string, { p50: number | null; p95: number | null; tokensP50: number | null }> = {};
  for (const d of datasets) {
    const file = resolve(dir, `${d.id}.jsonl`);
    if (!existsSync(file)) throw new Error(`${name}: ${d.id} not tagged — run scripts/ml/tag_datasets.py${holdout ? ' --holdout' : ''}`);
    const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as CachedRow);
    for (const r of rows) byText.set(r.text, r);
    modelLatency[d.id] = { p50: percentile(rows.map((r) => r.ms), 50), p95: percentile(rows.map((r) => r.ms), 95), tokensP50: percentile(rows.map((r) => r.tokens), 50) };
  }
  const meta = JSON.parse(readFileSync(resolve(dir, 'meta.json'), 'utf8')) as Record<string, unknown>;
  const replay: NeuralNer = {
    modelId: name,
    async detect(text) {
      const row = byText.get(text);
      if (!row) throw new Error(`${name}: no cached tags for a text — re-run tag_datasets.py`);
      return row.entities;
    },
    dispose: async () => undefined,
  };
  const policies: Record<string, RunSummary[]> = {};
  for (const [policyName, policy] of Object.entries(POLICIES)) {
    const { scan } = await createNodeEngine(root, { pathB: { device: 'cpu', create: async () => replay, policy } });
    policies[policyName] = [];
    for (const d of datasets) {
      const { summary } = await runBenchmark(d.id as DatasetId, 'B', samples(d.file, d.id), scan);
      policies[policyName].push(summary);
      console.log(line(`${name} · ${policyName}`, summary));
    }
  }
  report.candidates[name] = { meta, modelLatency, policies };
}

mkdirSync(resolve(root, 'bench-results'), { recursive: true });
const out = resolve(root, `bench-results/bakeoff-${holdout ? 'holdout' : 'dev'}.json`);
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(`wrote ${out}`);
