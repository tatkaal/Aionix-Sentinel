// Asynchronous engine host — the body of offscreen-onnx-worker.js and the Workbench engine worker.
// Owns Tier 2 routing (Path A lexicon ↔ Path B WebGPU), Tier 3 Path B (EDM) and the memory governor.
import type { Embedder } from './embed/minilm';
import { createMemoryProbe, MEMORY_CEILING_MB, type MemoryReading } from './memory-governor';
import type { AsyncScanResult } from './pipeline';
import { createContextValidator, type ContextValidator } from './tier2/context-validator';
import { Fst } from './tier2/fst-runtime';
import type { Tier2Scanner } from './tier2/graph-scan';
import type { HardwareReport } from './tier2/hardware-probe';
import { createLexiconPath } from './tier2/lexicon-path';
import { createNeuralPath, type NeuralPolicy } from './tier2/neural-path';
import { createWebGpuPath, type NeuralNer } from './tier2/webgpu-path';
import { createEdmDetector, decodeEdm, encodeEdm, type EdmDetector, type EdmSourceDoc } from './tier3/edm';
import type { Finding, FindingSource, ScanInput } from './types';

/** Fresh follow-up readings an over-ceiling reading must survive before Path B is evicted. */
const CEILING_CONFIRMATIONS = 2;

export type RouteMode = 'auto' | 'force-a' | 'force-b';
export type PathBState = 'unavailable' | 'idle' | 'loading' | 'ready' | 'failed' | 'evicted';

export interface EngineStatus {
  route: 'A' | 'B';
  mode: RouteMode;
  pathAReady: boolean;
  pathBState: PathBState;
  pathBReason: string;
  pathBProgress: number | null;
  pathBModel: string | null;
  hardware: HardwareReport | null;
  adapterSummary: string;
  memoryMB: number | null;
  memoryMethod: string;
  /** The newest reading predates a pending, fresher measurement. */
  memoryStale: boolean;
  memoryByType: Record<string, number> | null;
  ceilingMB: number;
  fstEntries: number;
  fstBytes: number;
  edmVectors: number;
  edmFields: number;
  loadMs: { pathA: number | null; pathB: number | null };
  /** Epoch ms when this engine instance started; unchanged for as long as the instance lives. */
  startedAt: number;
}

export interface PathBProvider {
  /**
   * 'cpu': a compact token classifier on the shared ONNX Runtime wasm — runs on any hardware.
   * 'webgpu': openai/privacy-filter — needs the hardware probe to pass.
   */
  device: 'cpu' | 'webgpu';
  create(dtype: 'q4' | 'q4f16', onProgress: (p: { file: string; loaded: number; total: number }) => void): Promise<NeuralNer>;
  /** Graph policy for 'cpu' taggers (see tier2/neural-path.ts). */
  policy?: NeuralPolicy;
}

export interface HostDeps {
  loadBinary(path: string): Promise<ArrayBuffer>;
  createEmbedder(): Promise<{ embedder: Embedder; modelBytes: number }>;
  probeHardware(): Promise<HardwareReport>;
  pathB?: PathBProvider;
  /** Load Path B automatically when the probe passes (extension: yes; Workbench: on request). */
  autoLoadPathB: boolean;
  /** Evict Path B above MEMORY_CEILING_MB (extension: yes; evaluation runtimes report only). */
  enforceCeiling: boolean;
  /** Remembers an eviction so a restart does not re-load ~0.8 GB just to evict it again. */
  evictionStore?: { get(): string | null; set(reason: string): void };
  /** Bytes of wasm linear memory in this runtime, for the memory fallback (see memory-governor.ts). */
  wasmBytes?(): number;
}

const now = () => performance.now();

/** Tier 2 budget for Path B inside the 1,000 ms send SLA (Tier 1/3A/3B and messaging use the rest). */
export const PATH_B_BUDGET_MS = 650;

export class EngineHost {
  private mode: RouteMode = 'auto';
  private fst: Fst | null = null;
  private embedder: Embedder | null = null;
  private validator: ContextValidator | null = null;
  private pathA: Tier2Scanner | null = null;
  private pathB: Tier2Scanner | null = null;
  private ner: NeuralNer | null = null;
  private edm: EdmDetector | null = null;
  private hardware: HardwareReport | null = null;
  private pathBState: PathBState = 'idle';
  private pathBReason = 'Not probed yet';
  private pathBProgress: number | null = null;
  private trackedBytes = 0;
  private pathBBytes = 0;
  private pathBLoad: Promise<void> | null = null;
  private loadMs: EngineStatus['loadMs'] = { pathA: null, pathB: null };
  private initPromise: Promise<void> | null = null;
  /** Protected items added inside the extension (options page), by id. */
  private readonly customIds = new Set<string>();
  private readonly memory = createMemoryProbe(
    () => this.trackedBytes,
    () => this.deps.wasmBytes?.() ?? 0,
  );
  private readonly startedAt = Date.now();

  constructor(private readonly deps: HostDeps) {}

  init(): Promise<void> {
    this.initPromise ??= this.doInit();
    return this.initPromise;
  }

  private async doInit() {
    const t0 = now();
    const [fstBuf, edmBuf, emb] = await Promise.all([
      this.deps.loadBinary('engine/medical.fst.bin'),
      this.deps.loadBinary('engine/vault-edm.bin'),
      this.deps.createEmbedder(),
    ]);
    this.fst = new Fst(fstBuf);
    this.embedder = emb.embedder;
    this.trackedBytes = fstBuf.byteLength + edmBuf.byteLength + emb.modelBytes;
    this.validator = await createContextValidator(this.embedder);
    this.pathA = createLexiconPath(this.fst, this.validator);
    this.edm = await createEdmDetector(decodeEdm(edmBuf), this.embedder);
    this.loadMs.pathA = now() - t0;

    this.hardware = await this.deps.probeHardware();
    const pathB = this.deps.pathB;
    if (!pathB) {
      this.pathBState = 'unavailable';
      this.pathBReason = 'Neural path not available in this runtime';
    } else if (pathB.device === 'webgpu' && !this.hardware.eligible) {
      this.pathBState = 'unavailable';
      this.pathBReason = this.hardware.reason;
    } else {
      this.pathBState = 'idle';
      this.pathBReason = pathB.device === 'cpu' ? 'Eligible: CPU tagger (any hardware)' : `Eligible: ${this.hardware.reason}`;
      const remembered = this.deps.evictionStore?.get();
      if (remembered) {
        this.pathBState = 'evicted';
        this.pathBReason = `${remembered} (remembered — choose Force Path B to retry)`;
      } else if (this.deps.autoLoadPathB) void this.loadPathB();
    }
  }

  /**
   * Loads the Path B tagger; any failure (OOM, device lost, missing file) degrades to Path A. Concurrent
   * callers share one in-flight load, and Path B only becomes routable once the memory check passes.
   */
  loadPathB(force = false): Promise<void> {
    this.pathBLoad ??= this.doLoadPathB(force).finally(() => {
      this.pathBLoad = null;
    });
    return this.pathBLoad;
  }

  private async doLoadPathB(force: boolean): Promise<void> {
    await this.init();
    if (this.pathBState === 'ready') return;
    const provider = this.deps.pathB;
    const gpu = provider?.device === 'webgpu';
    if (!provider || !this.hardware || (gpu && (!this.hardware.webgpu || (!this.hardware.eligible && !force)))) {
      this.pathBState = 'unavailable';
      this.pathBReason = provider ? (this.hardware?.reason ?? 'WebGPU unavailable') : 'Neural path not available in this runtime';
      return;
    }
    const where = gpu ? this.hardware.reason : 'CPU (ONNX Runtime wasm)';
    this.pathBState = 'loading';
    this.pathBReason = gpu ? `Downloading ${this.hardware.dtype} weights (cached after first load)` : 'Loading the Path B tagger';
    this.pathBProgress = 0;
    const t0 = now();
    const files = new Map<string, { loaded: number; total: number }>();
    let ner: NeuralNer | null = null;
    try {
      ner = await provider.create(this.hardware.dtype, (p) => {
        files.set(p.file, { loaded: p.loaded, total: p.total });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        this.pathBProgress = total ? loaded / total : 0;
      });
      this.loadMs.pathB = now() - t0;
      // Weight bytes that passed through host memory — the lower bound if no fresh reading arrives.
      this.pathBBytes = [...files.values()].reduce((n, f) => n + f.total, 0);
      this.trackedBytes += this.pathBBytes;
      this.pathBReason = `${ner.modelId} · ${where} · verifying host memory`;
      const verdict = await this.checkCeiling();
      this.pathBProgress = null;
      if (!verdict.keep) {
        await ner.dispose().catch(() => undefined);
        this.trackedBytes -= this.pathBBytes;
        this.pathBBytes = 0;
        this.pathBState = 'evicted';
        this.pathBReason = verdict.note;
        this.deps.evictionStore?.set(verdict.note);
        return;
      }
      this.ner = ner;
      this.pathB = gpu ? createWebGpuPath(this.fst!, this.validator, ner) : createNeuralPath(this.fst!, this.validator, ner, provider.policy);
      this.pathBState = 'ready';
      this.pathBReason = `${ner.modelId} · ${where} · ${verdict.note}`;
    } catch (err) {
      await ner?.dispose().catch(() => undefined);
      this.pathB = null;
      this.ner = null;
      this.pathBState = 'failed';
      this.pathBProgress = null;
      this.pathBReason = `Degraded → Path A: ${(err as Error).message}`;
    }
  }

  /**
   * Steady-state host footprint above the ceiling evicts Path B (VRAM weights are not counted).
   * Uses a reading taken *after* the load; if the browser has not produced one, the JS heap plus
   * tracked model bytes (incl. the downloaded Path B weights) is used as a labelled lower bound.
   */
  private async checkCeiling(): Promise<{ keep: boolean; note: string }> {
    let reading = (await this.memory.measureFresh()) ?? this.memory.estimate();
    if (reading.mb === null) return { keep: true, note: 'host memory not measurable after load' };
    // The ceiling is about the steady state, and an eviction is remembered. One reading right after the
    // load can still include load buffers the next GC frees (seen once: 212 MB, then 118 MB on re-runs),
    // so an over-ceiling reading must hold on two fresh follow-ups; the lowest one decides.
    for (let i = 0; i < CEILING_CONFIRMATIONS && reading.mb !== null && reading.mb > MEMORY_CEILING_MB; i++) {
      const next = await this.memory.measureFresh();
      if (!next || next.mb === null) break;
      if (next.mb < reading.mb) reading = next;
    }
    if (reading.mb === null) return { keep: true, note: 'host memory not measurable after load' };
    const measured = `host ${reading.mb.toFixed(0)} MB after load (${reading.method})`;
    if (reading.mb <= MEMORY_CEILING_MB) return { keep: true, note: measured };
    if (!this.deps.enforceCeiling) return { keep: true, note: `${measured} · above the ${MEMORY_CEILING_MB} MB extension ceiling (reported, not enforced here)` };
    return { keep: false, note: `Degraded → Path A: host memory ${reading.mb.toFixed(0)} MB > ${MEMORY_CEILING_MB} MB ceiling (${reading.method})` };
  }

  async setRouteMode(mode: RouteMode): Promise<void> {
    this.mode = mode;
    if (mode === 'force-b') await this.loadPathB(true);
  }

  private activeRoute(): { scanner: Tier2Scanner; route: 'A' | 'B'; degraded?: string } {
    if (this.mode !== 'force-a' && this.pathB && this.pathBState === 'ready') return { scanner: this.pathB, route: 'B' };
    const degraded =
      this.mode === 'force-b' ? `Path B ${this.pathBState}: ${this.pathBReason}` : this.mode === 'auto' && this.pathBState === 'loading' ? 'Path B loading — using Path A' : undefined;
    return { scanner: this.pathA!, route: 'A', ...(degraded ? { degraded } : {}) };
  }

  async scanAsync(input: ScanInput, opts: { strictRoute?: boolean } = {}): Promise<AsyncScanResult> {
    await this.init();
    const active = this.activeRoute();
    const { scanner } = active;
    let route = active.route;
    let degraded = active.degraded;
    const units: { text: string; source: FindingSource }[] = [
      { text: input.text, source: { kind: 'composer' } },
      ...(input.attachments ?? []).map((a) => ({ text: a.text, source: { kind: 'attachment', attachmentId: a.id } as FindingSource })),
    ];
    const findings: Finding[] = [];
    let t = now();
    for (const u of units) {
      // Path B on modest GPUs can exceed the send SLA. Past the budget, Path A (CPU, fast) decides
      // this prompt; the Path B inference keeps running and is discarded. Benchmarks pass `strict`.
      const remaining = PATH_B_BUDGET_MS - (now() - t);
      if (route === 'B' && !opts.strictRoute) {
        const raced = remaining > 0 ? await Promise.race([scanner.scan(u.text, u.source), new Promise<'late'>((r) => setTimeout(() => r('late'), remaining))]) : 'late';
        if (raced !== 'late') {
          findings.push(...raced);
          continue;
        }
        route = 'A';
        degraded = `Path B exceeded the ${PATH_B_BUDGET_MS} ms Tier 2 budget — Path A decided this prompt`;
        findings.push(...(await this.pathA!.scan(u.text, u.source)));
        continue;
      }
      findings.push(...(await (route === 'B' ? scanner : this.pathA!).scan(u.text, u.source)));
    }
    const tier2 = now() - t;
    t = now();
    for (const u of units) findings.push(...(await this.edm!.scan(u.text, u.source)));
    const tier3b = now() - t;
    return { findings, timings: { tier2, tier3b }, tier2Route: route, ...(degraded ? { degradedReason: degraded } : {}) };
  }

  /** Tier 2 only, on an explicit route — used by the benchmark harness to compare paths. */
  async scanTier2(text: string, route: 'A' | 'B'): Promise<{ findings: Finding[]; ms: number } | null> {
    await this.init();
    const scanner = route === 'B' ? (this.pathBState === 'ready' ? this.pathB : null) : this.pathA;
    if (!scanner) return null;
    const t = now();
    const findings = await scanner.scan(text, { kind: 'composer' });
    return { findings, ms: now() - t };
  }

  async addVaultDocument(doc: EdmSourceDoc): Promise<void> {
    await this.init();
    await this.edm!.addDocument(doc);
  }

  /**
   * Indexes protected data for Tier 3 Path B and returns its fingerprints (MiniLM vectors + salted
   * field hashes, encoded) for the caller to persist. The text itself is not kept.
   */
  async indexProtected(doc: EdmSourceDoc): Promise<Uint8Array> {
    await this.init();
    if (this.edm!.hasAsset(doc.id)) await this.edm!.removeAsset(doc.id);
    const part = await this.edm!.indexDocument(doc);
    this.customIds.add(doc.id);
    return encodeEdm(part);
  }

  /** Makes the custom part of the EDM index match the persisted list (add on restart, remove on delete). */
  async syncProtected(items: { id: string; edm: Uint8Array | null }[]): Promise<void> {
    await this.init();
    const wanted = new Set(items.map((i) => i.id));
    for (const id of [...this.customIds]) {
      if (wanted.has(id)) continue;
      await this.edm!.removeAsset(id);
      this.customIds.delete(id);
    }
    for (const it of items) {
      if (this.customIds.has(it.id) || !it.edm) continue;
      await this.edm!.importData(decodeEdm(it.edm));
      this.customIds.add(it.id);
    }
  }

  /**
   * @param memoryWaitMs how long to wait for a fresh memory reading (Chrome resolves it at a GC, often
   *   seconds later). The popup asks for ~0 and shows the newest reading; measurement runs wait longer.
   */
  async status(memoryWaitMs = 1500): Promise<EngineStatus> {
    // Measuring mid-initialisation (or mid Path B load) captures transient load buffers, and Chrome can
    // fold a status-triggered measurement into the ceiling check's — so report the newest reading then.
    const reading: MemoryReading = !this.pathA
      ? { mb: null, method: 'engine initialising', at: 0 }
      : this.pathBState === 'loading'
        ? { ...this.memory.last, stale: true }
        : await this.memory.measure(memoryWaitMs);
    const route = this.activeRoute().route;
    const hw = this.hardware;
    return {
      route,
      mode: this.mode,
      pathAReady: !!this.pathA,
      pathBState: this.pathBState,
      pathBReason: this.pathBReason,
      pathBProgress: this.pathBProgress,
      pathBModel: this.ner?.modelId ?? null,
      hardware: hw,
      adapterSummary: hw?.webgpu ? [hw.vendor, hw.architecture, hw.description].filter(Boolean).join(' · ') || 'WebGPU adapter' : 'No WebGPU',
      memoryMB: reading.mb,
      memoryMethod: reading.method,
      memoryStale: reading.stale === true,
      memoryByType: reading.byType ?? null,
      ceilingMB: MEMORY_CEILING_MB,
      fstEntries: this.fst?.entryCount ?? 0,
      fstBytes: this.fst?.byteLength ?? 0,
      edmVectors: this.edm?.vectorCount ?? 0,
      edmFields: this.edm?.fieldCount ?? 0,
      loadMs: this.loadMs,
      startedAt: this.startedAt,
    };
  }
}
