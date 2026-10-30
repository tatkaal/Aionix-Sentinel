// Shared interception core. The extension content script and the Workbench Sandbox both run this
// class; only the scope (document vs. sandbox element), adapter and scanner transport differ.
import { promptDigest } from '../../engine/digest';
import { mergeAsync, scanSync, type AsyncScanner, type SyncDetector } from '../../engine/pipeline';
import { maskValue } from '../../engine/redact';
import { CATEGORIES, PATH_LABELS, redactionTag, type Finding, type ScanInput, type ScanResult } from '../../engine/types';
import type { PortalAdapter } from './adapters/types';
import { GENERIC_CHIP_SELECTORS, GENERIC_COMPOSER_SELECTORS } from './adapters/types';
import { AttachmentShadowStore, LARGE_PASTE_THRESHOLD } from './attachment-store';
import { BlockDrawer, type DrawerItem } from './block-drawer';
import { readEditable, replaceSpans, selectSpan } from './dom-text';

export type InterceptorStatus = 'idle' | 'scanning' | 'blocked' | 'sent' | 'lifted' | 'redacted';

export interface InterceptorEvents {
  onStatus?(status: InterceptorStatus): void;
  /** Every completed inspection (clean or blocked). */
  onScan?(result: ScanResult, blocked: boolean, input: ScanInput): void;
  /** A prompt passed all tiers; the MAIN-world backstop may let a matching body through. */
  onVerified?(digest: string): void;
  onAttachmentsChanged?(): void;
}

export interface InterceptorOptions {
  adapter: PortalAdapter;
  scope: Document | HTMLElement;
  tier3a: () => SyncDetector | null;
  asyncScanner: AsyncScanner | null;
  drawer?: BlockDrawer;
  events?: InterceptorEvents;
  /** Tier 2 SLA. Past it the prompt fails open on the already-clean Tier 1/3A verdict. */
  asyncTimeoutMs?: number;
}

interface BlockState {
  input: ScanInput;
  result: ScanResult;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);
}

export class PromptInterceptor {
  readonly store = new AttachmentShadowStore();
  private readonly drawer: BlockDrawer;
  private bypass = false;
  private pending = false;
  private block: BlockState | null = null;
  /** Attachment ids whose paste-time pre-scan found something (chip gets a crimson outline). */
  private flagged = new Set<string>();
  private lastEditable: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private teardown: (() => void)[] = [];

  constructor(private readonly opts: InterceptorOptions) {
    this.drawer = opts.drawer ?? new BlockDrawer();
  }

  private get root(): ParentNode {
    return this.opts.scope;
  }

  private get target(): EventTarget {
    return this.opts.scope instanceof Document ? this.opts.scope : this.opts.scope;
  }

  install(): () => void {
    const t = this.target;
    const on = (type: string, fn: (e: Event) => void) => {
      t.addEventListener(type, fn, true);
      this.teardown.push(() => t.removeEventListener(type, fn, true));
    };
    on('keydown', (e) => this.onKeydown(e as KeyboardEvent));
    on('click', (e) => this.onClick(e as MouseEvent));
    on('submit', (e) => this.onSubmit(e as SubmitEvent));
    on('paste', (e) => this.onPaste(e as ClipboardEvent));
    on('focusin', (e) => {
      const el = e.target as HTMLElement;
      if (el?.isContentEditable || el instanceof HTMLTextAreaElement) this.lastEditable = el;
    });
    this.observe();
    return () => this.uninstall();
  }

  uninstall(): void {
    this.teardown.forEach((f) => f());
    this.teardown = [];
    this.observer?.disconnect();
    this.drawer.hide();
  }

  // ── Composer lookup (4 layers) ────────────────────────────────────────────
  findComposer(): HTMLElement | null {
    for (const sel of this.opts.adapter.composerSelectors) {
      const el = this.root.querySelector<HTMLElement>(sel);
      if (el) return el;
    }
    for (const sel of GENERIC_COMPOSER_SELECTORS) {
      const el = this.root.querySelector<HTMLElement>(sel);
      if (el) return el;
    }
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.isContentEditable || active instanceof HTMLTextAreaElement) && this.inScope(active)) return active;
    return this.lastEditable?.isConnected ? this.lastEditable : null;
  }

  private findSendButton(): HTMLElement | null {
    for (const sel of this.opts.adapter.sendButtonSelectors) {
      const el = this.root.querySelector<HTMLElement>(sel);
      if (el) return el;
    }
    return null;
  }

  private inScope(node: Node): boolean {
    return this.opts.scope instanceof Document ? true : this.opts.scope.contains(node);
  }

  private isInComposer(target: EventTarget | null): boolean {
    const composer = this.findComposer();
    return !!composer && target instanceof Node && (composer === target || composer.contains(target));
  }

  // ── Event hooks ───────────────────────────────────────────────────────────
  private onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    if (!this.isInComposer(e.target)) return;
    void this.handleSend(e, 'enter');
  }

  private onClick(e: MouseEvent) {
    const t = e.target as Element | null;
    if (!t?.closest) return;
    const hit = this.opts.adapter.sendButtonSelectors.some((s) => t.closest(s));
    if (!hit || !this.inScope(t)) return;
    void this.handleSend(e, 'click');
  }

  private onSubmit(e: SubmitEvent) {
    const form = e.target as HTMLFormElement;
    const composer = this.findComposer();
    if (!composer || !form.contains(composer)) return;
    void this.handleSend(e, 'submit');
  }

  private onPaste(e: ClipboardEvent) {
    if (!this.isInComposer(e.target)) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text.length < LARGE_PASTE_THRESHOLD) return;
    // Captured before the portal converts it into a pasted-content.txt chip.
    const att = this.store.add(text);
    const pre = scanSync({ text: '', attachments: [{ id: att.id, name: att.name, text }] }, this.opts.tier3a());
    if (pre.findings.length) this.flagged.add(att.id);
  }

  // ── Chip lifecycle ────────────────────────────────────────────────────────
  private observe() {
    const node = this.opts.scope instanceof Document ? this.opts.scope.documentElement : this.opts.scope;
    const chipSel = [...this.opts.adapter.chipSelectors, ...GENERIC_CHIP_SELECTORS].join(',');
    this.observer = new MutationObserver((records) => {
      let added = false;
      let removed = false;
      for (const r of records) {
        if (r.addedNodes.length) added = true;
        if (r.removedNodes.length) removed = true;
      }
      if (added && this.store.hasUnbound()) {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (!(n instanceof Element)) continue;
            const chips = n.matches(chipSel) ? [n] : [...n.querySelectorAll(chipSel)];
            for (const chip of chips) {
              if (this.store.findByChip(chip)) continue;
              const att = this.store.bindNextUnbound(chip);
              if (att && this.flagged.has(att.id)) {
                chip.setAttribute('data-aionix-flagged', 'true');
                (chip as HTMLElement).style.outline = '2px solid #EF4444';
                (chip as HTMLElement).style.outlineOffset = '2px';
              }
              if (att) this.opts.events?.onAttachmentsChanged?.();
            }
          }
        }
      }
      if (removed) {
        const gone = this.store.sweepDetached();
        if (gone.length) {
          gone.forEach((id) => this.flagged.delete(id));
          this.opts.events?.onAttachmentsChanged?.();
          this.onAttachmentsRemoved(gone);
        }
      }
    });
    this.observer.observe(node, { childList: true, subtree: true });
  }

  /** Chip removal automatically lifts a block that only the chip caused. */
  private onAttachmentsRemoved(ids: string[]) {
    if (!this.block) return;
    const remaining = this.block.result.findings.filter((f) => !(f.source.kind === 'attachment' && ids.includes(f.source.attachmentId)));
    if (remaining.length === this.block.result.findings.length) return;
    const input: ScanInput = { ...this.block.input, attachments: (this.block.input.attachments ?? []).filter((a) => !ids.includes(a.id)) };
    if (remaining.length === 0) {
      this.block = null;
      this.opts.events?.onStatus?.('lifted');
      this.drawer.show({ mode: 'lifted', portalLabel: this.opts.adapter.label, items: [], latencyMs: 0 }, this.handlers());
      setTimeout(() => {
        if (!this.block) this.drawer.hide();
      }, 2600);
      return;
    }
    this.block = { input, result: { ...this.block.result, findings: remaining } };
    this.showDrawer();
  }

  // ── Send pipeline ─────────────────────────────────────────────────────────
  private collectInput(): { input: ScanInput; composer: HTMLElement | null } {
    const composer = this.findComposer();
    const text = composer ? readEditable(composer).text : '';
    const attachments = this.store.active().map((a) => ({ id: a.id, name: a.name, text: a.text }));
    return { input: { text, attachments }, composer };
  }

  async handleSend(e: Event, trigger: 'enter' | 'click' | 'submit'): Promise<void> {
    if (this.bypass) return;
    const { input } = this.collectInput();
    if (!input.text.trim() && !input.attachments?.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.pending) return;

    const t0 = performance.now();
    const sync = scanSync(input, this.opts.tier3a());
    if (sync.verdict === 'block') {
      this.enterBlock(input, sync);
      void this.enrichBlock(input, sync, t0);
      return;
    }

    this.pending = true;
    this.opts.events?.onStatus?.('scanning');
    let merged = sync;
    try {
      const asyncPart = this.opts.asyncScanner
        ? await withTimeout(this.opts.asyncScanner.scanAsync(input), this.opts.asyncTimeoutMs ?? 1000)
        : null;
      merged =
        asyncPart === 'timeout'
          ? { ...sync, degradedReason: 'Tier 2 exceeded the 1,000 ms SLA — sent on clean Tier 1/3A verdict' }
          : mergeAsync(sync, asyncPart, performance.now() - t0);
    } catch (err) {
      merged = { ...sync, degradedReason: `Tier 2 unavailable: ${(err as Error).message}` };
    } finally {
      this.pending = false;
    }

    if (merged.verdict === 'block') {
      this.enterBlock(input, merged);
      return;
    }
    this.opts.events?.onScan?.(merged, false, input);
    this.opts.events?.onVerified?.(promptDigest(input.text));
    this.resend(trigger);
  }

  /** Re-dispatches the original send exactly once, bypassing interception. */
  private resend(trigger: 'enter' | 'click' | 'submit') {
    const btn = this.findSendButton();
    this.bypass = true;
    try {
      if (btn) btn.click();
      else {
        const composer = this.findComposer();
        const form = composer?.closest('form');
        if (trigger === 'submit' && form) form.requestSubmit();
        else composer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      }
    } finally {
      this.bypass = false;
    }
    this.block = null;
    this.drawer.hide();
    this.opts.events?.onStatus?.('sent');
  }

  private enterBlock(input: ScanInput, result: ScanResult) {
    this.block = { input, result };
    this.opts.events?.onScan?.(result, true, input);
    this.opts.events?.onStatus?.('blocked');
    this.showDrawer();
  }

  /** After a synchronous block, still run Tier 2/3B so the drawer lists every risk at once. */
  private async enrichBlock(input: ScanInput, sync: ScanResult, t0: number) {
    if (!this.opts.asyncScanner) return;
    try {
      const asyncPart = await withTimeout(this.opts.asyncScanner.scanAsync(input), 2000);
      if (asyncPart === 'timeout' || !this.block || this.block.input !== input) return;
      const merged = mergeAsync(sync, asyncPart, performance.now() - t0);
      if (merged.findings.length > this.block.result.findings.length) {
        this.block = { input, result: merged };
        this.showDrawer();
      }
    } catch {
      /* Tier 1/3A block already stands */
    }
  }

  private drawerItems(): DrawerItem[] {
    if (!this.block) return [];
    const { input, result } = this.block;
    return result.findings.map((f) => {
      const att = f.source.kind === 'attachment' ? input.attachments?.find((a) => a.id === (f.source as { attachmentId: string }).attachmentId) : undefined;
      const src = att ? att.text : input.text;
      return {
        id: f.id,
        categoryLabel: `Cat ${f.category} · ${CATEGORIES[f.category].label}`,
        label: f.label,
        masked: maskValue(src.slice(f.rawStart, f.rawEnd)),
        evidence: f.evidence,
        route: PATH_LABELS[f.path],
        source: att ? 'attachment' : 'composer',
        ...(att ? { attachmentId: att.id, attachmentName: att.name } : {}),
      };
    });
  }

  private showDrawer(note?: string) {
    if (!this.block) return;
    this.drawer.show(
      {
        mode: 'blocked',
        portalLabel: this.opts.adapter.label,
        items: this.drawerItems(),
        latencyMs: this.block.result.timings.total,
        ...(note ? { note } : {}),
      },
      this.handlers(),
    );
  }

  private handlers() {
    return {
      onRedactAll: () => this.redact(this.block?.result.findings.filter((f) => f.source.kind === 'composer') ?? []),
      onRedactOne: (id: string) => this.redact(this.block?.result.findings.filter((f) => f.id === id) ?? []),
      onEdit: (id: string) => {
        const f = this.block?.result.findings.find((x) => x.id === id);
        const composer = this.findComposer();
        this.drawer.hide();
        if (f && composer) selectSpan(composer, f.rawStart, f.rawEnd);
      },
      onRemoveAttachment: (attId: string) => this.removeAttachment(attId),
      onClose: () => this.drawer.hide(),
    };
  }

  private async redact(findings: Finding[]) {
    const composer = this.findComposer();
    if (!composer || !this.block || findings.length === 0) return;
    replaceSpans(
      composer,
      findings.map((f) => ({ start: f.rawStart, end: f.rawEnd, text: redactionTag(f.type) })),
    );
    // Offsets shifted — re-inspect the edited prompt with the full cascade.
    const { input } = this.collectInput();
    const t0 = performance.now();
    const sync = scanSync(input, this.opts.tier3a());
    this.block = { input, result: sync };
    if (sync.findings.length) this.showDrawer();
    let merged = sync;
    if (this.opts.asyncScanner) {
      try {
        const asyncPart = await withTimeout(this.opts.asyncScanner.scanAsync(input), 2000);
        if (asyncPart !== 'timeout') merged = mergeAsync(sync, asyncPart, performance.now() - t0);
      } catch {
        /* keep the synchronous verdict */
      }
    }
    if (this.block?.input !== input) return;
    if (merged.findings.length === 0) {
      this.block = null;
      this.drawer.hide();
      this.opts.events?.onStatus?.('redacted');
      composer.focus();
      return;
    }
    this.block = { input, result: merged };
    this.showDrawer();
  }

  private removeAttachment(attId: string) {
    const att = this.store.get(attId);
    const chip = att?.chip as HTMLElement | null | undefined;
    const btn = chip?.querySelector<HTMLElement>('[data-aionix-chip-remove], button[aria-label*="Remove" i], button[aria-label*="Delete" i]');
    if (btn) {
      btn.click(); // the MutationObserver lifts the block once the chip leaves the DOM
      return;
    }
    this.showDrawer('Remove the highlighted attachment from the composer to lift this block.');
  }
}
