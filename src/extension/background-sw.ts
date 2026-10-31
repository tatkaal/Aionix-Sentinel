// MV3 background service worker: offscreen-document lifecycle, message routing between content
// scripts and the offscreen inference engine, and zero-knowledge telemetry in chrome.storage.local.
import { randomSalt, type ScanRecord } from '../engine/telemetry';
import { CUSTOM_VAULT_KEY, type CustomVaultRecord } from '../engine/tier3/custom-vault';
import { emptyCounters, type BackgroundRequest, type Counters, type EngineStatus, type OffscreenRequest, type ProtectedEdm, type StatusResponse } from './messages';

const OFFSCREEN_PATH = 'offscreen.html';
const MAX_RECORDS = 500;
const OFFSCREEN_START_TIMEOUT_MS = 10_000;
const K = { counters: 'aionix.counters', records: 'aionix.records', salt: 'aionix.salt' } as const;

let creating: Promise<void> | null = null;
let recycling: Promise<void> | null = null;
let generation = 0;

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  if (existing.length) return;
  // Bounded: a start that never settles must not wedge every later request (they would all wait on
  // the same promise); after the timeout the next request tries again.
  creating ??= Promise.race([
    chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Runs the local Tier 2 / Tier 3 DLP inference engine (ONNX Runtime, FST lexicon) for prompt inspection.',
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('offscreen document did not start')), OFFSCREEN_START_TIMEOUT_MS)),
  ]).finally(() => {
    creating = null;
  });
  await creating;
}

/**
 * Recreates the offscreen document. After a Path B eviction the session is disposed, but wasm linear
 * memory never shrinks (measured: ~1 GB still held), so only a fresh document returns it. The new
 * document reads the remembered eviction and starts on Path A without re-loading the weights.
 */
function recycleOffscreen(): Promise<void> {
  recycling ??= (async () => {
    generation++;
    await chrome.offscreen.closeDocument().catch(() => undefined);
    await ensureOffscreen();
  })().finally(() => {
    recycling = null;
  });
  return recycling;
}

async function toOffscreen<T>(msg: OffscreenRequest): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await recycling;
    await ensureOffscreen();
    const gen = generation;
    try {
      const res = (await chrome.runtime.sendMessage(msg)) as T | undefined;
      if (res !== undefined || gen === generation || attempt > 0) return res as T;
    } catch (err) {
      if (gen === generation || attempt > 0) throw err;
    }
    // The document was recycled while this request was in flight: resend once to the new one. A route
    // change is not idempotent (force-b would re-load the evicted Path B), so report status instead.
    if (msg.type === 'set-route') msg = { target: 'offscreen', type: 'status' };
  }
}

async function getSalt(): Promise<string> {
  const { [K.salt]: existing } = await chrome.storage.local.get(K.salt);
  if (typeof existing === 'string') return existing;
  const salt = randomSalt();
  await chrome.storage.local.set({ [K.salt]: salt });
  return salt;
}

async function record(rec: ScanRecord): Promise<void> {
  const data = await chrome.storage.local.get([K.counters, K.records]);
  const counters: Counters = (data[K.counters] as Counters | undefined) ?? emptyCounters();
  counters.scanned++;
  counters.byPortal[rec.portal] = (counters.byPortal[rec.portal] ?? 0) + 1;
  if (rec.blocked) {
    counters.blocked++;
    for (const f of rec.findings) {
      counters.byCategory[f.category] = (counters.byCategory[f.category] ?? 0) + 1;
      counters.byPath[f.path] = (counters.byPath[f.path] ?? 0) + 1;
    }
  }
  const records = ((data[K.records] as ScanRecord[] | undefined) ?? []).concat(rec).slice(-MAX_RECORDS);
  await chrome.storage.local.set({ [K.counters]: counters, [K.records]: records });
  await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
  await chrome.action.setBadgeText({ text: counters.blocked ? String(Math.min(counters.blocked, 999)) : '' });
}

async function status(): Promise<StatusResponse> {
  const data = await chrome.storage.local.get([K.counters, K.records]);
  let engine: EngineStatus | null = null;
  try {
    engine = await toOffscreen<EngineStatus>({ target: 'offscreen', type: 'status' });
  } catch {
    engine = null;
  }
  return {
    engine,
    counters: (data[K.counters] as Counters | undefined) ?? emptyCounters(),
    recent: ((data[K.records] as ScanRecord[] | undefined) ?? []).slice(-25).reverse(),
  };
}

/** Persisted Tier 3 Path B fingerprints of protected data (options page), for the offscreen index. */
async function protectedEdm(): Promise<ProtectedEdm[]> {
  const { [CUSTOM_VAULT_KEY]: list } = await chrome.storage.local.get(CUSTOM_VAULT_KEY);
  return ((list as CustomVaultRecord[] | undefined) ?? []).map((r) => ({ id: r.id, edm: r.edm }));
}

async function handle(msg: BackgroundRequest): Promise<unknown> {
  switch (msg.type) {
    case 'scan-async':
      return toOffscreen({ target: 'offscreen', type: 'scan-async', input: msg.input });
    case 'record':
      return record(msg.record);
    case 'salt':
      return getSalt();
    case 'status':
      return status();
    case 'set-route':
      return toOffscreen({ target: 'offscreen', type: 'set-route', mode: msg.mode });
    case 'vault-index':
      return toOffscreen({ target: 'offscreen', type: 'edm-index', doc: msg.doc });
    case 'vault-custom':
      return protectedEdm();
    case 'recycle-offscreen':
      // Answer first: closing the document would otherwise drop the sender's reply port.
      setTimeout(() => void recycleOffscreen(), 0);
      return { ok: true };
    case 'export-audit': {
      const data = await chrome.storage.local.get([K.counters, K.records]);
      return { exportedAt: new Date().toISOString(), counters: data[K.counters] ?? emptyCounters(), records: data[K.records] ?? [] };
    }
  }
}

chrome.runtime.onMessage.addListener((msg: BackgroundRequest, _sender, sendResponse) => {
  if (msg?.target !== 'background') return false;
  handle(msg).then(sendResponse, (err: unknown) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
  return true;
});

// Adding or removing protected data updates the live offscreen index (content scripts read storage).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(CUSTOM_VAULT_KEY in changes)) return;
  void protectedEdm().then((items) => toOffscreen({ target: 'offscreen', type: 'edm-sync', items }).catch(() => undefined));
});

chrome.runtime.onInstalled.addListener(() => {
  void getSalt();
  void ensureOffscreen();
});
chrome.runtime.onStartup.addListener(() => void ensureOffscreen());
