/**
 * Budget input validation policy (Design.md D-09).
 *
 * This is the boundary between an arbitrary string typed by a user and an exact
 * Money value. Nothing downstream re-checks these conditions, so this module is
 * deliberately strict and deliberately specific: every rejection names what is
 * wrong rather than returning a generic "invalid input".
 *
 * Returns a result object rather than throwing. Invalid input is an expected
 * outcome of a form field, not an exceptional condition, and the UI needs the
 * failure reason to render a useful message.
 */

import { currencyMeta, SUPPORTED_CURRENCIES } from './currencies.js';
import { fromMajorString } from './money.js';

/** @enum {string} Stable codes; tests assert on these, not on message text. */
export const BudgetError = Object.freeze({
  UNSUPPORTED_CURRENCY: 'UNSUPPORTED_CURRENCY',
  EMPTY: 'EMPTY',
  TOO_LONG: 'TOO_LONG',
  CURRENCY_SYMBOL: 'CURRENCY_SYMBOL',
  NEGATIVE: 'NEGATIVE',
  EXPONENT_NOTATION: 'EXPONENT_NOTATION',
  NOT_A_NUMBER: 'NOT_A_NUMBER',
  TOO_MANY_DECIMALS: 'TOO_MANY_DECIMALS',
});

/**
 * A syntactic guard against pathological input, checked before any parsing.
 *
 * This is a bound on the STRING, not on the money. The economic limit -- what
 * counts as too large a budget -- is derived from payroll and enforced by the
 * engine (`maximumMeaningfulBudget`), because a fixed figure in major units
 * means something different in every currency (Design.md D-23).
 */
const MAX_INPUT_LENGTH = 32;

/**
 * Grouping separators are stripped, not validated for placement.
 *
 * Western grouping (2,000,000) and Indian grouping (20,00,000) are both correct
 * and differ from each other. Rejecting either would be a bug, and validating
 * both properly is disproportionate for a demo whose users span both
 * conventions. Accepting a slightly permissive superset is the right trade.
 *
 * Includes NBSP (U+00A0) and narrow NBSP (U+202F), which arrive when an amount
 * is pasted from a spreadsheet or a formatted web page.
 */
const GROUPING_SEPARATORS = /[,    ']/g;

/** Symbols we recognise well enough to give a better message than "not a number". */
const CURRENCY_SYMBOLS = /[$₹€£¥₱¢]|Rs\.?|INR|USD|MXN/i;

const EXACT_DECIMAL = /^\+?(\d+)(?:\.(\d*))?$/;

/**
 * @typedef {{ ok: true, value: {currency:string,minor:bigint} }} BudgetOk
 * @typedef {{ ok: false, code: string, message: string }} BudgetFail
 */

const fail = (code, message) => ({ ok: false, code, message });

/**
 * @param {unknown} rawInput the string as typed
 * @param {string} currency the currency selected alongside it
 * @returns {BudgetOk | BudgetFail}
 */
export function validateBudget(rawInput, currency) {
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    return fail(
      BudgetError.UNSUPPORTED_CURRENCY,
      `Unsupported currency. Choose one of ${SUPPORTED_CURRENCIES.join(', ')}.`,
    );
  }

  const meta = currencyMeta(currency);
  const input = typeof rawInput === 'string' ? rawInput.trim() : String(rawInput ?? '').trim();

  if (input === '') {
    return fail(BudgetError.EMPTY, 'Enter an additional budget amount.');
  }
  if (input.length > MAX_INPUT_LENGTH) {
    return fail(BudgetError.TOO_LONG, `That is too long to be an amount (limit ${MAX_INPUT_LENGTH} characters).`);
  }
  if (CURRENCY_SYMBOLS.test(input)) {
    return fail(
      BudgetError.CURRENCY_SYMBOL,
      'Enter the amount only — use the currency selector rather than typing a currency symbol or code.',
    );
  }

  const cleaned = input.replace(GROUPING_SEPARATORS, '');

  // Checked before the general numeric test so the message can be specific.
  if (cleaned.startsWith('-')) {
    return fail(BudgetError.NEGATIVE, 'The additional budget cannot be negative.');
  }
  // Only what actually reads as scientific notation -- "1e6", "2.5E-3" -- not
  // any input that happens to contain the letter, or "one" gets the wrong message.
  if (/^\+?\d*\.?\d*e[+-]?\d+$/i.test(cleaned)) {
    return fail(
      BudgetError.EXPONENT_NOTATION,
      'Scientific notation is not accepted for an amount. Write the number out in full.',
    );
  }

  const match = EXACT_DECIMAL.exec(cleaned);
  if (!match) {
    return fail(BudgetError.NOT_A_NUMBER, 'Enter a number, using digits 0–9 and an optional decimal point.');
  }

  const [, whole, fraction = ''] = match;
  if (fraction.length > meta.minorExponent) {
    return fail(
      BudgetError.TOO_MANY_DECIMALS,
      meta.minorExponent === 0
        ? `${currency} amounts cannot have decimal places.`
        : `${currency} amounts support at most ${meta.minorExponent} decimal place${meta.minorExponent === 1 ? '' : 's'}.`,
    );
  }

  // Zero is a valid query, not an error: it produces a 0% allocation.
  return { ok: true, value: fromMajorString(currency, cleaned.replace(/^\+/, '')) };
}
