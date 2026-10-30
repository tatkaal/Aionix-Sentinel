// Tier 3 Path A — document fingerprinting. Probes every prompt / attachment shingle against each
// asset's Bloom filter and blocks on a long run of consecutive hits (a copied excerpt), or on a
// high MinHash Jaccard estimate (a near-duplicate of a whole document).
import type { SyncDetector } from '../pipeline';
import type { Finding, FindingSource } from '../types';
import { estimateJaccard, minhashSignature } from './minhash';
import { shingles, tokenize } from './shingle';
import type { VaultAsset } from './vault-format';

/** Consecutive (non-generic) shingle hits needed to call an excerpt a copy (~2 lines of code). */
export const MIN_HIT_RUN = 10;
/** Whole-document near-duplicate threshold. */
export const MIN_JACCARD = 0.5;

export interface VaultMatch {
  asset: VaultAsset;
  run: number;
  hits: number;
  probes: number;
  jaccard: number;
  rawStart: number;
  rawEnd: number;
}

export interface VaultDetector extends SyncDetector {
  readonly assets: VaultAsset[];
  addAsset(asset: VaultAsset): void;
  removeAsset(id: string): void;
  /** Diagnostics for the Vault workspace (per-asset run / hit / Jaccard). */
  inspect(text: string): VaultMatch[];
}

export function createVaultDetector(initial: VaultAsset[]): VaultDetector {
  const assets = [...initial];

  const inspect = (text: string): VaultMatch[] => {
    const tokens = tokenize(text);
    const sh = shingles(tokens);
    if (sh.length === 0) return [];
    const meaningful = sh.filter((s) => !s.generic);
    const promptSig = meaningful.length >= 20 ? minhashSignature(meaningful.map((s) => s.hash)) : null;
    const out: VaultMatch[] = [];
    for (const asset of assets) {
      let run = 0;
      let best = 0;
      let bestStart = 0;
      let bestEnd = 0;
      let runStart = 0;
      let hits = 0;
      for (const s of sh) {
        if (s.generic) continue; // generic shingles neither extend nor break a run
        if (asset.bloom.has(s.hash)) {
          if (run === 0) runStart = s.token;
          run++;
          hits++;
          if (run > best) {
            best = run;
            bestStart = runStart;
            bestEnd = s.token + 4;
          }
        } else {
          run = 0;
        }
      }
      const jaccard = promptSig ? estimateJaccard(promptSig, asset.signature) : 0;
      out.push({
        asset,
        run: best,
        hits,
        probes: meaningful.length,
        jaccard,
        rawStart: best ? tokens[bestStart]!.start : 0,
        rawEnd: best ? tokens[Math.min(bestEnd, tokens.length - 1)]!.end : 0,
      });
    }
    return out;
  };

  return {
    assets,
    addAsset(asset) {
      const i = assets.findIndex((a) => a.id === asset.id);
      if (i >= 0) assets[i] = asset;
      else assets.push(asset);
    },
    removeAsset(id) {
      const i = assets.findIndex((a) => a.id === id);
      if (i >= 0) assets.splice(i, 1);
    },
    inspect,
    scan(text: string, source: FindingSource): Finding[] {
      if (assets.length === 0 || text.length < 40) return [];
      const findings: Finding[] = [];
      for (const m of inspect(text)) {
        const byRun = m.run >= MIN_HIT_RUN;
        const byJaccard = m.jaccard >= MIN_JACCARD;
        if (!byRun && !byJaccard) continue;
        const rawStart = byRun ? m.rawStart : 0;
        const rawEnd = byRun ? m.rawEnd : text.length;
        findings.push({
          id: `VAULT_${m.asset.id}:${rawStart}`,
          category: m.asset.category,
          type: m.asset.kind === 'code' ? 'PROPRIETARY_CODE' : m.asset.kind === 'table' ? 'CONFIDENTIAL_RECORDS' : 'CONFIDENTIAL_DOCUMENT',
          label: `Matches vault asset “${m.asset.title}”`,
          tier: 'tier3',
          path: 'minhash',
          rawStart,
          rawEnd,
          confidence: byRun ? Math.min(0.99, 0.9 + m.run / 500) : 0.9,
          evidence: `${m.run} consecutive 5-gram shingle hits · MinHash J≈${m.jaccard.toFixed(2)}`,
          source,
        });
      }
      return findings;
    },
  };
}
