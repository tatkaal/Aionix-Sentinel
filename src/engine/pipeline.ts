// Orchestrates the cascade. The synchronous half (Tier 1 + Tier 3 Path A) runs inside the send
// handler; the asynchronous half (Tier 2 + Tier 3 Path B) runs in the offscreen document / worker.
import { scanTier1 } from './tier1';
import { emptyTimings, type Finding, type FindingSource, type ScanInput, type ScanResult, type Tier2Route, type TierTimings } from './types';

/** Any detector that can scan one text unit synchronously (Tier 3 Path A implements this). */
export interface SyncDetector {
  scan(text: string, source: FindingSource): Finding[];
}

/** Result of the asynchronous half, merged into the synchronous result. */
export interface AsyncScanResult {
  findings: Finding[];
  timings: Pick<TierTimings, 'tier2' | 'tier3b'>;
  tier2Route: Tier2Route | null;
  degradedReason?: string;
}

export interface AsyncScanner {
  scanAsync(input: ScanInput): Promise<AsyncScanResult>;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function units(input: ScanInput): { text: string; source: FindingSource }[] {
  return [
    { text: input.text, source: { kind: 'composer' } as FindingSource },
    ...(input.attachments ?? []).map((a) => ({ text: a.text, source: { kind: 'attachment', attachmentId: a.id } as FindingSource })),
  ];
}

export function scanSync(input: ScanInput, tier3a?: SyncDetector | null): ScanResult {
  const timings = emptyTimings();
  const findings: Finding[] = [];
  const t0 = now();
  for (const u of units(input)) findings.push(...scanTier1(u.text, u.source));
  const t1 = now();
  timings.tier1 = t1 - t0;
  if (tier3a) {
    for (const u of units(input)) findings.push(...tier3a.scan(u.text, u.source));
  }
  timings.tier3a = now() - t1;
  timings.total = timings.tier1 + timings.tier3a;
  return { verdict: findings.length ? 'block' : 'allow', findings: dedupe(findings), timings, tier2Route: null };
}

/** Merges the async half; a finding overlapping an existing one in the same unit is dropped. */
export function mergeAsync(sync: ScanResult, asyncPart: AsyncScanResult | null, wallMs?: number): ScanResult {
  if (!asyncPart) return sync;
  const findings = dedupe([...sync.findings, ...asyncPart.findings]);
  const timings: TierTimings = {
    ...sync.timings,
    tier2: asyncPart.timings.tier2,
    tier3b: asyncPart.timings.tier3b,
    total: wallMs ?? sync.timings.total + asyncPart.timings.tier2 + asyncPart.timings.tier3b,
  };
  return {
    verdict: findings.length ? 'block' : 'allow',
    findings,
    timings,
    tier2Route: asyncPart.tier2Route,
    ...(asyncPart.degradedReason ? { degradedReason: asyncPart.degradedReason } : {}),
  };
}

function sourceKey(s: FindingSource) {
  return s.kind === 'composer' ? 'c' : `a:${s.attachmentId}`;
}

function dedupe(findings: Finding[]): Finding[] {
  const out: Finding[] = [];
  for (const f of findings) {
    const clash = out.find((o) => sourceKey(o.source) === sourceKey(f.source) && f.rawStart < o.rawEnd && o.rawStart < f.rawEnd);
    if (!clash) out.push(f);
  }
  return out.sort((a, b) => sourceKey(a.source).localeCompare(sourceKey(b.source)) || a.rawStart - b.rawStart);
}

/** Full cascade in one call — used by benchmarks and tests. */
export async function scanFull(input: ScanInput, tier3a: SyncDetector | null, asyncScanner: AsyncScanner | null): Promise<ScanResult> {
  const t0 = now();
  const sync = scanSync(input, tier3a);
  if (!asyncScanner) return sync;
  const asyncPart = await asyncScanner.scanAsync(input);
  return mergeAsync(sync, asyncPart, now() - t0);
}
