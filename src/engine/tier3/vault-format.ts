// corporate-vault.bin — compiled in CI/CD from proprietary assets. Ships only Bloom bits and
// MinHash signatures: no document text ever leaves the build machine.
//
// Layout (little-endian):
//   "AXV1" | u32 version | u32 shingleK | u32 perms | u32 assetCount
//   per asset: u16 len + utf8 id | u16 len + utf8 title | u8 kind | u8 category |
//              u32 shingleCount | u32 m | u8 k | m/8 bloom bytes | perms × u32 signature
import type { CategoryId } from '../types';
import { BloomFilter } from './bloom';
import { MINHASH_PERMS, minhashSignature } from './minhash';
import { documentShingleSet, SHINGLE_K } from './shingle';

export type AssetKind = 'code' | 'prose' | 'table';
const KIND_CODES: AssetKind[] = ['code', 'prose', 'table'];

export interface VaultAsset {
  id: string;
  title: string;
  kind: AssetKind;
  category: CategoryId;
  shingleCount: number;
  bloom: BloomFilter;
  signature: Uint32Array;
}

/** Per-probe false-positive target. Runs of ≥10 consecutive hits make a false block ~p^10. */
export const BLOOM_FP_RATE = 1e-4;

export function buildAsset(id: string, title: string, kind: AssetKind, category: CategoryId, text: string): VaultAsset {
  const set = documentShingleSet(text);
  const bloom = BloomFilter.create(set.length, BLOOM_FP_RATE);
  for (const h of set) bloom.add(h);
  return { id, title, kind, category, shingleCount: set.length, bloom, signature: minhashSignature(set) };
}

const MAGIC = 0x31565841; // "AXV1"

export function encodeVault(assets: VaultAsset[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const header = new DataView(new ArrayBuffer(20));
  header.setUint32(0, MAGIC, true);
  header.setUint32(4, 1, true);
  header.setUint32(8, SHINGLE_K, true);
  header.setUint32(12, MINHASH_PERMS, true);
  header.setUint32(16, assets.length, true);
  parts.push(new Uint8Array(header.buffer));
  for (const a of assets) {
    const id = enc.encode(a.id);
    const title = enc.encode(a.title);
    const meta = new DataView(new ArrayBuffer(2 + id.length + 2 + title.length + 1 + 1 + 4 + 4 + 1));
    let o = 0;
    meta.setUint16(o, id.length, true);
    o += 2;
    new Uint8Array(meta.buffer, o, id.length).set(id);
    o += id.length;
    meta.setUint16(o, title.length, true);
    o += 2;
    new Uint8Array(meta.buffer, o, title.length).set(title);
    o += title.length;
    meta.setUint8(o++, KIND_CODES.indexOf(a.kind));
    meta.setUint8(o++, a.category);
    meta.setUint32(o, a.shingleCount, true);
    o += 4;
    meta.setUint32(o, a.bloom.m, true);
    o += 4;
    meta.setUint8(o, a.bloom.k);
    parts.push(new Uint8Array(meta.buffer), a.bloom.bits);
    const sig = new Uint8Array(MINHASH_PERMS * 4);
    const sv = new DataView(sig.buffer);
    a.signature.forEach((v, i) => sv.setUint32(i * 4, v, true));
    parts.push(sig);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function decodeVault(buf: ArrayBuffer | Uint8Array): VaultAsset[] {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('corporate-vault.bin: bad magic');
  const k = dv.getUint32(8, true);
  const perms = dv.getUint32(12, true);
  if (k !== SHINGLE_K || perms !== MINHASH_PERMS) throw new Error('corporate-vault.bin: parameter mismatch');
  const count = dv.getUint32(16, true);
  let o = 20;
  const assets: VaultAsset[] = [];
  for (let i = 0; i < count; i++) {
    const idLen = dv.getUint16(o, true);
    o += 2;
    const id = dec.decode(bytes.subarray(o, o + idLen));
    o += idLen;
    const titleLen = dv.getUint16(o, true);
    o += 2;
    const title = dec.decode(bytes.subarray(o, o + titleLen));
    o += titleLen;
    const kind = KIND_CODES[dv.getUint8(o++)] ?? 'prose';
    const category = dv.getUint8(o++) as CategoryId;
    const shingleCount = dv.getUint32(o, true);
    o += 4;
    const m = dv.getUint32(o, true);
    o += 4;
    const bk = dv.getUint8(o++);
    const bits = bytes.slice(o, o + m / 8);
    o += m / 8;
    const signature = new Uint32Array(MINHASH_PERMS);
    for (let p = 0; p < MINHASH_PERMS; p++) signature[p] = dv.getUint32(o + p * 4, true);
    o += MINHASH_PERMS * 4;
    assets.push({ id, title, kind, category, shingleCount, bloom: new BloomFilter(bits, m, bk), signature });
  }
  return assets;
}
