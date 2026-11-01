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
  /**
   * Inputs the portal serves before its app hydrates. They take typing and an early Enter (which the
   * app sends once it loads), have no send button of their own, and can sit next to the real editor
   * for a moment — so they are composers too, and a clean send from one is replayed as Enter on it.
   */
  preloadComposerSelectors: string[];
  sendButtonSelectors: string[];
  /**
   * Set when the portal turns a long paste into a file attachment that it uploads as soon as it is
   * attached, before Send. Pastes of at least `minChars` are then checked at paste time with the full
   * cascade and only reach the portal when clean: a block on Send would come after the upload.
   */
  pasteUpload?: { minChars: number };
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
  '[data-aionix-chip]',
  '[data-testid*="thumbnail" i]',
  '[data-testid*="attachment" i]',
  '[data-testid*="file" i]',
  '[aria-label*="pasted" i]',
];
