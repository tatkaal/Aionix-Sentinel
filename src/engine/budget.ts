// Decision budgets, shared by the content script (whole Send) and the engine host (Path B's share).

/** Inputs up to this many characters get the plain 1,000 ms Send budget. */
export const SEND_BUDGET_BASE_CHARS = 4000;

/** Tier 2 budget for Path B inside the 1,000 ms send SLA (Tier 1/3A/3B and messaging use the rest). */
export const PATH_B_BUDGET_MS = 650;

/**
 * Decision budget for a Send, counted from the Send event: 1,000 ms for a prompt of up to 4,000
 * characters. Longer inputs (a long paste kept as inline text on Gemini and signed-out ChatGPT, or as a
 * chip on Claude) get 0.1 ms per extra character, up to 10 s. Path B's Tier 2 costs about 0.045 ms per
 * character (measured in the extension, 2026-11-02: 22,000 characters in ~1.0 s), so with a fixed 1 s a
 * clean long paste is held as "Check incomplete" or decided by Path A after Path B runs late.
 */
export function sendBudgetMs(chars: number): number {
  return Math.min(10_000, 1000 + Math.max(0, chars - SEND_BUDGET_BASE_CHARS) * 0.1);
}

/** Path B's share of the Send budget: what is left after Tier 1/3A/3B and messaging. */
export function pathBBudgetMs(chars: number): number {
  return sendBudgetMs(chars) - (1000 - PATH_B_BUDGET_MS);
}
