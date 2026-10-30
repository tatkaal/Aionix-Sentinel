import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CATEGORIES, type CategoryId } from '../engine/types';
import { AonixLogo } from '../shared/brand/AonixLogo';
import { Badge, Button, Dot, Segmented } from '../workbench/components/ui';
import type { BackgroundRequest, RouteMode, StatusResponse } from './messages';
import './popup.css';

const send = <T,>(msg: BackgroundRequest) => chrome.runtime.sendMessage(msg) as Promise<T>;

function Popup() {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  const refresh = useCallback(() => {
    void send<StatusResponse>({ target: 'background', type: 'status' }).then(setStatus);
  }, []);

  useEffect(() => {
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
    a.download = `aonix-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="bg-obsidian text-alabaster">
      <header className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
        <AonixLogo className="h-[22px] w-auto" />
        <span className="font-display text-[15px] font-bold">Aonix Sentinel</span>
        <Badge tone="emerald" className="ml-auto">
          <Dot tone="emerald" /> Protecting
        </Badge>
      </header>

      <section className="space-y-3 border-b border-hairline px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted">Tier 2 route</div>
            <div className="font-display text-sm font-semibold">
              {engine ? (engine.route === 'B' ? 'Path B · WebGPU neural' : 'Path A · Lexicon FST (CPU)') : 'Starting…'}
            </div>
          </div>
          {engine && <Badge tone={engine.route === 'B' ? 'brand' : 'amber'}>{engine.route === 'B' ? 'GPU' : 'CPU'}</Badge>}
        </div>
        {engine?.pathBReason && <p className="text-xs text-subtle">{engine.pathBReason}</p>}
        <div>
          <div className="flex justify-between text-xs text-muted">
            <span>Offscreen memory</span>
            <span className="metric text-alabaster">
              {mem != null ? mem.toFixed(1) : '—'} / {engine?.ceilingMB ?? 150} MB
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-graphite-2">
            <div className={`h-full rounded-full ${memPct > 70 ? 'bg-amber' : 'bg-luminous'}`} style={{ width: `${memPct}%` }} />
          </div>
        </div>
        <Segmented<RouteMode>
          label="Hardware route"
          size="sm"
          value={engine?.mode ?? 'auto'}
          onChange={(mode) => void send({ target: 'background', type: 'set-route', mode }).then(refresh)}
          options={[
            { value: 'auto', label: 'Auto-detect' },
            { value: 'force-b', label: 'Force WebGPU' },
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
                <span className="w-14 shrink-0 capitalize text-muted">{r.portal}</span>
                <span className="truncate">
                  {[...new Set(r.findings.map((f) => CATEGORIES[f.category as CategoryId].short))].join(', ')}
                </span>
              </li>
            ))}
          {!status?.recent.some((r) => r.blocked) && <li className="text-xs text-subtle">No blocks yet.</li>}
        </ul>
        <Button size="sm" className="mt-3 w-full" onClick={() => void exportAudit()}>
          Export zero-knowledge audit log
        </Button>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
