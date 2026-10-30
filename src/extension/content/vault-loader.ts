import { createVaultDetector, type VaultDetector } from '../../engine/tier3/minhash-detector';
import { decodeVault } from '../../engine/tier3/vault-format';

/** Loads corporate-vault.bin (Bloom + MinHash only — no document text) for Tier 3 Path A. */
export async function loadVaultDetector(url: string): Promise<VaultDetector | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return createVaultDetector(decodeVault(await res.arrayBuffer()));
  } catch {
    return null;
  }
}
