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

export type InterceptorStatus = 'idle' | 'scanning' | 'blocked' | 'held' | 'sent' | 'lifted' | 'redacted';

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
  /** Tier 2 SLA (default 1,000 ms). */
  asyncTimeoutMs?: number;
  /**
   * When the offscreen check (Tier 2 + 3B) times out or is unreachable after a clean Tier 1/3A
   * verdict: 'hold' (default) asks the user — Send anyway / keep editing; 'send' fails open.
   * A live capture run saw the offscreen engine become unreachable mid-session, so silently
   * sending would have let Category 8/9 context through.
   */
  asyncFailure?: 'hold' | 'send';
}

interface BlockState {
  input: ScanInput;
  result: ScanResult;
}

/** A paste is not a Send: the 1 s Send budget does not apply, but the user is waiting for the text to appear. */
const PASTE_BUDGET_MS = 3000;

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
  /** Set while a checked paste is replayed to the portal, so the replay is not intercepted again. */
  private replayingPaste = false;
  /** The composer the current send came from (portals can render more than one, e.g. while hydrating). */
  private activeComposer: HTMLElement | null = null;
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
  private get composerSelectors(): string[] {
    return [...this.opts.adapter.composerSelectors, ...this.opts.adapter.preloadComposerSelectors, ...GENERIC_COMPOSER_SELECTORS];
  }

  /**
   * The composer without an event to go on (send-button clicks, redaction). Portals can render two at
   * once — ChatGPT and Claude serve a plain textarea that takes typing until the app hydrates — so the
   * focused one wins, then a visible one with text, then any visible one.
   */
  findComposer(): HTMLElement | null {
    const found: HTMLElement[] = [];
    for (const sel of this.composerSelectors) {
      for (const el of this.root.querySelectorAll<HTMLElement>(sel)) if (!found.includes(el)) found.push(el);
    }
    const active = document.activeElement;
    const focused = found.find((el) => active instanceof Node && (el === active || el.contains(active)));
    if (focused) return focused;
    const visible = found.filter(isVisible);
    const best = visible.find((el) => readEditable(el).text.trim().length > 0) ?? visible[0] ?? found[0];
    if (best) return best;
    if (active instanceof HTMLElement && (active.isContentEditable || active instanceof HTMLTextAreaElement) && this.inScope(active)) return active;
    return this.lastEditable?.isConnected ? this.lastEditable : null;
  }

  /**
   * The composer an event came from. Matching the event target (not the first composer in the page)
   * is what catches an Enter typed into a portal's pre-hydration textarea while its real editor is
   * already mounted next to it.
   */
  composerFor(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element) || !this.inScope(target)) return null;
    for (const sel of this.composerSelectors) {
      const el = target.closest<HTMLElement>(sel);
      if (el) return el;
    }
    // Layers 3–4 only when the page has no recognisable composer (unknown DOM drift): never claim an
    // unrelated field (rename, search) on a page whose composer we do know.
    if (this.composerSelectors.some((sel) => this.root.querySelector(sel))) return null;
    const editable = target.closest<HTMLElement>('textarea, [contenteditable="true"], [contenteditable=""]');
    return editable && (editable === document.activeElement || editable === this.lastEditable) ? editable : null;
  }

  private findSendButton(composer: HTMLElement | null): HTMLElement | null {
    // A pre-hydration input has no button of its own; the real editor's button would send that (empty) editor.
    if (composer && this.opts.adapter.preloadComposerSelectors.some((sel) => composer.matches(sel))) return null;
    // Prefer the button that belongs to this composer's form or fieldset.
    const scope = composer?.closest('form, fieldset');
    for (const sel of this.opts.adapter.sendButtonSelectors) {
      const el = scope?.querySelector<HTMLElement>(sel) ?? this.root.querySelector<HTMLElement>(sel);
      if (el) return el;
    }
    return null;
  }

  private inScope(node: Node): boolean {
    return this.opts.scope instanceof Document ? true : this.opts.scope.contains(node);
  }

  // ── Event hooks ───────────────────────────────────────────────────────────
  private onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    const composer = this.composerFor(e.target);
    if (!composer) return;
    void this.handleSend(e, 'enter', composer);
  }

  private onClick(e: MouseEvent) {
    const t = e.target as Element | null;
    if (!t?.closest) return;
    const btn = this.opts.adapter.sendButtonSelectors.map((s) => t.closest<HTMLElement>(s)).find(Boolean);
    if (!btn || !this.inScope(t)) return;
    const scope = btn.closest('form, fieldset');
    const own = scope ? this.composerSelectors.map((sel) => scope.querySelector<HTMLElement>(sel)).find(Boolean) : null;
    void this.handleSend(e, 'click', own ?? this.findComposer());
  }

  private onSubmit(e: SubmitEvent) {
    const form = e.target as HTMLFormElement;
    const composer = this.composerSelectors.map((sel) => form.querySelector<HTMLElement>(sel)).find(Boolean);
    if (!composer) return;
    void this.handleSend(e, 'submit', composer);
  }

  private onPaste(e: ClipboardEvent) {
    if (this.replayingPaste) return;
    const composer = this.composerFor(e.target);
    if (!composer) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text.length < LARGE_PASTE_THRESHOLD) return;
    const upload = this.opts.adapter.pasteUpload;
    if (upload && text.length >= upload.minChars && e.target instanceof Element) {
      // The portal would turn this into a file and upload it before Send: check it first.
      e.preventDefault();
      e.stopImmediatePropagation();
      void this.checkPaste(composer, e.target, text);
      return;
    }
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
      // Hide only this "lifted" notice: a network or paste drawer shown since must stay.
      setTimeout(() => {
        if (!this.block && this.drawer.mode === 'lifted') this.drawer.hide();
      }, 2600);
      return;
    }
    this.block = { input, result: { ...this.block.result, findings: remaining } };
    this.showDrawer();
  }

  // ── Send pipeline ─────────────────────────────────────────────────────────
  /** The composer of the send in progress, if it is still in the page (hydration can replace it). */
  private currentComposer(): HTMLElement | null {
    return this.activeComposer?.isConnected ? this.activeComposer : this.findComposer();
  }

  private collectInput(from?: HTMLElement | null): { input: ScanInput; composer: HTMLElement | null } {
    const composer = from ?? this.currentComposer();
    const text = composer ? readEditable(composer).text : '';
    const attachments = this.store.active().map((a) => ({ id: a.id, name: a.name, text: a.text }));
    return { input: { text, attachments }, composer };
  }

  async handleSend(e: Event, trigger: 'enter' | 'click' | 'submit', from?: HTMLElement | null): Promise<void> {
    if (this.bypass) return;
    // The 1 s decision budget covers everything from the Send event: input collection, Tier 1 + 3A
    // and the offscreen round trip.
    const t0 = performance.now();
    const { input, composer } = this.collectInput(from ?? this.findComposer());
    if (!input.text.trim() && !input.attachments?.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.pending) return;
    this.activeComposer = composer;

    const sync = scanSync(input, this.opts.tier3a());
    if (sync.verdict === 'block') {
      this.enterBlock(input, sync);
      void this.enrichBlock(input, sync, t0);
      return;
    }

    this.pending = true;
    this.opts.events?.onStatus?.('scanning');
    let merged: ScanResult;
    let incomplete: boolean;
    try {
      ({ merged, incomplete } = await this.contextCheck(input, sync, t0));
    } finally {
      this.pending = false;
    }

    if (merged.verdict === 'block') {
      this.enterBlock(input, merged);
      return;
    }
    if (incomplete && (this.opts.asyncFailure ?? 'hold') === 'hold') {
      this.holdForDecision(input, merged, trigger);
      return;
    }
    this.opts.events?.onScan?.(merged, false, input);
    this.opts.events?.onVerified?.(promptDigest(input.text));
    this.resend(trigger);
  }

  /** Tier 2 + 3B from the offscreen engine, inside what is left of the budget (1 s for a Send) counted from t0. */
  private async contextCheck(input: ScanInput, sync: ScanResult, t0: number, budgetMs?: number): Promise<{ merged: ScanResult; incomplete: boolean }> {
    const budget = budgetMs ?? this.opts.asyncTimeoutMs ?? 1000;
    try {
      const remaining = Math.max(0, budget - (performance.now() - t0));
      const asyncPart = this.opts.asyncScanner ? await withTimeout(this.opts.asyncScanner.scanAsync(input), remaining) : null;
      if (asyncPart === 'timeout') return { merged: { ...sync, degradedReason: `Context check exceeded the ${budget.toLocaleString()} ms budget` }, incomplete: true };
      return { merged: mergeAsync(sync, asyncPart, performance.now() - t0), incomplete: false };
    } catch (err) {
      return { merged: { ...sync, degradedReason: `Context check unavailable: ${(err as Error).message}` }, incomplete: true };
    }
  }

  /**
   * Network-layer check, asked for by the MAIN-world backstop when a prompt reaches the portal's send
   * endpoint without having passed the composer check: typed before the page finished loading, an
   * edited message, a retry. The same cascade runs on the request's prompt; resolves true only when the
   * request may leave the browser.
   */
  async checkOutgoing(text: string): Promise<boolean> {
    const t0 = performance.now();
    const input: ScanInput = { text, attachments: [] };
    const sync = scanSync(input, this.opts.tier3a());
    const { merged, incomplete } = sync.verdict === 'block' ? { merged: sync, incomplete: false } : await this.contextCheck(input, sync, t0);
    if (merged.verdict === 'block') {
      this.opts.events?.onScan?.(merged, true, input);
      this.showNetworkBlock(
        merged.findings.map((f) => ({
          id: f.id,
          categoryLabel: `Cat ${f.category} · ${CATEGORIES[f.category].label}`,
          label: f.label,
          masked: maskValue(text.slice(f.rawStart, f.rawEnd)),
          evidence: f.evidence,
          route: PATH_LABELS[f.path],
          source: 'request',
        })),
        merged.timings.total,
      );
      return false;
    }
    if (incomplete && (this.opts.asyncFailure ?? 'hold') === 'hold') {
      return new Promise<boolean>((resolve) => {
        const decide = (allow: boolean) => {
          this.drawer.hide();
          if (allow) this.opts.events?.onScan?.({ ...merged, degradedReason: `${merged.degradedReason ?? 'Context check incomplete'} — sent by the user without it` }, false, input);
          resolve(allow);
        };
        this.drawer.show(
          { mode: 'held', origin: 'network', portalLabel: this.opts.adapter.label, items: [], latencyMs: merged.timings.total, ...(merged.degradedReason ? { note: merged.degradedReason } : {}) },
          { ...this.handlers(), onClose: () => decide(false), onSendAnyway: () => decide(true) },
        );
      });
    }
    this.opts.events?.onScan?.(merged, false, input);
    return true;
  }

  /**
   * A long paste on a portal that uploads it as a file at once: the full cascade runs on the clipboard
   * text, and the paste reaches the portal only if it is clean (or the user decides to paste anyway).
   */
  private async checkPaste(composer: HTMLElement, target: Element, text: string) {
    const t0 = performance.now();
    const input: ScanInput = { text: '', attachments: [{ id: `paste-${Date.now().toString(36)}`, name: 'pasted text', text }] };
    const sync = scanSync(input, this.opts.tier3a());
    const { merged, incomplete } = sync.verdict === 'block' ? { merged: sync, incomplete: false } : await this.contextCheck(input, sync, t0, PASTE_BUDGET_MS);
    const label = this.opts.adapter.label;
    if (merged.verdict === 'block') {
      this.opts.events?.onScan?.(merged, true, input);
      this.drawer.show(
        {
          mode: 'blocked',
          origin: 'paste',
          portalLabel: label,
          latencyMs: merged.timings.total,
          note: `${label} turns a paste this long into a file attachment and uploads it as soon as it is added, before Send. So the paste was checked first and was not added. Paste a copy without the flagged items instead.`,
          items: merged.findings.map((f) => ({
            id: f.id,
            categoryLabel: `Cat ${f.category} · ${CATEGORIES[f.category].label}`,
            label: f.label,
            masked: maskValue(text.slice(f.rawStart, f.rawEnd)),
            evidence: f.evidence,
            route: PATH_LABELS[f.path],
            source: 'paste',
          })),
        },
        { ...this.handlers(), onRedactAll: () => undefined, onRedactOne: () => undefined, onEdit: () => this.drawer.hide(), onClose: () => this.drawer.hide() },
      );
      return;
    }
    if (incomplete && (this.opts.asyncFailure ?? 'hold') === 'hold') {
      this.drawer.show(
        { mode: 'held', origin: 'paste', portalLabel: label, items: [], latencyMs: merged.timings.total, ...(merged.degradedReason ? { note: merged.degradedReason } : {}) },
        {
          ...this.handlers(),
          onClose: () => this.drawer.hide(),
          onSendAnyway: () => {
            this.drawer.hide();
            this.replayPaste(composer, target, text);
          },
        },
      );
      return;
    }
    this.replayPaste(composer, target, text);
  }

  /** Hands a checked paste to the portal as the same paste event, so it still becomes a chip there. */
  private replayPaste(composer: HTMLElement, target: Element, text: string) {
    const to = target.isConnected ? target : composer;
    if (!(document.activeElement instanceof Node && composer.contains(document.activeElement))) composer.focus();
    const data = new DataTransfer();
    data.setData('text/plain', text);
    const ev = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    this.replayingPaste = true;
    try {
      to.dispatchEvent(ev);
    } finally {
      this.replayingPaste = false;
    }
    // Editors that paste natively (a plain textarea) ignore a synthetic paste: insert the text instead.
    if (!ev.defaultPrevented) document.execCommand('insertText', false, text);
  }

  /** A request stopped at the network layer: there is nothing in the composer to redact, so no row actions. */
  showNetworkBlock(items: DrawerItem[], latencyMs: number): void {
    this.drawer.show(
      {
        mode: 'blocked',
        origin: 'network',
        portalLabel: this.opts.adapter.label,
        items,
        latencyMs,
        note: `This message reached ${this.opts.adapter.label}'s send request without passing the composer check (for example, it was typed before the page finished loading, or it is an edited message). It was stopped before it left the browser. ${this.opts.adapter.label} may still show it in the thread, but it was not delivered.`,
      },
      { ...this.handlers(), onRedactAll: () => undefined, onRedactOne: () => undefined, onEdit: () => this.drawer.hide(), onClose: () => this.drawer.hide() },
    );
  }

  /** Clean on Tier 1/3A, but the offscreen check did not answer: the user decides, nothing is sent yet. */
  private holdForDecision(input: ScanInput, result: ScanResult, trigger: 'enter' | 'click' | 'submit') {
    this.opts.events?.onStatus?.('held');
    this.drawer.show(
      { mode: 'held', portalLabel: this.opts.adapter.label, items: [], latencyMs: result.timings.total, ...(result.degradedReason ? { note: result.degradedReason } : {}) },
      {
        ...this.handlers(),
        onSendAnyway: () => {
          this.drawer.hide();
          const sent = { ...result, degradedReason: `${result.degradedReason ?? 'Context check incomplete'} — sent by the user without it` };
          this.opts.events?.onScan?.(sent, false, input);
          this.opts.events?.onVerified?.(promptDigest(input.text));
          this.resend(trigger);
        },
      },
    );
  }

  /** Re-dispatches the original send exactly once, bypassing interception. */
  private resend(trigger: 'enter' | 'click' | 'submit') {
    const composer = this.currentComposer();
    const btn = this.findSendButton(composer);
    this.bypass = true;
    try {
      if (btn) btn.click();
      else {
        // No send button (a pre-hydration input): replay Enter on the composer itself.
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
        const composer = this.currentComposer();
        this.drawer.hide();
        if (f && composer) selectSpan(composer, f.rawStart, f.rawEnd);
      },
      onRemoveAttachment: (attId: string) => this.removeAttachment(attId),
      onClose: () => this.drawer.hide(),
    };
  }

  private async redact(findings: Finding[]) {
    const composer = this.currentComposer();
    if (!composer || !this.block || findings.length === 0) return;
    replaceSpans(
      composer,
      findings.map((f) => ({ start: f.rawStart, end: f.rawEnd, text: redactionTag(f.type) })),
    );
    // Offsets shifted — re-inspect the edited prompt with the full cascade.
    const { input } = this.collectInput(composer);
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

function isVisible(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}
