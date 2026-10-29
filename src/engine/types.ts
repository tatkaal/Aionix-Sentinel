// Shared engine contracts. Pure TypeScript — no DOM, no chrome.* (see CLAUDE.md).

export type CategoryId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface CategoryInfo {
  id: CategoryId;
  label: string;
  short: string;
}

export const CATEGORIES: Record<CategoryId, CategoryInfo> = {
  1: { id: 1, label: 'API keys & access tokens', short: 'API keys' },
  2: { id: 2, label: 'Passwords & secrets', short: 'Secrets' },
  3: { id: 3, label: 'Government IDs', short: 'Gov IDs' },
  4: { id: 4, label: 'AU Tax File Number', short: 'AU TFN' },
  5: { id: 5, label: 'Payment cards & bank accounts', short: 'Cards/bank' },
  6: { id: 6, label: 'Business & national IDs', short: 'ABN/PAN/Aadhaar' },
  7: { id: 7, label: 'Database credentials', short: 'DB creds' },
  8: { id: 8, label: 'Customer financial records', short: 'Financial' },
  9: { id: 9, label: 'Medical records', short: 'Medical' },
  10: { id: 10, label: 'Corporate IP & documents', short: 'Corporate IP' },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES).map(Number) as CategoryId[];

export type EngineTier = 'tier1' | 'tier2' | 'tier3';

/**
 * Detection route: Tier 1 math; Tier 2 Path A lexicon (FST) or Path B WebGPU (privacy-filter);
 * Tier 3 Path A MinHash/Bloom or Path B exact data match (Orama + CRM hashes).
 */
export type EnginePath = 'math' | 'lexicon' | 'webgpu' | 'minhash' | 'edm';

export const PATH_LABELS: Record<EnginePath, string> = {
  math: 'Tier 1 · Math',
  lexicon: 'Tier 2 · Path A Lexicon',
  webgpu: 'Tier 2 · Path B WebGPU',
  minhash: 'Tier 3 · Path A MinHash',
  edm: 'Tier 3 · Path B EDM',
};

export type FindingSource = { kind: 'composer' } | { kind: 'attachment'; attachmentId: string };

export interface Finding {
  /** Stable within one scan: `${type}:${rawStart}`. */
  id: string;
  category: CategoryId;
  /** Machine type, also used for the redaction tag: [REDACTED_<type>]. */
  type: string;
  label: string;
  tier: EngineTier;
  path: EnginePath;
  /** Offsets into the raw (un-normalised) text the user typed. */
  rawStart: number;
  rawEnd: number;
  confidence: number;
  /** Short, non-sensitive reason (never the secret itself), e.g. "Luhn valid". */
  evidence: string;
  source: FindingSource;
}

export type Verdict = 'allow' | 'block';

export type Tier2Route = 'A' | 'B';

export interface TierTimings {
  tier1: number;
  tier3a: number;
  tier2: number;
  tier3b: number;
  total: number;
}

export interface ScanResult {
  verdict: Verdict;
  findings: Finding[];
  timings: TierTimings;
  /** Which Tier 2 path actually ran (null when Tier 2 was skipped). */
  tier2Route: Tier2Route | null;
  degradedReason?: string;
}

export interface ScanInput {
  text: string;
  /** Large-paste attachment chip contents scanned alongside the composer text. */
  attachments?: { id: string; name: string; text: string }[];
}

export function redactionTag(type: string): string {
  return `[REDACTED_${type}]`;
}

export function emptyTimings(): TierTimings {
  return { tier1: 0, tier3a: 0, tier2: 0, tier3b: 0, total: 0 };
}
