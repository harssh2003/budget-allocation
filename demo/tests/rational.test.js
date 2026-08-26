import test from 'node:test';
import assert from 'node:assert/strict';
import { rational, add, mul, div, compare, isZero, scaleFloor, roundHalfUp, toFixedString, ZERO } from '../src/core/rational.js';

const r = (n, d = 1) => rational(BigInt(n), BigInt(d));

test('normalises to lowest terms with a positive denominator', () => {
  assert.deepEqual(rational(6n, 4n), { num: 3n, den: 2n });
  assert.deepEqual(rational(1n, -2n), { num: -1n, den: 2n });
  assert.deepEqual(rational(-6n, -4n), { num: 3n, den: 2n });
  assert.deepEqual(rational(0n, 5n), { num: 0n, den: 1n });
});

test('rejects a zero denominator and non-BigInt operands', () => {
  assert.throws(() => rational(1n, 0n), RangeError);
  assert.throws(() => rational(1, 2), TypeError);
  assert.throws(() => div(r(1), ZERO), RangeError);
});

test('arithmetic is exact where floating point is not', () => {
  // 0.1 + 0.2 === 0.30000000000000004 as a float; exact here.
  assert.equal(compare(add(r(1, 10), r(2, 10)), r(3, 10)), 0);
  assert.equal(compare(add(r(1, 3), r(1, 6)), r(1, 2)), 0);
  assert.equal(compare(mul(r(2, 3), r(3, 2)), r(1)), 0);
  assert.equal(compare(div(r(1, 3), r(1, 3)), r(1)), 0);
  assert.ok(isZero(mul(r(0), r(999))));
});

test('roundHalfUp rounds halves away from zero', () => {
  assert.equal(roundHalfUp(r(5, 2)), 3n);    // 2.5 -> 3
  assert.equal(roundHalfUp(r(7, 2)), 4n);    // 3.5 -> 4  (half-even would give 4)
  assert.equal(roundHalfUp(r(3, 2)), 2n);    // 1.5 -> 2  (half-even would give 2)
  assert.equal(roundHalfUp(r(1, 2)), 1n);    // 0.5 -> 1  (half-even would give 0)
  assert.equal(roundHalfUp(r(12, 5)), 2n);   // 2.4 -> 2
  assert.equal(roundHalfUp(r(13, 5)), 3n);   // 2.6 -> 3
  assert.equal(roundHalfUp(r(-5, 2)), -3n);  // -2.5 -> -3
  assert.equal(roundHalfUp(r(0)), 0n);
});

test('scaleFloor splits an exact product into quotient and remainder', () => {
  const { quotient, remainder, denominator } = scaleFloor(7n, r(1, 3));
  assert.equal(quotient, 2n);
  assert.equal(remainder, 1n);
  assert.equal(denominator, 3n);
  // The split reconstructs the exact product: 7 * 1/3 == 2 + 1/3
  assert.equal(compare(add(r(quotient), rational(remainder, denominator)), mul(r(7), r(1, 3))), 0);
});

test('scaleFloor is exact at magnitudes past Number.MAX_SAFE_INTEGER', () => {
  const huge = 10n ** 30n;
  const { quotient } = scaleFloor(huge, r(1, 3));
  assert.equal(quotient, huge / 3n);
  assert.ok(quotient > BigInt(Number.MAX_SAFE_INTEGER));
});

test('scaleFloor rejects negative operands', () => {
  assert.throws(() => scaleFloor(-1n, r(1, 2)), RangeError);
  assert.throws(() => scaleFloor(1n, r(-1, 2)), RangeError);
});

test('toFixedString produces exact decimal expansions', () => {
  assert.equal(toFixedString(r(1, 3), 6), '0.333333');
  assert.equal(toFixedString(r(2, 3), 6), '0.666667');   // rounded, not truncated
  assert.equal(toFixedString(r(1), 2), '1.00');
  assert.equal(toFixedString(r(0), 4), '0.0000');
  assert.equal(toFixedString(r(-1, 3), 3), '-0.333');
  assert.equal(toFixedString(r(5, 2), 0), '3');
  assert.throws(() => toFixedString(r(1), -1), RangeError);
});
