// Benchmark harness — runs BenchSamples through a full-cascade scan function and aggregates
// document-level metrics and latency. Shared by `npm run bench` (Node) and the Workbench.
import type { CategoryId, EnginePath, ScanInput, ScanResult } from '../types';
import { computeMetrics, percentile, type Confusion, type Metrics } from './metrics';
import type { Adjudication, BenchSample, DatasetId } from './types';

export interface ObservationResult {
  id: string;
  expect: 'block' | 'allow';
  predicted: 'block' | 'allow';
  correct: boolean;
  expectedCategories: CategoryId[];
  detectedCategories: CategoryId[];
  paths: EnginePath[];
  findingTypes: string[];
  latencyMs: number;
  tier: { tier1: number; tier3a: number; tier2: number; tier3b: number };
  route: 'A' | 'B' | null;
  augmented: boolean;
  checksumInvalid: boolean;
  degraded?: string;
}

export interface LatencySummary {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  mean: number | null;
}

export interface RunSummary {
  dataset: DatasetId;
  route: 'A' | 'B';
  startedAt: string;
  durationMs: number;
  observations: number;
  metrics: Metrics;
  metricsSource: Metrics;
  metricsAugmented: Metrics | null;
  checksumInvalid: { n: number; blocked: number };
  latency: LatencySummary;
  tierP50: { tier1: number | null; tier3a: number | null; tier2: number | null; tier3b: number | null };
  /** Of correctly blocked samples with expected categories, the share where one was detected. */
  categoryAgreement: number | null;
  byPath: Partial<Record<EnginePath, number>>;
  misclassified: { id: string; expect: string; predicted: string; types: string[] }[];
}

export type ScanFn = (input: ScanInput) => Promise<ScanResult>;

export function applyAdjudications(samples: BenchSample[], adj: Record<string, Adjudication>): BenchSample[] {
  return samples.map((s) => (adj[s.id] ? { ...s, expect: adj[s.id]!.expect, categories: adj[s.id]!.categories, note: `adjudicated: ${adj[s.id]!.reason}` } : s));
}

function observations(s: BenchSample): { id: string; input: ScanInput; expect: 'block' | 'allow' }[] {
  if (s.steps?.length) return s.steps.map((st, i) => ({ id: `${s.id}#${i + 1}`, input: { text: st.text, attachments: st.attachments ?? [] }, expect: st.expect }));
  return [{ id: s.id, input: { text: s.text, attachments: s.attachments ?? [] }, expect: s.expect }];
}

const latency = (xs: number[]): LatencySummary => ({
  p50: percentile(xs, 50),
  p95: percentile(xs, 95),
  p99: percentile(xs, 99),
  mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null,
});

export async function runBenchmark(
  dataset: DatasetId,
  route: 'A' | 'B',
  samples: BenchSample[],
  scan: ScanFn,
  onProgress?: (done: number, total: number) => void,
): Promise<{ summary: RunSummary; results: ObservationResult[] }> {
  const t0 = performance.now();
  const results: ObservationResult[] = [];
  const total = samples.reduce((n, s) => n + (s.steps?.length ?? 1), 0);
  for (const s of samples) {
    for (const o of observations(s)) {
      const res = await scan(o.input);
      const predicted = res.verdict;
      results.push({
        id: o.id,
        expect: o.expect,
        predicted,
        correct: predicted === o.expect,
        expectedCategories: o.expect === 'block' ? s.categories : [],
        detectedCategories: [...new Set(res.findings.map((f) => f.category))],
        paths: [...new Set(res.findings.map((f) => f.path))],
        findingTypes: [...new Set(res.findings.map((f) => f.type))],
        latencyMs: res.timings.total,
        tier: { tier1: res.timings.tier1, tier3a: res.timings.tier3a, tier2: res.timings.tier2, tier3b: res.timings.tier3b },
        route: res.tier2Route,
        augmented: !!s.augmented,
        checksumInvalid: !!s.checksumInvalid,
        ...(res.degradedReason ? { degraded: res.degradedReason } : {}),
      });
      onProgress?.(results.length, total);
    }
  }
  return { summary: summarise(dataset, route, results, performance.now() - t0), results };
}

function confusion(rs: ObservationResult[]): Confusion {
  const c: Confusion = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const r of rs) {
    if (r.expect === 'block') r.predicted === 'block' ? c.tp++ : c.fn++;
    else r.predicted === 'block' ? c.fp++ : c.tn++;
  }
  return c;
}

export function summarise(dataset: DatasetId, route: 'A' | 'B', results: ObservationResult[], durationMs: number): RunSummary {
  const aug = results.filter((r) => r.augmented);
  const src = results.filter((r) => !r.augmented);
  const inv = results.filter((r) => r.checksumInvalid);
  const blockedOk = results.filter((r) => r.expect === 'block' && r.predicted === 'block' && r.expectedCategories.length);
  const byPath: Partial<Record<EnginePath, number>> = {};
  for (const r of results) if (r.predicted === 'block') for (const p of r.paths) byPath[p] = (byPath[p] ?? 0) + 1;
  const tierP = (k: keyof ObservationResult['tier']) => percentile(results.map((r) => r.tier[k]), 50);
  return {
    dataset,
    route,
    startedAt: new Date().toISOString(),
    durationMs,
    observations: results.length,
    metrics: computeMetrics(confusion(results)),
    metricsSource: computeMetrics(confusion(src)),
    metricsAugmented: aug.length ? computeMetrics(confusion(aug)) : null,
    checksumInvalid: { n: inv.length, blocked: inv.filter((r) => r.predicted === 'block').length },
    latency: latency(results.map((r) => r.latencyMs)),
    tierP50: { tier1: tierP('tier1'), tier3a: tierP('tier3a'), tier2: tierP('tier2'), tier3b: tierP('tier3b') },
    categoryAgreement: blockedOk.length ? blockedOk.filter((r) => r.expectedCategories.some((c) => r.detectedCategories.includes(c))).length / blockedOk.length : null,
    byPath,
    misclassified: results.filter((r) => !r.correct).map((r) => ({ id: r.id, expect: r.expect, predicted: r.predicted, types: r.findingTypes })),
  };
}
