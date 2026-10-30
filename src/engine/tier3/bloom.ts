import { mix32 } from './hash';

/** Classic Bloom filter over 32-bit item hashes (Kirsch–Mitzenmacher double hashing). */
export class BloomFilter {
  constructor(
    readonly bits: Uint8Array,
    readonly m: number,
    readonly k: number,
  ) {}

  /** Sizes the filter for n items at false-positive rate p. */
  static create(n: number, p: number): BloomFilter {
    const items = Math.max(1, n);
    const m = Math.max(64, Math.ceil((-items * Math.log(p)) / Math.LN2 ** 2));
    const k = Math.max(1, Math.round((m / items) * Math.LN2));
    const bytes = Math.ceil(m / 8);
    return new BloomFilter(new Uint8Array(bytes), bytes * 8, k);
  }

  add(h: number): void {
    const h1 = mix32(h, 0x9e3779b9);
    const h2 = mix32(h, 0x7f4a7c15) | 1;
    for (let i = 0; i < this.k; i++) {
      const bit = (h1 + Math.imul(i, h2)) >>> 0;
      const idx = bit % this.m;
      this.bits[idx >>> 3]! |= 1 << (idx & 7);
    }
  }

  has(h: number): boolean {
    const h1 = mix32(h, 0x9e3779b9);
    const h2 = mix32(h, 0x7f4a7c15) | 1;
    for (let i = 0; i < this.k; i++) {
      const idx = ((h1 + Math.imul(i, h2)) >>> 0) % this.m;
      if ((this.bits[idx >>> 3]! & (1 << (idx & 7))) === 0) return false;
    }
    return true;
  }

  /** Theoretical false-positive rate for n inserted items. */
  falsePositiveRate(n: number): number {
    return (1 - Math.exp((-this.k * n) / this.m)) ** this.k;
  }

  fillRatio(): number {
    let set = 0;
    for (const byte of this.bits) {
      let b = byte;
      while (b) {
        set += b & 1;
        b >>>= 1;
      }
    }
    return set / this.m;
  }
}
