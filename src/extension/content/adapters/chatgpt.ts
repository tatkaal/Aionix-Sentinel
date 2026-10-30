import type { PortalAdapter } from './types';

export const chatgptAdapter: PortalAdapter = {
  id: 'chatgpt',
  label: 'ChatGPT',
  hosts: ['chatgpt.com', 'chat.openai.com'],
  composerSelectors: ['div#prompt-textarea[contenteditable="true"]', '#prompt-textarea', 'textarea[data-id="root"]'],
  sendButtonSelectors: ['button[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label="Send prompt"]'],
  chipContainerSelectors: ['[data-testid="composer-attachments"]', 'form'],
  chipSelectors: ['[data-testid*="attachment" i]', '[data-testid*="file" i]', '[data-aionix-chip]'],
  completionEndpoint: /\/backend-api\/(?:f\/)?conversation(?:\?|$)/,
  extractPrompt(body) {
    try {
      const json = JSON.parse(body) as { messages?: { content?: { parts?: unknown[] } }[] };
      const parts: string[] = [];
      for (const m of json.messages ?? []) {
        for (const p of m.content?.parts ?? []) if (typeof p === 'string') parts.push(p);
      }
      return parts.join('\n\n');
    } catch {
      return null;
    }
  },
};
