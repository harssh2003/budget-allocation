import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBudget, BudgetError } from '../src/core/validate.js';
import { toMajorString } from '../src/core/money.js';

/** [input, currency, expected minor units] */
const ACCEPTED = [
  ['2000000', 'USD', 200000000n],
  ['2,000,000', 'USD', 200000000n],        // Western grouping
  ['20,00,000', 'INR', 200000000n],        // Indian grouping - both are correct
  ['1 234 567', 'MXN', 123456700n],        // space grouping
  ['1 000', 'INR', 100000n],          // NBSP, as pasted from a spreadsheet
  ['0', 'USD', 0n],                        // zero is a valid query, not an error
  ['0.01', 'USD', 1n],
  ['0.00', 'USD', 0n],
  ['+50', 'USD', 5000n],
  ['007', 'USD', 700n],
  ['  42.5  ', 'USD', 4250n],              // trimmed, fraction padded
  ['1234.15', 'MXN', 123415n],
  ['1000000000000', 'USD', 100000000000000n], // large amounts parse; the economic cap lives in the engine
];

/** [input, currency, expected error code] */
const REJECTED = [
  ['', 'USD', BudgetError.EMPTY],
  ['   ', 'USD', BudgetError.EMPTY],
  [null, 'USD', BudgetError.EMPTY],
  [undefined, 'USD', BudgetError.EMPTY],
  ['-1', 'USD', BudgetError.NEGATIVE],
  ['-0', 'USD', BudgetError.NEGATIVE],           // sign checked before magnitude
  ['-0.01', 'USD', BudgetError.NEGATIVE],
  ['abc', 'USD', BudgetError.NOT_A_NUMBER],
  ['1.2.3', 'USD', BudgetError.NOT_A_NUMBER],
  ['0x10', 'USD', BudgetError.NOT_A_NUMBER],
  ['１２３', 'USD', BudgetError.NOT_A_NUMBER],  // fullwidth digits
  ['NaN', 'USD', BudgetError.NOT_A_NUMBER],
  ['Infinity', 'USD', BudgetError.NOT_A_NUMBER],
  ['.', 'USD', BudgetError.NOT_A_NUMBER],
  ['1e9', 'USD', BudgetError.EXPONENT_NOTATION],
  ['1E9', 'USD', BudgetError.EXPONENT_NOTATION],
  ['2.5e-3', 'USD', BudgetError.EXPONENT_NOTATION],
  ['one', 'USD', BudgetError.NOT_A_NUMBER],          // contains "e", is not notation
  ['twelve', 'USD', BudgetError.NOT_A_NUMBER],
  ['1.005', 'USD', BudgetError.TOO_MANY_DECIMALS],
  ['1.000', 'INR', BudgetError.TOO_MANY_DECIMALS],
  ['$2000', 'USD', BudgetError.CURRENCY_SYMBOL],
  ['₹2,00,000', 'INR', BudgetError.CURRENCY_SYMBOL],
  ['Rs 5000', 'INR', BudgetError.CURRENCY_SYMBOL],
  ['5000 USD', 'USD', BudgetError.CURRENCY_SYMBOL],
  ['9'.repeat(33), 'USD', BudgetError.TOO_LONG],
  ['2000000', 'EUR', BudgetError.UNSUPPORTED_CURRENCY],
  ['2000000', '', BudgetError.UNSUPPORTED_CURRENCY],
];

test('accepts well-formed amounts', () => {
  for (const [input, currency, expected] of ACCEPTED) {
    const result = validateBudget(input, currency);
    assert.ok(result.ok, `${JSON.stringify(input)} (${currency}) should be accepted, got ${result.code}`);
    assert.equal(result.value.minor, expected, `${JSON.stringify(input)} (${currency})`);
    assert.equal(result.value.currency, currency);
  }
});

test('rejects malformed amounts with a specific code', () => {
  for (const [input, currency, expected] of REJECTED) {
    const result = validateBudget(input, currency);
    assert.equal(result.ok, false, `${JSON.stringify(input)} (${currency}) should be rejected`);
    assert.equal(result.code, expected, `${JSON.stringify(input)} (${currency})`);
  }
});

test('every rejection carries a non-empty, specific message', () => {
  for (const [input, currency] of REJECTED) {
    const { message } = validateBudget(input, currency);
    assert.ok(message && message.length > 10, `message too thin for ${JSON.stringify(input)}`);
    assert.notEqual(message.toLowerCase(), 'invalid input');
  }
});

test('negative is reported as negative, not as a generic parse failure', () => {
  // A user who types -5 should be told the budget cannot be negative, not
  // "enter a number" -- they did enter a number.
  const result = validateBudget('-5', 'USD');
  assert.equal(result.code, BudgetError.NEGATIVE);
  assert.match(result.message, /negative/i);
});

test('the decimal limit names the currency and its precision', () => {
  assert.match(validateBudget('1.005', 'MXN').message, /MXN.*2 decimal places/);
});

test('this layer bounds the string, not the amount', () => {
  // The economic limit is derived from payroll and enforced by the engine
  // (Design.md D-23), because a fixed figure in major units means a different
  // amount of money in every currency. Here only the string length is capped.
  assert.ok(validateBudget('1000000000000', 'USD').ok);
  assert.ok(validateBudget('999999999999999999', 'USD').ok, 'parsing is exact well past any cap');
  assert.equal(toMajorString(validateBudget('999999999999999999', 'USD').value), '999999999999999999.00');
  assert.equal(validateBudget('9'.repeat(33), 'USD').code, BudgetError.TOO_LONG);
  assert.ok(!Object.keys(BudgetError).includes('EXCEEDS_MAXIMUM'), 'the economic cap no longer lives here');
});
