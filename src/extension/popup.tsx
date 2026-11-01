import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CATEGORIES, type CategoryId } from '../engine/types';
import { AionixLogo } from '../shared/brand/AionixLogo';
import { Badge, Button, Dot, Segmented } from '../workbench/components/ui';
import type { ScanRecord } from '../engine/telemetry';
import { emptyCounters, LAST_ENGINE_KEY, STORE_KEYS, type BackgroundRequest, type Counters, type EngineStatus, type RouteMode, type StatusResponse } from './messages';
import './popup.css';

const send = <T,>(msg: BackgroundRequest) => chrome.runtime.sendMessage(msg) as Promise<T>;
const PORTAL_LABEL: Record<string, string> = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini', workbench: 'Workbench' };

/** The last known state straight from storage, so the popup draws at once (the engine is not restarted). */
async function cachedStatus(): Promise<StatusResponse> {
  const [session, local] = await Promise.all([
    chrome.storage.session.get(LAST_ENGINE_KEY).catch(() => ({}) as Record<string, unknown>),
    chrome.storage.local.get([STORE_KEYS.counters, STORE_KEYS.records]),
  ]);
  return {
    engine: (session[LAST_ENGINE_KEY] as EngineStatus | undefined) ?? null,
    counters: (local[STORE_KEYS.counters] as Counters | undefined) ?? emptyCounters(),
    recent: ((local[STORE_KEYS.records] as ScanRecord[] | undefined) ?? []).slice(-25).reverse(),
  };
}

function since(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

function routeLabel(engine: EngineStatus | null | undefined): string {
  if (!engine) return 'Connecting to the engine…';
  if (!engine.pathAReady) return 'Loading the engine…';
  if (engine.route === 'B') return 'Path B · Neural tagger (CPU)';
  if (engine.pathBState === 'loading') return `Path A · loading Path B${engine.pathBProgress != null ? ` ${Math.round(engine.pathBProgress * 100)}%` : ''}`;
  return 'Path A · Lexicon FST (CPU)';
}

function Popup() {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  const refresh = useCallback(() => {
    void send<StatusResponse>({ target: 'background', type: 'status', quick: true }).then((s) => {
      if (s?.engine) setStatus(s);
      else if (s) setStatus((prev) => ({ ...s, engine: prev?.engine ?? null }));
    });
  }, []);

  useEffect(() => {
    void cachedStatus().then((c) => setStatus((prev) => prev ?? c));
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const engine = status?.engine;
  const counters = status?.counters;
  const rate = counters && counters.scanned ? counters.blocked / counters.scanned : 0;
  const mem = engine?.memoryMB ?? null;
  const memPct = mem != null && engine ? Math.min(100, (mem / engine.ceilingMB) * 100) : 0;

  const exportAudit = async () => {
    const data = await send<unknown>({ target: 'background', type: 'export-audit' });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aionix-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="bg-obsidian text-alabaster">
      <header className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
        <AionixLogo className="h-[22px] w-auto" />
        <span className="font-display text-[15px] font-bold">Aionix Sentinel</span>
        <Badge tone="emerald" className="ml-auto">
          <Dot tone="emerald" /> Protecting
        </Badge>
      </header>

      <section className="space-y-3 border-b border-hairline px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted">Tier 2 route</div>
            <div className="font-display text-sm font-semibold">
              {routeLabel(engine)}
            </div>
          </div>
          {engine && <Badge tone={engine.route === 'B' ? 'brand' : 'amber'}>{engine.route === 'B' ? 'Neural' : 'Lexicon'}</Badge>}
        </div>
        {engine?.pathBReason && <p className="text-xs text-subtle">{engine.pathBReason}</p>}
        {engine?.startedAt && (
          <p className="text-xs text-subtle" data-testid="engine-uptime">
            Engine loaded once at{' '}
            <span className="metric">{new Date(engine.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> · running for{' '}
            {since(Date.now() - engine.startedAt)}, shared by every tab
          </p>
        )}
        <div>
          <div className="flex justify-between text-xs text-muted">
            <span>Offscreen memory</span>
            <span className="metric text-alabaster" title={engine?.memoryMethod}>
              {mem != null ? mem.toFixed(1) : '—'} / {engine?.ceilingMB ?? 150} MB
              {engine?.memoryStale && <span className="text-subtle"> · earlier reading</span>}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-graphite-2">
            <div className={`h-full rounded-full ${memPct >= 100 ? 'bg-crimson' : memPct > 70 ? 'bg-amber' : 'bg-luminous'}`} style={{ width: `${memPct}%` }} />
          </div>
        </div>
        <Segmented<RouteMode>
          label="Hardware route"
          size="sm"
          value={engine?.mode ?? 'auto'}
          onChange={(mode) => void send({ target: 'background', type: 'set-route', mode }).then(refresh)}
          options={[
            { value: 'auto', label: 'Auto-detect' },
            { value: 'force-b', label: 'Force Path B' },
            { value: 'force-a', label: 'Force Lexicon' },
          ]}
        />
      </section>

      <section className="grid grid-cols-3 gap-3 border-b border-hairline px-4 py-3">
        <div>
          <div className="text-xs text-muted">Scanned</div>
          <div className="metric text-lg font-semibold">{counters?.scanned ?? 0}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Blocked</div>
          <div className="metric text-lg font-semibold text-[#FCA5A5]">{counters?.blocked ?? 0}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Block rate</div>
          <div className="metric text-lg font-semibold">{(rate * 100).toFixed(1)}%</div>
        </div>
      </section>

      <section className="px-4 py-3">
        <h2 className="mb-2 text-xs font-semibold text-muted">Recent blocks</h2>
        <ul className="max-h-40 space-y-1.5 overflow-y-auto">
          {(status?.recent ?? [])
            .filter((r) => r.blocked)
            .slice(0, 8)
            .map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-xs">
                <span className="metric w-11 shrink-0 text-subtle">{new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="w-16 shrink-0 text-muted">{PORTAL_LABEL[r.portal] ?? r.portal}</span>
                <span className="truncate">
                  {[...new Set(r.findings.map((f) => CATEGORIES[f.category as CategoryId].short))].join(', ')}
                </span>
              </li>
            ))}
          {!status?.recent.some((r) => r.blocked) && <li className="text-xs text-subtle">No blocks yet.</li>}
        </ul>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => void chrome.runtime.openOptionsPage()}>
            Protected data & test kit
          </Button>
          <Button size="sm" onClick={() => void exportAudit()}>
            Export audit log
          </Button>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
