import { useEffect, useRef, useState } from 'react';
import { toScanRecord } from '../../../engine/telemetry';
import { maskValue } from '../../../engine/redact';
import { CATEGORIES, PATH_LABELS, type Finding, type ScanInput, type ScanResult } from '../../../engine/types';
import { ADAPTERS } from '../../../extension/content/adapters';
import { BlockDrawer } from '../../../extension/content/block-drawer';
import { readEditable } from '../../../extension/content/dom-text';
import { PromptInterceptor, type InterceptorStatus } from '../../../extension/content/interceptor-core';
import type { RouteMode } from '../../../extension/messages';
import { Badge, Button, EmptyState, Panel, Segmented, Stat, WorkspaceHeader, cx, formatMs, type Tone } from '../../components/ui';
import { useEngine } from '../../state/engine';
import { useSandboxInbox } from '../../state/sandbox-inbox';
import { useTelemetry } from '../../state/telemetry';
import { PORTALS, PortalComposer, type Chip, type PortalId } from './PortalComposer';
import { SAMPLE_PROMPTS } from './samples';

const SANDBOX_SALT = 'aonix-workbench-sandbox';

const STATUS_TONE: Record<InterceptorStatus, Tone> = {
  idle: 'neutral',
  scanning: 'brand',
  blocked: 'crimson',
  sent: 'emerald',
  lifted: 'emerald',
  redacted: 'amber',
};

const STATUS_LABEL: Record<InterceptorStatus, string> = {
  idle: 'Idle',
  scanning: 'Inspecting…',
  blocked: 'Send blocked',
  sent: 'Delivered',
  lifted: 'Block lifted',
  redacted: 'Redacted — review & send',
};

interface Delivered {
  id: number;
  portal: PortalId;
  text: string;
  attachments: number;
}

let chipSeq = 0;

/** Inserts text at the caret through the editor's input pipeline (or simulates a real paste). */
function feedComposer(scope: HTMLElement, text: string, mode: 'type' | 'paste') {
  const editor = scope.querySelector<HTMLElement>('[contenteditable="true"]');
  if (!editor) return;
  editor.focus();
  const sel = window.getSelection();
  sel?.selectAllChildren(editor);
  sel?.collapseToEnd();
  if (mode === 'paste') {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  } else {
    document.execCommand('insertText', false, text);
  }
}

export function SandboxView() {
  const [portal, setPortal] = useState<PortalId>('claude');
  const [chips, setChips] = useState<Chip[]>([]);
  const [status, setStatus] = useState<InterceptorStatus>('idle');
  const [last, setLast] = useState<{ result: ScanResult; input: ScanInput } | null>(null);
  const [delivered, setDelivered] = useState<Delivered[]>([]);
  const scopeRef = useRef<HTMLDivElement>(null);
  const interceptorRef = useRef<PromptInterceptor | null>(null);

  const engine = useEngine();
  const addRecord = useTelemetry((s) => s.add);

  useEffect(() => {
    void engine.init();
  }, [engine]);

  // Install the shared interception core on the emulated composer.
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    const drawer = new BlockDrawer();
    const interceptor = new PromptInterceptor({
      adapter: ADAPTERS[portal],
      scope,
      tier3a: () => useEngine.getState().tier3a,
      asyncScanner: {
        scanAsync: (input) => {
          const s = useEngine.getState().asyncScanner;
          return s ? s.scanAsync(input) : Promise.resolve({ findings: [], timings: { tier2: 0, tier3b: 0 }, tier2Route: null });
        },
      },
      drawer,
      events: {
        onStatus: setStatus,
        onScan: (result, _blocked, input) => {
          setLast({ result, input });
          const valueOf = (f: Finding) => {
            const src = f.source.kind === 'attachment' ? input.attachments?.find((a) => a.id === (f.source as { attachmentId: string }).attachmentId)?.text : input.text;
            return src?.slice(f.rawStart, f.rawEnd) ?? f.id;
          };
          void toScanRecord(result, 'sandbox', SANDBOX_SALT, valueOf).then(addRecord);
        },
      },
    });
    interceptorRef.current = interceptor;
    const uninstall = interceptor.install();
    return () => {
      uninstall();
      interceptorRef.current = null;
    };
  }, [portal, addRecord]);

  // Hand-offs from other workspaces (Vault excerpts, attachment chips).
  const pending = useSandboxInbox((s) => s.pending);
  useEffect(() => {
    if (!pending) return;
    if (pending.portal && pending.portal !== portal) {
      setPortal(pending.portal);
      return;
    }
    const item = useSandboxInbox.getState().take();
    const scope = scopeRef.current;
    if (item && scope) requestAnimationFrame(() => feedComposer(scope, item.text, item.mode));
  }, [pending, portal]);

  const onSend = () => {
    const scope = scopeRef.current;
    const editor = scope?.querySelector<HTMLElement>('[contenteditable="true"]');
    if (!editor) return;
    const text = readEditable(editor).text;
    if (!text.trim() && chips.length === 0) return;
    setDelivered((d) => [{ id: Date.now(), portal, text, attachments: chips.length }, ...d].slice(0, 6));
    editor.replaceChildren();
    setChips([]);
  };

  const onLargePaste = (text: string) => {
    setChips((c) => [...c, { id: `chip-${++chipSeq}`, name: 'pasted-content.txt', size: new Blob([text]).size }]);
  };

  const route = engine.status?.route ?? null;
  const t = last?.result.timings;
  const mem = engine.status?.memoryMB ?? null;

  return (
    <>
      <WorkspaceHeader
        eyebrow="Live sandbox"
        title="Prompt Guard Sandbox"
        description="Structural emulations of the Claude, ChatGPT and Gemini composers running the extension's own interception core. Press Enter or Send to inspect; paste 1,200+ characters to create a pasted-content.txt chip."
        actions={
          <Segmented<RouteMode>
            label="Hardware override"
            value={engine.routeMode}
            onChange={engine.setRouteMode}
            options={[
              { value: 'auto', label: 'Auto-detect WebGPU' },
              { value: 'force-b', label: 'Force WebGPU · Path B' },
              { value: 'force-a', label: 'Force Lexicon · Path A' },
            ]}
          />
        }
      />

      <Panel className="mb-6" bodyClassName="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Tier 2 route"
          value={route ? `Path ${route}` : '—'}
          hint={engine.status ? (route === 'B' ? 'WebGPU · privacy-filter' : 'CPU · FST lexicon + MiniLM') : 'engine starting'}
          tone={route === 'B' ? undefined : route === 'A' ? 'amber' : undefined}
        />
        <Stat label="Tier 1 · Math" value={formatMs(t?.tier1)} unit="ms" />
        <Stat label="Tier 3 · A MinHash" value={formatMs(t?.tier3a)} unit="ms" />
        <Stat label="Tier 2" value={formatMs(t?.tier2)} unit="ms" />
        <Stat label="Tier 3 · B EDM" value={formatMs(t?.tier3b)} unit="ms" />
        <Stat
          label="Engine memory"
          value={mem != null ? mem.toFixed(1) : '—'}
          unit="/ 150 MB"
          hint={engine.status?.memoryMethod}
          tone={mem != null && mem > 105 ? 'amber' : undefined}
        />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <div className="min-w-0 space-y-6">
          <Panel
            title="Composer"
            subtitle={`Emulating ${PORTALS.find((p) => p.id === portal)!.host}`}
            actions={<Segmented label="Portal" value={portal} onChange={(p) => { setPortal(p); setChips([]); }} options={PORTALS.map((p) => ({ value: p.id, label: p.label }))} />}
          >
            <div ref={scopeRef}>
              <PortalComposer
                key={portal}
                portal={portal}
                chips={chips}
                onRemoveChip={(id) => setChips((c) => c.filter((x) => x.id !== id))}
                onSend={onSend}
                onLargePaste={onLargePaste}
                footer={<span className="text-xs text-subtle">Enter to send · Shift+Enter for newline</span>}
              />
            </div>
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-muted">Test prompts</p>
              <div className="flex flex-wrap gap-2">
                {SAMPLE_PROMPTS.map((s) => (
                  <Button key={s.id} size="sm" variant="secondary" onClick={() => scopeRef.current && feedComposer(scopeRef.current, s.text, s.mode)}>
                    <span className={cx('size-1.5 rounded-full', s.expect === 'block' ? 'bg-crimson' : 'bg-emerald')} aria-hidden />
                    {s.label}
                  </Button>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Delivered to portal" subtitle="Prompts that passed every tier reach the portal's own send handler.">
            {delivered.length === 0 ? (
              <EmptyState title="Nothing delivered yet" />
            ) : (
              <ul className="divide-y divide-hairline">
                {delivered.map((d) => (
                  <li key={d.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                      <Badge tone="emerald">Sent</Badge>
                      {PORTALS.find((p) => p.id === d.portal)!.label}
                      {d.attachments > 0 && <span>· {d.attachments} attachment(s)</span>}
                    </div>
                    <p className="line-clamp-3 text-sm whitespace-pre-wrap text-alabaster">{d.text || '(attachments only)'}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="Inspection result" actions={<Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>}>
          {!last ? (
            <EmptyState title="Nothing inspected yet">Type a prompt or pick a test prompt, then press Enter.</EmptyState>
          ) : (
            <ResultDetail result={last.result} input={last.input} />
          )}
        </Panel>
      </div>
    </>
  );
}

function ResultDetail({ result, input }: { result: ScanResult; input: ScanInput }) {
  const blocked = result.verdict === 'block';
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className={cx('font-display text-lg font-bold', blocked ? 'text-[#FCA5A5]' : 'text-[#6EE7B7]')}>{blocked ? 'High-risk data blocked' : 'Clean — allowed'}</div>
          <div className="text-[13px] text-muted">
            {result.findings.length} finding{result.findings.length === 1 ? '' : 's'} · Tier 2 route {result.tier2Route ?? '—'}
          </div>
        </div>
        <div className="text-right">
          <div className="metric text-2xl font-semibold">{formatMs(result.timings.total)}</div>
          <div className="text-xs text-subtle">ms end-to-end</div>
        </div>
      </div>
      {result.degradedReason && <p className="rounded-lg bg-amber/10 px-3 py-2 text-xs text-[#FCD34D]">{result.degradedReason}</p>}
      {result.findings.length > 0 && (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {result.findings.map((f) => {
            const src = f.source.kind === 'attachment' ? input.attachments?.find((a) => a.id === (f.source as { attachmentId: string }).attachmentId)?.text ?? '' : input.text;
            return (
              <li key={`${f.id}-${f.source.kind}`} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="crimson">Cat {f.category}</Badge>
                  <span className="text-sm font-medium">{f.label}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <code className="rounded bg-graphite-2 px-1.5 py-0.5 text-alabaster">{maskValue(src.slice(f.rawStart, f.rawEnd))}</code>
                  <span>{PATH_LABELS[f.path]}</span>
                  <span>{f.evidence}</span>
                  <span>{f.source.kind === 'attachment' ? 'attachment chip' : `chars ${f.rawStart}–${f.rawEnd}`}</span>
                </div>
                <div className="mt-1 text-xs text-subtle">{CATEGORIES[f.category].label}</div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
