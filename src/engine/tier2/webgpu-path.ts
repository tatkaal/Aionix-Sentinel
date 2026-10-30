// Tier 2 Path B — neural person / account / secret detection (openai/privacy-filter on WebGPU).
// The model supplies PERSON-side nodes; clinical nodes still come from the FST because the model
// has no medical label. The same proximity graph and validator make the decision.
import type { Finding, FindingSource } from '../types';
import type { ContextValidator } from './context-validator';
import { FST_CLASS } from './fst-format';
import type { Fst } from './fst-runtime';
import { graphFindings, type Tier2Scanner } from './graph-scan';
import { findPersonNodes, findSensitiveNodes, type PersonNode, type SensitiveNode } from './nodes';

export interface NeuralEntity {
  label: string;
  start: number;
  end: number;
  score: number;
}

export interface NeuralNer {
  readonly modelId: string;
  detect(text: string): Promise<NeuralEntity[]>;
  dispose(): Promise<void>;
}

const PERSON_LABELS = new Set(['private_person', 'private_email', 'private_phone']);

export function createWebGpuPath(fst: Fst, validator: ContextValidator | null, ner: NeuralNer): Tier2Scanner {
  return {
    route: 'B',
    async scan(text: string, source: FindingSource): Promise<Finding[]> {
      if (text.length < 12) return [];
      const entities = (await ner.detect(text)).filter((e) => e.score >= 0.5);
      const persons: PersonNode[] = [];
      const extraSensitive: SensitiveNode[] = [];
      const findings: Finding[] = [];
      for (const e of entities) {
        const span = text.slice(e.start, e.end);
        if (PERSON_LABELS.has(e.label)) {
          const isPublic = fst.lookup(span.toLowerCase().replace(/\s+/g, ' ').trim()).some((o) => o[0] === FST_CLASS.publicFigure);
          persons.push({ kind: 'neural', start: e.start, end: e.end, text: span, isPublic });
        } else if (e.label === 'account_number') {
          persons.push({ kind: 'account', start: e.start, end: e.end, text: span, isPublic: false });
          extraSensitive.push({ kind: 'account', domain: 'financial', start: e.start, end: e.end, term: 'account number' });
        } else if (e.label === 'secret') {
          findings.push({
            id: `NEURAL_SECRET:${e.start}`,
            category: 2,
            type: 'SECRET',
            label: 'Secret (neural detection)',
            tier: 'tier2',
            path: 'webgpu',
            rawStart: e.start,
            rawEnd: e.end,
            confidence: e.score,
            evidence: `privacy-filter secret · p=${e.score.toFixed(2)}`,
            source,
          });
        }
      }
      // Structured identifiers (MRN, record IDs, DOB) are deterministic — keep them from the lexicon side.
      for (const p of findPersonNodes(text, fst)) {
        if (p.kind === 'name' || p.kind === 'honorific') continue;
        if (!persons.some((q) => p.start < q.end && q.start < p.end)) persons.push(p);
      }
      if (persons.some((p) => !p.isPublic)) {
        const sensitive = [...findSensitiveNodes(text, fst), ...extraSensitive];
        findings.push(...(await graphFindings(text, source, persons, sensitive, validator, 'webgpu')));
      }
      return findings;
    },
  };
}
