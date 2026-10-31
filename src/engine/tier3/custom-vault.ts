// Protected data added by an administrator inside the extension (options page). Only fingerprints
// are persisted: Bloom + MinHash for Tier 3 Path A (content script) and MiniLM vectors + salted field
// hashes for Tier 3 Path B (offscreen). The document text is indexed in memory and discarded.
import type { CategoryId } from '../types';
import { buildAsset, decodeVault, encodeVault, type AssetKind, type VaultAsset } from './vault-format';

export const CUSTOM_VAULT_KEY = 'aionix.vault.custom.v1';
/** Indexing cap per item: keeps chrome.storage small and the embedding pass short. */
export const MAX_CUSTOM_CHARS = 200_000;

export type ProtectedType = 'code' | 'document' | 'customers' | 'patients';

export const PROTECTED_TYPES: Record<ProtectedType, { label: string; kind: AssetKind; category: CategoryId; hint: string }> = {
  code: { label: 'Proprietary source code', kind: 'code', category: 10, hint: 'Blocks pasted excerpts (≈ 2+ lines) and near-copies of the file.' },
  document: { label: 'Confidential document', kind: 'prose', category: 10, hint: 'Blocks copied paragraphs and near-duplicates of the document.' },
  customers: {
    label: 'Customer records (CSV)',
    kind: 'table',
    category: 8,
    hint: 'Header row required. Columns named full_name / name, account_number, customer_id, email are matched exactly (salted hashes).',
  },
  patients: {
    label: 'Patient records (CSV)',
    kind: 'table',
    category: 9,
    hint: 'Header row required. Columns named full_name / name, mrn, patient_id, email are matched exactly (salted hashes).',
  },
};

/** What chrome.storage.local holds per protected item — fingerprints and metadata, never text. */
export interface CustomVaultRecord {
  id: string;
  title: string;
  type: ProtectedType;
  kind: AssetKind;
  category: CategoryId;
  addedAt: number;
  chars: number;
  shingles: number;
  /** base64 of encodeVault([asset]) — Tier 3 Path A. */
  vault: string;
  /** base64 of encodeEdm(partial) — Tier 3 Path B (vectors + salted field hashes). */
  edm: string | null;
  vectors: number;
  fieldHashes: number;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Tier 3 Path A fingerprints for one protected item. */
export function fingerprintCustom(id: string, title: string, type: ProtectedType, text: string): { vault: string; shingles: number; asset: VaultAsset } {
  const t = PROTECTED_TYPES[type];
  const asset = buildAsset(id, title, t.kind, t.category, text.slice(0, MAX_CUSTOM_CHARS));
  return { vault: toBase64(encodeVault([asset])), shingles: asset.shingleCount, asset };
}

export function decodeCustomAsset(record: Pick<CustomVaultRecord, 'vault'>): VaultAsset | null {
  try {
    return decodeVault(fromBase64(record.vault))[0] ?? null;
  } catch {
    return null;
  }
}
