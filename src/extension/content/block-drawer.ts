// Aionix enforcement drawer — rendered in a closed Shadow DOM so portal CSS can't restyle it and
// portal scripts can't read it. Dynamic values are written with textContent only (no HTML injection).
import { aionixLogoMarkup } from '../../shared/brand/logo-paths';
import { BRAND, FONT_STACK } from '../../shared/brand/tokens';

declare const __AIONIX_TEST_BUILD__: boolean | undefined;

export interface DrawerItem {
  id: string;
  categoryLabel: string;
  label: string;
  masked: string;
  evidence: string;
  route: string;
  source: 'composer' | 'attachment';
  attachmentId?: string;
  attachmentName?: string;
}

export interface DrawerState {
  /** held: Tier 1/3A were clean but the offscreen check (Tier 2/3B) could not answer — the user decides. */
  mode: 'blocked' | 'lifted' | 'held';
  portalLabel: string;
  items: DrawerItem[];
  latencyMs: number;
  note?: string;
}

export interface DrawerHandlers {
  onRedactAll(): void;
  onRedactOne(id: string): void;
  onEdit(id: string): void;
  onRemoveAttachment(attachmentId: string): void;
  onClose(): void;
  /** Only in 'held' mode: send although the context check did not finish. */
  onSendAnyway?(): void;
}

const CSS = `
:host { all: initial; }
.wrap { position: fixed; top: 16px; right: 16px; z-index: 2147483647; width: min(440px, calc(100vw - 32px));
  max-height: calc(100vh - 32px); display: flex; flex-direction: column; box-sizing: border-box;
  background: ${BRAND.graphite}; color: ${BRAND.text}; border: 1px solid ${BRAND.hairlineBrand}; border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.4); font-family: ${FONT_STACK.body}; font-size: 14px;
  line-height: 1.45; animation: in .16s ease-out; }
@keyframes in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .wrap { animation: none; } }
* { box-sizing: border-box; }
header { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid ${BRAND.hairline}; }
.brand { display: flex; align-items: center; gap: 8px; font-family: ${FONT_STACK.display}; font-weight: 700; font-size: 14px; white-space: nowrap; }
.spacer { flex: 1; }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.badge.block { background: rgba(239,68,68,.14); color: #FCA5A5; box-shadow: inset 0 0 0 1px rgba(239,68,68,.4); }
.badge.ok { background: rgba(16,185,129,.14); color: #6EE7B7; box-shadow: inset 0 0 0 1px rgba(16,185,129,.4); }
.badge.warn { background: rgba(245,158,11,.14); color: #FCD34D; box-shadow: inset 0 0 0 1px rgba(245,158,11,.4); }
.x { all: unset; cursor: pointer; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 8px; color: ${BRAND.muted}; }
.x:hover { background: rgba(255,255,255,.06); color: ${BRAND.text}; }
.summary { padding: 14px 16px 6px; }
.summary h2 { margin: 0; font-family: ${FONT_STACK.display}; font-size: 16px; font-weight: 700; text-wrap: balance; }
.summary p { margin: 4px 0 0; color: ${BRAND.muted}; font-size: 13px; }
.mono { font-family: ${FONT_STACK.mono}; font-variant-numeric: tabular-nums; }
ul { list-style: none; margin: 0; padding: 6px 8px; overflow-y: auto; }
li { padding: 10px 8px; border-bottom: 1px solid ${BRAND.hairline}; display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; }
li:last-child { border-bottom: 0; }
.cat { font-size: 12px; color: #FCA5A5; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.cat::before { content: ''; width: 6px; height: 6px; border-radius: 99px; background: ${BRAND.crimson}; }
.lbl { font-weight: 500; }
.masked { font-family: ${FONT_STACK.mono}; font-size: 12.5px; color: ${BRAND.text}; background: ${BRAND.graphite2}; padding: 2px 6px; border-radius: 5px; word-break: break-all; }
.meta { font-size: 12px; color: ${BRAND.subtle}; grid-column: 1 / -1; }
.row-actions { display: flex; gap: 6px; align-items: start; grid-row: 1 / span 3; grid-column: 2; }
button.b { all: unset; cursor: pointer; font-size: 12.5px; font-weight: 600; padding: 6px 10px; border-radius: 8px; white-space: nowrap; text-align: center; }
button.b:focus-visible, .x:focus-visible { outline: 2px solid ${BRAND.luminous}; outline-offset: 2px; }
.b.ghost { color: ${BRAND.muted}; box-shadow: inset 0 0 0 1px ${BRAND.hairline}; }
.b.ghost:hover { color: ${BRAND.text}; background: rgba(255,255,255,.05); }
.b.primary { background: ${BRAND.violet}; color: #fff; }
.b.primary:hover { background: ${BRAND.violetHover}; }
.b.danger { color: #FCA5A5; box-shadow: inset 0 0 0 1px rgba(239,68,68,.4); }
.b.danger:hover { background: rgba(239,68,68,.12); }
footer { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 16px; border-top: 1px solid ${BRAND.hairline}; }
footer .b { flex: 1 1 auto; }
.note { margin: 0 16px 10px; padding: 8px 10px; border-radius: 8px; font-size: 12.5px; background: rgba(245,158,11,.1); color: #FCD34D; }
.lifted { padding: 6px 16px 16px; color: ${BRAND.muted}; font-size: 13px; }
`;

export class BlockDrawer {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.handlers?.onClose();
  };
  private handlers: DrawerHandlers | null = null;

  get isOpen(): boolean {
    return !!this.host?.isConnected;
  }

  show(state: DrawerState, handlers: DrawerHandlers): void {
    this.handlers = handlers;
    if (!this.host || !this.host.isConnected) {
      this.host = document.createElement('aionix-sentinel-drawer');
      // Closed in production so page scripts cannot read findings; open only in the e2e test build.
      const testBuild = typeof __AIONIX_TEST_BUILD__ !== 'undefined' && __AIONIX_TEST_BUILD__;
      this.root = this.host.attachShadow({ mode: testBuild ? 'open' : 'closed' });
      (document.body ?? document.documentElement).appendChild(this.host);
      document.addEventListener('keydown', this.keyHandler, true);
    }
    this.render(state);
  }

  hide(): void {
    document.removeEventListener('keydown', this.keyHandler, true);
    this.host?.remove();
    this.host = null;
    this.root = null;
  }

  private render(state: DrawerState) {
    const root = this.root!;
    const h = this.handlers!;
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const wrap = el('div', 'wrap');
    wrap.setAttribute('role', state.mode === 'lifted' ? 'status' : 'alertdialog');
    wrap.setAttribute('aria-labelledby', 'aionix-title');

    const header = el('header');
    const brand = el('div', 'brand');
    const logo = el('span');
    logo.innerHTML = aionixLogoMarkup(20); // static, trusted markup
    brand.append(logo, text('span', 'Aionix Sentinel'));
    const badge = text(
      'span',
      { blocked: 'Send blocked', lifted: 'Block lifted', held: 'Check incomplete' }[state.mode],
      `badge ${{ blocked: 'block', lifted: 'ok', held: 'warn' }[state.mode]}`,
    );
    const close = el('button', 'x');
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round"/></svg>';
    close.addEventListener('click', () => h.onClose());
    header.append(brand, el('span', 'spacer'), badge, close);
    wrap.appendChild(header);

    if (state.mode === 'held') {
      const s = el('div', 'summary');
      const h2 = text('h2', `Held: the context check did not finish`);
      h2.id = 'aionix-title';
      s.appendChild(h2);
      s.appendChild(
        text('p', `Secrets, IDs and document fingerprints were checked and nothing was found. The medical / financial context check and exact-data match could not answer in time, so nothing was sent to ${state.portalLabel}.`),
      );
      wrap.appendChild(s);
      if (state.note) wrap.appendChild(text('div', state.note, 'note'));
      wrap.appendChild(text('p', 'Press Enter to check again, or send without the context check.', 'lifted'));
      const footer = el('footer');
      const cancel = text('button', 'Keep editing', 'b primary');
      cancel.addEventListener('click', () => h.onClose());
      const anyway = text('button', 'Send anyway', 'b danger');
      anyway.addEventListener('click', () => h.onSendAnyway?.());
      footer.append(cancel, anyway);
      wrap.appendChild(footer);
      root.appendChild(wrap);
      cancel.focus({ preventScroll: true });
      return;
    }

    if (state.mode === 'lifted') {
      const s = el('div', 'summary');
      const h2 = text('h2', 'Flagged attachment removed');
      h2.id = 'aionix-title';
      s.appendChild(h2);
      wrap.appendChild(s);
      wrap.appendChild(text('p', 'No high-risk data remains in this prompt. You can send it now.', 'lifted'));
      root.appendChild(wrap);
      return;
    }

    const summary = el('div', 'summary');
    const n = state.items.length;
    const h2 = text('h2', `${n} high-risk item${n === 1 ? '' : 's'} stopped before reaching ${state.portalLabel}`);
    h2.id = 'aionix-title';
    const p = el('p');
    p.append('Nothing was sent. Inspected locally in ', text('span', `${state.latencyMs.toFixed(1)} ms`, 'mono'), '.');
    summary.append(h2, p);
    wrap.appendChild(summary);
    if (state.note) wrap.appendChild(text('div', state.note, 'note'));

    const list = el('ul');
    list.setAttribute('aria-label', 'Detected items');
    for (const item of state.items) {
      const li = el('li');
      li.appendChild(text('div', item.categoryLabel, 'cat'));
      const actions = el('div', 'row-actions');
      if (item.source === 'attachment' && item.attachmentId) {
        const rm = text('button', 'Remove file', 'b danger');
        rm.addEventListener('click', () => h.onRemoveAttachment(item.attachmentId!));
        actions.appendChild(rm);
      } else {
        const red = text('button', 'Redact', 'b ghost');
        red.addEventListener('click', () => h.onRedactOne(item.id));
        const edit = text('button', 'Edit', 'b ghost');
        edit.addEventListener('click', () => h.onEdit(item.id));
        actions.append(red, edit);
      }
      li.appendChild(actions);
      const line = el('div');
      line.append(text('span', item.label, 'lbl'), ' ', text('span', item.masked, 'masked'));
      li.appendChild(line);
      const where = item.source === 'attachment' ? `in ${item.attachmentName ?? 'attachment'}` : 'in composer';
      li.appendChild(text('div', `${item.evidence} · ${item.route} · ${where}`, 'meta'));
      list.appendChild(li);
    }
    wrap.appendChild(list);

    const footer = el('footer');
    const composerCount = state.items.filter((i) => i.source === 'composer').length;
    if (composerCount > 0) {
      const all = text('button', `Auto-redact ${composerCount === 1 ? 'item' : `all ${composerCount}`}`, 'b primary');
      all.addEventListener('click', () => h.onRedactAll());
      footer.appendChild(all);
    }
    const dismiss = text('button', 'Edit manually', 'b ghost');
    dismiss.addEventListener('click', () => h.onClose());
    footer.appendChild(dismiss);
    wrap.appendChild(footer);
    root.appendChild(wrap);
    (footer.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = el(tag, cls);
  e.textContent = value;
  return e;
}
