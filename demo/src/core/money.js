/**
 * Money as an exact integer count of minor units, tagged with its currency.
 *
 * Representation: { currency: 'INR', minor: 12345n } means Rs 123.45.
 *
 * Two rules make this safe, and both are enforced rather than assumed:
 *
 *  1. No floating point ever touches a monetary value. Numbers enter as
 *     decimal *strings* (fromMajorString) and leave as decimal *strings*
 *     (toMajorString). `Number("1234.15") * 100` is 123415.00000000001 and
 *     `(1.005).toFixed(2)` is "1.00" -- both wrong, both avoided entirely.
 *
 *  2. Amounts in different currencies cannot be combined. add() throws rather
 *     than silently producing a meaningless total. Cross-currency arithmetic
 *     goes through rates.js, which is explicit about the conversion.
 *
 * BigInt rather than Number-with-safe-integer-checks: at demo magnitudes a
 * bounded Number would also be exact, but BigInt removes the 2^53 question
 * from every future multiply site instead of requiring that proof to be
 * re-established as the code changes. Cost at 300 rows is nil. See Design.md D-01.
 */

import { currencyMeta, minorPerMajor } from './currencies.js';
import { rational } from './rational.js';

/** @typedef {{ currency: string, minor: bigint }} Money */

/**
 * @param {string} currency
 * @param {bigint} minor
 * @returns {Money}
 */
export function money(currency, minor) {
  currencyMeta(currency); // validates the code
  if (typeof minor !== 'bigint') {
    throw new TypeError(`money(): minor units must be a BigInt, got ${typeof minor}`);
  }
  return Object.freeze({ currency, minor });
}

export function zero(currency) {
  return money(currency, 0n);
}

/**
 * Parse an exact decimal string into Money. No Number, no parseFloat.
 *
 * Accepts an optional sign, digits, and at most `minorExponent` decimal
 * places. Rejects anything else -- including exponent notation, which is
 * ambiguous for a money entry field. Grouping separators are the caller's
 * concern (see validate.js); this function is the strict primitive.
 *
 * @param {string} currency
 * @param {string} decimal e.g. "2000000" or "1234.15"
 * @returns {Money}
 */
export function fromMajorString(currency, decimal) {
  const meta = currencyMeta(currency);
  if (typeof decimal !== 'string') {
    throw new TypeError('fromMajorString(): expects a string');
  }
  const m = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(decimal);
  if (!m) throw new RangeError(`fromMajorString(): not an exact decimal: ${JSON.stringify(decimal)}`);

  const [, sign, whole, frac = ''] = m;
  if (frac.length > meta.minorExponent) {
    throw new RangeError(
      `fromMajorString(): ${currency} supports at most ${meta.minorExponent} decimal places, got ${frac.length}`,
    );
  }
  const padded = frac.padEnd(meta.minorExponent, '0');
  const magnitude = BigInt(whole + padded);
  return money(currency, sign === '-' ? -magnitude : magnitude);
}

/**
 * Exact decimal string, always with the currency's full minor-unit precision.
 * Suitable to hand directly to Intl.NumberFormat, which accepts strings and
 * formats them exactly (verified on Node 20 / modern browsers).
 *
 * @param {Money} m
 * @returns {string} e.g. "1234.15"
 */
export function toMajorString(m) {
  const { minorExponent } = currencyMeta(m.currency);
  const neg = m.minor < 0n;
  const digits = (neg ? -m.minor : m.minor).toString().padStart(minorExponent + 1, '0');
  const whole = digits.slice(0, digits.length - minorExponent);
  const frac = minorExponent > 0 ? '.' + digits.slice(digits.length - minorExponent) : '';
  return `${neg ? '-' : ''}${whole}${frac}`;
}

/** Exact value in major units as a Rational, for rate conversion. */
export function toMajorRational(m) {
  return rational(m.minor, minorPerMajor(m.currency));
}

function assertSameCurrency(a, b) {
  if (a.currency !== b.currency) {
    throw new TypeError(
      `Cannot combine ${a.currency} and ${b.currency} directly; convert through rates.js first`,
    );
  }
}

export function add(a, b) {
  assertSameCurrency(a, b);
  return money(a.currency, a.minor + b.minor);
}

export function subtract(a, b) {
  assertSameCurrency(a, b);
  return money(a.currency, a.minor - b.minor);
}

/**
 * @param {Money[]} amounts
 * @param {string} currency required, so an empty list still has a currency
 */
export function sum(amounts, currency) {
  let total = 0n;
  for (const a of amounts) {
    if (a.currency !== currency) {
      throw new TypeError(`sum(): expected ${currency}, found ${a.currency}`);
    }
    total += a.minor;
  }
  return money(currency, total);
}

export function isZeroMoney(m) {
  return m.minor === 0n;
}

export function compare(a, b) {
  assertSameCurrency(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}
