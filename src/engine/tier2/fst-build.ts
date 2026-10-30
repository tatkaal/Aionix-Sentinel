// Build-time compiler: sorted entries → minimal DAFSA (Daciuk et al. 2000, incremental
// construction for sorted input) → flat Uint32Array.
//
// Serialized node at word offset o:  words[o] = (edgeCount << 1) | final
//                                    words[o+1+i] = (charCode << 24) | targetOffset
import { FST_MAGIC, OUTPUT_SEP } from './fst-format';

class BuildNode {
  final = false;
  readonly edges = new Map<number, BuildNode>();
  constructor(readonly id: number) {}
  signature(): string {
    let s = this.final ? '1' : '0';
    for (const [c, n] of [...this.edges].sort((a, b) => a[0] - b[0])) s += `|${c}:${n.id}`;
    return s;
  }
}

export interface FstEntry {
  term: string;
  output: string;
}

export function compileFst(entries: FstEntry[]): { bytes: Uint8Array; nodes: number; words: number } {
  const words = [...new Set(entries.map((e) => e.term + String.fromCharCode(OUTPUT_SEP) + e.output))].sort();
  let nextId = 0;
  const root = new BuildNode(nextId++);
  const register = new Map<string, BuildNode>();
  const unchecked: [BuildNode, number, BuildNode][] = [];

  const minimize = (downTo: number) => {
    for (let i = unchecked.length - 1; i >= downTo; i--) {
      const [parent, ch, child] = unchecked[i]!;
      const sig = child.signature();
      const existing = register.get(sig);
      if (existing) parent.edges.set(ch, existing);
      else register.set(sig, child);
      unchecked.pop();
    }
  };

  let prev = '';
  for (const word of words) {
    let common = 0;
    while (common < word.length && common < prev.length && word[common] === prev[common]) common++;
    minimize(common);
    let node = unchecked.length ? unchecked[unchecked.length - 1]![2] : root;
    for (let i = common; i < word.length; i++) {
      const code = word.charCodeAt(i);
      if (code > 255) throw new Error(`FST alphabet is 8-bit; got U+${code.toString(16)} in "${word}"`);
      const child = new BuildNode(nextId++);
      node.edges.set(code, child);
      unchecked.push([node, code, child]);
      node = child;
    }
    node.final = true;
    prev = word;
  }
  minimize(0);

  // Assign offsets in BFS order, then serialise.
  const order: BuildNode[] = [];
  const offset = new Map<BuildNode, number>();
  const queue = [root];
  let cursor = 0;
  offset.set(root, 0);
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    cursor += 1 + n.edges.size;
    for (const child of [...n.edges.values()]) {
      if (!offset.has(child)) {
        offset.set(child, -1);
        queue.push(child);
      }
    }
  }
  let o = 0;
  for (const n of order) {
    offset.set(n, o);
    o += 1 + n.edges.size;
  }
  if (o >= 1 << 24) throw new Error('FST too large for 24-bit offsets');

  const HEADER = 4;
  const out = new Uint32Array(HEADER + o);
  out[0] = FST_MAGIC;
  out[1] = 1;
  out[2] = order.length;
  out[3] = words.length;
  for (const n of order) {
    const base = HEADER + offset.get(n)!;
    out[base] = (n.edges.size << 1) | (n.final ? 1 : 0);
    let i = 1;
    for (const [c, child] of [...n.edges].sort((a, b) => a[0] - b[0])) out[base + i++] = ((c << 24) | offset.get(child)!) >>> 0;
  }
  return { bytes: new Uint8Array(out.buffer), nodes: order.length, words: words.length };
}
