import { useSyncExternalStore } from 'react';

export type WorkspaceId = 'sandbox' | 'vault' | 'benchmarks' | 'telemetry' | 'presentation' | 'source';

export const NAV_WORKSPACES: { id: WorkspaceId; label: string }[] = [
  { id: 'sandbox', label: 'Live Sandbox' },
  { id: 'vault', label: 'Corporate Vault' },
  { id: 'benchmarks', label: 'Benchmarks' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'presentation', label: 'Presentation' },
];

const ALL: WorkspaceId[] = [...NAV_WORKSPACES.map((w) => w.id), 'source'];

function read(): WorkspaceId {
  const id = window.location.hash.replace(/^#\/?/, '').split('?')[0] as WorkspaceId;
  return ALL.includes(id) ? id : 'sandbox';
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useWorkspace(): WorkspaceId {
  return useSyncExternalStore(subscribe, read, () => 'sandbox');
}

export function navigate(id: WorkspaceId) {
  window.location.hash = `/${id}`;
}
