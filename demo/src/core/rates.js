/**
 * Fixed demo exchange rates.
 *
 * THESE ARE NOT LIVE RATES. They are a single snapshot, captured 2026-08-26
 * 11:42 UTC and frozen, so that the demo is deterministic and reviewable: the
 * same inputs always produce the same output, with no network dependency. They
 * were near market at capture and will drift from it; the snapshot date is
 * carried in RATE_SET_ID precisely so a result can be traced to the rates that
 * produced it. Deliverable 2 covers how a production system sources, versions
 * and audits real rates.
 *
 * Representation: each rate is an exact integer ratio, not a decimal.
 *
 *   1 USD = num/den <currency>
 *
 * Why a ratio rather than a decimal like 0.010496? Because the inverse of a
 * decimal rate does not round-trip. Storing INR->USD as 0.010496 and USD->INR
 * as 95.27 gives two mutually inconsistent rates; converting a value out and
 * back does not return the original. With an exact ratio the inverse is just
 * den/num, so conversion is invertible by construction and the round-trip is
 * exact. See Design.md D-03.
 *
 * All conversion is aggregate-level. Individual salaries are never converted:
 * the allocation ratio is dimensionless, so each raise is computed inside the
 * employee's own currency. See Design.md D-04.
 */

import { rational, mul, div, add as addRational, toFixedString, ZERO } from './rational.js';
import { toMajorRational } from './money.js';
import { currencyMeta } from './currencies.js';

export const BASE_CURRENCY = 'USD';

/**
 * Identifies this rate set in output and documentation.
 *
 * The identifier carries the snapshot date deliberately. A monetary result is
 * only reproducible if you know which rates produced it, so every allocation
 * result reports the rate set it used. A production system versions rates for
 * the same reason -- see Deliverable 2.
 */
export const RATE_SET_ID = 'snapshot-2026-08-26';

/** Provenance, surfaced in the UI and the README rather than buried here. */
export const RATE_SET = Object.freeze({
  id: RATE_SET_ID,
  asOf: '2026-08-26T11:42:00Z',
  source: 'Mid-market reference rate, Morningstar via Google Finance',
  note: 'Captured once and frozen. No rate API is called at runtime.',
});

/** 1 USD = num/den of the keyed currency. */
export const RATES = Object.freeze({
  USD: Object.freeze({ num: 1n, den: 1n }),      // 1 USD =  1.00 USD
  INR: Object.freeze({ num: 9527n, den: 100n }), // 1 USD = 95.27 INR
  MXN: Object.freeze({ num: 1694n, den: 100n }), // 1 USD = 16.94 MXN
});

/**
 * Human-readable rate lines for the README and the UI's assumptions panel.
 * Formatted from the exact ratio -- no Number conversion anywhere, so the
 * displayed rate cannot drift from the rate actually used.
 */
export function rateTable() {
  return Object.entries(RATES).map(([code, r]) => {
    const exact = rational(r.num, r.den);
    return {
      currency: code,
      perBase: toFixedString(exact, 2),
      exactRatio: `${r.num}/${r.den}`,
      label: `1 ${BASE_CURRENCY} = ${toFixedString(exact, 2)} ${code}`,
    };
  });
}

function rateOf(currency) {
  const r = RATES[currency];
  if (!r) throw new RangeError(`No exchange rate configured for ${currency}`);
  return rational(r.num, r.den);
}

/**
 * Exact value of a Money amount expressed in BASE major units, as a Rational.
 * No rounding occurs here -- the result stays exact so that the allocation
 * ratio has a single, documented rounding point downstream.
 *
 * @param {{currency:string,minor:bigint}} m
 * @returns {{num:bigint,den:bigint}}
 */
export function toBaseRational(m) {
  currencyMeta(m.currency);
  return div(toMajorRational(m), rateOf(m.currency));
}

/**
 * Exact value of a Rational amount of BASE major units, expressed in `currency`
 * major units. Inverse of toBaseRational by construction.
 */
export function fromBaseRational(baseMajor, currency) {
  return mul(baseMajor, rateOf(currency));
}

/** Sum a list of Money in mixed currencies into an exact base-currency Rational. */
export function sumInBase(amounts) {
  return amounts.reduce((acc, m) => addRational(acc, toBaseRational(m)), ZERO);
}
