// Document-level detection metrics. Positive = "must block".

export interface Confusion {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export interface Metrics extends Confusion {
  n: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /** Compliance-weighted F-beta with beta = 2 (recall counts 4× precision). */
  f2: number | null;
  fpr: number | null;
  accuracy: number;
}

export function fbeta(precision: number | null, recall: number | null, beta: number): number | null {
  if (precision === null || recall === null) return null;
  const b2 = beta * beta;
  const denom = b2 * precision + recall;
  return denom === 0 ? 0 : ((1 + b2) * precision * recall) / denom;
}

export function computeMetrics(c: Confusion): Metrics {
  const n = c.tp + c.fp + c.tn + c.fn;
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : null;
  const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
  return {
    ...c,
    n,
    precision,
    recall,
    f1: fbeta(precision, recall, 1),
    f2: fbeta(precision, recall, 2),
    fpr: c.fp + c.tn ? c.fp / (c.fp + c.tn) : null,
    accuracy: n ? (c.tp + c.tn) / n : 0,
  };
}

/** Nearest-rank percentile (p in 0–100). */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1]!;
}
