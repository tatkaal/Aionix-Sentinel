import { create } from 'zustand';
import type { PortalId } from '../workspaces/sandbox/PortalComposer';

/** Hand-off from other workspaces (e.g. Vault "Paste excerpt to Sandbox") into the Sandbox composer. */
export interface InboxItem {
  mode: 'type' | 'paste';
  text: string;
  portal?: PortalId;
}

interface InboxState {
  pending: InboxItem | null;
  push(item: InboxItem): void;
  take(): InboxItem | null;
}

export const useSandboxInbox = create<InboxState>((set, get) => ({
  pending: null,
  push(item) {
    set({ pending: item });
  },
  take() {
    const item = get().pending;
    if (item) set({ pending: null });
    return item;
  },
}));
