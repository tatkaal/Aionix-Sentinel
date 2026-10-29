import { EmptyState, Panel, WorkspaceHeader } from '../../components/ui';

export function BenchmarksView() {
  return (
    <>
      <WorkspaceHeader
        eyebrow="Evaluation lab"
        title="Dataset Benchmarks"
        description="Run the shipping 3-tier engine against Enron, Presidio, AI4Privacy and the 24 stakeholder edge cases on Tier 2 Path A (lexicon) and Path B (WebGPU)."
      />
      <Panel title="Results">
        <EmptyState title="No benchmark runs yet">Choose datasets and start a run.</EmptyState>
      </Panel>
    </>
  );
}
