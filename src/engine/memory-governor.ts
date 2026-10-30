// Memory governor for the offscreen document / Workbench worker. Reports measured numbers and
// labels how they were obtained; never substitutes assumed values.

export const MEMORY_CEILING_MB = 150;
export const MEMORY_WARN_MB = 105;

export interface MemoryReading {
  mb: number | null;
  method: string;
  /** When the reading was taken (performance.now()). */
  at: number;
  /** True when a newer measurement was requested but had not resolved in time. */
  stale?: boolean;
  /** MB by memory type and context (e.g. "JavaScript @ Window:offscreen.html"). */
  byType?: Record<string, number>;
}

interface PerfWithMemory {
  measureUserAgentSpecificMemory?: () => Promise<{
    bytes: number;
    breakdown?: { bytes: number; types: string[]; attribution?: { url?: string; scope?: string }[] }[];
  }>;
  memory?: { usedJSHeapSize: number };
}

const now = () => performance.now();

/**
 * Prefers performance.measureUserAgentSpecificMemory() (needs crossOriginIsolated; covers the JS heap
 * and wasm linear memory of this agent). Chrome resolves it after a GC, which can take seconds:
 * callers get the newest reading, flagged `stale` if a fresher one is still pending. Decisions
 * (Path B eviction) use `measureFresh`, which waits for a reading taken after the call.
 */
export function createMemoryProbe(trackedBytes: () => number) {
  let last: MemoryReading = { mb: null, method: 'not yet measured', at: 0 };
  let inflight: Promise<MemoryReading> | null = null;
  const perf = (globalThis as { performance?: PerfWithMemory }).performance;
  const isolated = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
  const native = isolated && !!perf?.measureUserAgentSpecificMemory;

  const fallback = (): MemoryReading => {
    const heap = perf?.memory?.usedJSHeapSize;
    if (typeof heap === 'number') {
      // Chrome's usedJSHeapSize already includes ArrayBuffer / wasm backing stores (an offscreen
      // document with Path B loaded read ~830 MB here), so tracked bytes are a floor, not an addend.
      return { mb: Math.max(heap, trackedBytes()) / 1048576, method: 'performance.memory JS heap (floored at tracked model bytes)', at: now() };
    }
    return { mb: trackedBytes() / 1048576, method: 'tracked model buffers only (lower bound)', at: now() };
  };

  const start = (): Promise<MemoryReading> => {
    inflight ??= perf!
      .measureUserAgentSpecificMemory!()
      .then((r) => {
        const byType: Record<string, number> = {};
        for (const b of r.breakdown ?? []) {
          const where = (b.attribution ?? []).map((a) => `${a.scope ?? ''}:${(a.url ?? '').split('/').pop()}`).join(',');
          const k = `${b.types.join('+') || 'unattributed'}${where ? ` @ ${where}` : ''}`;
          byType[k] = Math.round(((byType[k] ?? 0) + b.bytes / 1048576) * 10) / 10;
        }
        last = { mb: r.bytes / 1048576, method: 'measureUserAgentSpecificMemory', at: now(), byType };
        return last;
      })
      .catch(() => (last = fallback()))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const race = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

  return {
    get last(): MemoryReading {
      return last;
    },
    /** Newest available reading; marked stale when a fresher one did not resolve within `timeoutMs`. */
    async measure(timeoutMs = 1500): Promise<MemoryReading> {
      if (!native) return (last = fallback());
      const fresh = await race(start(), timeoutMs);
      if (fresh) return fresh;
      return last.mb === null ? (last = fallback()) : { ...last, stale: true };
    },
    /** JS heap + tracked model bytes, labelled — the fallback when no browser measurement resolves. */
    estimate(): MemoryReading {
      return fallback();
    },
    /** A reading taken after this call (or null if none arrives in time) — for ceiling decisions. */
    async measureFresh(timeoutMs = 30_000): Promise<MemoryReading | null> {
      if (!native) return (last = fallback());
      const since = now();
      // An in-flight measurement may have started before the event we care about; wait it out, then
      // give the new measurement its own full budget (Chrome resolves it at a GC, up to ~20 s later).
      if (inflight) await race(inflight, timeoutMs);
      const r = await race(start(), timeoutMs);
      return r && r.at >= since ? r : null;
    },
  };
}
