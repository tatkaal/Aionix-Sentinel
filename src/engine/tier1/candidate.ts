import type { CategoryId } from '../types';

/** Detector output in normalised-text coordinates (mapped to raw offsets by tier1/index.ts). */
export interface Candidate {
  start: number;
  end: number;
  category: CategoryId;
  type: string;
  label: string;
  confidence: number;
  evidence: string;
  /** Higher wins when candidates overlap (more specific detectors rank higher). */
  priority: number;
}

/** True when `re` matches the context window around [start, end). `re` must not be global. */
export function labelNear(text: string, start: number, end: number, re: RegExp, before = 48, after = 24): boolean {
  const ctx = text.slice(Math.max(0, start - before), start) + ' \u0000 ' + text.slice(end, Math.min(text.length, end + after));
  return re.test(ctx);
}
