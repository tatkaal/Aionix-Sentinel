// MAIN-world network backstop. Wraps window.fetch and XMLHttpRequest for each portal's prompt
// endpoint. Bodies whose prompt digest the content script already verified pass straight through;
// anything else gets a synchronous Tier 1 scan before it is allowed onto the network.
import { promptDigest } from '../engine/digest';
import { maskValue } from '../engine/redact';
import { scanTier1 } from '../engine/tier1';
import { CATEGORIES } from '../engine/types';
import { ADAPTERS, adapterForHost, type PortalAdapter } from './content/adapters';

declare const __AIONIX_TEST_BUILD__: boolean;

const VERIFIED_TTL_MS = 30_000;

class AionixBlockedError extends TypeError {
  constructor() {
    super('Aionix Sentinel blocked this request: high-risk data detected.');
  }
}

function pickAdapter(): PortalAdapter | null {
  const a = adapterForHost(location.hostname);
  if (a) return a;
  if (__AIONIX_TEST_BUILD__ && location.hostname === 'localhost') {
    return ADAPTERS[location.pathname.split('/')[1] as keyof typeof ADAPTERS] ?? null;
  }
  return null;
}

const adapter = pickAdapter();

if (adapter) {
  const verified = new Map<string, number>();
  document.addEventListener('aionix:verified', (e) => {
    const digest = (e as CustomEvent<unknown>).detail;
    if (typeof digest === 'string') verified.set(digest, Date.now() + VERIFIED_TTL_MS);
  });

  /** Returns true when the body must be blocked. */
  const inspect = (body: string): boolean => {
    const prompt = adapter.extractPrompt(body) ?? body;
    const digest = promptDigest(prompt);
    const exp = verified.get(digest);
    if (exp && exp > Date.now()) return false;
    const findings = scanTier1(prompt);
    if (!findings.length) return false;
    const items = findings.map((f) => ({
      label: f.label,
      category: `Cat ${f.category} · ${CATEGORIES[f.category].label}`,
      masked: maskValue(prompt.slice(f.rawStart, f.rawEnd)),
    }));
    document.dispatchEvent(new CustomEvent('aionix:backstop-block', { detail: JSON.stringify({ items }) }));
    return true;
  };

  const bodyText = async (input: RequestInfo | URL, init?: RequestInit): Promise<string | null> => {
    const b = init?.body;
    if (typeof b === 'string') return b;
    if (b instanceof URLSearchParams) return b.toString();
    if (b instanceof Blob) return b.text();
    if (b instanceof ArrayBuffer || ArrayBuffer.isView(b)) return new TextDecoder().decode(b as ArrayBuffer);
    if (b == null && input instanceof Request) return input.clone().text();
    return null;
  };

  const origFetch = window.fetch;
  window.fetch = async function aionixFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (adapter.completionEndpoint.test(url)) {
      const body = await bodyText(input, init).catch(() => null);
      if (body != null && inspect(body)) throw new AionixBlockedError();
    }
    return origFetch.call(this ?? window, input, init);
  } as typeof window.fetch;

  const urls = new WeakMap<XMLHttpRequest, string>();
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    urls.set(this, String(args[1]));
    return (origOpen as (...a: unknown[]) => void).apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const url = urls.get(this) ?? '';
    if (adapter.completionEndpoint.test(url)) {
      const text = typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : null;
      if (text != null && inspect(text)) {
        setTimeout(() => this.dispatchEvent(new ProgressEvent('error')), 0);
        return;
      }
    }
    return origSend.call(this, body);
  };
}
