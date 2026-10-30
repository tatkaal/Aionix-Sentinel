import { useEffect, useMemo, useState } from 'react';
import type { RunSummary } from '../../../engine/bench/harness';
import { DATASETS, type DatasetId } from '../../../engine/bench/types';
import { PATH_LABELS, type EnginePath } from '../../../engine/types';
import { BarList, ConfusionMatrix, PairedBars, SERIES } from '../../components/charts';
import { Badge, Button, EmptyState, Panel, Stat, WorkspaceHeader, cx, formatMs, formatPct } from '../../components/ui';
import { datasetAvailable } from '../../data/datasets';
import { downloadBlob } from '../../lib/download';
import { RELEASE_GATE_YAML } from '../../lib/release-gate';
import { runKey, useBench, type Route } from '../../state/bench';
import { useEngine } from '../../state/engine';

/** Blueprint targets — displayed as targets only, never as results. */
export const TARGETS = { f2: 0.978, fpr: 0.0002 };

const f3 = (v: number | null) => (v === null ? '—' : v.toFixed(3));

function splitBadge(split: string) {
  if (split === 'holdout') return <Badge tone="emerald">held-out</Badge>;
  if (split === 'dev') return <Badge tone="amber">dev · tuned on</Badge>;
  return <Badge tone="brand">curated</Badge>;
}

function PathStatus() {
  const { status, loadPathB, error } = useEngine();
  const [busy, setBusy] = useState(false);
  const hw = status?.hardware;
  const state = status?.pathBState ?? 'idle';
  const tone = state === 'ready' ? 'emerald' : state === 'loading' ? 'brand' : state === 'unavailable' || state === 'failed' || state === 'evicted' ? 'amber' : 'neutral';
  return (
    <Panel title="Hardware & Tier 2 paths" subtitle="Both paths run the same proximity graph and MiniLM validator; they differ in how PERSON nodes are found.">
      <div className="grid gap-6 md:grid-cols-2 md:divide-x md:divide-hairline">
        <div className="space-y-3 md:pr-6">
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: SERIES.a }} />
            <h3 className="font-display text-sm font-semibold">Path A · Lexicon-automata (CPU)</h3>
            <Badge tone={status?.pathAReady ? 'emerald' : 'neutral'}>{status?.pathAReady ? 'ready' : 'starting'}</Badge>
          </div>
          <p className="text-[13px] text-muted">ICD-10-CM + RxNorm FST, curated name / financial lexicons, MiniLM-L6 INT8 context validator on ONNX Runtime wasm.</p>
          <dl className="grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <dt className="text-subtle">FST entries</dt>
              <dd className="metric">{status ? status.fstEntries.toLocaleString() : '—'}</dd>
            </div>
            <div>
              <dt className="text-subtle">FST size</dt>
              <dd className="metric">{status ? `${(status.fstBytes / 1048576).toFixed(2)} MB` : '—'}</dd>
            </div>
            <div>
              <dt className="text-subtle">Cold start</dt>
              <dd className="metric">{status?.loadMs.pathA ? `${formatMs(status.loadMs.pathA, 0)} ms` : '—'}</dd>
            </div>
            <div>
              <dt className="text-subtle">EDM index</dt>
              <dd className="metric">{status ? `${status.edmVectors} vec · ${status.edmFields} fields` : '—'}</dd>
            </div>
          </dl>
        </div>
        <div className="space-y-3 md:pl-6">
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: SERIES.b }} />
            <h3 className="font-display text-sm font-semibold">Path B · openai/privacy-filter (WebGPU)</h3>
            <Badge tone={tone}>{state}</Badge>
          </div>
          <p className="text-[13px] text-muted">{status?.pathBReason ?? 'Probing hardware…'}</p>
          <dl className="grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <dt className="text-subtle">Adapter</dt>
              <dd className="truncate">{status?.adapterSummary ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-subtle">Storage binding</dt>
              <dd className="metric">{hw?.webgpu ? `${(hw.maxStorageBufferBindingSize / 1048576).toFixed(0)} MB` : '—'}</dd>
            </div>
            <div>
              <dt className="text-subtle">Quantisation</dt>
              <dd className="metric">{hw?.webgpu ? `${hw.dtype}${hw.shaderF16 ? ' (shader-f16)' : ''}` : '—'}</dd>
            </div>
            <div>
              <dt className="text-subtle">Load time</dt>
              <dd className="metric">{status?.loadMs.pathB ? `${(status.loadMs.pathB / 1000).toFixed(1)} s` : '—'}</dd>
            </div>
          </dl>
          {state === 'loading' && status?.pathBProgress != null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-graphite-2" role="progressbar" aria-valuenow={Math.round(status.pathBProgress * 100)}>
              <div className="h-full rounded-full" style={{ width: `${status.pathBProgress * 100}%`, background: SERIES.b }} />
            </div>
          )}
          {(state === 'idle' || state === 'failed' || state === 'evicted') && hw?.webgpu && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void loadPathB().finally(() => setBusy(false));
                }}
              >
                Load WebGPU model
              </Button>
              <span className="text-xs text-subtle">Downloads ~0.8–0.9 GB of weights once; cached by the browser.</span>
            </div>
          )}
          {error && <p className="text-xs text-[#FCA5A5]">{error}</p>}
        </div>
      </div>
    </Panel>
  );
}

function summaryOf(dataset: DatasetId, route: Route): RunSummary | null {
  return useBench.getState().runs[runKey(dataset, route)]?.summary ?? null;
}

export function BenchmarksView() {
  const bench = useBench();
  const engine = useEngine();
  const [selected, setSelected] = useState<DatasetId>('edge');

  useEffect(() => {
    void engine.init();
    void bench.loadBaseline();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pathBReady = engine.status?.pathBState === 'ready';
  const a = bench.runs[runKey(selected, 'A')]?.summary ?? null;
  const b = bench.runs[runKey(selected, 'B')]?.summary ?? null;
  const ci = bench.baseline?.summaries.find((s) => s.dataset === selected) ?? null;
  const ds = DATASETS.find((d) => d.id === selected)!;
  const available = DATASETS.filter((d) => datasetAvailable(d.id)).map((d) => d.id);

  const rows = useMemo(
    () => [
      { key: 'p', label: 'Precision', a: a?.metrics.precision ?? null, b: b?.metrics.precision ?? null },
      { key: 'r', label: 'Recall', a: a?.metrics.recall ?? null, b: b?.metrics.recall ?? null },
      { key: 'f1', label: 'F1', a: a?.metrics.f1 ?? null, b: b?.metrics.f1 ?? null },
      { key: 'f2', label: 'F2', a: a?.metrics.f2 ?? null, b: b?.metrics.f2 ?? null, target: { value: TARGETS.f2, label: `F2 ≥ ${TARGETS.f2}` } },
      { key: 'acc', label: 'Accuracy', a: a?.metrics.accuracy ?? null, b: b?.metrics.accuracy ?? null },
    ],
    [a, b],
  );

  const exportResults = () =>
    downloadBlob(
      `aionix-benchmarks-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), browserRuns: bench.runs, nodeBaseline: bench.baseline }, null, 2),
      'application/json',
    );

  return (
    <>
      <WorkspaceHeader
        eyebrow="Evaluation lab"
        title="Dataset Benchmarks"
        description="The shipping 3-tier engine runs against Enron, Presidio, AI4Privacy and the 24 stakeholder edge cases on Tier 2 Path A and Path B. Every number below comes from an actual run."
        actions={
          <>
            <Button size="sm" onClick={() => downloadBlob('release-gate.yml', RELEASE_GATE_YAML, 'text/yaml')}>
              Export release-gate YAML
            </Button>
            <Button size="sm" onClick={exportResults}>
              Export results JSON
            </Button>
          </>
        }
      />

      <div className="mb-6 rounded-xl border border-amber/30 bg-amber/[0.06] px-4 py-3 text-[13px] text-[#FCD34D]">
        <strong className="font-semibold">Read held-out numbers.</strong> Dev splits were used for error analysis while the rules were developed, so their scores
        are optimistic. Held-out splits were drawn from different offsets and never inspected. Blueprint figures (F2 ≥ {TARGETS.f2}, FPR &lt;{' '}
        {(TARGETS.fpr * 100).toFixed(2)}%) are shown only as targets.
      </div>

      <div className="mb-6">
        <PathStatus />
      </div>

      <Panel
        className="mb-6"
        title="Datasets"
        subtitle="Runs execute in the Workbench engine worker (same modules as the offscreen document). CI baseline = npm run bench on Node."
        actions={
          <>
            <Button size="sm" variant="secondary" disabled={!!bench.running} onClick={() => void bench.runMany(available, 'A')}>
              Run all · Path A
            </Button>
            <Button size="sm" variant="secondary" disabled={!!bench.running || !pathBReady} onClick={() => void bench.runMany(available, 'B')}>
              Run all · Path B
            </Button>
          </>
        }
        bodyClassName="p-0"
      >
        {bench.running && (
          <div className="border-b border-hairline px-4 py-3 sm:px-5">
            <div className="mb-1.5 flex justify-between text-xs text-muted">
              <span>
                Running {DATASETS.find((d) => d.id === bench.running!.dataset)?.label} on Path {bench.running.route}
              </span>
              <span className="metric">
                {bench.running.done} / {bench.running.total || '…'}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-graphite-2">
              <div className="h-full rounded-full transition-[width]" style={{ width: `${bench.running.total ? (bench.running.done / bench.running.total) * 100 : 3}%`, background: bench.running.route === 'A' ? SERIES.a : SERIES.b }} />
            </div>
          </div>
        )}
        {bench.error && <p className="border-b border-hairline px-5 py-2.5 text-[13px] text-[#FCA5A5]">{bench.error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="text-xs text-subtle">
              <tr className="border-b border-hairline">
                <th className="px-5 py-2.5 font-medium">Dataset</th>
                <th className="px-3 py-2.5 font-medium">Split</th>
                <th className="px-3 py-2.5 text-right font-medium">CI F2 / FPR</th>
                <th className="px-3 py-2.5 text-right font-medium">Path A F2 / FPR</th>
                <th className="px-3 py-2.5 text-right font-medium">Path B F2 / FPR</th>
                <th className="px-5 py-2.5 text-right font-medium">Run</th>
              </tr>
            </thead>
            <tbody>
              {DATASETS.map((d) => {
                const has = datasetAvailable(d.id);
                const sa = summaryOf(d.id, 'A');
                const sb = summaryOf(d.id, 'B');
                const sc = bench.baseline?.summaries.find((s) => s.dataset === d.id);
                const cell = (s: RunSummary | null | undefined) => (s ? `${f3(s.metrics.f2)} / ${formatPct(s.metrics.fpr, 2)}` : '—');
                return (
                  <tr
                    key={d.id}
                    className={cx('cursor-pointer border-b border-hairline last:border-0 hover:bg-white/[0.02]', selected === d.id && 'bg-luminous/[0.06]')}
                    onClick={() => setSelected(d.id)}
                  >
                    <td className="px-5 py-3">
                      <div className={cx('font-medium', selected === d.id ? 'text-luminous' : 'text-alabaster')}>{d.label}</div>
                      <div className="text-xs text-subtle">{has ? d.focus : 'Not present in this build — run npm run data:datasets'}</div>
                    </td>
                    <td className="px-3 py-3">{splitBadge(d.split)}</td>
                    <td className="metric px-3 py-3 text-right text-muted">{cell(sc)}</td>
                    <td className="metric px-3 py-3 text-right">{cell(sa)}</td>
                    <td className="metric px-3 py-3 text-right">{cell(sb)}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" disabled={!has || !!bench.running} onClick={(e) => (e.stopPropagation(), void bench.run(d.id, 'A'))}>
                        Path A
                      </Button>
                      <Button size="sm" variant="ghost" disabled={!has || !!bench.running || !pathBReady} onClick={(e) => (e.stopPropagation(), void bench.run(d.id, 'B'))}>
                        Path B
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-bold">{ds.label}</h2>
        <span className="text-xs text-subtle">{ds.source}</span>
      </div>

      {!a && !b && !ci ? (
        <Panel>
          <EmptyState title="No runs for this dataset yet">Run it on Path A (and Path B once the WebGPU model is loaded).</EmptyState>
        </Panel>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Path A vs Path B" subtitle="Document-level metrics; positive = must block. White tick = blueprint target.">
            <PairedBars rows={rows} format={(v) => (v === null ? '—' : v.toFixed(3))} />
          </Panel>
          <Panel title="Confusion matrices & latency">
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                ['Path A', a],
                ['Path B', b],
              ] as [string, RunSummary | null][]).map(([label, s]) => {
                const sum = s as RunSummary | null;
                return (
                  <div key={label as string} className="min-w-0">
                    {sum ? (
                      <>
                        <ConfusionMatrix {...sum.metrics} caption={`${label} · n=${sum.observations}`} />
                        <dl className="mt-3 grid grid-cols-3 gap-2">
                          <Stat label="p50" value={formatMs(sum.latency.p50)} unit="ms" />
                          <Stat label="p95" value={formatMs(sum.latency.p95)} unit="ms" />
                          <Stat label="p99" value={formatMs(sum.latency.p99)} unit="ms" />
                        </dl>
                        <p className="mt-2 text-xs text-subtle">
                          FPR {formatPct(sum.metrics.fpr, 2)} · Tier 2 p50 {formatMs(sum.tierP50.tier2)} ms · Tier 3B p50 {formatMs(sum.tierP50.tier3b)} ms
                          {useBench.getState().runs[runKey(selected, label === 'Path A' ? 'A' : 'B')]?.offRoute ? ' · some observations degraded to Path A' : ''}
                        </p>
                      </>
                    ) : (
                      <p className="py-8 text-center text-xs text-subtle">{label} not run{label === 'Path B' && !pathBReady ? ' — WebGPU model not loaded' : ''}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
          <Panel title="Detections by engine path" subtitle="Blocked observations per route that contributed a finding (Path A run).">
            <BarList
              items={(Object.entries(a?.byPath ?? ci?.byPath ?? {}) as [EnginePath, number][]).map(([k, v]) => ({ key: k, label: PATH_LABELS[k], value: v }))}
              empty="Run Path A to see per-route detections."
            />
          </Panel>
          <Panel title="Misclassified observations" subtitle="Ids only — text stays in the dataset files.">
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                ['Path A', a ?? ci],
                ['Path B', b],
              ] as [string, RunSummary | null][]).map(([label, s]) => {
                const sum = s as RunSummary | null;
                return (
                  <div key={label as string} className="min-w-0">
                    <h3 className="mb-2 text-xs font-medium text-muted">
                      {label as string} {!a && label === 'Path A' && ci ? '(CI baseline)' : ''}
                    </h3>
                    {!sum ? (
                      <p className="text-xs text-subtle">—</p>
                    ) : sum.misclassified.length === 0 ? (
                      <p className="text-xs text-[#6EE7B7]">None</p>
                    ) : (
                      <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                        {sum.misclassified.map((m) => (
                          <li key={m.id} className="flex items-center gap-2 text-xs">
                            <Badge tone={m.expect === 'block' ? 'crimson' : 'amber'}>{m.expect === 'block' ? 'FN' : 'FP'}</Badge>
                            <span className="metric truncate text-muted">{m.id}</span>
                            <span className="truncate text-subtle">{m.types.join(', ')}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      )}
      {bench.baseline && (
        <p className="mt-4 text-xs text-subtle">
          CI baseline: {bench.baseline.runtime.kind} {bench.baseline.runtime.node} · {bench.baseline.runtime.cpu} · generated {new Date(bench.baseline.generatedAt).toLocaleString()} · Tier 2 Path A
          only (no WebGPU in Node).
        </p>
      )}
    </>
  );
}
