import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-violet text-white hover:bg-violet-hover active:bg-violet',
  secondary: 'bg-graphite-2 text-alabaster border border-hairline hover:border-hairline-brand hover:bg-[#1f2338]',
  ghost: 'text-muted hover:text-alabaster hover:bg-white/5',
  danger: 'bg-crimson/15 text-[#FCA5A5] border border-crimson/40 hover:bg-crimson/25',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors',
        'focus-visible:outline-2 focus-visible:outline-luminous disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-3.5 text-sm',
        BUTTON[variant],
        className,
      )}
      {...rest}
    />
  );
}

/** Single-elevation surface. Never nest a Panel inside another Panel. */
export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx('min-w-0 rounded-xl border border-hairline bg-graphite', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-alabaster">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export type Tone = 'brand' | 'crimson' | 'amber' | 'emerald' | 'neutral';

const BADGE: Record<Tone, string> = {
  brand: 'bg-luminous/12 text-[#C4A3FF] ring-luminous/30',
  crimson: 'bg-crimson/12 text-[#FCA5A5] ring-crimson/35',
  amber: 'bg-amber/12 text-[#FCD34D] ring-amber/35',
  emerald: 'bg-emerald/12 text-[#6EE7B7] ring-emerald/35',
  neutral: 'bg-white/5 text-muted ring-white/10',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        BADGE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  const color: Record<Tone, string> = {
    brand: 'bg-luminous',
    crimson: 'bg-crimson',
    amber: 'bg-amber',
    emerald: 'bg-emerald',
    neutral: 'bg-subtle',
  };
  return <span aria-hidden className={cx('inline-block size-1.5 shrink-0 rounded-full', color[tone])} />;
}

export function Stat({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: Tone;
}) {
  const valueColor = tone === 'crimson' ? 'text-[#FCA5A5]' : tone === 'emerald' ? 'text-[#6EE7B7]' : tone === 'amber' ? 'text-[#FCD34D]' : 'text-alabaster';
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-muted">{label}</div>
      <div className={cx('metric mt-1 text-2xl font-semibold', valueColor)}>
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-xs text-subtle">{hint}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-lg border border-hairline bg-obsidian p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              'rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-40',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
              active ? 'bg-graphite-2 text-luminous shadow-[inset_0_0_0_1px_rgba(149,83,251,0.35)]' : 'text-muted hover:text-alabaster',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function WorkspaceHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        <p className="metric text-xs font-medium tracking-wide text-luminous">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-alabaster sm:text-[28px]">{title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-hairline px-4 py-10 text-center">
      <p className="text-sm font-medium text-alabaster">{title}</p>
      {children && <div className="max-w-md text-[13px] text-muted">{children}</div>}
    </div>
  );
}

export function formatMs(ms: number | null | undefined, digits = 1) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return ms < 10 ? ms.toFixed(digits + 1) : ms.toFixed(digits);
}

export function formatPct(x: number | null | undefined, digits = 1) {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}
