import { redactionTag, type Finding } from './types';

/** Zero-knowledge preview: enough to recognise the item, never enough to reuse it. */
export function maskValue(value: string): string {
  const v = value.trim();
  const digits = v.replace(/\D/g, '');
  if (digits.length >= 6 && digits.length / v.replace(/\s/g, '').length > 0.5) {
    // Numeric IDs: cards keep first/last 4 (PCI-style); shorter IDs reveal only the last 2 digits.
    const head = digits.length >= 13 ? 4 : 0;
    const tail = digits.length >= 13 ? 4 : 2;
    let seen = 0;
    return v.replace(/\d/g, (d) => {
      seen++;
      return seen <= head || seen > digits.length - tail ? d : '•';
    });
  }
  if (v.length <= 6) return '•'.repeat(v.length);
  const keep = Math.min(4, Math.floor(v.length / 6));
  return `${v.slice(0, keep)}${'•'.repeat(Math.min(16, v.length - keep * 2))}${v.slice(-keep)}`;
}

/** Replaces each finding's raw span with [REDACTED_<TYPE>] (applied right-to-left so offsets stay valid). */
export function redactText(text: string, findings: Finding[]): string {
  const sorted = [...findings].sort((a, b) => b.rawStart - a.rawStart);
  let out = text;
  let lastStart = Infinity;
  for (const f of sorted) {
    if (f.rawEnd > lastStart) continue; // overlapping span already redacted
    out = out.slice(0, f.rawStart) + redactionTag(f.type) + out.slice(f.rawEnd);
    lastStart = f.rawStart;
  }
  return out;
}
