import { lazy, Suspense } from 'react';
import { TopBar } from './components/TopBar';
import { useWorkspace, type WorkspaceId } from './router';
import { SandboxView } from './workspaces/sandbox/SandboxView';

const VaultView = lazy(() => import('./workspaces/vault/VaultView').then((m) => ({ default: m.VaultView })));
const BenchmarksView = lazy(() => import('./workspaces/benchmarks/BenchmarksView').then((m) => ({ default: m.BenchmarksView })));
const TelemetryView = lazy(() => import('./workspaces/telemetry/TelemetryView').then((m) => ({ default: m.TelemetryView })));
const PresentationView = lazy(() =>
  import('./workspaces/presentation/PresentationView').then((m) => ({ default: m.PresentationView })),
);
const SourceView = lazy(() => import('./workspaces/source/SourceView').then((m) => ({ default: m.SourceView })));

function Workspace({ id }: { id: WorkspaceId }) {
  switch (id) {
    case 'sandbox':
      return <SandboxView />;
    case 'vault':
      return <VaultView />;
    case 'benchmarks':
      return <BenchmarksView />;
    case 'telemetry':
      return <TelemetryView />;
    case 'presentation':
      return <PresentationView />;
    case 'source':
      return <SourceView />;
  }
}

export function App() {
  const active = useWorkspace();
  return (
    <div className="min-h-dvh overflow-x-clip bg-obsidian text-alabaster">
      <TopBar active={active} />
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <Suspense fallback={<p className="text-sm text-muted">Loading workspace…</p>}>
          <Workspace id={active} />
        </Suspense>
      </main>
    </div>
  );
}
