import type { PortalAdapter } from './types';

export const geminiAdapter: PortalAdapter = {
  id: 'gemini',
  label: 'Gemini',
  hosts: ['gemini.google.com'],
  composerSelectors: ['rich-textarea div.ql-editor[contenteditable="true"][role="textbox"]', 'rich-textarea [contenteditable="true"]'],
  sendButtonSelectors: ['button.send-button', 'button[aria-label="Send message"]', 'button[aria-label*="Send" i]'],
  chipContainerSelectors: ['.file-preview-container', 'uploader-file-preview-container', '.input-area-container'],
  chipSelectors: ['uploader-file-preview', '.file-preview', '[data-aonix-chip]'],
  completionEndpoint: /\/BardFrontendService\/StreamGenerate\b/,
  extractPrompt(body) {
    // Form-encoded `f.req=[null,"<json>"]`; the inner JSON's first element starts with the prompt.
    try {
      const freq = new URLSearchParams(body).get('f.req');
      if (!freq) return null;
      const outer = JSON.parse(freq) as unknown[];
      const inner = JSON.parse(String(outer[1])) as unknown[][];
      const prompt = inner?.[0]?.[0];
      return typeof prompt === 'string' ? prompt : null;
    } catch {
      return null;
    }
  },
};
