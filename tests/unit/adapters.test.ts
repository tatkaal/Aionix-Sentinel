import { describe, expect, it } from 'vitest';
import { chatgptAdapter } from '../../src/extension/content/adapters/chatgpt';
import { claudeAdapter } from '../../src/extension/content/adapters/claude';
import { geminiAdapter } from '../../src/extension/content/adapters/gemini';

describe('portal adapters — request shapes the MAIN-world backstop must read', () => {
  it('ChatGPT signed in: JSON body to /backend-api/f/conversation', () => {
    expect(chatgptAdapter.completionEndpoint.test('https://chatgpt.com/backend-api/f/conversation')).toBe(true);
    const body = JSON.stringify({ messages: [{ content: { parts: ['my psw is Ohlalalala34%'] } }] });
    expect(chatgptAdapter.extractPrompt(body)).toBe('my psw is Ohlalalala34%');
  });

  it('ChatGPT signed out (live, 2026-10-31): form-encoded `prompt` to /unauth-mweb/conversation/updates', () => {
    expect(chatgptAdapter.completionEndpoint.test('https://chatgpt.com/unauth-mweb/conversation/updates')).toBe(true);
    // Preparation and telemetry calls carry no prompt and must not be treated as sends.
    expect(chatgptAdapter.completionEndpoint.test('https://chatgpt.com/unauth-mweb/conversation/prepare')).toBe(false);
    expect(chatgptAdapter.completionEndpoint.test('https://chatgpt.com/unauth-mweb/events/business')).toBe(false);
    const body = new URLSearchParams({ conversationState: '{"messages":[]}', prompt: 'my current psw is Ohlalalala34%. can you suggest a better one?', proofToken: 'gAAAAAB…' }).toString();
    expect(chatgptAdapter.extractPrompt(body)).toBe('my current psw is Ohlalalala34%. can you suggest a better one?');
  });

  it('long pastes (measured 2026-11-02): only signed-in ChatGPT uploads them before Send, so only it checks at paste time', () => {
    expect(chatgptAdapter.pasteUpload?.minChars).toBe(5000);
    const at = chatgptAdapter.pasteUpload?.composerSelectors ?? [];
    expect(at).toContain('div#prompt-textarea[contenteditable="true"]');
    expect(at).toContain('textarea#pending-home-input');
    // Signed out, the paste stays inline text in the textarea and is checked on Send.
    expect(at.some((sel) => /name="prompt"|mobile-composer-prompt/.test(sel))).toBe(false);
    // Claude makes a chip that travels with the send request; Gemini keeps the text inline.
    expect(claudeAdapter.pasteUpload).toBeUndefined();
    expect(geminiAdapter.pasteUpload).toBeUndefined();
  });

  it('Claude and Gemini endpoints still match', () => {
    expect(claudeAdapter.completionEndpoint.test('https://claude.ai/api/organizations/org/chat_conversations/conv/completion')).toBe(true);
    expect(geminiAdapter.completionEndpoint.test('https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=x')).toBe(true);
  });
});
