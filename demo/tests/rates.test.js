import test from 'node:test';
import assert from 'node:assert/strict';
import { RATES, BASE_CURRENCY, RATE_SET_ID, rateTable, toBaseRational, fromBaseRational, sumInBase } from '../src/core/rates.js';
import { fromMajorString, money } from '../src/core/money.js';
import { rational, compare, toFixedString, mul, div } from '../src/core/rational.js';

test('the rate set is fixed and identifiable', () => {
  assert.equal(BASE_CURRENCY, 'USD');
  assert.equal(RATE_SET_ID, 'snapshot-2026-08-26');
  assert.deepEqual(Object.keys(RATES).sort(), ['INR', 'MXN', 'USD']);
  assert.deepEqual(RATES.USD, { num: 1n, den: 1n });     // base converts to itself exactly
});

test('conversion to base is exact', () => {
  // 1 USD = 95.27 INR, so Rs 9,527 is exactly USD 100.
  assert.equal(compare(toBaseRational(fromMajorString('INR', '9527')), rational(100n)), 0);
  // 1 USD = 16.94 MXN, so MXN 1,694 is exactly USD 100.
  assert.equal(compare(toBaseRational(fromMajorString('MXN', '1694')), rational(100n)), 0);
  assert.equal(compare(toBaseRational(fromMajorString('USD', '100')), rational(100n)), 0);
});

test('conversion round-trips exactly in both directions', () => {
  // The reason rates are integer ratios rather than decimals (Design.md D-03):
  // a decimal rate table does not round-trip, an exact ratio does by construction.
  for (const currency of ['USD', 'INR', 'MXN']) {
    for (const amount of ['0.01', '1', '166770000', '99999999999.99']) {
      const original = fromMajorString(currency, amount);
      const roundTripped = fromBaseRational(toBaseRational(original), currency);
      assert.equal(
        compare(roundTripped, rational(original.minor, 100n)), 0,
        `${amount} ${currency} did not round-trip`,
      );
    }
  }
});

test('the inverse rate is exact, not an approximation', () => {
  // A decimal table would store INR->USD as 0.010496..., losing the identity.
  const inrPerUsd = rational(RATES.INR.num, RATES.INR.den);
  const usdPerInr = div(rational(1n), inrPerUsd);
  assert.equal(compare(mul(inrPerUsd, usdPerInr), rational(1n)), 0);
});

test('mixed-currency totals are exact', () => {
  const total = sumInBase([
    fromMajorString('USD', '100'),
    fromMajorString('INR', '9527'),
    fromMajorString('MXN', '1694'),
  ]);
  assert.equal(compare(total, rational(300n)), 0);
  assert.equal(compare(sumInBase([]), rational(0n)), 0);
});

test('zero converts to zero in every currency', () => {
  for (const currency of ['USD', 'INR', 'MXN']) {
    assert.equal(compare(toBaseRational(money(currency, 0n)), rational(0n)), 0);
  }
});

test('the displayed rate is derived from the ratio actually used', () => {
  const rows = rateTable();
  assert.equal(rows.length, 3);
  const inr = rows.find((r) => r.currency === 'INR');
  assert.equal(inr.perBase, '95.27');
  assert.equal(inr.exactRatio, '9527/100');
  assert.equal(inr.label, '1 USD = 95.27 INR');
  // Displayed value must equal the stored ratio, so the two cannot drift apart.
  for (const row of rows) {
    const stored = rational(RATES[row.currency].num, RATES[row.currency].den);
    assert.equal(row.perBase, toFixedString(stored, 2));
  }
});

test('rejects an unconfigured currency', () => {
  assert.throws(() => toBaseRational({ currency: 'EUR', minor: 1n }), RangeError);
});
