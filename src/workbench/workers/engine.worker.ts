// Workbench mirror of offscreen-onnx-worker.ts: the same EngineHost, loading the same binaries
// from the Workbench origin. Path B loads on request (it downloads ~0.8–0.9 GB of weights).
import { EngineHost, type RouteMode } from '../../engine/host';
import { createOrtWebEmbedder } from '../../engine/runtime/ort-web-embedder';
import type { EdmSourceDoc } from '../../engine/tier3/edm';
import { probeHardware } from '../../engine/tier2/hardware-probe';
import type { ScanInput } from '../../engine/types';

export type WorkerRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'scan'; input: ScanInput; strict?: boolean }
  | { id: number; type: 'tier2'; text: string; route: 'A' | 'B' }
  | { id: number; type: 'status' }
  | { id: number; type: 'set-route'; mode: RouteMode }
  | { id: number; type: 'load-b' }
  | { id: number; type: 'add-doc'; doc: EdmSourceDoc };

export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

const base = `${self.location.origin}/`;

const host = new EngineHost({
  loadBinary: async (path) => {
    const res = await fetch(`${base}${path}`);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status} — run "npm run setup"`);
    return res.arrayBuffer();
  },
  createEmbedder: () => createOrtWebEmbedder(base),
  probeHardware: () => probeHardware(),
  createNeuralNer: async (dtype, onProgress) => {
    const { createPrivacyFilterNer } = await import('../../engine/runtime/privacy-filter-ner');
    return createPrivacyFilterNer(base, dtype, (p) => onProgress(p.total ? p.loaded / p.total : 0));
  },
  autoLoadPathB: false,
});

async function handle(msg: WorkerRequest): Promise<unknown> {
  switch (msg.type) {
    case 'init':
      await host.init();
      return host.status();
    case 'scan':
      return host.scanAsync(msg.input, { strictRoute: msg.strict === true });
    case 'tier2':
      return host.scanTier2(msg.text, msg.route);
    case 'status':
      return host.status();
    case 'set-route':
      await host.setRouteMode(msg.mode);
      return host.status();
    case 'load-b':
      await host.loadPathB(true);
      return host.status();
    case 'add-doc':
      await host.addVaultDocument(msg.doc);
      return host.status();
  }
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  handle(msg).then(
    (result) => self.postMessage({ id: msg.id, ok: true, result } satisfies WorkerResponse),
    (err: unknown) => self.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies WorkerResponse),
  );
};
