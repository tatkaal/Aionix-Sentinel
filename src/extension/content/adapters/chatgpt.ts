import type { PortalAdapter } from './types';

// Two live variants (verified 2026-10-31):
//  - signed in: ProseMirror composer (formerly #prompt-textarea; now an id-less
//    div.ProseMirror[role="textbox"][aria-label="Ask ChatGPT"] in a form), JSON POST to /backend-api/(f/)conversation;
//  - signed out: <textarea name="prompt"> (#mobile-composer-prompt), form-encoded POST to
//    /unauth-mweb/conversation/updates whose `prompt` field carries the message.
// Before the app hydrates, the signed-in home page serves <textarea id="pending-home-input"> (verified
// 2026-11-02): it takes typing and an early Enter, and the app sends that text once it loads.
export const chatgptAdapter: PortalAdapter = {
  id: 'chatgpt',
  label: 'ChatGPT',
  hosts: ['chatgpt.com', 'chat.openai.com'],
  composerSelectors: ['div#prompt-textarea[contenteditable="true"]', '#prompt-textarea', 'form div.ProseMirror[contenteditable="true"][role="textbox"]', 'textarea[name="prompt"]', '#mobile-composer-prompt', 'textarea[data-id="root"]'],
  preloadComposerSelectors: ['textarea#pending-home-input'],
  // Signed in, a long paste becomes "Pasted text.txt" and is uploaded at once, before Send (measured
  // 2026-11-02 on Free: from 10,000 chars, POST /backend-api/files → PUT of the full text to
  // *.oaiusercontent.com/files/<id>/raw → POST /backend-api/files/process_upload_stream). Plus, Pro and
  // Business are reported to convert from 5,000, so that is the floor. Signed out, pastes stay inline
  // text (13k and 60k measured; no upload), so they are checked on Send like any prompt.
  pasteUpload: { minChars: 5000, composerSelectors: ['div#prompt-textarea[contenteditable="true"]', 'form div.ProseMirror[contenteditable="true"]', 'textarea#pending-home-input'] },
  sendButtonSelectors: ['button[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label="Send prompt"]', 'button[aria-label="Send message"]'],
  chipContainerSelectors: ['[data-testid="composer-attachments"]', 'form'],
  chipSelectors: ['[data-testid*="attachment" i]', '[data-testid*="file" i]', '[data-aionix-chip]'],
  completionEndpoint: /\/(?:backend-api|backend-anon|unauth-mweb)\/(?:f\/)?conversation(?:\/updates)?(?:\?|$)/,
  extractPrompt(body) {
    if (body.trimStart().startsWith('{')) {
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
    }
    const prompt = new URLSearchParams(body).get('prompt');
    return prompt ?? null;
  },
};
