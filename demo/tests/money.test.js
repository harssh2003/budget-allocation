import test from 'node:test';
import assert from 'node:assert/strict';
import { money, zero, fromMajorString, toMajorString, toMajorRational, add, subtract, sum, compare, isZeroMoney } from '../src/core/money.js';
import { compare as compareRational, rational } from '../src/core/rational.js';

test('parses exact decimal strings into minor units', () => {
  assert.equal(fromMajorString('USD', '1234.15').minor, 123415n);
  assert.equal(fromMajorString('USD', '0.07').minor, 7n);
  assert.equal(fromMajorString('INR', '2000000').minor, 200000000n);
  assert.equal(fromMajorString('USD', '1.5').minor, 150n);   // short fraction padded
  assert.equal(fromMajorString('USD', '0').minor, 0n);
  assert.equal(fromMajorString('USD', '007').minor, 700n);
});

test('avoids the float parse trap', () => {
  // Number("1234.15") * 100 === 123415.00000000001
  assert.equal(fromMajorString('USD', '1234.15').minor, 123415n);
  // Number("0.07") * 100 === 7.000000000000001
  assert.equal(fromMajorString('USD', '0.07').minor, 7n);
  // (8.575).toFixed(2) === "8.57", i.e. the wrong cent
  assert.equal(toMajorString(fromMajorString('USD', '8.58')), '8.58');
});

test('round-trips through the exact decimal string', () => {
  for (const [currency, text] of [
    ['USD', '1234.15'], ['INR', '16677000.00'], ['MXN', '0.01'],
    ['USD', '12345678901234567890.99'], ['USD', '0.00'],
  ]) {
    assert.equal(toMajorString(fromMajorString(currency, text)), text.includes('.') ? text : `${text}.00`);
  }
});

test('rejects anything that is not an exact decimal', () => {
  for (const bad of ['1e9', 'abc', '', '1.2.3', '0x10', ' 12', '１２３', 'Infinity', 'NaN', '1,000']) {
    assert.throws(() => fromMajorString('USD', bad), RangeError, `should reject ${JSON.stringify(bad)}`);
  }
  assert.throws(() => fromMajorString('USD', 1234), TypeError);
});

test('rejects more decimal places than the currency defines', () => {
  assert.throws(() => fromMajorString('USD', '1.005'), /at most 2 decimal places/);
  assert.throws(() => fromMajorString('INR', '1.000'), /at most 2 decimal places/);
});

test('rejects unsupported currencies', () => {
  assert.throws(() => money('EUR', 1n), RangeError);
  assert.throws(() => fromMajorString('JPY', '100'), RangeError);
});

test('requires BigInt minor units', () => {
  assert.throws(() => money('USD', 100), TypeError);
  assert.throws(() => money('USD', 1.5), TypeError);
});

test('refuses to combine different currencies', () => {
  const usd = fromMajorString('USD', '1');
  const inr = fromMajorString('INR', '1');
  assert.throws(() => add(usd, inr), /Cannot combine USD and INR/);
  assert.throws(() => subtract(usd, inr), /Cannot combine/);
  assert.throws(() => compare(usd, inr), /Cannot combine/);
  assert.throws(() => sum([usd, inr], 'USD'), /expected USD, found INR/);
});

test('sums and compares within a currency', () => {
  const a = fromMajorString('USD', '10.50');
  const b = fromMajorString('USD', '0.50');
  assert.equal(toMajorString(add(a, b)), '11.00');
  assert.equal(toMajorString(subtract(a, b)), '10.00');
  assert.equal(toMajorString(sum([a, b, zero('USD')], 'USD')), '11.00');
  assert.equal(toMajorString(sum([], 'INR')), '0.00');   // empty list still has a currency
  assert.equal(compare(a, b), 1);
  assert.ok(isZeroMoney(zero('MXN')));
});

test('exposes an exact major-unit rational for conversion', () => {
  assert.equal(compareRational(toMajorRational(fromMajorString('USD', '1.50')), rational(3n, 2n)), 0);
});
