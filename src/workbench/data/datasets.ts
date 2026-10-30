// Lazy loaders for the benchmark datasets and the committed Node baseline. Files that are not
// present at build time (e.g. the gitignored AI4Privacy samples on a fresh clone) are reported
// as unavailable instead of failing the page.
import type { RunSummary } from '../../engine/bench/harness';
import { applyAdjudications } from '../../engine/bench/harness';
import { DATASETS, type Adjudication, type BenchSample, type DatasetId } from '../../engine/bench/types';

const files = import.meta.glob('/data/datasets/*.{json,jsonl}', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const baselineFile = import.meta.glob('/bench-results/path-a.json', { import: 'default' }) as Record<string, () => Promise<NodeBaseline>>;

export interface NodeBaseline {
  generatedAt: string;
  runtime: { kind: string; node: string; cpu: string; cores: number };
  route: 'A';
  engine: { fstEntries: number; fstBytes: number; edmVectors: number; edmFields: number; pathB: string };
  summaries: RunSummary[];
}

const recordedFile = import.meta.glob('/bench-results/browser-runs.json', { import: 'default' }) as Record<string, () => Promise<RecordedBrowserRuns>>;

/** Browser runs committed to the repo (bench-results/browser-runs.json) — shown when not re-run locally. */
export interface RecordedBrowserRuns {
  recordedAt: string;
  userAgent: string;
  hardware: { pathA: string; pathB: string };
  runs: Record<string, { summary: RunSummary; hardware: string; offRoute: number }>;
}

export async function loadRecordedRuns(): Promise<RecordedBrowserRuns | null> {
  const loader = recordedFile['/bench-results/browser-runs.json'];
  return loader ? loader() : null;
}

export function datasetAvailable(id: DatasetId): boolean {
  const ds = DATASETS.find((d) => d.id === id)!;
  return `/data/datasets/${ds.file}` in files;
}

export async function loadDataset(id: DatasetId): Promise<BenchSample[]> {
  const ds = DATASETS.find((d) => d.id === id)!;
  const loader = files[`/data/datasets/${ds.file}`];
  if (!loader) throw new Error(`${ds.file} not present — run "npm run data:datasets"`);
  const raw = await loader();
  let samples = ds.file.endsWith('.json') ? (JSON.parse(raw) as BenchSample[]) : raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as BenchSample);
  if (id.startsWith('enron')) {
    const adj = files['/data/datasets/enron-adjudications.json'];
    if (adj) samples = applyAdjudications(samples, JSON.parse(await adj()) as Record<string, Adjudication>);
  }
  return samples;
}

export async function loadBaseline(): Promise<NodeBaseline | null> {
  const loader = baselineFile['/bench-results/path-a.json'];
  return loader ? loader() : null;
}
