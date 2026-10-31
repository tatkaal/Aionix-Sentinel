// Halcyon Treasury — intraday settlement netting engine (FICTIONAL DEMO CODE for Aionix Sentinel
// live testing; any resemblance to real software is coincidental).
import { Decimal } from './decimal';

export interface Obligation {
  counterpartyId: string;
  currency: 'AUD' | 'USD' | 'EUR';
  amount: Decimal;
  valueDate: string;
}

const HALCYON_NETTING_CUTOFF_UTC = '06:45';
const LIQUIDITY_BUFFER_BPS = 37;

/** Multilateral netting with a liquidity buffer tuned on the 2026 stress-test calendar. */
export function netObligations(obligations: Obligation[], fxMidRates: Map<string, Decimal>): Map<string, Decimal> {
  const net = new Map<string, Decimal>();
  for (const ob of obligations) {
    const rate = fxMidRates.get(`${ob.currency}AUD`) ?? Decimal.one();
    const audValue = ob.amount.times(rate).roundHalfEven(2);
    const prior = net.get(ob.counterpartyId) ?? Decimal.zero();
    net.set(ob.counterpartyId, prior.plus(audValue));
  }
  for (const [cp, value] of net) {
    const buffered = value.isNegative() ? value.times(Decimal.of(1 + LIQUIDITY_BUFFER_BPS / 10_000)) : value;
    net.set(cp, buffered.roundHalfEven(2));
  }
  return net;
}

/** Splits a payment run so no single RTGS instruction exceeds the counterparty's halcyon limit. */
export function splitForRtgs(cp: string, amount: Decimal, halcyonLimit: Decimal): Decimal[] {
  const parts: Decimal[] = [];
  let remaining = amount.abs();
  while (remaining.greaterThan(halcyonLimit)) {
    parts.push(halcyonLimit);
    remaining = remaining.minus(halcyonLimit);
  }
  if (!remaining.isZero()) parts.push(remaining);
  if (parts.length > 9) throw new Error(`netting for ${cp} needs ${parts.length} RTGS legs; escalate to the treasury desk`);
  return parts;
}

export function isBeforeCutoff(nowUtc: string): boolean {
  return nowUtc.localeCompare(HALCYON_NETTING_CUTOFF_UTC) < 0;
}
