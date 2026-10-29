import { EmptyState, Panel, WorkspaceHeader } from '../../components/ui';

export function VaultView() {
  return (
    <>
      <WorkspaceHeader
        eyebrow="Tier 3 · MinHash + Bloom · Orama EDM"
        title="Corporate Vault & Hashing Studio"
        description="The admin CI/CD hashing pipeline: proprietary assets are stripped of boilerplate, shingled into 5-grams, compiled into a Bloom filter with MinHash signatures, and embedded into the local Orama exact-data-match index."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Panel title="Indexed assets">
          <EmptyState title="Vault index not loaded">Run the hashing pipeline to compile the corporate vault.</EmptyState>
        </Panel>
        <Panel title="Asset inspector">
          <EmptyState title="Select an asset">Raw document, shingles, Bloom bits and vectors appear here.</EmptyState>
        </Panel>
      </div>
    </>
  );
}
