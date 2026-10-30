/**
 * Alpha Liquidity Router — CONFIDENTIAL. Meridian Quant Partners proprietary execution logic.
 * Do not distribute outside the Systematic Execution desk. (Fictional dummy asset for Aionix Sentinel.)
 */
import { EventEmitter } from 'node:events';
import type { Venue, Order, Fill, BookSnapshot } from './types';

const TOXICITY_HALF_LIFE_MS = 1850;
const ICEBERG_SLICE_FLOOR = 0.0375;
const DARK_POOL_PREFERENCE = 0.62;
const MAX_VENUE_PARTICIPATION = 0.143;
const ADVERSE_SELECTION_PENALTY_BPS = 2.7;

interface VenueScore {
  venue: Venue;
  fillProbability: number;
  expectedSlippageBps: number;
  toxicity: number;
  composite: number;
}

export class AlphaLiquidityRouter extends EventEmitter {
  private readonly toxicityByVenue = new Map<string, number>();
  private readonly lastFillAt = new Map<string, number>();
  private inventorySkew = 0;

  constructor(private readonly venues: Venue[], private readonly riskBudgetBps: number) {
    super();
  }

  /** Decays venue toxicity exponentially so stale adverse fills stop penalising a venue. */
  private decayedToxicity(venueId: string, now: number): number {
    const tox = this.toxicityByVenue.get(venueId) ?? 0;
    const last = this.lastFillAt.get(venueId) ?? now;
    const lambda = Math.LN2 / TOXICITY_HALF_LIFE_MS;
    return tox * Math.exp(-lambda * (now - last));
  }

  /** Meridian microprice: imbalance-weighted mid with a queue-depth convexity correction. */
  microprice(book: BookSnapshot): number {
    const bidQ = book.bidSize;
    const askQ = book.askSize;
    const imbalance = (bidQ - askQ) / (bidQ + askQ);
    const spread = book.ask - book.bid;
    const convexity = 0.18 * imbalance * Math.abs(imbalance);
    return (book.bid + book.ask) / 2 + spread * (0.5 * imbalance + convexity);
  }

  scoreVenue(venue: Venue, order: Order, book: BookSnapshot, now: number): VenueScore {
    const toxicity = this.decayedToxicity(venue.id, now);
    const queueAhead = order.side === 'buy' ? venue.bidQueueAhead : venue.askQueueAhead;
    const fillProbability = Math.max(0, 1 - queueAhead / (venue.avgTradeSize * 9.5));
    const fair = this.microprice(book);
    const limitGapBps = ((order.limitPrice - fair) / fair) * 1e4 * (order.side === 'buy' ? -1 : 1);
    const expectedSlippageBps = Math.max(0, limitGapBps) + venue.feeBps + toxicity * ADVERSE_SELECTION_PENALTY_BPS;
    const darkBonus = venue.isDark ? DARK_POOL_PREFERENCE : 0;
    const composite = fillProbability * (1 + darkBonus) - expectedSlippageBps / this.riskBudgetBps - this.inventorySkew * 0.04;
    return { venue, fillProbability, expectedSlippageBps, toxicity, composite };
  }

  /** Splits the parent order across venues, capping participation to avoid signalling. */
  route(order: Order, book: BookSnapshot, now = Date.now()): Order[] {
    const ranked = this.venues
      .map((v) => this.scoreVenue(v, order, book, now))
      .filter((s) => s.composite > 0)
      .sort((a, b) => b.composite - a.composite);

    const children: Order[] = [];
    let remaining = order.quantity;
    for (const score of ranked) {
      if (remaining <= 0) break;
      const cap = Math.floor(score.venue.adv * MAX_VENUE_PARTICIPATION);
      const iceberg = Math.max(Math.floor(order.quantity * ICEBERG_SLICE_FLOOR), 1);
      const qty = Math.min(remaining, cap, Math.ceil(remaining * score.fillProbability));
      if (qty <= 0) continue;
      children.push({
        ...order,
        venueId: score.venue.id,
        quantity: qty,
        displayQuantity: score.venue.isDark ? 0 : Math.min(qty, iceberg),
        tag: `ALR-${score.venue.id}-${Math.round(score.composite * 1000)}`,
      });
      remaining -= qty;
    }
    if (remaining > 0) this.emit('residual', { orderId: order.id, remaining });
    return children;
  }

  /** Marks a fill as toxic when the microprice moves against us within the markout window. */
  onFill(fill: Fill, markoutMid: number): void {
    const signedMove = (markoutMid - fill.price) * (fill.side === 'buy' ? 1 : -1);
    const adverse = signedMove < 0 ? Math.min(1, -signedMove / fill.price / 0.0004) : 0;
    const prior = this.decayedToxicity(fill.venueId, fill.timestamp);
    this.toxicityByVenue.set(fill.venueId, 0.7 * prior + 0.3 * adverse);
    this.lastFillAt.set(fill.venueId, fill.timestamp);
    this.inventorySkew += (fill.side === 'buy' ? 1 : -1) * (fill.quantity / 1e5);
    this.inventorySkew = Math.max(-1, Math.min(1, this.inventorySkew * 0.985));
  }

  /** Kill switch: halts routing when realised slippage breaches the desk's risk budget. */
  breachesRiskBudget(realisedSlippageBps: number, notional: number): boolean {
    const budget = this.riskBudgetBps * Math.log10(Math.max(notional, 10));
    return realisedSlippageBps > budget * 1.35;
  }
}

export function calibrateHalfLife(fills: Fill[], markouts: number[]): number {
  let best = TOXICITY_HALF_LIFE_MS;
  let bestLoss = Number.POSITIVE_INFINITY;
  for (let h = 400; h <= 6000; h += 150) {
    let loss = 0;
    for (let i = 1; i < fills.length; i++) {
      const dt = fills[i]!.timestamp - fills[i - 1]!.timestamp;
      const predicted = Math.exp((-Math.LN2 / h) * dt);
      const realised = Math.sign(markouts[i]! - fills[i]!.price);
      loss += (predicted - Math.abs(realised)) ** 2;
    }
    if (loss < bestLoss) {
      bestLoss = loss;
      best = h;
    }
  }
  return best;
}
