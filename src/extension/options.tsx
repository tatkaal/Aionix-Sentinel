// Options page: protected data (Categories 8–10) managed inside the extension, and the live test kit.
// Protected text is fingerprinted here (Tier 3 Path A) and embedded/hashed in the offscreen document
// (Tier 3 Path B); only the fingerprints are stored. The text lives in this page's memory until saved.
import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { KitPrompt, TestKit } from '../engine/bench/test-kit';
import { CUSTOM_VAULT_KEY, fingerprintCustom, MAX_CUSTOM_CHARS, PROTECTED_TYPES, type CustomVaultRecord, type ProtectedType } from '../engine/tier3/custom-vault';
import { decodeVault, type VaultAsset } from '../engine/tier3/vault-format';
import { CATEGORIES, type CategoryId } from '../engine/types';
import { AionixLogo } from '../shared/brand/AionixLogo';
import { Badge, Button, cx, Panel, Segmented } from '../workbench/components/ui';
import type { BackgroundRequest, IndexedEdm, StatusResponse } from './messages';
import './options.css';

const send = <T,>(msg: BackgroundRequest) => chrome.runtime.sendMessage(msg) as Promise<T>;
const readCustom = async () => ((await chrome.storage.local.get(CUSTOM_VAULT_KEY))[CUSTOM_VAULT_KEY] as CustomVaultRecord[] | undefined) ?? [];
const KIND_LABEL = { code: 'Code', prose: 'Document', table: 'Records (CSV)' } as const;

function CategoryBadge({ id }: { id: CategoryId }) {
  return <Badge tone={id >= 8 ? 'amber' : 'crimson'}>{`Cat ${id} · ${CATEGORIES[id].short}`}</Badge>;
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((key: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    });
  }, []);
  return { copied, copy };
}

// ── Protected data ────────────────────────────────────────────────────────────
function ProtectedData({ kit, records, refresh }: { kit: TestKit | null; records: CustomVaultRecord[]; refresh: () => void }) {
  const [demo, setDemo] = useState<VaultAsset[]>([]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ProtectedType>('code');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'emerald' | 'crimson'; text: string } | null>(null);

  useEffect(() => {
    void fetch(chrome.runtime.getURL('engine/corporate-vault.bin'))
      .then((r) => r.arrayBuffer())
      .then((b) => setDemo(decodeVault(b)))
      .catch(() => setDemo([]));
    void send<StatusResponse>({ target: 'background', type: 'status' }).then(setStatus);
  }, [records]);

  const loadSample = (id: string) => {
    const s = kit?.samples.find((x) => x.id === id);
    if (!s) return;
    setTitle(s.title);
    setType(s.type);
    setText(s.text);
    setMessage(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setText((await file.text()).slice(0, MAX_CUSTOM_CHARS));
    if (!title) setTitle(file.name);
    if (/\.csv$/i.test(file.name) && type !== 'patients') setType('customers');
  };

  const protect = async () => {
    if (!title.trim() || text.trim().length < 40) return;
    setBusy(true);
    setMessage(null);
    const id = `custom-${Date.now().toString(36)}`;
    const t = PROTECTED_TYPES[type];
    try {
      const fp = fingerprintCustom(id, title.trim(), type, text);
      const res = await send<IndexedEdm | { error: string }>({ target: 'background', type: 'vault-index', doc: { id, title: title.trim(), kind: t.kind, category: t.category, text: text.slice(0, MAX_CUSTOM_CHARS) } });
      const edm = res && !('error' in res) ? res : null;
      const record: CustomVaultRecord = {
        id,
        title: title.trim(),
        type,
        kind: t.kind,
        category: t.category,
        addedAt: Date.now(),
        chars: Math.min(text.length, MAX_CUSTOM_CHARS),
        shingles: fp.shingles,
        vault: fp.vault,
        edm: edm?.edm ?? null,
        vectors: edm?.vectors ?? 0,
        fieldHashes: edm?.fieldHashes ?? 0,
      };
      await chrome.storage.local.set({ [CUSTOM_VAULT_KEY]: [...(await readCustom()), record] });
      setMessage({
        tone: 'emerald',
        text: `Protected “${record.title}”: ${record.shingles.toLocaleString()} shingle fingerprints, ${record.vectors} vectors, ${record.fieldHashes} salted field hashes. The text itself was not stored.${edm ? '' : ' (Tier 3 Path B was unavailable; fingerprints for Path A were saved.)'}`,
      });
      setTitle('');
      setText('');
      refresh();
    } catch (e) {
      setMessage({ tone: 'crimson', text: `Could not protect this item: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id?: string) => {
    await chrome.storage.local.set({ [CUSTOM_VAULT_KEY]: id ? (await readCustom()).filter((r) => r.id !== id) : [] });
    refresh();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
      <Panel
        title="Protect new data"
        subtitle="Paste or load a file. It is fingerprinted locally — Bloom + MinHash for excerpts, MiniLM vectors and salted hashes for records — and only those fingerprints are kept."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted">Fictional samples:</span>
            {kit?.samples.map((s) => (
              <Button key={s.id} size="sm" variant="ghost" onClick={() => loadSample(s.id)} data-sample={s.id}>
                {s.fileName}
              </Button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block text-[13px] text-muted">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Pricing engine (src/pricing.ts)"
              className="h-9 w-full rounded-lg border border-hairline bg-obsidian px-3 text-sm text-alabaster outline-none focus:border-luminous"
              aria-label="Title"
            />
          </label>
          <div>
            <span className="mb-1 block text-[13px] text-muted">Type</span>
            <Segmented<ProtectedType>
              label="Type"
              size="sm"
              value={type}
              onChange={setType}
              options={(Object.keys(PROTECTED_TYPES) as ProtectedType[]).map((k) => ({ value: k, label: PROTECTED_TYPES[k].label }))}
            />
            <p className="mt-1.5 text-xs text-subtle">
              Category {PROTECTED_TYPES[type].category} · {PROTECTED_TYPES[type].hint}
            </p>
          </div>
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-[13px] text-muted">
              Content
              <span className="metric text-xs text-subtle">
                {text.length.toLocaleString()} / {MAX_CUSTOM_CHARS.toLocaleString()} chars
              </span>
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_CUSTOM_CHARS))}
              rows={11}
              spellCheck={false}
              aria-label="Content"
              placeholder="Paste source code, a document, or a CSV with a header row…"
              className="w-full resize-y rounded-lg border border-hairline bg-obsidian p-3 font-mono text-[12.5px] leading-relaxed text-alabaster outline-none focus:border-luminous"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={busy || !title.trim() || text.trim().length < 40} onClick={() => void protect()} data-action="protect">
              {busy ? 'Fingerprinting…' : 'Protect'}
            </Button>
            <label className="cursor-pointer text-[13px] text-muted hover:text-alabaster">
              <input type="file" className="sr-only" accept=".txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py,.java,.go,.rs,.cs,.sql,.yaml,.yml" onChange={(e) => void onFile(e.target.files?.[0])} />
              Load a file…
            </label>
          </div>
          {message && (
            <p role="status" className={cx('rounded-lg px-3 py-2 text-[13px]', message.tone === 'emerald' ? 'bg-emerald/10 text-[#6EE7B7]' : 'bg-crimson/10 text-[#FCA5A5]')}>
              {message.text}
            </p>
          )}
        </div>
      </Panel>

      <div className="space-y-5">
        <Panel
          title="Your protected data"
          subtitle="Added in this browser. Removing an item lifts its blocks immediately."
          actions={records.length > 0 && <Button size="sm" variant="danger" onClick={() => void remove()}>Remove all</Button>}
        >
          {records.length === 0 ? (
            <p className="text-[13px] text-subtle">Nothing protected yet. Load a fictional sample on the left and press Protect.</p>
          ) : (
            <ul className="divide-y divide-hairline" data-testid="protected-list">
              {records.map((r) => (
                <li key={r.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-alabaster">{r.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <CategoryBadge id={r.category} />
                      <Badge>{PROTECTED_TYPES[r.type].label}</Badge>
                    </div>
                    <div className="metric mt-1.5 text-xs text-subtle">
                      {r.chars.toLocaleString()} chars indexed · {r.shingles.toLocaleString()} shingles · {r.vectors} vectors · {r.fieldHashes} field hashes ·{' '}
                      {new Date(r.addedAt).toLocaleString()}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => void remove(r.id)} aria-label={`Remove ${r.title}`}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Built-in demo vault" subtitle="Ships with the extension as fingerprints only (fictional assets). Used by the Category 8–10 test prompts marked “demo vault”.">
          <ul className="divide-y divide-hairline">
            {demo.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1 truncate text-sm">{a.title}</div>
                <Badge>{KIND_LABEL[a.kind]}</Badge>
                <CategoryBadge id={a.category} />
              </li>
            ))}
          </ul>
          <p className="metric mt-3 text-xs text-subtle">
            Exact-data-match index: {status?.engine ? `${status.engine.edmVectors} vectors · ${status.engine.edmFields} salted field hashes (incl. yours)` : 'engine starting…'}
          </p>
        </Panel>
      </div>
    </div>
  );
}

// ── Live test kit ─────────────────────────────────────────────────────────────
function PromptRow({ p, k, copy, copied, protectedIds, kit }: { p: KitPrompt; k: string; copy: (k: string, t: string) => void; copied: string | null; protectedIds: Set<string>; kit: TestKit }) {
  const sample = p.needs?.startsWith('sample:') ? kit.samples.find((s) => `sample:${s.id}` === p.needs) : null;
  const ready = !sample || protectedIds.has(sample.title);
  return (
    <li className="grid gap-2 py-3.5 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-alabaster">{p.title}</span>
          <Badge tone={p.expect === 'block' ? 'crimson' : 'emerald'}>{p.expect === 'block' ? 'Expect: blocked' : 'Expect: sent'}</Badge>
          {p.needs === 'demo-vault' && <Badge tone="brand">uses demo vault</Badge>}
          {sample && <Badge tone={ready ? 'emerald' : 'amber'}>{ready ? `${sample.fileName} protected` : `protect ${sample.fileName} first`}</Badge>}
        </div>
        <pre className="mt-1.5 max-h-28 overflow-auto rounded-lg bg-obsidian p-2.5 font-mono text-xs whitespace-pre-wrap text-muted">{p.text}</pre>
        {p.paste && (
          <p className="mt-1 text-xs text-subtle">
            First paste the attachment ({p.paste.length.toLocaleString()} chars) with Ctrl+V. Claude turns it into a “Pasted text” chip; ChatGPT and Gemini have it checked
            as you paste, because ChatGPT uploads a long paste as a file as soon as it is added.
          </p>
        )}
        <p className="mt-1 text-xs text-subtle">{p.note}</p>
      </div>
      <div className="flex gap-2 sm:flex-col">
        <Button size="sm" onClick={() => copy(k, p.text)}>
          {copied === k ? 'Copied' : 'Copy prompt'}
        </Button>
        {p.paste && (
          <Button size="sm" variant="ghost" onClick={() => copy(`${k}:paste`, p.paste!)}>
            {copied === `${k}:paste` ? 'Copied' : 'Copy attachment'}
          </Button>
        )}
      </div>
    </li>
  );
}

function TestKitView({ kit, records }: { kit: TestKit; records: CustomVaultRecord[] }) {
  const [tab, setTab] = useState<string>('1');
  const { copied, copy } = useCopy();
  const protectedIds = useMemo(() => new Set(records.map((r) => r.title)), [records]);
  const cat = kit.categories.find((c) => String(c.id) === tab);
  return (
    <Panel
      title="Live test kit"
      subtitle="Open claude.ai, chatgpt.com or gemini.google.com, paste a prompt into the composer and press Enter (or click Send). Blocked prompts never leave the browser; “sent” prompts go to the AI as normal."
    >
      <div className="mb-4">
        <Segmented
          label="Category"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[...kit.categories.map((c) => ({ value: String(c.id), label: `${c.id}` })), { value: 'edge', label: '24 edge cases' }]}
        />
      </div>
      {cat ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <CategoryBadge id={cat.id} />
            <span className="text-sm font-semibold">{cat.title}</span>
          </div>
          <p className="mb-4 text-[13px] text-muted">{cat.how}</p>
          <ul className="divide-y divide-hairline">
            {cat.prompts.map((p, i) => (
              <PromptRow key={i} k={`${cat.id}-${i}`} p={p} copy={copy} copied={copied} protectedIds={protectedIds} kit={kit} />
            ))}
          </ul>
        </>
      ) : (
        <ul className="divide-y divide-hairline">
          {kit.edgeCases.map((c) => (
            <li key={c.id} className="grid gap-2 py-3.5 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="metric text-xs text-subtle">{c.id}</span>
                  <span className="text-sm font-medium text-alabaster">{c.title}</span>
                  <Badge tone={c.expect === 'block' ? 'crimson' : 'emerald'}>{c.expect === 'block' ? 'Expect: blocked' : 'Expect: sent'}</Badge>
                  {c.categories.map((id) => (
                    <CategoryBadge key={id} id={id} />
                  ))}
                </div>
                {c.steps ? (
                  <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-xs text-muted">
                    {c.steps.map((s, i) => (
                      <li key={i}>
                        {s.paste ? `Paste the attachment (${s.paste.length.toLocaleString()} chars), then send “${s.text}”` : `Send “${s.text}”`} → expect {s.expect === 'block' ? 'blocked' : 'sent'}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <pre className="mt-1.5 max-h-24 overflow-auto rounded-lg bg-obsidian p-2.5 font-mono text-xs whitespace-pre-wrap text-muted">{c.text}</pre>
                )}
              </div>
              <div className="flex gap-2 sm:flex-col">
                <Button size="sm" onClick={() => copy(c.id, c.steps?.[0]?.text ?? c.text)}>
                  {copied === c.id ? 'Copied' : 'Copy prompt'}
                </Button>
                {(c.paste ?? c.steps?.find((s) => s.paste)?.paste) && (
                  <Button size="sm" variant="ghost" onClick={() => copy(`${c.id}:paste`, (c.paste ?? c.steps!.find((s) => s.paste)!.paste)!)}>
                    {copied === `${c.id}:paste` ? 'Copied' : 'Copy attachment'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Options() {
  const [view, setView] = useState<'data' | 'kit'>(location.hash === '#kit' ? 'kit' : 'data');
  const [kit, setKit] = useState<TestKit | null>(null);
  const [records, setRecords] = useState<CustomVaultRecord[]>([]);
  const refresh = useCallback(() => void readCustom().then(setRecords), []);

  useEffect(() => {
    void fetch(chrome.runtime.getURL('engine/test-kit.json'))
      .then((r) => r.json() as Promise<TestKit>)
      .then(setKit)
      .catch(() => setKit(null));
    refresh();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[CUSTOM_VAULT_KEY]) refresh();
    };
    chrome.storage.onChanged.addListener(onChange);
    const onHash = () => setView(location.hash === '#kit' ? 'kit' : 'data');
    addEventListener('hashchange', onHash);
    return () => {
      chrome.storage.onChanged.removeListener(onChange);
      removeEventListener('hashchange', onHash);
    };
  }, [refresh]);

  return (
    <div className="min-h-screen bg-obsidian text-alabaster">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
          <div className="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
            <AionixLogo className="h-[26px] w-auto" />
            <span className="font-display text-[17px] font-bold">Aionix Sentinel</span>
          </div>
          <Segmented
            label="Section"
            value={view}
            onChange={(v) => {
              setView(v);
              history.replaceState(null, '', v === 'kit' ? '#kit' : '#data');
            }}
            options={[
              { value: 'data', label: 'Protected data' },
              { value: 'kit', label: 'Live test kit' },
            ]}
          />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <h1 className="mb-1 font-display text-2xl font-bold [text-wrap:balance]">{view === 'data' ? 'Protected data' : 'Live test kit'}</h1>
        <p className="mb-6 max-w-3xl text-[14px] text-muted">
          {view === 'data'
            ? 'Categories 8–10 depend on what your organisation protects. Add code, documents or customer / patient records here; copies of them pasted into Claude, ChatGPT or Gemini are blocked.'
            : 'Copy-ready prompts for every category and the 24 stakeholder edge cases, with the expected outcome. All values are synthetic.'}
        </p>
        {view === 'data' ? <ProtectedData kit={kit} records={records} refresh={refresh} /> : kit ? <TestKitView kit={kit} records={records} /> : <p className="text-sm text-subtle">Test kit not found in this build.</p>}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
