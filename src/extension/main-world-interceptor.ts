// MAIN-world network backstop. Wraps window.fetch and XMLHttpRequest for each portal's prompt
// endpoint. Bodies whose prompt digest the content script already verified pass straight through.
// Anything else (typed before the page finished loading, an edited message, a retry) gets Tier 1 here,
// synchronously, and then the rest of the cascade (Tier 3A, and Tier 2 + 3B in the offscreen engine)
// from the content script before it is allowed onto the network.
import { promptDigest } from '../engine/digest';
import { maskValue } from '../engine/redact';
import { scanTier1 } from '../engine/tier1';
import { CATEGORIES } from '../engine/types';
import { ADAPTERS, adapterForHost, type PortalAdapter } from './content/adapters';

declare const __AIONIX_TEST_BUILD__: boolean;

const VERIFIED_TTL_MS = 30_000;
/** The content script answers the hand-off synchronously; no answer means it is gone (extension reloaded). */
const ACK_MS = 300;
/** Upper bound while the user decides in a "Check incomplete" drawer. */
const VERDICT_MAX_MS = 120_000;

class AionixBlockedError extends TypeError {
  constructor() {
    super('Aionix Sentinel blocked this request: high-risk data detected.');
  }
}

function pickAdapter(): PortalAdapter | null {
  const a = adapterForHost(location.hostname);
  if (a) return a;
  if (__AIONIX_TEST_BUILD__ && location.hostname === 'localhost') {
    return ADAPTERS[location.pathname.split('/')[1]!.replace(/-(?:anon|early)$/, '') as keyof typeof ADAPTERS] ?? null;
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

  // Hand-off to the content script (isolated world) for the full cascade. Details cross worlds as JSON.
  let seq = 0;
  const waiters = new Map<string, { ack(): void; done(allow: boolean): void }>();
  document.addEventListener('aionix:backstop-ack', (e) => waiters.get(String((e as CustomEvent<unknown>).detail))?.ack());
  document.addEventListener('aionix:backstop-verdict', (e) => {
    try {
      const { id, allow } = JSON.parse(String((e as CustomEvent<unknown>).detail)) as { id: string; allow: boolean };
      waiters.get(id)?.done(allow === true);
    } catch {
      /* malformed — the waiter times out */
    }
  });

  /** Resolves true when the request may go out. */
  const fullCheck = (prompt: string): Promise<boolean> =>
    new Promise((resolve) => {
      const id = `${Date.now().toString(36)}-${++seq}`;
      let acked = false;
      const finish = (allow: boolean) => {
        clearTimeout(ackTimer);
        clearTimeout(maxTimer);
        waiters.delete(id);
        resolve(allow);
      };
      // Tier 1 already passed; without a content script there is nothing more to run.
      const ackTimer = setTimeout(() => !acked && finish(true), ACK_MS);
      const maxTimer = setTimeout(() => finish(false), VERDICT_MAX_MS);
      waiters.set(id, { ack: () => (acked = true), done: finish });
      document.dispatchEvent(new CustomEvent('aionix:backstop-scan', { detail: JSON.stringify({ id, prompt }) }));
    });

  type Verdict = { kind: 'allow' } | { kind: 'block' } | { kind: 'check'; prompt: string };

  const inspect = (body: string): Verdict => {
    const prompt = adapter.extractPrompt(body) ?? body;
    if (!prompt.trim()) return { kind: 'allow' };
    const exp = verified.get(promptDigest(prompt));
    if (exp && exp > Date.now()) return { kind: 'allow' };
    const t0 = performance.now();
    const findings = scanTier1(prompt);
    if (!findings.length) return { kind: 'check', prompt };
    const items = findings.map((f) => ({
      label: f.label,
      category: `Cat ${f.category} · ${CATEGORIES[f.category].label}`,
      masked: maskValue(prompt.slice(f.rawStart, f.rawEnd)),
      evidence: f.evidence,
    }));
    document.dispatchEvent(new CustomEvent('aionix:backstop-block', { detail: JSON.stringify({ items, latencyMs: performance.now() - t0 }) }));
    return { kind: 'block' };
  };

  /** Resolves true when the body must be blocked. */
  const mustBlock = async (body: string): Promise<boolean> => {
    const v = inspect(body);
    return v.kind === 'check' ? !(await fullCheck(v.prompt)) : v.kind === 'block';
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
      if (body != null && (await mustBlock(body))) throw new AionixBlockedError();
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
      const v = text == null ? ({ kind: 'allow' } as const) : inspect(text);
      const fail = () => this.dispatchEvent(new ProgressEvent('error'));
      if (v.kind === 'block') {
        setTimeout(fail, 0);
        return;
      }
      if (v.kind === 'check') {
        // An opened XHR may be sent later: hold it until the full check answers.
        void fullCheck(v.prompt).then((allow) => (allow ? origSend.call(this, body) : fail()));
        return;
      }
    }
    return origSend.call(this, body);
  };
}
