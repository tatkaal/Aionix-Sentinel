import type { AsyncScanResult } from '../engine/pipeline';
import type { ScanRecord } from '../engine/telemetry';
import type { EngineStatus, RouteMode } from '../engine/host';
import type { ScanInput } from '../engine/types';

export type { EngineStatus, RouteMode };

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
  | { target: 'background'; type: 'status' }
  | { target: 'background'; type: 'export-audit' }
  | { target: 'background'; type: 'set-route'; mode: RouteMode };

export type OffscreenRequest =
  | { target: 'offscreen'; type: 'scan-async'; input: ScanInput }
  | { target: 'offscreen'; type: 'status' }
  | { target: 'offscreen'; type: 'set-route'; mode: RouteMode };

export interface StatusResponse {
  engine: EngineStatus | null;
  counters: Counters;
  recent: ScanRecord[];
}

export type ScanAsyncResponse = AsyncScanResult | { error: string };

export function emptyCounters(): Counters {
  return { scanned: 0, blocked: 0, byCategory: {}, byPath: {}, byPortal: {} };
}
