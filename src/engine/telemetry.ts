// Zero-knowledge telemetry records. Never contain prompt text or detected values — only
// categories, routes, latency and a salted, truncated SHA-256 of each finding.
import type { CategoryId, EnginePath, EngineTier, Finding, ScanResult, Tier2Route } from './types';

export type PortalName = 'claude' | 'chatgpt' | 'gemini' | 'sandbox';

export interface IncidentFinding {
  category: CategoryId;
  type: string;
  tier: EngineTier;
  path: EnginePath;
  /** sha256(salt + value) truncated to 12 hex chars — lets auditors correlate repeats, not recover values. */
  fingerprint: string;
  inAttachment: boolean;
}

export interface ScanRecord {
  id: string;
  ts: number;
  portal: PortalName;
  blocked: boolean;
  latencyMs: number;
  tier2Route: Tier2Route | null;
  degraded: boolean;
  findings: IncidentFinding[];
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function fingerprint(salt: string, value: string): Promise<string> {
  return (await sha256Hex(`${salt}\u0000${value}`)).slice(0, 12);
}

/** Builds a telemetry record; `valueOf` resolves a finding's raw value only for hashing. */
export async function toScanRecord(
  result: ScanResult,
  portal: PortalName,
  salt: string,
  valueOf: (f: Finding) => string,
): Promise<ScanRecord> {
  const findings = await Promise.all(
    result.findings.map(async (f) => ({
      category: f.category,
      type: f.type,
      tier: f.tier,
      path: f.path,
      fingerprint: await fingerprint(salt, valueOf(f)),
      inAttachment: f.source.kind === 'attachment',
    })),
  );
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    portal,
    blocked: result.verdict === 'block',
    latencyMs: Math.round(result.timings.total * 100) / 100,
    tier2Route: result.tier2Route,
    degraded: !!result.degradedReason,
    findings,
  };
}

export function randomSalt(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
