import { create } from 'zustand';
import type { ScanRecord } from '../../engine/telemetry';

const KEY = 'aionix.workbench.telemetry.v1';
const MAX = 2000;

function load(): ScanRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ScanRecord[]) : [];
  } catch {
    return [];
  }
}

function save(records: ScanRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* storage unavailable (private mode / quota) — telemetry stays in memory */
  }
}

interface TelemetryState {
  records: ScanRecord[];
  add(record: ScanRecord): void;
  importRecords(records: ScanRecord[]): number;
  clear(): void;
}

export const useTelemetry = create<TelemetryState>((set, get) => ({
  records: load(),
  add(record) {
    const records = [...get().records, record].slice(-MAX);
    save(records);
    set({ records });
  },
  importRecords(incoming) {
    const seen = new Set(get().records.map((r) => r.id));
    const fresh = incoming.filter((r) => r && typeof r.id === 'string' && !seen.has(r.id));
    const records = [...get().records, ...fresh].sort((a, b) => a.ts - b.ts).slice(-MAX);
    save(records);
    set({ records });
    return fresh.length;
  },
  clear() {
    save([]);
    set({ records: [] });
  },
}));
