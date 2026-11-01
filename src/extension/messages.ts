import type { AsyncScanResult } from '../engine/pipeline';
import type { ScanRecord } from '../engine/telemetry';
import type { EngineStatus, RouteMode } from '../engine/host';
import type { EdmSourceDoc } from '../engine/tier3/edm';
import type { ScanInput } from '../engine/types';

export type { EngineStatus, RouteMode };

/** chrome.storage.session: the last engine status, so the popup can draw it before the round trip returns. */
export const LAST_ENGINE_KEY = 'aionix.lastEngine';
/** chrome.storage.local keys written by the background service worker. */
export const STORE_KEYS = { counters: 'aionix.counters', records: 'aionix.records', salt: 'aionix.salt' } as const;

export interface Counters {
  scanned: number;
  blocked: number;
  byCategory: Record<string, number>;
  byPath: Record<string, number>;
  byPortal: Record<string, number>;
}

export type BackgroundRequest =
  | { target: 'background'; type: 'scan-async'; input: ScanInput }
  | { target: 'background'; type: 'record'; record: ScanRecord }
  | { target: 'background'; type: 'salt' }
  /** quick: answer with the newest memory reading instead of waiting for a fresh one (popup). */
  | { target: 'background'; type: 'status'; quick?: boolean }
  /** Content script, on composer focus: make sure the service worker and offscreen engine are up. */
  | { target: 'background'; type: 'warm' }
  | { target: 'background'; type: 'export-audit' }
  | { target: 'background'; type: 'set-route'; mode: RouteMode }
  /** Sent by the offscreen document after evicting Path B: its wasm heap only returns on teardown. */
  | { target: 'background'; type: 'recycle-offscreen' }
  /** Options page: index protected data for Tier 3 Path B; the reply carries fingerprints only. */
  | { target: 'background'; type: 'vault-index'; doc: EdmSourceDoc }
  /** Offscreen document at start-up: the persisted protected-data fingerprints to restore. */
  | { target: 'background'; type: 'vault-custom' };

export type OffscreenRequest =
  | { target: 'offscreen'; type: 'scan-async'; input: ScanInput }
  | { target: 'offscreen'; type: 'status'; memoryWaitMs?: number }
  | { target: 'offscreen'; type: 'set-route'; mode: RouteMode }
  | { target: 'offscreen'; type: 'edm-index'; doc: EdmSourceDoc }
  | { target: 'offscreen'; type: 'edm-sync'; items: ProtectedEdm[] };

/** Persisted Tier 3 Path B fingerprints of one protected item (base64 of encodeEdm). */
export interface ProtectedEdm {
  id: string;
  edm: string | null;
}

export interface IndexedEdm {
  edm: string;
  vectors: number;
  fieldHashes: number;
}

export interface StatusResponse {
  engine: EngineStatus | null;
  counters: Counters;
  recent: ScanRecord[];
}

export type ScanAsyncResponse = AsyncScanResult | { error: string };

export function emptyCounters(): Counters {
  return { scanned: 0, blocked: 0, byCategory: {}, byPath: {}, byPortal: {} };
}
