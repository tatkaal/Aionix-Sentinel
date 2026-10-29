import { EmptyState, Panel, WorkspaceHeader } from '../../components/ui';

export function SourceView() {
  return (
    <>
      <WorkspaceHeader
        eyebrow="Manifest V3 · zero remote code"
        title="Extension Source & ZIP Packager"
        description="Browse the extension source and download a ready-to-load package for chrome://extensions."
      />
      <Panel title="Files">
        <EmptyState title="Source browser">The extension file tree appears here.</EmptyState>
      </Panel>
    </>
  );
}
