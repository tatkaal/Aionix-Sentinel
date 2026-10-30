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
import { createWebGpuPath, type NeuralNer } from './tier2/webgpu-path';
import { createEdmDetector, decodeEdm, type EdmDetector, type EdmSourceDoc } from './tier3/edm';
import type { Finding, FindingSource, ScanInput } from './types';

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
  ceilingMB: number;
  fstEntries: number;
  fstBytes: number;
  edmVectors: number;
  edmFields: number;
  loadMs: { pathA: number | null; pathB: number | null };
}

export interface HostDeps {
  loadBinary(path: string): Promise<ArrayBuffer>;
  createEmbedder(): Promise<{ embedder: Embedder; modelBytes: number }>;
  probeHardware(): Promise<HardwareReport>;
  createNeuralNer?(dtype: 'q4' | 'q4f16', onProgress: (fraction: number) => void): Promise<NeuralNer>;
  /** Load Path B automatically when the probe passes (extension: yes; Workbench: on request). */
  autoLoadPathB: boolean;
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
  private loadMs: EngineStatus['loadMs'] = { pathA: null, pathB: null };
  private initPromise: Promise<void> | null = null;
  private readonly memory = createMemoryProbe(() => this.trackedBytes);

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
    void this.memory.measure();

    this.hardware = await this.deps.probeHardware();
    if (!this.deps.createNeuralNer) {
      this.pathBState = 'unavailable';
      this.pathBReason = 'Neural path not available in this runtime';
    } else if (!this.hardware.eligible) {
      this.pathBState = 'unavailable';
      this.pathBReason = this.hardware.reason;
    } else {
      this.pathBState = 'idle';
      this.pathBReason = `Eligible: ${this.hardware.reason}`;
      if (this.deps.autoLoadPathB) void this.loadPathB();
    }
  }

  /** Loads privacy-filter; any failure (OOM, device lost, download) degrades to Path A. */
  async loadPathB(force = false): Promise<void> {
    await this.init();
    if (this.pathBState === 'loading' || this.pathBState === 'ready') return;
    if (!this.deps.createNeuralNer || !this.hardware?.webgpu || (!this.hardware.eligible && !force)) {
      this.pathBState = 'unavailable';
      this.pathBReason = this.hardware?.reason ?? 'WebGPU unavailable';
      return;
    }
    this.pathBState = 'loading';
    this.pathBReason = `Downloading ${this.hardware.dtype} weights (cached after first load)`;
    this.pathBProgress = 0;
    const t0 = now();
    try {
      this.ner = await this.deps.createNeuralNer(this.hardware.dtype, (f) => (this.pathBProgress = f));
      this.pathB = createWebGpuPath(this.fst!, this.validator, this.ner);
      this.loadMs.pathB = now() - t0;
      this.pathBState = 'ready';
      this.pathBProgress = null;
      this.pathBReason = `${this.ner.modelId} · ${this.hardware.reason}`;
      await this.enforceCeiling();
    } catch (err) {
      this.pathB = null;
      this.ner = null;
      this.pathBState = 'failed';
      this.pathBProgress = null;
      this.pathBReason = `Degraded → Path A: ${(err as Error).message}`;
    }
  }

  /** Steady-state host footprint above the ceiling evicts Path B (VRAM weights are not counted). */
  private async enforceCeiling(): Promise<void> {
    const reading = await this.memory.measure(6000);
    if (this.pathBState === 'ready' && reading.mb !== null && reading.mb > MEMORY_CEILING_MB) {
      await this.ner?.dispose().catch(() => undefined);
      this.ner = null;
      this.pathB = null;
      this.pathBState = 'evicted';
      this.pathBReason = `Degraded → Path A: host memory ${reading.mb.toFixed(0)} MB > ${MEMORY_CEILING_MB} MB ceiling (${reading.method})`;
    }
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

  async status(): Promise<EngineStatus> {
    const reading: MemoryReading = await this.memory.measure(1500);
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
      ceilingMB: MEMORY_CEILING_MB,
      fstEntries: this.fst?.entryCount ?? 0,
      fstBytes: this.fst?.byteLength ?? 0,
      edmVectors: this.edm?.vectorCount ?? 0,
      edmFields: this.edm?.fieldCount ?? 0,
      loadMs: this.loadMs,
    };
  }
}
