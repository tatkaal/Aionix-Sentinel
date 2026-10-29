import { useState } from 'react';
import { Badge, EmptyState, Panel, Segmented, Stat, WorkspaceHeader } from '../../components/ui';
import { PORTALS, PortalComposer, type Chip, type PortalId } from './PortalComposer';

export function SandboxView() {
  const [portal, setPortal] = useState<PortalId>('claude');
  const [chips, setChips] = useState<Chip[]>([]);

  return (
    <>
      <WorkspaceHeader
        eyebrow="Live sandbox"
        title="Prompt Guard Sandbox"
        description="Structural emulations of the Claude, ChatGPT and Gemini composers running the same interception core as the extension. Press Enter or Send to scan."
      />

      <Panel className="mb-6" bodyClassName="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Tier 2 route" value="—" />
        <Stat label="Tier 1" value="—" unit="ms" />
        <Stat label="Tier 3 · A" value="—" unit="ms" />
        <Stat label="Tier 2" value="—" unit="ms" />
        <Stat label="Tier 3 · B" value="—" unit="ms" />
        <Stat label="Offscreen memory" value="—" unit="/ 150 MB" />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <Panel
          title="Composer"
          actions={
            <Segmented label="Portal" value={portal} onChange={setPortal} options={PORTALS.map((p) => ({ value: p.id, label: p.label }))} />
          }
        >
          <PortalComposer key={portal} portal={portal} chips={chips} onRemoveChip={(id) => setChips((c) => c.filter((x) => x.id !== id))} />
        </Panel>
        <Panel title="Scan result" actions={<Badge>idle</Badge>}>
          <EmptyState title="Nothing scanned yet">Type a prompt and press Enter.</EmptyState>
        </Panel>
      </div>
    </>
  );
}
