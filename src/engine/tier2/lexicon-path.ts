// Tier 2 Path A — Hybrid Lexicon-Automata. Deterministic FST extraction of clinical / financial
// terms and person identifiers, linked by the 30-token graph and confirmed by the shared MiniLM
// context validator. Runs on CPU everywhere; this is the fallback every other path degrades to.
import type { ContextValidator } from './context-validator';
import type { Fst } from './fst-runtime';
import { graphFindings, type Tier2Scanner } from './graph-scan';
import { findPersonNodes, findSensitiveNodes } from './nodes';

export function createLexiconPath(fst: Fst, validator: ContextValidator | null): Tier2Scanner {
  return {
    route: 'A',
    async scan(text, source) {
      if (text.length < 12) return [];
      const persons = findPersonNodes(text, fst);
      if (!persons.some((p) => !p.isPublic)) return [];
      return graphFindings(text, source, persons, findSensitiveNodes(text, fst), validator, 'lexicon');
    },
  };
}
