import { useState } from 'react';
import { AonixLogo } from '../../shared/brand/AonixLogo';
import { NAV_WORKSPACES, navigate, type WorkspaceId } from '../router';
import { cx } from './ui';

export function TopBar({ active }: { active: WorkspaceId }) {
  const [open, setOpen] = useState(false);

  const go = (id: WorkspaceId) => {
    navigate(id);
    setOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-obsidian/85 backdrop-blur-md print:hidden">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-8 px-4 sm:px-6 lg:px-8">
        {/* Brand zone */}
        <a
          href="#/sandbox"
          className="flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md"
          onClick={(e) => {
            e.preventDefault();
            go('sandbox');
          }}
        >
          <AonixLogo className="h-[27px] w-auto" />
          <span className="font-display text-[15px] font-bold tracking-tight text-alabaster">Aonix Sentinel</span>
        </a>

        {/* Navigation */}
        <nav aria-label="Workspaces" className="hidden min-w-0 flex-1 items-center gap-1 lg:flex">
          {NAV_WORKSPACES.map((w) => {
            const isActive = w.id === active;
            return (
              <a
                key={w.id}
                href={`#/${w.id}`}
                aria-current={isActive ? 'page' : undefined}
                className={cx(
                  'relative whitespace-nowrap rounded-md px-3 py-2 font-display text-[13.5px] font-semibold transition-colors',
                  isActive ? 'text-luminous' : 'text-muted hover:text-alabaster',
                )}
              >
                {w.label}
                {isActive && <span aria-hidden className="absolute inset-x-3 -bottom-[11px] h-0.5 rounded-full bg-luminous" />}
              </a>
            );
          })}
        </nav>

        {/* Primary action */}
        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <button
            type="button"
            onClick={() => go('source')}
            className={cx(
              'hidden h-9 items-center gap-2 whitespace-nowrap rounded-lg bg-violet px-3.5 text-sm font-semibold text-white transition-colors hover:bg-violet-hover sm:inline-flex',
              active === 'source' && 'ring-2 ring-luminous ring-offset-2 ring-offset-obsidian',
            )}
          >
            <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Export MV3 Extension
          </button>
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-alabaster lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label="Open navigation"
            onClick={() => setOpen((o) => !o)}
          >
            <svg aria-hidden viewBox="0 0 16 16" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
              {open ? <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /> : <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" strokeLinecap="round" />}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Workspaces" className="border-t border-hairline px-4 py-2 lg:hidden">
          {[...NAV_WORKSPACES, { id: 'source' as const, label: 'Export MV3 Extension' }].map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => go(w.id)}
              className={cx(
                'block w-full rounded-md px-3 py-2.5 text-left font-display text-sm font-semibold',
                w.id === active ? 'bg-white/5 text-luminous' : 'text-muted hover:text-alabaster',
              )}
            >
              {w.label}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
}
