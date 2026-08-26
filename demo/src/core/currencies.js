/**
 * Currency metadata for the demo.
 *
 * `minorExponent` is modelled as data rather than hard-coded as 100, even
 * though all three demo currencies happen to use 2 decimal places. A
 * zero-decimal currency (JPY, KRW) or a three-decimal one (BHD, KWD) can be
 * added here without touching the money or allocation code. See Design.md D-02.
 *
 * `displayLocale` renders each salary the way its own country writes it --
 * notably INR uses the Indian lakh/crore grouping (1,66,77,000) rather than
 * Western thousands grouping.
 */

/** @typedef {'USD'|'INR'|'MXN'} CurrencyCode */

export const CURRENCIES = Object.freeze({
  USD: Object.freeze({ code: 'USD', minorExponent: 2, displayLocale: 'en-US', name: 'US Dollar' }),
  INR: Object.freeze({ code: 'INR', minorExponent: 2, displayLocale: 'en-IN', name: 'Indian Rupee' }),
  MXN: Object.freeze({ code: 'MXN', minorExponent: 2, displayLocale: 'es-MX', name: 'Mexican Peso' }),
});

/** Country -> currency of that country's payroll. */
export const COUNTRY_CURRENCY = Object.freeze({
  USA: 'USD',
  India: 'INR',
  Mexico: 'MXN',
});

export const SUPPORTED_CURRENCIES = Object.freeze(Object.keys(CURRENCIES));
export const SUPPORTED_COUNTRIES = Object.freeze(Object.keys(COUNTRY_CURRENCY));

/**
 * @param {string} code
 * @returns {{code:string,minorExponent:number,displayLocale:string,name:string}}
 */
export function currencyMeta(code) {
  const meta = CURRENCIES[code];
  if (!meta) throw new RangeError(`Unsupported currency: ${JSON.stringify(code)}`);
  return meta;
}

/** Number of minor units in one major unit, e.g. 100n for USD. */
export function minorPerMajor(code) {
  return 10n ** BigInt(currencyMeta(code).minorExponent);
}
