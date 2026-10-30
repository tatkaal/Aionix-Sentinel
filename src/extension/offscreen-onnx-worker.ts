// Offscreen document: hosts the asynchronous half of the engine — Tier 2 (Path A lexicon FST +
// MiniLM validator, Path B openai/privacy-filter on WebGPU) and Tier 3 Path B (EDM) — plus the
// memory governor. Every runtime binary is loaded from the extension package (zero remote code);
// only Path B model weights are fetched from the Hugging Face Hub, as data.
import { EngineHost } from '../engine/host';
import { createOrtWebEmbedder } from '../engine/runtime/ort-web-embedder';
import { probeHardware } from '../engine/tier2/hardware-probe';
import type { OffscreenRequest } from './messages';

const base = chrome.runtime.getURL('');
const EVICTION_KEY = 'aionix.pathB.evicted';

const host = new EngineHost({
  loadBinary: async (path) => {
    const res = await fetch(`${base}${path}`);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.arrayBuffer();
  },
  createEmbedder: () => createOrtWebEmbedder(base),
  probeHardware: () => probeHardware(),
  createNeuralNer: async (dtype, onProgress) => {
    const { createPrivacyFilterNer } = await import('../engine/runtime/privacy-filter-ner');
    return createPrivacyFilterNer(base, dtype, onProgress);
  },
  autoLoadPathB: true,
  enforceCeiling: true,
  evictionStore: {
    get: () => {
      try {
        return localStorage.getItem(EVICTION_KEY);
      } catch {
        return null;
      }
    },
    set: (reason) => {
      try {
        localStorage.setItem(EVICTION_KEY, reason);
      } catch {
        /* storage unavailable — the next start will measure again */
      }
      // Recycle only if the eviction is remembered; otherwise the new document would re-load Path B.
      let remembered = false;
      try {
        remembered = localStorage.getItem(EVICTION_KEY) === reason;
      } catch {
        /* ignore */
      }
      if (remembered) void chrome.runtime.sendMessage({ target: 'background', type: 'recycle-offscreen' }).catch(() => undefined);
    },
  },
});

void host.init();

async function handle(msg: OffscreenRequest): Promise<unknown> {
  switch (msg.type) {
    case 'scan-async':
      return host.scanAsync(msg.input);
    case 'set-route':
      // An explicit "Force WebGPU" clears a remembered eviction so the ceiling is re-measured.
      if (msg.mode === 'force-b') {
        try {
          localStorage.removeItem(EVICTION_KEY);
        } catch {
          /* ignore */
        }
      }
      await host.setRouteMode(msg.mode);
      return host.status();
    case 'status':
      return host.status();
  }
}

chrome.runtime.onMessage.addListener((msg: OffscreenRequest, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  handle(msg).then(sendResponse, (err: unknown) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
  return true;
});
