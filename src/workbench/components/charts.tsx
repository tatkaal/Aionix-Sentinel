// Small SVG/HTML chart primitives for the Workbench (no chart library).
// Dark-surface palette validated with the dataviz validator against #11131F:
//   Path A #199e70 · Path B #9553fb (CVD ΔE 24.0, normal-vision ΔE 33.8, both ≥ 3:1).
// Single-series charts use the brand violet; identity lives in the axis labels.
import { useState, type ReactNode } from 'react';
import { cx } from './ui';

export const SERIES = { a: '#199e70', b: '#9553fb', single: '#9553fb' } as const;

function Tooltip({ children }: { children: ReactNode }) {
  return (
    <div role="tooltip" className="pointer-events-none absolute right-0 bottom-full z-20 mb-1.5 rounded-md border border-hairline bg-graphite-2 px-2.5 py-1.5 text-xs whitespace-nowrap text-alabaster shadow-lg">
      {children}
    </div>
  );
}

export interface BarItem {
  key: string;
  label: ReactNode;
  value: number;
  hint?: string;
}

/** Horizontal single-hue bars; labels and values are text, the bar carries magnitude only. */
export function BarList({ items, format = (v) => String(v), empty = 'No data yet', max }: { items: BarItem[]; format?: (v: number) => string; empty?: string; max?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!items.length || total === 0) return <p className="py-6 text-center text-[13px] text-subtle">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li
          key={it.key}
          className={cx('relative grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_3.5rem] items-center gap-3 rounded-md px-1 py-0.5', hover === it.key && 'bg-white/[0.03]')}
          onMouseEnter={() => setHover(it.key)}
          onMouseLeave={() => setHover(null)}
        >
          <span className="truncate text-[13px] text-muted">{it.label}</span>
          <span className="relative h-2.5">
            <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-hairline" />
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-300"
              style={{ width: `${Math.max(it.value > 0 ? 1.5 : 0, (it.value / top) * 100)}%`, background: SERIES.single }}
            />
          </span>
          <span className="metric text-right text-[13px] text-alabaster">{format(it.value)}</span>
          {hover === it.key && (
            <Tooltip>
              <span className="text-muted">{it.label}</span> · <span className="metric">{format(it.value)}</span>
              {total > 0 && <span className="text-subtle"> · {((it.value / total) * 100).toFixed(1)}% of total</span>}
              {it.hint && <div className="text-subtle">{it.hint}</div>}
            </Tooltip>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Legend({ items }: { items: { label: string; color: string; note?: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-3.5 rounded-[3px]" style={{ background: i.color }} />
          {i.label}
          {i.note && <span className="text-subtle">{i.note}</span>}
        </span>
      ))}
    </div>
  );
}

export interface PairedRow {
  key: string;
  label: string;
  a: number | null;
  b: number | null;
  target?: { value: number; label: string };
}

/** Path A vs Path B on a shared 0–1 scale, direct-labelled; a target tick when one applies. */
export function PairedBars({ rows, format, aLabel = 'Path A', bLabel = 'Path B' }: { rows: PairedRow[]; format: (v: number | null) => string; aLabel?: string; bLabel?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Legend items={[{ label: aLabel, color: SERIES.a }, { label: bLabel, color: SERIES.b }]} />
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.key} className="relative grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3" onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}>
            <span className="text-[13px] text-muted">{r.label}</span>
            <div className="relative space-y-[2px]">
              {(['a', 'b'] as const).map((s) => {
                const v = r[s];
                return (
                  <div key={s} className="grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-2">
                    <div className="relative h-2.5">
                      <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-hairline" />
                      {v !== null && (
                        <span aria-hidden className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${Math.max(0.8, v * 100)}%`, background: SERIES[s] }} />
                      )}
                      {r.target && <span aria-hidden className="absolute -inset-y-1 w-px bg-alabaster/50" style={{ left: `${r.target.value * 100}%` }} />}
                    </div>
                    <span className="metric text-right text-xs text-alabaster">{v === null ? 'n/a' : format(v)}</span>
                  </div>
                );
              })}
              {hover === r.key && (
                <Tooltip>
                  {r.label}: <span className="metric">{aLabel} {format(r.a)}</span> · <span className="metric">{bLabel} {format(r.b)}</span>
                  {r.target && <div className="text-subtle">Blueprint target {r.target.label} (white tick)</div>}
                </Tooltip>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 2×2 confusion matrix. Correct cells read as "good", errors as "critical" — always with labels. */
export function ConfusionMatrix({ tp, fp, tn, fn, caption }: { tp: number; fp: number; tn: number; fn: number; caption?: string }) {
  const cell = (label: string, n: number, ok: boolean, desc: string) => (
    <td className={cx('rounded-lg px-3 py-2.5 align-top', ok ? 'bg-emerald/10' : n > 0 ? 'bg-crimson/12' : 'bg-white/[0.02]')}>
      <div className="flex items-center justify-between gap-2">
        <span className={cx('text-[11px] font-semibold tracking-wide', ok ? 'text-[#6EE7B7]' : n > 0 ? 'text-[#FCA5A5]' : 'text-subtle')}>{label}</span>
        <span className="metric text-lg font-semibold text-alabaster">{n}</span>
      </div>
      <div className="text-[11px] text-subtle">{desc}</div>
    </td>
  );
  return (
    <table className="w-full border-separate border-spacing-[3px] text-left">
      {caption && <caption className="mb-1 text-left text-xs text-muted">{caption}</caption>}
      <thead>
        <tr>
          <th className="w-24" />
          <th className="px-3 text-[11px] font-medium text-subtle">Predicted block</th>
          <th className="px-3 text-[11px] font-medium text-subtle">Predicted allow</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th className="pr-2 text-[11px] font-medium text-subtle">Must block</th>
          {cell('TP', tp, true, 'caught')}
          {cell('FN', fn, false, 'missed leak')}
        </tr>
        <tr>
          <th className="pr-2 text-[11px] font-medium text-subtle">Must allow</th>
          {cell('FP', fp, false, 'false alarm')}
          {cell('TN', tn, true, 'clean pass')}
        </tr>
      </tbody>
    </table>
  );
}

/** Vertical single-series columns (activity over time). */
export function Columns({ buckets, label }: { buckets: { key: string; label: string; value: number; sub?: number }[]; label: (v: number) => string }) {
  const [hover, setHover] = useState<string | null>(null);
  const top = Math.max(1, ...buckets.map((b) => b.value));
  return (
    <div>
      <div className="relative flex h-32 items-end gap-[2px] border-b border-hairline">
        {buckets.map((b) => (
          <div key={b.key} className="relative flex h-full min-w-0 flex-1 items-end justify-center" onMouseEnter={() => setHover(b.key)} onMouseLeave={() => setHover(null)}>
            <span className={cx('block w-full max-w-6 rounded-t-[4px]', hover === b.key ? 'opacity-100' : 'opacity-85')} style={{ height: `${(b.value / top) * 100}%`, minHeight: b.value ? 2 : 0, background: SERIES.single }} />
            {hover === b.key && (
              <Tooltip>
                <span className="text-muted">{b.label}</span> · <span className="metric">{label(b.value)}</span>
                {b.sub !== undefined && <span className="text-subtle"> · {b.sub} blocked</span>}
              </Tooltip>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-subtle">
        <span>{buckets[0]?.label}</span>
        <span>{buckets.at(-1)?.label}</span>
      </div>
    </div>
  );
}
