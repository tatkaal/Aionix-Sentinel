// Shared Tier 2 decision logic for both paths: PERSON/SENSITIVE nodes → 30-token proximity edges →
// MiniLM context validation → findings anchored on the identifying span (so redaction
// de-identifies the record instead of deleting the clinical or financial content).
import { chunkText } from '../chunk';
import type { EnginePath, Finding, FindingSource } from '../types';
import type { ContextValidator } from './context-validator';
import type { PersonNode, SensitiveNode } from './nodes';
import { buildEdges, type GraphEdge } from './proximity-graph';

const MAX_VALIDATIONS = 4;
const CONTEXT_PAD = 120;

export interface Tier2Scanner {
  readonly route: 'A' | 'B';
  scan(text: string, source: FindingSource): Promise<Finding[]>;
}

/**
 * The paragraph chunk that contains the whole edge (identical to a Tier 3 EDM chunk, so the
 * embedding is shared through the cache); otherwise a padded character window.
 */
function validationWindow(text: string, edge: GraphEdge): string {
  const chunk = chunkText(text, 1).find((c) => c.start <= edge.windowStart && edge.windowEnd <= c.end);
  if (chunk) return chunk.text;
  return text.slice(Math.max(0, edge.windowStart - CONTEXT_PAD), Math.min(text.length, edge.windowEnd + CONTEXT_PAD));
}

function describe(edge: GraphEdge): string {
  const s = edge.sensitive[0]!;
  const extra = edge.sensitive.length > 1 ? ` +${edge.sensitive.length - 1}` : '';
  return `${s.term.trim()}${s.code ? ` (${s.code})` : ''}${extra}`;
}

export async function graphFindings(
  text: string,
  source: FindingSource,
  persons: PersonNode[],
  sensitive: SensitiveNode[],
  validator: ContextValidator | null,
  path: EnginePath,
): Promise<Finding[]> {
  const edges = buildEdges(text, persons, sensitive)
    // Medical first so a person tied to both domains is reported as a medical record.
    .sort((a, b) => (a.domain === b.domain ? a.distance - b.distance : a.domain === 'medical' ? -1 : 1));
  const findings: Finding[] = [];
  const seenPerson = new Set<number>();
  let validations = 0;
  for (const edge of edges) {
    if (seenPerson.has(edge.person.start)) continue;
    // A customer financial *record* ties the person to an account, or to an amount *and* a financial
    // attribute (balance, holdings, loan, salary …). Vocabulary alone ("portfolio review") or an
    // amount alone (a hotel rate next to a rooming list) is not a record.
    if (edge.domain === 'financial') {
      const hasAccount = edge.sensitive.some((s) => s.kind === 'account');
      const hasAmount = edge.sensitive.some((s) => s.kind === 'money');
      const hasAttribute = edge.sensitive.some((s) => s.kind === 'financial-term');
      if (!hasAccount && !(hasAmount && hasAttribute)) continue;
    }
    let contextNote = 'graph only';
    let confidence = 0.8;
    if (validator && validations < MAX_VALIDATIONS) {
      validations++;
      const v = await validator.validate(validationWindow(text, edge));
      if (!v.personal) continue;
      contextNote = `context ${v.score >= 0 ? '+' : ''}${v.score.toFixed(2)}`;
      confidence = Math.min(0.98, 0.85 + Math.max(0, v.score));
    }
    seenPerson.add(edge.person.start);
    const medical = edge.domain === 'medical';
    findings.push({
      id: `${medical ? 'PATIENT' : 'CUSTOMER'}_IDENTITY:${edge.person.start}`,
      category: medical ? 9 : 8,
      type: medical ? 'PATIENT_IDENTITY' : 'CUSTOMER_IDENTITY',
      label: medical ? `Identifiable patient linked to ${describe(edge)}` : `Identifiable customer linked to ${describe(edge)}`,
      tier: 'tier2',
      path,
      rawStart: edge.person.start,
      rawEnd: edge.person.end,
      confidence,
      evidence: `${edge.person.kind} ↔ ${edge.sensitive[0]!.kind} · ${edge.distance} tokens · ${contextNote}`,
      source,
    });
  }
  return findings;
}
