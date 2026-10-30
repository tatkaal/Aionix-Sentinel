// Tier 2 Path B (v2) — a compact token classifier on the CPU, linked through the same proximity graph
// and validator as Path A. Unlike privacy-filter's coarse `account_number`, entity kinds keep the
// person side (names, contacts, record IDs) apart from financial facts (accounts, cards), so two
// numbers can no longer form a "customer record" on their own.
import type { Finding, FindingSource } from '../types';
import type { ContextValidator } from './context-validator';
import { FST_CLASS } from './fst-format';
import type { Fst } from './fst-runtime';
import { graphFindings, type Tier2Scanner } from './graph-scan';
import labels from './neural-labels.json';
import { findPersonNodes, findSensitiveNodes, type PersonNode, type SensitiveNode } from './nodes';
import type { NeuralEntity, NeuralNer } from './webgpu-path';

export type NeuralKind = 'person' | 'email' | 'phone' | 'dob' | 'record-id' | 'gov-id' | 'account' | 'card' | 'secret' | 'address';

export const NEURAL_KINDS = labels.kinds as NeuralKind[];
const SOURCE_MAP = labels.map as Record<string, NeuralKind>;

/** Canonical kind for a source label (`B-first_name` → person); null for labels Tier 2 ignores. */
export function neuralKind(label: string): NeuralKind | null {
  const bare = label.replace(/^[BIES]-/, '').toLowerCase();
  if ((NEURAL_KINDS as string[]).includes(bare)) return bare as NeuralKind;
  return SOURCE_MAP[bare] ?? null;
}

export interface NeuralPolicy {
  /** Minimum span score kept from the tagger. */
  minScore: number;
  /** Also keep Path A's lexicon/cue names alongside neural names. */
  lexiconNames: boolean;
  /** Emit Category 3 for neural government IDs (no checksum available). */
  govIdFindings: boolean;
  /** Emit Category 2 for neural secrets (passwords, PINs, API keys). */
  secretFindings: boolean;
}

// minScore 0.7: dev-split error analysis found the spurious names ("der", "e", "Danish") at 0.51–0.67
// while real names score above 0.8.
export const DEFAULT_NEURAL_POLICY: NeuralPolicy = { minScore: 0.7, lexiconNames: true, govIdFindings: false, secretFindings: false };

// Who the record is about: names, record IDs and dates of birth — as on Path A. Phone numbers and
// email addresses are left out: in prose they are as often a help line or a team inbox
// ("1-800-227-2345") as a person, which dev-split error analysis showed linking to clinical terms.
const PERSON_SIDE: Partial<Record<NeuralKind, PersonNode['kind']>> = {
  person: 'neural',
  dob: 'dob',
  'record-id': 'record-id',
};

/**
 * Account numbers are mostly numeric (IBANs carry a few letters). Alphanumeric codes the tagger
 * sometimes calls accounts — vehicle VINs, booking references — are not; and a bare 13–19 digit
 * run is card-shaped, which Tier 1 decides with Luhn.
 */
export function accountShaped(span: string): boolean {
  const alnum = span.replace(/[^\p{L}\p{N}]/gu, '');
  const digits = alnum.replace(/\D/g, '').length;
  if (digits < 5 || digits / alnum.length < 0.6) return false;
  return !(digits === alnum.length && digits >= 13 && digits <= 19);
}

/**
 * Identifiers stand alone: a span inside a larger token ("SBD42664" of "SBD42664FCR.pdf") or inside a
 * URL, e-mail address or path ("…/l.cfm?lk=0062300450…") is not an account or record number.
 */
export function standsAlone(text: string, start: number, end: number): boolean {
  const alnum = /[\p{L}\p{N}]/u;
  if ((start > 0 && alnum.test(text[start - 1]!)) || (end < text.length && alnum.test(text[end]!))) return false;
  let s = start;
  let e = end;
  while (s > 0 && !/\s/.test(text[s - 1]!)) s--;
  while (e < text.length && !/\s/.test(text[e]!)) e++;
  return !/:\/\/|@|=|\/|www\./i.test(text.slice(s, e));
}

/** Adjacent spans of one kind separated only by spaces are one mention ("Taylor" + "Swift"). */
function mergeAdjacent(text: string, entities: NeuralEntity[]): NeuralEntity[] {
  const out: NeuralEntity[] = [];
  for (const e of [...entities].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && neuralKind(last.label) === neuralKind(e.label) && /^[ \t]+$/.test(text.slice(last.end, e.start))) {
      out[out.length - 1] = { ...last, end: e.end, score: Math.min(last.score, e.score) };
    } else out.push(e);
  }
  return out;
}

export function createNeuralPath(fst: Fst, validator: ContextValidator | null, ner: NeuralNer, policy: NeuralPolicy = DEFAULT_NEURAL_POLICY): Tier2Scanner {
  return {
    route: 'B',
    async scan(text: string, source: FindingSource): Promise<Finding[]> {
      if (text.length < 12) return [];
      const persons: PersonNode[] = [];
      const sensitive: SensitiveNode[] = [];
      const findings: Finding[] = [];
      for (const e of mergeAdjacent(text, await ner.detect(text))) {
        if (e.score < policy.minScore) continue;
        const kind = neuralKind(e.label);
        if (!kind) continue;
        const span = text.slice(e.start, e.end);
        const personKind = PERSON_SIDE[kind];
        if (personKind && (kind !== 'record-id' || standsAlone(text, e.start, e.end))) {
          const isPublic = kind === 'person' && fst.lookup(span.toLowerCase().replace(/\s+/g, ' ').trim()).some((o) => o[0] === FST_CLASS.publicFigure);
          persons.push({ kind: personKind, start: e.start, end: e.end, text: span, isPublic });
        } else if (kind === 'account' && accountShaped(span) && standsAlone(text, e.start, e.end)) {
          // Payment cards are Tier 1's call (Luhn): a card-shaped number the checksum rejects is not
          // evidence of a customer record, so neural `card` spans are not financial nodes.
          sensitive.push({ kind: 'account', domain: 'financial', start: e.start, end: e.end, term: 'account number' });
        } else if ((kind === 'gov-id' && policy.govIdFindings) || (kind === 'secret' && policy.secretFindings)) {
          const gov = kind === 'gov-id';
          findings.push({
            id: `${gov ? 'NEURAL_GOV_ID' : 'NEURAL_SECRET'}:${e.start}`,
            category: gov ? 3 : 2,
            type: gov ? 'GOV_ID' : 'SECRET',
            label: gov ? 'Government ID (neural detection)' : 'Secret (neural detection)',
            tier: 'tier2',
            path: 'neural',
            rawStart: e.start,
            rawEnd: e.end,
            confidence: e.score,
            evidence: `${ner.modelId} ${kind} · p=${e.score.toFixed(2)}`,
            source,
          });
        }
      }
      // Deterministic identifiers (MRN, record IDs, DOB) and, by policy, Path A's cue-based names.
      for (const p of findPersonNodes(text, fst)) {
        if (!policy.lexiconNames && (p.kind === 'name' || p.kind === 'honorific')) continue;
        if (!persons.some((q) => p.start < q.end && q.start < p.end)) persons.push(p);
      }
      if (persons.some((p) => !p.isPublic)) {
        for (const s of findSensitiveNodes(text, fst)) if (!sensitive.some((q) => s.start < q.end && q.start < s.end)) sensitive.push(s);
        findings.push(...(await graphFindings(text, source, persons, sensitive, validator, 'neural')));
      }
      return findings;
    },
  };
}
