import { AONIX_LOGO_PATHS, AONIX_LOGO_VIEWBOX } from './logo-paths';

interface AonixLogoProps {
  className?: string;
  /** Accessible name; omit when the mark sits next to the visible "Aonix Sentinel" wordmark. */
  title?: string;
}

export function AonixLogo({ className = 'h-[27px] w-auto', title }: AonixLogoProps) {
  return (
    <svg
      className={className}
      viewBox={AONIX_LOGO_VIEWBOX}
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {AONIX_LOGO_PATHS.map((p) => (
        <path key={p.d.slice(0, 24)} d={p.d} fill={p.fill} />
      ))}
    </svg>
  );
}
