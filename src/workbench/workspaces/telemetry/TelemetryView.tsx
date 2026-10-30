import { useMemo, useRef, useState } from 'react';
import { percentile } from '../../../engine/bench/metrics';
import type { ScanRecord } from '../../../engine/telemetry';
import { CATEGORIES, CATEGORY_IDS, PATH_LABELS, type CategoryId, type EnginePath } from '../../../engine/types';
import { BarList, Columns } from '../../components/charts';
import { Badge, Button, EmptyState, Panel, Stat, WorkspaceHeader, cx, formatMs, formatPct } from '../../components/ui';
import { downloadBlob, toCsv } from '../../lib/download';
import { navigate } from '../../router';
import { useTelemetry } from '../../state/telemetry';

const PORTAL_LABEL: Record<string, string> = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini', sandbox: 'Workbench sandbox' };
const PATHS: EnginePath[] = ['math', 'lexicon', 'neural', 'webgpu', 'minhash', 'edm'];

function hourBuckets(records: ScanRecord[]) {
  const now = Date.now();
  const hour = 3_600_000;
  const start = Math.floor(now / hour) * hour - 23 * hour;
  return Array.from({ length: 24 }, (_, i) => {
    const t = start + i * hour;
    const inBucket = records.filter((r) => r.ts >= t && r.ts < t + hour);
    return {
      key: String(t),
      label: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: inBucket.length,
      sub: inBucket.filter((r) => r.blocked).length,
    };
  });
}

export function TelemetryView() {
  const { records, importRecords, clear } = useTelemetry();
  const [category, setCategory] = useState<CategoryId | 'all'>('all');
  const [portal, setPortal] = useState<string>('all');
  const [onlyBlocked, setOnlyBlocked] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const blocked = records.filter((r) => r.blocked);
  const latencies = records.map((r) => r.latencyMs);
  const byCategory = CATEGORY_IDS.map((c) => ({
    key: String(c),
    label: `${c} · ${CATEGORIES[c].short}`,
    value: blocked.filter((r) => r.findings.some((f) => f.category === c)).length,
    hint: CATEGORIES[c].label,
  }));
  const byPath = PATHS.map((p) => ({ key: p, label: PATH_LABELS[p], value: blocked.filter((r) => r.findings.some((f) => f.path === p)).length }));
  const portals = [...new Set(records.map((r) => r.portal))];
  const byPortal = portals.map((p) => ({ key: p, label: PORTAL_LABEL[p] ?? p, value: records.filter((r) => r.portal === p).length }));

  const filtered = useMemo(
    () =>
      [...records]
        .reverse()
        .filter((r) => (!onlyBlocked || r.blocked) && (portal === 'all' || r.portal === portal) && (category === 'all' || r.findings.some((f) => f.category === category))),
    [records, onlyBlocked, portal, category],
  );

  const exportCsv = () => {
    const rows = [['id', 'timestamp', 'portal', 'blocked', 'latency_ms', 'tier2_route', 'degraded', 'categories', 'types', 'paths', 'fingerprints']];
    for (const r of filtered) {
      rows.push([
        r.id,
        new Date(r.ts).toISOString(),
        r.portal,
        String(r.blocked),
        String(r.latencyMs),
        r.tier2Route ?? '',
        String(r.degraded),
        [...new Set(r.findings.map((f) => f.category))].join(' '),
        [...new Set(r.findings.map((f) => f.type))].join(' '),
        [...new Set(r.findings.map((f) => f.path))].join(' '),
        r.findings.map((f) => f.fingerprint).join(' '),
      ]);
    }
    downloadBlob(`aionix-incidents-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows), 'text/csv');
  };

  const onImport = async (file: File) => {
    try {
      const json = JSON.parse(await file.text()) as { records?: ScanRecord[] };
      const n = importRecords(Array.isArray(json.records) ? json.records : []);
      setNotice(`Imported ${n} new record${n === 1 ? '' : 's'} from ${file.name}.`);
    } catch {
      setNotice(`${file.name} is not an Aionix audit export.`);
    }
  };

  return (
    <>
      <WorkspaceHeader
        eyebrow="Zero-knowledge audit"
        title="Block Telemetry & Audit Console"
        description="Every inspection from the Sandbox and from imported extension audit logs. Records hold categories, engine routes, latency and salted 12-hex fingerprints — never prompt text or detected values."
        actions={
          <>
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && void onImport(e.target.files[0])} />
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              Import extension audit log
            </Button>
            <Button size="sm" onClick={exportCsv} disabled={!filtered.length}>
              Export CSV
            </Button>
          </>
        }
      />
      {notice && <p className="mb-4 rounded-lg border border-hairline bg-graphite px-4 py-2 text-[13px] text-muted">{notice}</p>}

      {records.length === 0 ? (
        <Panel>
          <EmptyState title="No telemetry yet">
            Send prompts in the <button className="text-luminous underline-offset-2 hover:underline" onClick={() => navigate('sandbox')}>Live Sandbox</button>, or import an audit log
            exported from the extension popup.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <Panel className="mb-6" bodyClassName="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Prompts inspected" value={records.length.toLocaleString()} />
            <Stat label="Sends blocked" value={blocked.length.toLocaleString()} tone={blocked.length ? 'crimson' : undefined} />
            <Stat label="Block rate" value={formatPct(records.length ? blocked.length / records.length : null)} />
            <Stat label="Latency p50" value={formatMs(percentile(latencies, 50))} unit="ms" hint="end-to-end inspection" />
            <Stat label="Latency p95" value={formatMs(percentile(latencies, 95))} unit="ms" />
          </Panel>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Panel title="Blocks by category" subtitle="Blocked sends containing each category (1–10).">
              <BarList items={byCategory} />
            </Panel>
            <div className="grid gap-6">
              <Panel title="Blocks by engine route" subtitle="Tier 1 math · Tier 2 Path A/B · Tier 3 Path A/B.">
                <BarList items={byPath} />
              </Panel>
              <Panel title="Inspections by portal">
                <BarList items={byPortal} />
              </Panel>
            </div>
          </div>

          <Panel className="mb-6" title="Activity · last 24 hours" subtitle="Inspections per hour (hover for blocked count).">
            <Columns buckets={hourBuckets(records)} label={(v) => `${v} inspection${v === 1 ? '' : 's'}`} />
          </Panel>

          <Panel
            title="Redacted incident log"
            subtitle={`${filtered.length} of ${records.length} records`}
            actions={
              <>
                <select aria-label="Category filter" value={category} onChange={(e) => setCategory(e.target.value === 'all' ? 'all' : (Number(e.target.value) as CategoryId))} className="h-8 rounded-lg border border-hairline bg-obsidian px-2 text-[13px] text-alabaster">
                  <option value="all">All categories</option>
                  {CATEGORY_IDS.map((c) => (
                    <option key={c} value={c}>
                      {c} · {CATEGORIES[c].short}
                    </option>
                  ))}
                </select>
                <select aria-label="Portal filter" value={portal} onChange={(e) => setPortal(e.target.value)} className="h-8 rounded-lg border border-hairline bg-obsidian px-2 text-[13px] text-alabaster">
                  <option value="all">All portals</option>
                  {portals.map((p) => (
                    <option key={p} value={p}>
                      {PORTAL_LABEL[p] ?? p}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-[13px] text-muted">
                  <input type="checkbox" checked={onlyBlocked} onChange={(e) => setOnlyBlocked(e.target.checked)} className="accent-[#9553fb]" />
                  Blocked only
                </label>
                <Button size="sm" variant="ghost" onClick={clear}>
                  Clear
                </Button>
              </>
            }
            bodyClassName="p-0"
          >
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full min-w-[820px] text-left text-[13px]">
                <thead className="sticky top-0 bg-graphite text-xs text-subtle">
                  <tr className="border-b border-hairline">
                    <th className="px-5 py-2.5 font-medium">Time</th>
                    <th className="px-3 py-2.5 font-medium">Portal</th>
                    <th className="px-3 py-2.5 font-medium">Verdict</th>
                    <th className="px-3 py-2.5 font-medium">Categories</th>
                    <th className="px-3 py-2.5 font-medium">Route</th>
                    <th className="px-3 py-2.5 font-medium">Fingerprints</th>
                    <th className="px-5 py-2.5 text-right font-medium">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 300).map((r) => (
                    <tr key={r.id} className="border-b border-hairline align-top last:border-0">
                      <td className="metric px-5 py-2.5 whitespace-nowrap text-muted">{new Date(r.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                      <td className="px-3 py-2.5">{PORTAL_LABEL[r.portal] ?? r.portal}</td>
                      <td className="px-3 py-2.5">{r.blocked ? <Badge tone="crimson">Blocked</Badge> : <Badge tone="emerald">Allowed</Badge>}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {[...new Set(r.findings.map((f) => f.category))].map((c) => (
                            <Badge key={c}>
                              {c} · {CATEGORIES[c].short}
                            </Badge>
                          ))}
                          {!r.findings.length && <span className="text-subtle">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted">
                        {[...new Set(r.findings.map((f) => PATH_LABELS[f.path]))].join(', ') || '—'}
                        {r.tier2Route && <div className="text-subtle">Tier 2 route {r.tier2Route}{r.degraded ? ' · degraded' : ''}</div>}
                      </td>
                      <td className="metric px-3 py-2.5 text-xs text-subtle">
                        {r.findings.slice(0, 3).map((f) => (
                          <div key={f.fingerprint + f.type}>{f.fingerprint}</div>
                        ))}
                        {r.findings.length > 3 && <div>+{r.findings.length - 3}</div>}
                      </td>
                      <td className={cx('metric px-5 py-2.5 text-right', r.latencyMs > 1000 ? 'text-[#FCD34D]' : 'text-alabaster')}>{formatMs(r.latencyMs)} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
