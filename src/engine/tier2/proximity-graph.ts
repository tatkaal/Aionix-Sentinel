// Bipartite PERSON ↔ SENSITIVE graph: an edge exists when the two nodes sit within
// MAX_TOKEN_DISTANCE word tokens of each other. Only edges become Tier 2 candidates.
import type { PersonNode, SensitiveNode } from './nodes';

export const MAX_TOKEN_DISTANCE = 30;

export interface GraphEdge {
  person: PersonNode;
  sensitive: SensitiveNode[];
  domain: 'medical' | 'financial';
  /** Smallest token distance between the person and any linked sensitive node. */
  distance: number;
  /** Window [start, end) in raw offsets covering the person and its linked nodes. */
  windowStart: number;
  windowEnd: number;
}

function tokenStarts(text: string): number[] {
  const starts: number[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  for (let m = re.exec(text); m; m = re.exec(text)) starts.push(m.index);
  return starts;
}

function tokenIndex(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function buildEdges(text: string, persons: PersonNode[], sensitive: SensitiveNode[]): GraphEdge[] {
  if (!persons.length || !sensitive.length) return [];
  const starts = tokenStarts(text);
  const span = (s: number, e: number): [number, number] => [tokenIndex(starts, s), tokenIndex(starts, Math.max(s, e - 1))];
  const edges: GraphEdge[] = [];
  for (const p of persons) {
    if (p.isPublic) continue;
    const [ps, pe] = span(p.start, p.end);
    for (const domain of ['medical', 'financial'] as const) {
      const linked: SensitiveNode[] = [];
      let best = Infinity;
      for (const s of sensitive) {
        if (s.domain !== domain) continue;
        if (s.start < p.end && p.start < s.end) continue; // overlapping spans are the same mention
        const [ss, se] = span(s.start, s.end);
        const d = se < ps ? ps - se : ss > pe ? ss - pe : 0;
        if (d <= MAX_TOKEN_DISTANCE) {
          linked.push(s);
          best = Math.min(best, d);
        }
      }
      if (!linked.length) continue;
      edges.push({
        person: p,
        sensitive: linked,
        domain,
        distance: best,
        windowStart: Math.min(p.start, ...linked.map((s) => s.start)),
        windowEnd: Math.max(p.end, ...linked.map((s) => s.end)),
      });
    }
  }
  return edges;
}
