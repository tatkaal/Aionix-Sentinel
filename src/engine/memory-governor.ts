// Memory governor for the offscreen document / Workbench worker. Reports measured numbers and
// labels how they were obtained; never substitutes assumed values.

export const MEMORY_CEILING_MB = 150;
export const MEMORY_WARN_MB = 105;

export interface MemoryReading {
  mb: number | null;
  method: string;
}

interface PerfWithMemory {
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
  memory?: { usedJSHeapSize: number };
}

/**
 * Prefers performance.measureUserAgentSpecificMemory() (needs crossOriginIsolated; covers JS heap,
 * wasm linear memory and workers of this agent). Chrome may defer it until the next GC, so it is
 * raced against a timeout and falls back to performance.memory + tracked buffers.
 */
export function createMemoryProbe(trackedBytes: () => number) {
  let last: MemoryReading = { mb: null, method: 'not yet measured' };
  let inflight: Promise<void> | null = null;
  const perf = (globalThis as { performance?: PerfWithMemory }).performance;
  const isolated = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;

  const fallback = (): MemoryReading => {
    const heap = perf?.memory?.usedJSHeapSize;
    if (typeof heap === 'number') {
      return { mb: (heap + trackedBytes()) / 1048576, method: 'performance.memory + tracked model buffers' };
    }
    return { mb: trackedBytes() / 1048576, method: 'tracked model buffers only (lower bound)' };
  };

  return {
    get last(): MemoryReading {
      return last;
    },
    async measure(timeoutMs = 4000): Promise<MemoryReading> {
      if (isolated && perf?.measureUserAgentSpecificMemory) {
        inflight ??= perf
          .measureUserAgentSpecificMemory()
          .then((r) => {
            last = { mb: r.bytes / 1048576, method: 'measureUserAgentSpecificMemory' };
          })
          .catch(() => {
            last = fallback();
          })
          .finally(() => {
            inflight = null;
          });
        const done = await Promise.race([inflight.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs))]);
        if (!done && last.mb === null) last = fallback();
        return last;
      }
      last = fallback();
      return last;
    },
  };
}
