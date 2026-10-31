import type { PortalAdapter } from './types';

export const claudeAdapter: PortalAdapter = {
  id: 'claude',
  label: 'Claude',
  hosts: ['claude.ai'],
  // Verified live (signed in) 2026-10-31: div.tiptap.ProseMirror[data-testid="chat-input"], send button
  // [data-testid="chat-input-send"][aria-label="Send message"].
  composerSelectors: ['div[data-testid="chat-input"][contenteditable="true"]', 'div.ProseMirror[contenteditable="true"]', 'fieldset [contenteditable="true"][role="textbox"]'],
  sendButtonSelectors: ['button[data-testid="chat-input-send"]', 'button[aria-label="Send message"]', 'button[aria-label="Send Message"]', 'fieldset button[type="submit"]'],
  chipContainerSelectors: ['[data-testid="file-thumbnail-list"]', 'fieldset'],
  chipSelectors: ['[data-testid="file-thumbnail"]', '[data-testid*="thumbnail" i]', '[data-aionix-chip]'],
  completionEndpoint: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/(?:retry_)?completion\b/,
  extractPrompt(body) {
    try {
      const json = JSON.parse(body) as { prompt?: string; attachments?: { extracted_content?: string }[] };
      const parts = [json.prompt ?? '', ...(json.attachments ?? []).map((a) => a.extracted_content ?? '')];
      return parts.filter(Boolean).join('\n\n');
    } catch {
      return null;
    }
  },
};
