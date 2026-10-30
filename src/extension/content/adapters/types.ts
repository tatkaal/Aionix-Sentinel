export type PortalId = 'claude' | 'chatgpt' | 'gemini';

/**
 * Everything portal-specific lives in an adapter. When a live site changes its DOM or API,
 * update the adapter — never the interceptor core.
 */
export interface PortalAdapter {
  id: PortalId;
  label: string;
  hosts: string[];
  /** Layer 1 of the 4-layer composer lookup (most specific first). */
  composerSelectors: string[];
  sendButtonSelectors: string[];
  /** Containers that hold attachment chips (pasted-content.txt and file thumbnails). */
  chipContainerSelectors: string[];
  /** Individual chip elements inside a chip container. */
  chipSelectors: string[];
  /** Prompt-submission endpoint (MAIN-world backstop). */
  completionEndpoint: RegExp;
  /** Extracts prompt (and attachment) text from an outgoing request body; null when unparseable. */
  extractPrompt(body: string): string | null;
}

export const GENERIC_COMPOSER_SELECTORS = [
  'form [contenteditable="true"][role="textbox"]',
  'form [contenteditable="true"]',
  'form textarea',
  '[contenteditable="true"][role="textbox"]',
];

export const GENERIC_CHIP_SELECTORS = [
  '[data-aonix-chip]',
  '[data-testid*="thumbnail" i]',
  '[data-testid*="attachment" i]',
  '[data-testid*="file" i]',
  '[aria-label*="pasted" i]',
];
