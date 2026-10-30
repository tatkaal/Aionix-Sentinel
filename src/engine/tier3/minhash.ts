import { mix32 } from './hash';

export const MINHASH_PERMS = 64;

// Fixed permutation seeds (deterministic, so build-time and run-time signatures agree).
const SEEDS = Uint32Array.from({ length: MINHASH_PERMS }, (_, i) => mix32(i + 1, 0x5bd1e995));

/** k=64 MinHash signature over a set of 32-bit shingle hashes. */
export function minhashSignature(hashes: ArrayLike<number>): Uint32Array {
  const sig = new Uint32Array(MINHASH_PERMS).fill(0xffffffff);
  for (let i = 0; i < hashes.length; i++) {
    const h = hashes[i]!;
    for (let p = 0; p < MINHASH_PERMS; p++) {
      const v = mix32(h, SEEDS[p]!);
      if (v < sig[p]!) sig[p] = v;
    }
  }
  return sig;
}

/** Estimated Jaccard similarity: the fraction of permutations whose minima agree. */
export function estimateJaccard(a: Uint32Array, b: Uint32Array): number {
  let eq = 0;
  for (let i = 0; i < MINHASH_PERMS; i++) if (a[i] === b[i] && a[i] !== 0xffffffff) eq++;
  return eq / MINHASH_PERMS;
}
