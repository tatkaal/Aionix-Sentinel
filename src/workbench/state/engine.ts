import { create } from 'zustand';
import type { AsyncScanner, SyncDetector } from '../../engine/pipeline';
import type { EngineStatus, RouteMode } from '../../extension/messages';

interface EngineState {
  tier3a: SyncDetector | null;
  asyncScanner: AsyncScanner | null;
  status: EngineStatus | null;
  routeMode: RouteMode;
  initialised: boolean;
  init(): Promise<void>;
  setRouteMode(mode: RouteMode): void;
}

/** Workbench engine host. Tier 1/3A run on the main thread; Tier 2/3B run in a dedicated worker. */
export const useEngine = create<EngineState>((set, get) => ({
  tier3a: null,
  asyncScanner: null,
  status: null,
  routeMode: 'auto',
  initialised: false,
  async init() {
    if (get().initialised) return;
    set({ initialised: true });
  },
  setRouteMode(mode) {
    set({ routeMode: mode });
  },
}));
