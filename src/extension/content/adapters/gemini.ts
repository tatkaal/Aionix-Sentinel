import type { PortalAdapter } from './types';

export const geminiAdapter: PortalAdapter = {
  id: 'gemini',
  label: 'Gemini',
  hosts: ['gemini.google.com'],
  composerSelectors: ['rich-textarea div.ql-editor[contenteditable="true"][role="textbox"]', 'rich-textarea [contenteditable="true"]'],
  // The server-rendered page starts with .initial-input-area textarea until the app boots (2026-11-02).
  preloadComposerSelectors: ['.initial-input-area textarea'],
  // Not verified whether Gemini converts long pastes into an uploaded file; treated like ChatGPT so that
  // one can never upload unchecked.
  pasteUpload: { minChars: 4000 },
  sendButtonSelectors: ['button.send-button', 'button[aria-label="Send message"]', 'button[aria-label*="Send" i]'],
  chipContainerSelectors: ['.file-preview-container', 'uploader-file-preview-container', '.input-area-container'],
  chipSelectors: ['uploader-file-preview', '.file-preview', '[data-aionix-chip]'],
  // Live path: /_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate
  completionEndpoint: /[./]BardFrontendService\/StreamGenerate\b/,
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
