// Offscreen document: hosts the asynchronous half of the engine (Tier 2 + Tier 3 Path B).
// Full hardware-aware routing and the memory governor are wired in the engine step.
import type { AsyncScanResult } from '../engine/pipeline';
import type { EngineStatus, OffscreenRequest, RouteMode } from './messages';

let mode: RouteMode = 'auto';

async function handle(msg: OffscreenRequest): Promise<unknown> {
  switch (msg.type) {
    case 'scan-async':
      return { findings: [], timings: { tier2: 0, tier3b: 0 }, tier2Route: null } satisfies AsyncScanResult;
    case 'set-route':
      mode = msg.mode;
      return true;
    case 'status':
      return {
        route: 'A',
        mode,
        pathBState: 'unavailable',
        pathBReason: 'Engine not initialised',
        adapterSummary: '—',
        memoryMB: null,
        memoryMethod: 'n/a',
        ceilingMB: 150,
        pathAReady: false,
      } satisfies EngineStatus;
  }
}

chrome.runtime.onMessage.addListener((msg: OffscreenRequest, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  handle(msg).then(sendResponse, (err: unknown) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
  return true;
});
