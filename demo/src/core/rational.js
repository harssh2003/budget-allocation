/**
 * Exact rational arithmetic over BigInt.
 *
 * Why this exists: the allocation engine performs exactly ONE rounding step
 * (the largest-remainder apportionment in allocate.js). Every value feeding
 * that step -- exchange-rate conversions, payroll subtotals, the allocation
 * ratio itself -- must therefore stay exact. A decimal or floating-point
 * intermediate would introduce a second, undocumented rounding point.
 *
 * Invariant: every Rational is normalised to lowest terms with den > 0n.
 */

/** @typedef {{ num: bigint, den: bigint }} Rational */

function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/**
 * @param {bigint} num
 * @param {bigint} [den]
 * @returns {Rational}
 */
export function rational(num, den = 1n) {
  if (typeof num !== 'bigint' || typeof den !== 'bigint') {
    throw new TypeError('rational() requires BigInt operands');
  }
  if (den === 0n) throw new RangeError('rational(): zero denominator');
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return g > 1n ? { num: num / g, den: den / g } : { num, den };
}

export const ZERO = Object.freeze({ num: 0n, den: 1n });

/** @returns {Rational} */
export function add(a, b) {
  return rational(a.num * b.den + b.num * a.den, a.den * b.den);
}

/** @returns {Rational} */
export function mul(a, b) {
  return rational(a.num * b.num, a.den * b.den);
}

/** @returns {Rational} a / b */
export function div(a, b) {
  if (b.num === 0n) throw new RangeError('div(): division by zero');
  return rational(a.num * b.den, a.den * b.num);
}

export function isZero(a) {
  return a.num === 0n;
}

/** @returns {-1|0|1} */
export function compare(a, b) {
  const l = a.num * b.den;
  const r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

/**
 * Scale a BigInt by a Rational, returning the floor and the exact remainder.
 * This is the primitive the largest-remainder apportionment is built on:
 * `amount * r == quotient + remainder/denominator`, with no precision loss.
 *
 * @param {bigint} amount non-negative
 * @param {Rational} r non-negative
 * @returns {{ quotient: bigint, remainder: bigint, denominator: bigint }}
 */
export function scaleFloor(amount, r) {
  if (amount < 0n || r.num < 0n) {
    throw new RangeError('scaleFloor(): expects non-negative operands');
  }
  const product = amount * r.num;
  return {
    quotient: product / r.den,
    remainder: product % r.den,
    denominator: r.den,
  };
}

/**
 * Round a Rational to the nearest integer, halves away from zero.
 *
 * Half-up rather than half-even: this is applied to exactly three values per
 * allocation (one per currency group), so the systematic-bias argument that
 * motivates banker's rounding does not apply, and half-up is the convention a
 * finance reviewer will expect. See Design.md D-06.
 *
 * @param {Rational} r
 * @returns {bigint}
 */
export function roundHalfUp(r) {
  const { num, den } = r;
  // (2n + d) / 2d, floored, is exactly "round half up" for n >= 0.
  if (num >= 0n) return (2n * num + den) / (2n * den);
  return -((2n * -num + den) / (2n * den));
}

/**
 * Smallest integer not less than r. Used for "at least this much" thresholds,
 * where rounding to nearest could land one unit short of the bound.
 *
 * @param {Rational} r
 * @returns {bigint}
 */
export function ceilToInteger(r) {
  const { num, den } = r;
  if (num >= 0n) return (num + den - 1n) / den;
  return -(-num / den);
}

/**
 * Decimal expansion to a fixed number of places, half-up, as an exact string.
 * Used only for display of the allocation percentage; never in the money path.
 *
 * @param {Rational} r
 * @param {number} places
 * @returns {string}
 */
export function toFixedString(r, places) {
  if (!Number.isInteger(places) || places < 0) {
    throw new RangeError('toFixedString(): places must be a non-negative integer');
  }
  const shift = 10n ** BigInt(places);
  const scaled = roundHalfUp(mul(r, rational(shift)));
  const neg = scaled < 0n;
  const digits = (neg ? -scaled : scaled).toString().padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  const frac = places > 0 ? '.' + digits.slice(digits.length - places) : '';
  return `${neg ? '-' : ''}${whole}${frac}`;
}
