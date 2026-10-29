import { EmptyState, Panel, WorkspaceHeader } from '../../components/ui';

export function TelemetryView() {
  return (
    <>
      <WorkspaceHeader
        eyebrow="Zero-knowledge audit"
        title="Block Telemetry & Audit Console"
        description="Prompts scanned, blocks by category and engine tier, portal distribution and the redacted incident log."
      />
      <Panel title="Incident log">
        <EmptyState title="No incidents recorded">Blocks from the Sandbox and imported extension audit logs appear here.</EmptyState>
      </Panel>
    </>
  );
}
