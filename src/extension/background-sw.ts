// MV3 background service worker: offscreen-document lifecycle, message routing between content
// scripts and the offscreen inference engine, and zero-knowledge telemetry in chrome.storage.local.
import { randomSalt, type ScanRecord } from '../engine/telemetry';
import { emptyCounters, type BackgroundRequest, type Counters, type EngineStatus, type OffscreenRequest, type StatusResponse } from './messages';

const OFFSCREEN_PATH = 'offscreen.html';
const MAX_RECORDS = 500;
const K = { counters: 'aonix.counters', records: 'aonix.records', salt: 'aonix.salt' } as const;

let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  if (existing.length) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Runs the local Tier 2 / Tier 3 DLP inference engine (ONNX Runtime, FST lexicon) for prompt inspection.',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

async function toOffscreen<T>(msg: OffscreenRequest): Promise<T> {
  await ensureOffscreen();
  return chrome.runtime.sendMessage(msg) as Promise<T>;
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

chrome.runtime.onInstalled.addListener(() => {
  void getSalt();
  void ensureOffscreen();
});
chrome.runtime.onStartup.addListener(() => void ensureOffscreen());
