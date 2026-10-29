import { forwardRef, type ReactNode } from 'react';

export type PortalId = 'claude' | 'chatgpt' | 'gemini';

export const PORTALS: { id: PortalId; label: string; host: string }[] = [
  { id: 'claude', label: 'Claude', host: 'claude.ai' },
  { id: 'chatgpt', label: 'ChatGPT', host: 'chatgpt.com' },
  { id: 'gemini', label: 'Gemini', host: 'gemini.google.com' },
];

export interface Chip {
  id: string;
  name: string;
  size: number;
  flagged: boolean;
}

interface ComposerProps {
  portal: PortalId;
  chips: Chip[];
  onRemoveChip: (id: string) => void;
  footer?: ReactNode;
}

const SendIcon = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M8 13V3m0 0L3.5 7.5M8 3l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function ChipRow({ chips, onRemoveChip, attrs, extraClass = "" }: { chips: Chip[]; onRemoveChip: (id: string) => void; attrs?: Record<string, string>; extraClass?: string }) {
  return (
    <div {...attrs} className={`${extraClass} flex flex-wrap gap-2 empty:hidden`}>
      {chips.map((c) => (
        <div
          key={c.id}
          data-aonix-chip={c.id}
          className={
            'group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ' +
            (c.flagged ? 'border-crimson/50 bg-crimson/10' : 'border-hairline bg-white/[0.03]')
          }
        >
          <svg aria-hidden viewBox="0 0 16 16" className="size-4 text-muted" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M4 1.5h5L12.5 5v9.5h-8.5z M9 1.5V5h3.5" strokeLinejoin="round" />
          </svg>
          <span className="font-medium text-alabaster">{c.name}</span>
          <span className="metric text-subtle">{(c.size / 1024).toFixed(1)} KB</span>
          {c.flagged && <span className="font-medium text-[#FCA5A5]">flagged</span>}
          <button
            type="button"
            aria-label={`Remove ${c.name}`}
            data-aonix-chip-remove
            onClick={() => onRemoveChip(c.id)}
            className="ml-1 rounded p-0.5 text-subtle hover:bg-white/10 hover:text-alabaster"
          >
            <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Structural emulation of each portal's composer. The DOM selectors match the live sites so the
 * same interceptor-core and adapters used by the extension run here unchanged. No third-party marks.
 */
export const PortalComposer = forwardRef<HTMLDivElement, ComposerProps>(function PortalComposer({ portal, chips, onRemoveChip, footer }, ref) {
  if (portal === 'claude') {
    return (
      <div ref={ref} data-portal="claude" className="rounded-2xl border border-hairline bg-graphite-2 p-3 focus-within:border-luminous/50">
        <fieldset className="flex flex-col gap-2">
          <ChipRow chips={chips} onRemoveChip={onRemoveChip} attrs={{ 'data-testid': 'file-thumbnail-list' }} />
          <div
            className="ProseMirror max-h-72 min-h-24 overflow-y-auto px-1 py-1 text-[15px] leading-relaxed whitespace-pre-wrap text-alabaster outline-none"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-label="Write your prompt to Claude"
            aria-multiline="true"
            translate="no"
            data-placeholder="How can I help you today?"
          />
          <div className="flex items-center justify-between gap-2">
            {footer ?? <span />}
            <button type="button" aria-label="Send message" className="inline-flex size-8 items-center justify-center rounded-lg bg-alabaster text-obsidian hover:opacity-90">
              <SendIcon />
            </button>
          </div>
        </fieldset>
      </div>
    );
  }

  if (portal === 'chatgpt') {
    return (
      <div ref={ref} data-portal="chatgpt">
        <form className="rounded-[28px] border border-hairline bg-graphite-2 px-4 py-3 focus-within:border-luminous/50" onSubmit={(e) => e.preventDefault()}>
          <ChipRow chips={chips} onRemoveChip={onRemoveChip} attrs={{ 'data-testid': 'composer-attachments' }} />
          <div
            id="prompt-textarea"
            className="ProseMirror max-h-72 min-h-16 overflow-y-auto py-1.5 text-[15px] leading-relaxed whitespace-pre-wrap text-alabaster outline-none"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-label="Message ChatGPT"
            translate="no"
            data-placeholder="Ask anything"
          />
          <div className="flex items-center justify-between gap-2">
            {footer ?? <span />}
            <button
              type="button"
              id="composer-submit-button"
              data-testid="send-button"
              aria-label="Send prompt"
              className="inline-flex size-9 items-center justify-center rounded-full bg-alabaster text-obsidian hover:opacity-90"
            >
              <SendIcon />
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div ref={ref} data-portal="gemini" className="rounded-[24px] border border-hairline bg-graphite-2 px-4 py-3 focus-within:border-luminous/50">
      <ChipRow chips={chips} onRemoveChip={onRemoveChip} extraClass="file-preview-container" />
      <rich-textarea className="block">
        <div
          className="ql-editor max-h-72 min-h-16 overflow-y-auto py-1.5 text-[15px] leading-relaxed whitespace-pre-wrap text-alabaster outline-none"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Enter a prompt here"
          aria-multiline="true"
          data-placeholder="Ask Gemini"
        />
      </rich-textarea>
      <div className="flex items-center justify-between gap-2">
        {footer ?? <span />}
        <button type="button" aria-label="Send message" className="send-button inline-flex size-9 items-center justify-center rounded-full bg-alabaster text-obsidian hover:opacity-90">
          <SendIcon />
        </button>
      </div>
    </div>
  );
});

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'rich-textarea': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
