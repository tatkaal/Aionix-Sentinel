import type { PortalAdapter } from './types';

export const claudeAdapter: PortalAdapter = {
  id: 'claude',
  label: 'Claude',
  hosts: ['claude.ai'],
  composerSelectors: ['div.ProseMirror[contenteditable="true"]', 'fieldset [contenteditable="true"][role="textbox"]'],
  sendButtonSelectors: ['button[aria-label="Send message"]', 'button[aria-label="Send Message"]', 'fieldset button[type="submit"]'],
  chipContainerSelectors: ['[data-testid="file-thumbnail-list"]', 'fieldset'],
  chipSelectors: ['[data-testid="file-thumbnail"]', '[data-testid*="thumbnail" i]', '[data-aonix-chip]'],
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
