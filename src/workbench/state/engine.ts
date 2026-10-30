import { create } from 'zustand';
import type { EngineStatus, RouteMode } from '../../engine/host';
import type { AsyncScanResult, AsyncScanner } from '../../engine/pipeline';
import type { EdmSourceDoc } from '../../engine/tier3/edm';
import { createVaultDetector, type VaultDetector } from '../../engine/tier3/minhash-detector';
import { buildAsset, decodeVault } from '../../engine/tier3/vault-format';
import type { Finding } from '../../engine/types';
import type { WorkerRequest, WorkerResponse } from '../workers/engine.worker';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function call<T>(msg: DistributiveOmit<WorkerRequest, 'id'>): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
  }
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ ...msg, id });
  });
}

interface EngineState {
  tier3a: VaultDetector | null;
  asyncScanner: AsyncScanner | null;
  status: EngineStatus | null;
  routeMode: RouteMode;
  initialised: boolean;
  error: string | null;
  init(): Promise<void>;
  refresh(): Promise<void>;
  setRouteMode(mode: RouteMode): void;
  /** Applies a route in the worker and resolves with the resulting status (used by benchmarks). */
  applyRoute(mode: RouteMode): Promise<EngineStatus | null>;
  loadPathB(): Promise<void>;
  scanTier2(text: string, route: 'A' | 'B'): Promise<{ findings: Finding[]; ms: number } | null>;
  addVaultDocument(doc: EdmSourceDoc): Promise<void>;
}

/** Workbench engine host: Tier 1/3A on the main thread, Tier 2/3B in a dedicated worker. */
export const useEngine = create<EngineState>((set, get) => ({
  tier3a: null,
  asyncScanner: null,
  status: null,
  routeMode: 'auto',
  initialised: false,
  error: null,
  async init() {
    if (get().initialised) return;
    set({ initialised: true });
    try {
      const res = await fetch('/engine/corporate-vault.bin');
      if (res.ok) set({ tier3a: createVaultDetector(decodeVault(await res.arrayBuffer())) });
    } catch {
      /* vault index missing — Tier 3 Path A stays off */
    }
    set({
      asyncScanner: { scanAsync: (input) => call<AsyncScanResult>({ type: 'scan', input }) },
    });
    try {
      set({ status: await call<EngineStatus>({ type: 'init' }) });
    } catch (err) {
      set({ error: (err as Error).message });
    }
    setInterval(() => void get().refresh(), 3000);
  },
  async refresh() {
    try {
      set({ status: await call<EngineStatus>({ type: 'status' }) });
    } catch {
      /* transient */
    }
  },
  setRouteMode(mode) {
    set({ routeMode: mode });
    void call<EngineStatus>({ type: 'set-route', mode }).then((status) => set({ status }));
    setTimeout(() => void get().refresh(), 300);
  },
  async applyRoute(mode) {
    try {
      const status = await call<EngineStatus>({ type: 'set-route', mode });
      set({ status });
      return status;
    } catch {
      return null;
    }
  },
  async loadPathB() {
    const p = call<EngineStatus>({ type: 'load-b' }).then((status) => set({ status }));
    setTimeout(() => void get().refresh(), 300);
    await p;
  },
  scanTier2(text, route) {
    return call({ type: 'tier2', text, route });
  },
  async addVaultDocument(doc) {
    get().tier3a?.addAsset(buildAsset(doc.id, doc.title, doc.kind, doc.category, doc.text));
    set({ status: await call<EngineStatus>({ type: 'add-doc', doc }) });
  },
}));
