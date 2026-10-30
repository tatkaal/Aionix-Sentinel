import { create } from 'zustand';
import { runBenchmark, type RunSummary } from '../../engine/bench/harness';
import type { DatasetId } from '../../engine/bench/types';
import { mergeAsync, scanSync } from '../../engine/pipeline';
import type { ScanResult } from '../../engine/types';
import { loadBaseline, loadDataset, loadRecordedRuns, type NodeBaseline, type RecordedBrowserRuns } from '../data/datasets';
import { useEngine } from './engine';

export type Route = 'A' | 'B';

export interface BrowserRun {
  summary: RunSummary;
  hardware: string;
  /** Observations whose Tier 2 actually ran on a different route (e.g. Path B degraded). */
  offRoute: number;
}

const KEY = 'aionix.workbench.bench.v1';

function loadRuns(): Record<string, BrowserRun> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, BrowserRun>;
  } catch {
    return {};
  }
}

function saveRuns(runs: Record<string, BrowserRun>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(runs));
  } catch {
    /* storage unavailable — results stay in memory */
  }
}

interface BenchState {
  runs: Record<string, BrowserRun>;
  running: { dataset: DatasetId; route: Route; done: number; total: number } | null;
  error: string | null;
  baseline: NodeBaseline | null;
  /** Committed browser runs (bench-results/browser-runs.json), used when a run is not in this browser. */
  recorded: RecordedBrowserRuns | null;
  loadBaseline(): Promise<void>;
  run(dataset: DatasetId, route: Route): Promise<void>;
  runMany(datasets: DatasetId[], route: Route): Promise<void>;
  clear(): void;
}

export const runKey = (dataset: DatasetId, route: Route) => `${dataset}:${route}`;

export const useBench = create<BenchState>((set, get) => ({
  runs: loadRuns(),
  running: null,
  error: null,
  baseline: null,
  recorded: null,
  async loadBaseline() {
    if (get().baseline) return;
    const [baseline, recorded] = await Promise.all([loadBaseline(), loadRecordedRuns()]);
    set({ baseline, recorded });
  },
  async run(dataset, route) {
    if (get().running) return;
    set({ error: null, running: { dataset, route, done: 0, total: 0 } });
    const engine = useEngine.getState();
    const previousMode = engine.routeMode;
    try {
      await engine.init();
      await engine.refresh();
      const before = useEngine.getState().status;
      // Never trigger the ~0.8–0.9 GB Path B download implicitly from a benchmark run.
      if (route === 'B' && before?.pathBState !== 'ready') {
        throw new Error(`Path B is ${before?.pathBState ?? 'unavailable'} — ${before?.pathBReason ?? 'load the WebGPU model first'}`);
      }
      await engine.applyRoute(route === 'B' ? 'force-b' : 'force-a');
      const samples = await loadDataset(dataset);
      const { tier3a, strictScanner: asyncScanner } = useEngine.getState();
      if (!asyncScanner) throw new Error('Engine worker not ready');
      let offRoute = 0;
      const scan = async (input: Parameters<typeof scanSync>[0]): Promise<ScanResult> => {
        const t0 = performance.now();
        const sync = scanSync(input, tier3a);
        const asyncPart = await asyncScanner.scanAsync(input);
        if (asyncPart.tier2Route !== route) offRoute++;
        return mergeAsync(sync, asyncPart, performance.now() - t0);
      };
      const { summary } = await runBenchmark(dataset, route, samples, scan, (done, total) => set({ running: { dataset, route, done, total } }));
      const hw = useEngine.getState().status;
      const hardware = route === 'B' ? (hw?.pathBModel ?? 'WebGPU') + ' · ' + (hw?.adapterSummary ?? '') : `ONNX Runtime wasm (CPU) · ${navigator.hardwareConcurrency} logical cores`;
      const runs = { ...get().runs, [runKey(dataset, route)]: { summary, hardware, offRoute } };
      saveRuns(runs);
      set({ runs });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      await useEngine.getState().applyRoute(previousMode);
      set({ running: null });
    }
  },
  async runMany(datasets, route) {
    for (const d of datasets) {
      await get().run(d, route);
      if (get().error) break;
    }
  },
  clear() {
    saveRuns({});
    set({ runs: {} });
  },
}));

/** A run from this browser if present, else the committed recording; labelled with its provenance. */
export function resolveRun(dataset: DatasetId, route: Route): { summary: RunSummary; source: 'local' | 'recorded'; hardware: string } | null {
  const { runs, recorded } = useBench.getState();
  const local = runs[runKey(dataset, route)];
  if (local) return { summary: local.summary, source: 'local', hardware: local.hardware };
  const rec = recorded?.runs[runKey(dataset, route)];
  return rec ? { summary: rec.summary, source: 'recorded', hardware: rec.hardware } : null;
}
