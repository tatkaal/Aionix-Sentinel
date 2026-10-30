import { AIONIX_LOGO_PATHS, AIONIX_LOGO_VIEWBOX } from './logo-paths';

interface AionixLogoProps {
  className?: string;
  /** Accessible name; omit when the mark sits next to the visible "Aionix Sentinel" wordmark. */
  title?: string;
}

export function AionixLogo({ className = 'h-[27px] w-auto', title }: AionixLogoProps) {
  return (
    <svg
      className={className}
      viewBox={AIONIX_LOGO_VIEWBOX}
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {AIONIX_LOGO_PATHS.map((p) => (
        <path key={p.d.slice(0, 24)} d={p.d} fill={p.fill} />
      ))}
    </svg>
  );
}
