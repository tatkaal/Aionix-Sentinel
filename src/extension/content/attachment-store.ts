// AttachmentShadowStore — keeps the text of large pastes that portals turn into
// `pasted-content.txt` chips, so the chip contents are scanned on send even though they never
// appear in the composer DOM. Entries are bound to chip elements; removing the chip drops the entry.

export const LARGE_PASTE_THRESHOLD = 1200;
const UNBOUND_TTL_MS = 8000;

export interface ShadowAttachment {
  id: string;
  name: string;
  text: string;
  createdAt: number;
  chip: Element | null;
}

let seq = 0;

export class AttachmentShadowStore {
  private items = new Map<string, ShadowAttachment>();

  add(text: string, name = 'pasted-content.txt'): ShadowAttachment {
    const item: ShadowAttachment = { id: `att-${Date.now().toString(36)}-${++seq}`, name, text, createdAt: Date.now(), chip: null };
    this.items.set(item.id, item);
    return item;
  }

  /** Binds the oldest unbound paste to a newly rendered chip element (FIFO, like the portals). */
  bindNextUnbound(chip: Element): ShadowAttachment | null {
    this.expire();
    for (const item of this.items.values()) {
      if (!item.chip) {
        item.chip = chip;
        return item;
      }
    }
    return null;
  }

  hasUnbound(): boolean {
    for (const item of this.items.values()) if (!item.chip) return true;
    return false;
  }

  bind(id: string, chip: Element): void {
    const item = this.items.get(id);
    if (item) item.chip = chip;
  }

  findByChip(chip: Element): ShadowAttachment | null {
    for (const item of this.items.values()) if (item.chip === chip) return item;
    return null;
  }

  get(id: string): ShadowAttachment | undefined {
    return this.items.get(id);
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  /** Drops entries whose chip left the DOM; returns the removed ids. */
  sweepDetached(): string[] {
    const removed: string[] = [];
    for (const [id, item] of this.items) {
      if (item.chip && !item.chip.isConnected) {
        this.items.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }

  /** Attachments that are currently represented by a chip in the composer. */
  active(): ShadowAttachment[] {
    return [...this.items.values()].filter((i) => i.chip?.isConnected);
  }

  clear(): void {
    this.items.clear();
  }

  private expire() {
    const now = Date.now();
    for (const [id, item] of this.items) if (!item.chip && now - item.createdAt > UNBOUND_TTL_MS) this.items.delete(id);
  }
}
