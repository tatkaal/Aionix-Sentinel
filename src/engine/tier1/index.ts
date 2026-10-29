// Tier 1 — synchronous deterministic & mathematical engine (Categories 1–7).
import { normalize, toRawSpan } from '../normalize';
import type { Finding, FindingSource } from '../types';
import type { Candidate } from './candidate';
import { scanNumbers } from './numbers';
import { scanPatterns } from './patterns';
import { scanSecrets } from './secrets';

/** Keeps the highest-priority candidate among overlapping spans (ties → longer span). */
function resolveOverlaps(cands: Candidate[]): Candidate[] {
  const ranked = [...cands].sort((a, b) => b.priority - a.priority || b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: Candidate[] = [];
  for (const c of ranked) {
    if (!kept.some((k) => c.start < k.end && k.start < c.end)) kept.push(c);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function scanTier1(raw: string, source: FindingSource = { kind: 'composer' }): Finding[] {
  if (!raw) return [];
  const norm = normalize(raw);
  const cands: Candidate[] = [];
  scanPatterns(norm.text, cands);
  scanNumbers(norm.text, cands);
  scanSecrets(norm.text, cands);
  return resolveOverlaps(cands).map((c) => {
    const { rawStart, rawEnd } = toRawSpan(norm, c.start, c.end);
    return {
      id: `${c.type}:${rawStart}`,
      category: c.category,
      type: c.type,
      label: c.label,
      tier: 'tier1',
      path: 'math',
      rawStart,
      rawEnd,
      confidence: c.confidence,
      evidence: c.evidence,
      source,
    } satisfies Finding;
  });
}
