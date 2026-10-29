import { AonixLogo } from '../../../shared/brand/AonixLogo';
import { WorkspaceHeader } from '../../components/ui';

export function PresentationView() {
  return (
    <>
      <WorkspaceHeader eyebrow="Executive briefing" title="Stakeholder Presentation" description="8-slide briefing and printable report." />
      <div className="aspect-video w-full rounded-xl border border-hairline bg-graphite p-8">
        <AonixLogo className="h-10 w-auto" />
      </div>
    </>
  );
}
