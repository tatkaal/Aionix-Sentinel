import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { RunSummary } from '../../../engine/bench/harness';
import { DATASETS, type DatasetId } from '../../../engine/bench/types';
import { AionixLogo } from '../../../shared/brand/AionixLogo';
import { SERIES } from '../../components/charts';
import { Button, cx, formatMs, formatPct } from '../../components/ui';
import { downloadBlob } from '../../lib/download';
import { resolveRun, useBench } from '../../state/bench';
import { useEngine } from '../../state/engine';
import { TARGETS } from '../benchmarks/BenchmarksView';

const f3 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(3));

interface Row {
  id: DatasetId;
  label: string;
  split: string;
  a: RunSummary | null;
  aSource: Source;
  b: RunSummary | null;
  bSource: Source;
}

type Source = 'browser' | 'recorded' | 'CI' | null;
const sourceOf = (r: ReturnType<typeof resolveRun>): Source => (r ? ({ local: 'browser', recorded: 'recorded', ci: 'CI' } as const)[r.source] : null);
const SOURCE_TEXT = { browser: 'runs in this browser', recorded: 'the recorded Workbench run', CI: 'the Node CI run' } as const;

function useRows(): Row[] {
  // Subscribe so the deck re-renders when runs, recordings or CI baselines change.
  useBench((st) => st.runs);
  useBench((st) => st.recorded);
  useBench((st) => st.baseline);
  useBench((st) => st.baselineB);
  return DATASETS.map((d) => {
    const ra = resolveRun(d.id, 'A');
    const rb = resolveRun(d.id, 'B');
    return { id: d.id, label: d.label, split: d.split, a: ra?.summary ?? null, aSource: sourceOf(ra), b: rb?.summary ?? null, bSource: sourceOf(rb) };
  });
}

function Slide({ n, title, kicker, children }: { n: number; title: string; kicker?: string; children: ReactNode }) {
  return (
    <section className="relative flex aspect-video w-full flex-col overflow-hidden rounded-xl border border-hairline bg-graphite p-[4%] print:mb-0 print:break-after-page print:rounded-none print:border-0">
      <header className="mb-[2.5%] flex items-center gap-3">
        <AionixLogo className="h-[clamp(14px,2.2vw,26px)] w-auto" />
        <span className="font-display text-[clamp(10px,1.1vw,14px)] font-semibold text-muted">Aionix Sentinel</span>
        <span className="metric ml-auto text-[clamp(10px,1vw,13px)] text-subtle">{String(n).padStart(2, '0')} / 08</span>
      </header>
      {kicker && <p className="metric text-[clamp(9px,1vw,13px)] text-luminous">{kicker}</p>}
      <h2 className="mb-[2%] font-display text-[clamp(16px,2.6vw,34px)] font-bold tracking-tight text-alabaster">{title}</h2>
      <div className="min-h-0 flex-1 text-[clamp(10px,1.15vw,15px)] leading-relaxed text-muted">{children}</div>
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-graphite-2 p-[6%]">
      <div className="text-[0.85em] text-subtle">{label}</div>
      <div className="metric mt-1 text-[1.9em] font-semibold text-alabaster">{value}</div>
      {note && <div className="mt-0.5 text-[0.8em] text-subtle">{note}</div>}
    </div>
  );
}

function FlowDiagram() {
  const box = (x: number, y: number, w: number, h: number, title: string, sub: string, accent = false) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={accent ? 'rgba(149,83,251,0.12)' : '#181B2C'} stroke={accent ? 'rgba(149,83,251,0.55)' : 'rgba(255,255,255,0.12)'} />
      <text x={x + 14} y={y + 26} fill="#F8FAFC" fontSize="15" fontWeight="600" fontFamily="'Plus Jakarta Sans Variable', sans-serif">
        {title}
      </text>
      <text x={x + 14} y={y + 46} fill="#A1A9BC" fontSize="12" fontFamily="'DM Sans Variable', sans-serif">
        {sub}
      </text>
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6E768C" strokeWidth={1.5} markerEnd="url(#arr)" />;
  return (
    <svg viewBox="0 0 960 300" className="h-auto w-full" role="img" aria-label="Inspection flow: content script runs Tier 1 and Tier 3A synchronously, the offscreen document runs Tier 2 and Tier 3B, then the send is allowed or blocked.">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 10 5 0 10z" fill="#6E768C" />
        </marker>
      </defs>
      <text x="20" y="22" fill="#6E768C" fontSize="12">Isolated-world content script · synchronous</text>
      <text x="520" y="22" fill="#6E768C" fontSize="12">Offscreen document · asynchronous</text>
      {box(20, 40, 150, 64, 'Send / Enter', 'capture-phase hook')}
      {box(200, 40, 140, 64, 'Tier 1', 'checksums · entropy')}
      {box(370, 40, 120, 64, 'Tier 3 · A', 'MinHash + Bloom')}
      {box(520, 40, 200, 64, 'Tier 2 · route A or B', 'FST + MiniLM | tagger', true)}
      {box(750, 40, 190, 64, 'Tier 3 · B', 'Orama EDM + row hashes')}
      {arrow(170, 72, 198, 72)}
      {arrow(340, 72, 368, 72)}
      {arrow(490, 72, 518, 72)}
      {arrow(720, 72, 748, 72)}
      {box(200, 180, 290, 64, 'High risk found → block', 'Shadow DOM drawer · redact / remove chip')}
      {box(560, 180, 380, 64, 'Clean → re-dispatch send', 'verified digest lets the MAIN-world fetch through')}
      {arrow(430, 104, 345, 178)}
      {arrow(845, 104, 750, 178)}
      <text x="20" y="282" fill="#6E768C" fontSize="12">
        A MAIN-world fetch / XHR backstop re-scans any prompt body the content script did not verify.
      </text>
    </svg>
  );
}

export function PresentationView() {
  const [i, setI] = useState(0);
  const rows = useRows();
  const bench = useBench();
  const { status, tier3a, init } = useEngine();

  useEffect(() => {
    void init();
    void bench.loadBaseline();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setI((x) => Math.min(7, x + 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const edge = rows.find((r) => r.id === 'edge');
  const edgeCorrect = edge?.a ? edge.a.metrics.tp + edge.a.metrics.tn : null;
  const heldEnron = rows.find((r) => r.id === 'enron-holdout')?.a;
  const heldAi4p = rows.find((r) => r.id === 'ai4privacy-holdout')?.a;
  const tierP50 = useMemo(() => {
    const s = rows.find((r) => r.id === 'ai4privacy')?.a ?? rows.find((r) => r.id === 'presidio')?.a;
    return s?.tierP50 ?? null;
  }, [rows]);
  const vaultBytes = tier3a?.assets.reduce((n, a) => n + a.bloom.bits.length + 256, 0) ?? 0;

  const slides: ReactNode[] = [
    <section key="title" className="relative flex aspect-video w-full flex-col justify-between overflow-hidden rounded-xl border border-hairline bg-graphite p-[5%] print:break-after-page print:rounded-none print:border-0">
      <AionixLogo className="h-[clamp(36px,6vw,84px)] w-auto self-start" />
      <div>
        <p className="metric mb-2 text-[clamp(10px,1.2vw,15px)] text-luminous">Executive briefing</p>
        <h1 className="font-display text-[clamp(26px,4.6vw,64px)] leading-[1.05] font-bold tracking-tight text-alabaster">Aionix Sentinel</h1>
        <p className="mt-3 max-w-[70%] text-[clamp(12px,1.6vw,22px)] text-muted">
          Enterprise AI prompt guard: a Manifest V3 extension with a hardware-aware, 3-tier local DLP engine for Claude, ChatGPT and Gemini.
        </p>
      </div>
      <p className="text-[clamp(9px,1vw,13px)] text-subtle">
        {new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} · figures bound to live Workbench runs
      </p>
    </section>,
    <Slide key="achieved" n={2} kicker="What has been achieved" title="Inspection that never leaves the browser">
      <div className="grid h-full grid-cols-[1.1fr_1fr] gap-[4%]">
        <ul className="list-disc space-y-[2%] pl-5">
          <li>MV3 extension protecting Claude, ChatGPT and Gemini, with a MAIN-world network backstop.</li>
          <li>10 risk categories across three tiers; all inference runs locally with zero remote code.</li>
          <li>One-click redaction, single-item redaction and automatic unblock when a flagged attachment chip is removed.</li>
          <li>Zero-knowledge telemetry: categories, routes, latency and salted fingerprints only.</li>
          <li>Benchmark lab on four corpora, with held-out splits that were never used for tuning.</li>
        </ul>
        <div className="grid grid-cols-2 gap-[5%] self-start">
          <Tile label="Edge cases passed" value={edgeCorrect != null ? `${edgeCorrect}/${edge!.a!.observations}` : '—'} note={edge?.aSource ? `${edge.aSource} run · 24 scenarios` : 'not yet run'} />
          <Tile label="Held-out Enron FPR" value={formatPct(heldEnron?.metrics.fpr, 2)} note={`target < ${(TARGETS.fpr * 100).toFixed(2)}%`} />
          <Tile label="Medical FST" value={status ? status.fstEntries.toLocaleString() : '—'} note={status ? `${(status.fstBytes / 1048576).toFixed(1)} MB · ICD-10-CM + RxNorm` : undefined} />
          <Tile label="Held-out AI4Privacy F2" value={f3(heldAi4p?.metrics.f2)} note={`target ≥ ${TARGETS.f2}`} />
        </div>
      </div>
    </Slide>,
    <Slide key="engine" n={3} kicker="How the 3-tier engine works" title="Synchronous math first, models only when needed">
      <FlowDiagram />
      <p className="mt-[2%]">
        Measured p50 per tier on the AI4Privacy run (Tier 2 exits early when no person is named, so its median is tiny; with a person and a sensitive term it runs the MiniLM validator): Tier 1 <span className="metric text-alabaster">{formatMs(tierP50?.tier1)} ms</span> · Tier 3A{' '}
        <span className="metric text-alabaster">{formatMs(tierP50?.tier3a)} ms</span> · Tier 2 <span className="metric text-alabaster">{formatMs(tierP50?.tier2)} ms</span> · Tier 3B{' '}
        <span className="metric text-alabaster">{formatMs(tierP50?.tier3b)} ms</span>.
      </p>
    </Slide>,
    <Slide key="tier2" n={4} kicker="Two Tier 2 paths" title="Lexicon automata and a compact neural tagger, both on the CPU">
      <div className="grid h-full grid-cols-2 gap-[4%]">
        <div>
          <h3 className="mb-1 flex items-center gap-2 font-display font-semibold text-alabaster">
            <span className="inline-block size-3 rounded-sm" style={{ background: SERIES.a }} /> Path A · CPU
          </h3>
          <p>ICD-10-CM and RxNorm compiled into a minimal FST walked without allocation; a 30-token person ↔ condition graph; a MiniLM-L6 INT8 validator separating records from general questions.</p>
          <h3 className="mt-[4%] mb-1 flex items-center gap-2 font-display font-semibold text-alabaster">
            <span className="inline-block size-3 rounded-sm" style={{ background: SERIES.b }} /> Path B · neural tagger
          </h3>
          <p>A multilingual MiniLM token classifier (vocabulary trimmed to 30k pieces, INT8) trained on permissively licensed synthetic PII. It finds names, record IDs and account numbers in any of its languages; the same graph and validator decide. It replaced openai/privacy-filter, which needed ~1 GB of host memory.</p>
        </div>
        <div className="space-y-[3%]">
          <Tile label="Path B model" value={status?.pathBModel ? status.pathBModel.split(' (')[0]! : '—'} note={status?.pathBReason} />
          <div className="grid grid-cols-2 gap-[5%]">
            <Tile label="Route in use" value={status ? `Path ${status.route}` : '—'} note={status?.pathBState ? `Path B ${status.pathBState}` : undefined} />
            <Tile label="Engine memory" value={status?.memoryMB != null ? `${status.memoryMB.toFixed(0)} MB` : '—'} note={`ceiling 150 MB · ${status?.memoryMethod ?? ''}`} />
          </div>
        </div>
      </div>
    </Slide>,
    <Slide key="vault" n={5} kicker="Tier 3 · corporate vault" title="Copy-paste of proprietary text is caught by fingerprint, not keyword">
      <div className="grid grid-cols-[1.2fr_1fr] gap-[4%]">
        <ul className="list-disc space-y-[2%] pl-5">
          <li>
            <span className="text-alabaster">Path A, MinHash + Bloom.</span> 5-gram shingles probed per asset; a block needs ≥ 10 consecutive hits, so a 15-line excerpt is caught while a shared phrase is not.
          </li>
          <li>
            <span className="text-alabaster">Path B, exact data match.</span> MiniLM vectors in an Orama index (cosine &gt; 0.95) plus salted SHA-256 hashes of CRM and registry fields.
          </li>
          <li>Only Bloom bits, MinHash minima, vectors and salted hashes ship — never the documents.</li>
        </ul>
        <div className="grid grid-cols-2 gap-[5%] self-start">
          <Tile label="Assets indexed" value={tier3a ? tier3a.assets.length : '—'} note="fictional demo assets" />
          <Tile label="Fingerprint index" value={vaultBytes ? `${(vaultBytes / 1024).toFixed(1)} KB` : '—'} />
          <Tile label="EDM vectors" value={status?.edmVectors ?? '—'} />
          <Tile label="Salted field hashes" value={status?.edmFields ?? '—'} />
        </div>
      </div>
    </Slide>,
    <Slide key="safety" n={6} kicker="Attachment chips & memory safety" title="Large pastes, hidden requests and memory limits are handled explicitly">
      <div className="grid grid-cols-3 gap-[3%]">
        {[
          ['Attachment shadow store', 'Pastes ≥ 1,200 characters are captured before the portal turns them into pasted-content.txt chips, scanned with the composer, and outlined if flagged. Removing the chip lifts the block automatically.'],
          ['Network backstop', 'A MAIN-world fetch / XHR wrapper only lets prompt bodies the content script verified through; anything else gets a Tier 1 scan before reaching the network.'],
          ['Memory governor', 'Offscreen ceiling 150 MB (warn at 105 MB). Readings are measured, with the method labelled. Path B is evicted to Path A if the steady-state host footprint exceeds the ceiling.'],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg border border-hairline bg-graphite-2 p-[6%]">
            <h3 className="mb-1 font-display font-semibold text-alabaster">{t}</h3>
            <p>{d}</p>
          </div>
        ))}
      </div>
    </Slide>,
    <Slide key="results" n={7} kicker="Benchmark results" title="Measured on four corpora — held-out splits are the honest view">
      <table className="w-full text-left text-[0.92em]">
        <thead className="text-subtle">
          <tr className="border-b border-hairline">
            <th className="py-[0.6%] font-medium">Dataset</th>
            <th className="font-medium">Split</th>
            <th className="text-right font-medium">n</th>
            <th className="text-right font-medium">Precision</th>
            <th className="text-right font-medium">Recall</th>
            <th className="text-right font-medium">F2 · A</th>
            <th className="text-right font-medium">F2 · B</th>
            <th className="text-right font-medium">FPR · A</th>
            <th className="text-right font-medium">FPR · B</th>
            <th className="text-right font-medium">p95 · A</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-hairline">
              <td className="py-[0.6%] text-alabaster">{r.label}</td>
              <td className={cx(r.split === 'holdout' ? 'text-[#6EE7B7]' : 'text-subtle')}>{r.split === 'dev' ? 'dev (tuned on)' : r.split}</td>
              <td className="metric text-right">{r.a?.observations ?? '—'}</td>
              <td className="metric text-right">{f3(r.a?.metrics.precision)}</td>
              <td className="metric text-right">{f3(r.a?.metrics.recall)}</td>
              <td className="metric text-right text-alabaster">{f3(r.a?.metrics.f2)}</td>
              <td className="metric text-right text-alabaster">{f3(r.b?.metrics.f2)}</td>
              <td className="metric text-right">{formatPct(r.a?.metrics.fpr, 2)}</td>
              <td className="metric text-right">{formatPct(r.b?.metrics.fpr, 2)}</td>
              <td className="metric text-right">{formatMs(r.a?.latency.p95)} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-[1.5%] text-[0.85em] text-subtle">
        Design targets from the original plan: F2 ≥ {TARGETS.f2}, FPR &lt; {(TARGETS.fpr * 100).toFixed(2)}%. Path A figures come from {SOURCE_TEXT[rows.find((r) => r.aSource)?.aSource ?? 'CI']}; Path B figures from {SOURCE_TEXT[rows.find((r) => r.bSource)?.bSource ?? 'CI']}, routed strictly to the tagger.
      </p>
    </Slide>,
    <Slide key="future" n={8} kicker="Future scope" title="Keeping pace with the portals and the enterprise">
      <div className="grid grid-cols-3 gap-[2.5%] text-[0.92em]">
        {[
          ['12-hour live DOM canary bots', 'Playwright drives authenticated test tenants of Claude, ChatGPT and Gemini every 12 hours and alerts when a composer selector, send button, chip container or endpoint drifts.'],
          ['MDM dictionary sync', 'Push vault fingerprints, EDM row hashes, lexicon additions and gate thresholds through Chrome managed storage, so policy updates without republishing the extension.'],
          ['Multilingual training data', 'Path B learned French, German and Italian from ~4k synthetic finance documents per language. More languages and domains (clinical, HR) are the main lever for its held-out recall.'],
          ['Larger held-out evaluation', 'Grow labelled held-out sets (especially unlabelled national IDs and passwords) and calibrate the validator margin per category on them.'],
          ['Shared encoder', 'Serve the validator, the EDM index and the tagger from one multilingual encoder pass, removing the second ONNX session and its memory.'],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg border border-hairline bg-graphite-2 p-[5%]">
            <h3 className="mb-1 font-display font-semibold text-alabaster">{t}</h3>
            <p>{d}</p>
          </div>
        ))}
      </div>
    </Slide>,
  ];

  const exportMarkdown = () => {
    const lines = [
      '# Aionix Sentinel — Executive briefing',
      '',
      `_Generated ${new Date().toISOString()} from live Workbench data._`,
      '',
      '## Benchmark results',
      '',
      '| Dataset | Split | n | Precision | Recall | F2 (Path A) | F2 (Path B) | FPR (Path A) | p95 (Path A) |',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|',
      ...rows.map(
        (r) =>
          `| ${r.label} | ${r.split} | ${r.a?.observations ?? '—'} | ${f3(r.a?.metrics.precision)} | ${f3(r.a?.metrics.recall)} | ${f3(r.a?.metrics.f2)} | ${f3(r.b?.metrics.f2)} | ${formatPct(r.a?.metrics.fpr, 2)} | ${formatMs(r.a?.latency.p95)} ms |`,
      ),
      '',
      `Design targets: F2 ≥ ${TARGETS.f2}, FPR < ${(TARGETS.fpr * 100).toFixed(2)}%. Dev splits were used for error analysis; held-out splits were not.`,
      '',
      '## Engine',
      '',
      `- Tier 2 route on this machine: ${status ? `Path ${status.route}` : 'unknown'} — ${status?.pathBReason ?? ''}`,
      `- Medical FST: ${status?.fstEntries ?? '—'} entries (${status ? (status.fstBytes / 1048576).toFixed(1) : '—'} MB)`,
      `- EDM: ${status?.edmVectors ?? '—'} vectors, ${status?.edmFields ?? '—'} salted field hashes`,
      `- Engine memory: ${status?.memoryMB != null ? `${status.memoryMB.toFixed(1)} MB` : '—'} (${status?.memoryMethod ?? ''}) of a 150 MB ceiling`,
    ];
    downloadBlob('aionix-sentinel-briefing.md', lines.join('\n'), 'text/markdown');
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <p className="metric text-xs font-medium text-luminous">Executive briefing</p>
          <h1 className="font-display text-2xl font-bold tracking-tight">Stakeholder Presentation</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={exportMarkdown}>
            Export Markdown
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            Print / save PDF
          </Button>
          <span className="mx-1 h-5 w-px bg-hairline" />
          <Button size="sm" variant="ghost" aria-label="Previous slide" disabled={i === 0} onClick={() => setI(i - 1)}>
            ←
          </Button>
          <span className="metric text-sm text-muted">{i + 1} / 8</span>
          <Button size="sm" variant="ghost" aria-label="Next slide" disabled={i === 7} onClick={() => setI(i + 1)}>
            →
          </Button>
        </div>
      </div>
      <div className="print:hidden">{slides[i]}</div>
      <div className="hidden print:block">{slides}</div>
      <nav aria-label="Slides" className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8 print:hidden">
        {['Title', 'Achieved', 'Engine', 'Tier 2', 'Vault', 'Safety', 'Results', 'Future'].map((t, k) => (
          <button
            key={t}
            type="button"
            onClick={() => setI(k)}
            className={cx('rounded-lg border px-2 py-2 text-left text-xs transition-colors', k === i ? 'border-luminous/50 bg-luminous/10 text-luminous' : 'border-hairline text-muted hover:text-alabaster')}
          >
            <span className="metric block text-[10px] text-subtle">{String(k + 1).padStart(2, '0')}</span>
            {t}
          </button>
        ))}
      </nav>
    </>
  );
}
