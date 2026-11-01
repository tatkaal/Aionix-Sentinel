// Isolated-world content script (run_at: document_start).
// Tier 1 + Tier 3 Path A run synchronously here; Tier 2 + Tier 3 Path B are delegated to the
// offscreen document through the background service worker.
import type { AsyncScanner } from '../../engine/pipeline';
import { toScanRecord, type PortalName } from '../../engine/telemetry';
import { CUSTOM_VAULT_KEY, decodeCustomAsset, type CustomVaultRecord } from '../../engine/tier3/custom-vault';
import { createVaultDetector, type VaultDetector } from '../../engine/tier3/minhash-detector';
import type { Finding, ScanInput, ScanResult } from '../../engine/types';
import type { BackgroundRequest, ScanAsyncResponse } from '../messages';
import { ADAPTERS, adapterForHost, type PortalAdapter } from './adapters';
import { BlockDrawer } from './block-drawer';
import { PromptInterceptor } from './interceptor-core';
import { loadVaultDetector } from './vault-loader';

declare const __AIONIX_TEST_BUILD__: boolean;

function pickAdapter(): PortalAdapter | null {
  const byHost = adapterForHost(location.hostname);
  if (byHost) return byHost;
  if (__AIONIX_TEST_BUILD__ && location.hostname === 'localhost') {
    const id = location.pathname.split('/')[1]!.replace(/-(?:anon|early)$/, '') as keyof typeof ADAPTERS;
    return ADAPTERS[id] ?? null;
  }
  return null;
}

function send<T>(msg: BackgroundRequest): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

function registerBrandFonts() {
  const fonts: [string, string, string][] = [
    ['Plus Jakarta Sans Variable', 'fonts/plus-jakarta-sans.woff2', '200 800'],
    ['DM Sans Variable', 'fonts/dm-sans.woff2', '100 1000'],
    ['JetBrains Mono Variable', 'fonts/jetbrains-mono.woff2', '100 800'],
  ];
  for (const [family, path, weight] of fonts) {
    try {
      document.fonts.add(new FontFace(family, `url(${chrome.runtime.getURL(path)})`, { weight, display: 'swap' }));
    } catch {
      /* page CSP may block extension fonts — the drawer falls back to system-ui */
    }
  }
}

const adapter = pickAdapter();

if (adapter) {
  let salt: string | null = null;
  const getSalt = async () => (salt ??= await send<string>({ target: 'background', type: 'salt' }));

  // Tier 3 Path A: the bundled vault plus protected data added in the options page (fingerprints only).
  let tier3a: VaultDetector | null = null;
  const customIds = new Set<string>();
  const applyCustom = (records: CustomVaultRecord[]) => {
    if (!tier3a) return;
    const wanted = new Set(records.map((r) => r.id));
    for (const id of [...customIds]) {
      if (wanted.has(id)) continue;
      tier3a.removeAsset(id);
      customIds.delete(id);
    }
    for (const r of records) {
      const asset = customIds.has(r.id) ? null : decodeCustomAsset(r);
      if (!asset) continue;
      tier3a.addAsset(asset);
      customIds.add(r.id);
    }
  };
  const readCustom = async () => ((await chrome.storage.local.get(CUSTOM_VAULT_KEY))[CUSTOM_VAULT_KEY] as CustomVaultRecord[] | undefined) ?? [];
  void loadVaultDetector(chrome.runtime.getURL('engine/corporate-vault.bin')).then(async (d) => {
    tier3a = d ?? createVaultDetector([]);
    applyCustom(await readCustom());
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[CUSTOM_VAULT_KEY]) applyCustom((changes[CUSTOM_VAULT_KEY].newValue as CustomVaultRecord[] | undefined) ?? []);
  });

  const asyncScanner: AsyncScanner = {
    async scanAsync(input: ScanInput) {
      const res = await send<ScanAsyncResponse>({ target: 'background', type: 'scan-async', input });
      if (!res || 'error' in res) throw new Error(res ? res.error : 'no response from background');
      return res;
    },
  };

  const drawer = new BlockDrawer();
  const interceptor = new PromptInterceptor({
    adapter,
    scope: document,
    tier3a: () => tier3a,
    asyncScanner,
    drawer,
    events: {
      onScan: (result: ScanResult, _blocked: boolean, input: ScanInput) => {
        void (async () => {
          // Values are read only to compute salted fingerprints; they never leave this function.
          const valueOf = (f: Finding) => {
            const src =
              f.source.kind === 'attachment'
                ? input.attachments?.find((a) => a.id === (f.source as { attachmentId: string }).attachmentId)?.text
                : input.text;
            return src?.slice(f.rawStart, f.rawEnd) ?? f.id;
          };
          const record = await toScanRecord(result, adapter.id as PortalName, await getSalt(), valueOf);
          await send({ target: 'background', type: 'record', record });
        })().catch(() => undefined);
      },
      onVerified: (digest) => {
        document.dispatchEvent(new CustomEvent('aionix:verified', { detail: digest }));
      },
    },
  });

  registerBrandFonts();
  interceptor.install();

  // Wake the service worker (and through it the offscreen engine, if Chrome dropped it) when the user
  // starts on a prompt, so a cold start is not paid inside the 1 s budget after Send.
  let lastWarm = 0;
  document.addEventListener(
    'focusin',
    (e) => {
      if (Date.now() - lastWarm < 20_000 || !interceptor.composerFor(e.target)) return;
      lastWarm = Date.now();
      void send({ target: 'background', type: 'warm' }).catch(() => undefined);
    },
    true,
  );

  // MAIN-world backstop, step 1: Tier 1 there already stopped the request.
  document.addEventListener('aionix:backstop-block', (e) => {
    try {
      const detail = JSON.parse((e as CustomEvent<string>).detail) as { items: { label: string; category: string; masked: string; evidence?: string }[]; latencyMs?: number };
      interceptor.showNetworkBlock(
        detail.items.map((it, i) => ({
          id: `backstop-${i}`,
          categoryLabel: it.category,
          label: it.label,
          masked: it.masked,
          evidence: it.evidence ?? 'network backstop',
          route: 'Tier 1 · Math · network backstop',
          source: 'request',
        })),
        detail.latencyMs ?? 0,
      );
    } catch {
      /* malformed detail — ignore */
    }
  });

  // MAIN-world backstop, step 2: Tier 1 was clean but the prompt skipped the composer check, so the rest
  // of the cascade runs here. Acknowledge at once; the verdict follows (possibly after the user decides).
  document.addEventListener('aionix:backstop-scan', (e) => {
    let req: { id: string; prompt: string };
    try {
      req = JSON.parse((e as CustomEvent<string>).detail) as { id: string; prompt: string };
    } catch {
      return;
    }
    document.dispatchEvent(new CustomEvent('aionix:backstop-ack', { detail: req.id }));
    void interceptor
      .checkOutgoing(req.prompt)
      .catch(() => false)
      .then((allow) => document.dispatchEvent(new CustomEvent('aionix:backstop-verdict', { detail: JSON.stringify({ id: req.id, allow }) })));
  });
}
