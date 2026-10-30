import { useEffect, useMemo, useState } from 'react';
import { MIN_HIT_RUN, MIN_JACCARD, type VaultMatch } from '../../../engine/tier3/minhash-detector';
import { shingles, stripBoilerplate, tokenize } from '../../../engine/tier3/shingle';
import type { AssetKind, VaultAsset } from '../../../engine/tier3/vault-format';
import { CATEGORIES, type CategoryId } from '../../../engine/types';
import { Badge, Button, EmptyState, Panel, Segmented, WorkspaceHeader, cx } from '../../components/ui';
import { navigate } from '../../router';
import { useEngine } from '../../state/engine';
import { useSandboxInbox } from '../../state/sandbox-inbox';
import manifest from '../../../../data/vault/manifest.json';

const docs = import.meta.glob('/data/vault/*.{ts,md,csv}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const docText = (file: string) => docs[`/data/vault/${file}`] ?? '';

interface CustomDoc {
  id: string;
  title: string;
  kind: AssetKind;
  category: CategoryId;
  text: string;
}

const KIND_LABEL: Record<AssetKind, string> = { code: 'Source code', prose: 'Document', table: 'Table export' };

function excerpt(kind: AssetKind, text: string): string {
  if (kind === 'code') return text.split('\n').slice(54, 69).join('\n');
  if (kind === 'table') return text.split('\n').slice(0, 4).join('\n');
  return text.split('\n\n').find((p) => p.split(' ').length > 60) ?? text.slice(0, 800);
}

function BloomGrid({ asset }: { asset: VaultAsset }) {
  const cols = 64;
  const rows = 24;
  const cells = [];
  for (let i = 0; i < cols * rows && i < asset.bloom.m; i++) {
    if (asset.bloom.bits[i >>> 3]! & (1 << (i & 7))) cells.push(<rect key={i} x={(i % cols) * 4} y={Math.floor(i / cols) * 4} width={3} height={3} rx={0.5} fill="#9553fb" />);
  }
  return (
    <svg viewBox={`0 0 ${cols * 4} ${rows * 4}`} className="h-auto w-full max-w-md rounded-md bg-obsidian p-1" role="img" aria-label={`First ${cols * rows} bits of the Bloom filter`}>
      {cells}
    </svg>
  );
}

function Pipeline({ asset, text }: { asset: VaultAsset; text: string }) {
  const stripped = stripBoilerplate(text);
  const tokens = tokenize(stripped);
  const sh = shingles(tokens).filter((s) => !s.generic);
  const removed = text.split('\n').length - stripped.split('\n').filter((l) => l.trim()).length;
  return (
    <ol className="space-y-5 text-[13px]">
      <li>
        <h4 className="font-medium text-alabaster">1 · Strip boilerplate</h4>
        <p className="text-muted">
          Imports, licence banners, comment-only and blank lines removed (<span className="metric">{removed}</span> lines). What remains is the proprietary signal.
        </p>
      </li>
      <li>
        <h4 className="font-medium text-alabaster">2 · 5-gram word shingles</h4>
        <p className="mb-2 text-muted">
          <span className="metric">{tokens.length.toLocaleString()}</span> tokens → <span className="metric">{asset.shingleCount.toLocaleString()}</span> distinct non-generic shingles (stopword-only shingles never count).
        </p>
        <ul className="space-y-1 rounded-lg bg-obsidian p-3 font-mono text-xs">
          {sh.slice(0, 6).map((s) => (
            <li key={s.token} className="flex gap-3">
              <span className="text-luminous">{s.hash.toString(16).padStart(8, '0')}</span>
              <span className="truncate text-muted">{tokens.slice(s.token, s.token + 5).map((t) => t.text).join(' ')}</span>
            </li>
          ))}
        </ul>
      </li>
      <li>
        <h4 className="font-medium text-alabaster">3 · Bloom filter</h4>
        <p className="mb-2 text-muted">
          m = <span className="metric">{asset.bloom.m.toLocaleString()}</span> bits · k = <span className="metric">{asset.bloom.k}</span> · fill{' '}
          <span className="metric">{(asset.bloom.fillRatio() * 100).toFixed(1)}%</span> · per-probe FP ≈{' '}
          <span className="metric">{asset.bloom.falsePositiveRate(asset.shingleCount).toExponential(1)}</span>. A block needs ≥ {MIN_HIT_RUN} consecutive hits.
        </p>
        <BloomGrid asset={asset} />
      </li>
      <li>
        <h4 className="font-medium text-alabaster">4 · MinHash signature (k = 64)</h4>
        <p className="mb-2 text-muted">Whole-document near-duplicates are caught when the estimated Jaccard ≥ {MIN_JACCARD}.</p>
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-obsidian p-3 font-mono text-[11px] text-muted sm:grid-cols-8">
          {Array.from(asset.signature.slice(0, 32)).map((v, i) => (
            <span key={i}>{v.toString(16).padStart(8, '0')}</span>
          ))}
        </div>
      </li>
      <li>
        <h4 className="font-medium text-alabaster">5 · What ships</h4>
        <p className="text-muted">
          corporate-vault.bin carries only Bloom bits and MinHash minima — no document text. Tier 3 Path B adds MiniLM vectors{asset.kind === 'table' ? ' and salted SHA-256 hashes of each row’s name, account / patient ID, e-mail and MRN' : ''}.
        </p>
      </li>
    </ol>
  );
}

export function VaultView() {
  const engine = useEngine();
  const push = useSandboxInbox((s) => s.push);
  const [selected, setSelected] = useState(manifest[0]!.id);
  const [tab, setTab] = useState<'raw' | 'pipeline'>('pipeline');
  const [custom, setCustom] = useState<CustomDoc[]>([]);
  const [form, setForm] = useState({ title: '', kind: 'prose' as AssetKind, category: 10 as CategoryId, text: '' });
  const [probe, setProbe] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void engine.init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const assets = engine.tier3a?.assets ?? [];
  const entries = [
    ...manifest.map((m) => ({ id: m.id, title: m.title, kind: m.kind as AssetKind, category: m.category as CategoryId, text: docText(m.file), owner: m.owner, custom: false })),
    ...custom.map((c) => ({ ...c, owner: 'Added in Workbench', custom: true })),
  ];
  const current = entries.find((e) => e.id === selected) ?? entries[0]!;
  const asset = assets.find((a) => a.id === current.id);

  const probeResult = useMemo<VaultMatch[]>(() => (probe.trim().length > 20 && engine.tier3a ? engine.tier3a.inspect(probe) : []), [probe, engine.tier3a]);
  const probeHit = probeResult.some((m) => m.run >= MIN_HIT_RUN || m.jaccard >= MIN_JACCARD);

  const send = (mode: 'type' | 'paste', text: string) => {
    push({ mode, text });
    navigate('sandbox');
  };

  const addCustom = async () => {
    if (!form.title.trim() || form.text.trim().length < 80) return;
    setBusy(true);
    const doc: CustomDoc = { id: `custom-${Date.now().toString(36)}`, title: form.title.trim(), kind: form.kind, category: form.category, text: form.text };
    await engine.addVaultDocument(doc);
    setCustom((c) => [...c, doc]);
    setSelected(doc.id);
    setForm({ title: '', kind: 'prose', category: 10, text: '' });
    setBusy(false);
  };

  return (
    <>
      <WorkspaceHeader
        eyebrow="Tier 3 · MinHash + Bloom · Orama EDM"
        title="Corporate Vault & Hashing Studio"
        description="The admin CI/CD hashing pipeline: proprietary assets are stripped of boilerplate, shingled into 5-grams, compiled into per-asset Bloom filters with MinHash signatures, and embedded into the local exact-data-match index. All four assets are fictional."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Panel title="Indexed assets" subtitle={`${assets.length} in corporate-vault.bin${custom.length ? ` (+${custom.length} added)` : ''}`} bodyClassName="p-2">
            <ul>
              {entries.map((e) => {
                const a = assets.find((x) => x.id === e.id);
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(e.id)}
                      className={cx('w-full rounded-lg px-3 py-2.5 text-left transition-colors', selected === e.id ? 'bg-luminous/10' : 'hover:bg-white/[0.03]')}
                    >
                      <div className={cx('text-[13.5px] font-medium', selected === e.id ? 'text-luminous' : 'text-alabaster')}>{e.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-subtle">
                        <span>{KIND_LABEL[e.kind]}</span>
                        <span>· Cat {e.category}</span>
                        {a && <span className="metric">· {a.shingleCount} shingles</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Add a corporate secret" subtitle="Indexed live into Tier 3 Path A (Bloom/MinHash) and Path B (vectors, row hashes).">
            <div className="space-y-3 text-[13px]">
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Title, e.g. Pricing model v7"
                className="h-9 w-full rounded-lg border border-hairline bg-obsidian px-3 text-alabaster placeholder:text-subtle"
              />
              <div className="flex flex-wrap gap-2">
                <Segmented<AssetKind> size="sm" label="Kind" value={form.kind} onChange={(kind) => setForm({ ...form, kind })} options={[{ value: 'prose', label: 'Document' }, { value: 'code', label: 'Code' }, { value: 'table', label: 'CSV' }]} />
                <select
                  aria-label="Category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: Number(e.target.value) as CategoryId })}
                  className="h-8 rounded-lg border border-hairline bg-obsidian px-2 text-alabaster"
                >
                  {([10, 8, 9] as CategoryId[]).map((c) => (
                    <option key={c} value={c}>
                      Cat {c} · {CATEGORIES[c].short}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
                rows={6}
                placeholder="Paste the confidential text (≥ 80 characters)…"
                className="w-full rounded-lg border border-hairline bg-obsidian px-3 py-2 font-mono text-xs text-alabaster placeholder:text-subtle"
              />
              <Button variant="primary" size="sm" disabled={busy || !form.title.trim() || form.text.trim().length < 80} onClick={() => void addCustom()}>
                {busy ? 'Indexing…' : 'Index into vault'}
              </Button>
            </div>
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <Panel
            title={current.title}
            subtitle={`${KIND_LABEL[current.kind]} · ${CATEGORIES[current.category].label} · owner: ${current.owner}`}
            actions={
              <>
                <Button size="sm" variant="secondary" onClick={() => send('type', `Can you review this?\n\n${excerpt(current.kind, current.text)}`)}>
                  {current.kind === 'code' ? 'Paste 15-line excerpt to Sandbox' : 'Paste excerpt to Sandbox'}
                </Button>
                <Button size="sm" variant="primary" disabled={current.text.length < 1200} onClick={() => send('paste', current.text)}>
                  Paste full document as chip
                </Button>
              </>
            }
          >
            <div className="mb-4">
              <Segmented size="sm" label="View" value={tab} onChange={setTab} options={[{ value: 'pipeline', label: 'Hashing pipeline' }, { value: 'raw', label: 'Raw document' }]} />
            </div>
            {tab === 'raw' ? (
              <pre className="max-h-[560px] overflow-auto rounded-lg bg-obsidian p-4 text-xs leading-relaxed whitespace-pre-wrap text-muted">{current.text}</pre>
            ) : asset ? (
              <Pipeline asset={asset} text={current.text} />
            ) : (
              <EmptyState title="Vault index not loaded">Run npm run data:vault to build corporate-vault.bin.</EmptyState>
            )}
          </Panel>

          <Panel title="Probe the vault" subtitle="Paste any text — this is exactly what Tier 3 Path A computes on send.">
            <textarea
              value={probe}
              onChange={(e) => setProbe(e.target.value)}
              rows={4}
              placeholder="Paste a paragraph, a few lines of code, or CSV rows…"
              className="mb-3 w-full rounded-lg border border-hairline bg-obsidian px-3 py-2 text-[13px] text-alabaster placeholder:text-subtle"
            />
            {probeResult.length > 0 && (
              <>
                <div className="mb-2">{probeHit ? <Badge tone="crimson">Would block (Cat {probeResult.find((m) => m.run >= MIN_HIT_RUN || m.jaccard >= MIN_JACCARD)!.asset.category})</Badge> : <Badge tone="emerald">No vault match</Badge>}</div>
                <table className="w-full text-left text-[13px]">
                  <thead className="text-xs text-subtle">
                    <tr>
                      <th className="py-1.5 font-medium">Asset</th>
                      <th className="py-1.5 text-right font-medium">Longest run</th>
                      <th className="py-1.5 text-right font-medium">Hits / probes</th>
                      <th className="py-1.5 text-right font-medium">MinHash J</th>
                    </tr>
                  </thead>
                  <tbody>
                    {probeResult.map((m) => (
                      <tr key={m.asset.id} className="border-t border-hairline">
                        <td className="py-1.5">{m.asset.title}</td>
                        <td className={cx('metric py-1.5 text-right', m.run >= MIN_HIT_RUN && 'text-[#FCA5A5]')}>{m.run}</td>
                        <td className="metric py-1.5 text-right text-muted">
                          {m.hits} / {m.probes}
                        </td>
                        <td className="metric py-1.5 text-right text-muted">{m.jaccard.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
