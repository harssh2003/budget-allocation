/**
 * Display formatting. The boundary where exact values become human-readable
 * text -- and the last place a floating-point value could sneak in.
 *
 * Intl.NumberFormat.format() accepts a STRING and formats it exactly (verified
 * on Node 20 and modern browsers). Money is therefore rendered straight from
 * its exact decimal string; no Number is ever constructed from an amount.
 *
 * Currency is displayed as a CODE rather than a symbol: Intl renders both USD
 * and MXN as "$1,234.00", which is genuinely ambiguous on a table showing USA
 * and Mexico rows together (Design.md D-10). Each currency keeps its own
 * locale, so INR retains Indian lakh/crore grouping.
 */

import { currencyMeta } from '../core/currencies.js';
import { toMajorString } from '../core/money.js';
import { toFixedString } from '../core/rational.js';

const cache = new Map();

function formatterFor(currency) {
  let f = cache.get(currency);
  if (!f) {
    const meta = currencyMeta(currency);
    f = new Intl.NumberFormat(meta.displayLocale, {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: meta.minorExponent,
      maximumFractionDigits: meta.minorExponent,
    });
    cache.set(currency, f);
  }
  return f;
}

/** @param {{currency:string,minor:bigint}} m */
export function formatMoney(m) {
  return formatterFor(m.currency).format(toMajorString(m));
}

/** Format an exact Rational amount of base-currency major units. */
export function formatBaseRational(rationalAmount, baseCurrency, places) {
  const meta = currencyMeta(baseCurrency);
  const decimals = places ?? meta.minorExponent;
  return new Intl.NumberFormat(meta.displayLocale, {
    style: 'currency',
    currency: baseCurrency,
    currencyDisplay: 'code',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(toFixedString(rationalAmount, decimals));
}

/** Format the dimensionless allocation ratio as a percentage. */
export function formatPercent(ratio, places = 4) {
  const scaled = { num: ratio.num * 100n, den: ratio.den };
  return `${toFixedString(scaled, places)}%`;
}

/** Plain integer count, e.g. employee totals. */
export function formatCount(n) {
  return new Intl.NumberFormat('en-US').format(n);
}
