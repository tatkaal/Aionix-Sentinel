// Paragraph-aligned chunking shared by Tier 2 (validator windows) and Tier 3 Path B (EDM index and
// queries). Sharing chunk boundaries lets one cached MiniLM embedding serve both tiers, and keeps
// pasted paragraphs aligned with indexed ones (a 0.95 cosine threshold does not survive misaligned
// windows). CSV-like lines become one chunk per row; long paragraphs fall back to 90-word windows.

export interface TextChunk {
  text: string;
  start: number;
  end: number;
}

export const MIN_CHUNK_WORDS = 12;
export const MAX_CHUNK_WORDS = 120;
const CSV_ROW = /^[^\n,]*(?:,[^\n,]*){4,}$/;

export function chunkText(text: string, minWords = MIN_CHUNK_WORDS): TextChunk[] {
  const out: TextChunk[] = [];
  const paraRe = /[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g;
  for (let m = paraRe.exec(text); m; m = paraRe.exec(text)) {
    const para = m[0];
    const base = m.index;
    const lines = para.split('\n');
    if (lines.filter((l) => CSV_ROW.test(l)).length >= Math.max(1, lines.length / 2)) {
      let off = base;
      for (const line of lines) {
        if (CSV_ROW.test(line)) out.push({ text: line.trim(), start: off, end: off + line.length });
        off += line.length + 1;
      }
      continue;
    }
    const words: { start: number; end: number }[] = [];
    const wr = /\S+/g;
    for (let w = wr.exec(para); w; w = wr.exec(para)) words.push({ start: base + w.index, end: base + w.index + w[0].length });
    if (words.length < minWords) continue;
    if (words.length <= MAX_CHUNK_WORDS) {
      out.push({ text: text.slice(words[0]!.start, words.at(-1)!.end), start: words[0]!.start, end: words.at(-1)!.end });
      continue;
    }
    for (let i = 0; i < words.length; i += 70) {
      const last = words[Math.min(words.length, i + 90) - 1]!;
      out.push({ text: text.slice(words[i]!.start, last.end), start: words[i]!.start, end: last.end });
      if (i + 90 >= words.length) break;
    }
  }
  return out;
}
