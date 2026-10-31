// Offscreen document: hosts the asynchronous half of the engine — Tier 2 (Path A lexicon FST +
// MiniLM validator, Path B compact multilingual token classifier on the CPU) and Tier 3 Path B
// (EDM) — plus the memory governor. Every binary, model weights included, is loaded from the
// extension package: nothing is fetched from the network.
import { EngineHost } from '../engine/host';
import { createOrtWebEmbedder } from '../engine/runtime/ort-web-embedder';
import { createOrtWebTagger } from '../engine/runtime/ort-web-tagger';
import { DEFAULT_NEURAL_POLICY } from '../engine/tier2/neural-path';
import { fromBase64, toBase64 } from '../engine/tier3/custom-vault';
import { decodeEdm } from '../engine/tier3/edm';
import { probeHardware } from '../engine/tier2/hardware-probe';
import type { IndexedEdm, OffscreenRequest, ProtectedEdm } from './messages';

const base = chrome.runtime.getURL('');
// Versioned per Path B model: an eviction of the earlier privacy-filter must not block the tagger.
const EVICTION_KEY = 'aionix.pathB.evicted.v2';

const host = new EngineHost({
  loadBinary: async (path) => {
    const res = await fetch(`${base}${path}`);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.arrayBuffer();
  },
  createEmbedder: () => createOrtWebEmbedder(base),
  probeHardware: () => probeHardware(),
  pathB: { device: 'cpu', create: (_dtype, onProgress) => createOrtWebTagger(base, onProgress), policy: DEFAULT_NEURAL_POLICY },
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

const syncProtected = (items: ProtectedEdm[]) => host.syncProtected(items.map((i) => ({ id: i.id, edm: i.edm ? fromBase64(i.edm) : null })));

// Restore protected data added in the options page (fingerprints persisted by the background).
void host.init().then(async () => {
  const items = (await chrome.runtime.sendMessage({ target: 'background', type: 'vault-custom' }).catch(() => [])) as ProtectedEdm[];
  if (Array.isArray(items) && items.length) await syncProtected(items);
});

async function handle(msg: OffscreenRequest): Promise<unknown> {
  switch (msg.type) {
    case 'scan-async':
      return host.scanAsync(msg.input);
    case 'set-route':
      // An explicit "Force Path B" clears a remembered eviction so the ceiling is re-measured.
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
    case 'edm-index': {
      // The text is embedded and hashed here, then dropped; only fingerprints go back.
      const bytes = await host.indexProtected(msg.doc);
      const part = decodeEdm(bytes);
      return { edm: toBase64(bytes), vectors: part.chunks.length, fieldHashes: part.fieldHashes.length } satisfies IndexedEdm;
    }
    case 'edm-sync':
      await syncProtected(msg.items);
      return host.status();
  }
}

chrome.runtime.onMessage.addListener((msg: OffscreenRequest, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  handle(msg).then(sendResponse, (err: unknown) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
  return true;
});
