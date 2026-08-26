/**
 * Budget allocation engine.
 *
 * Distributes an additional budget across employees so that every employee
 * receives the SAME PERCENTAGE increase on their existing salary. The budget is
 * additional money: entering 2M against an existing 8M payroll produces a 10M
 * payroll, not an 8M one.
 *
 * ---------------------------------------------------------------------------
 * Two properties drive the whole design.
 * ---------------------------------------------------------------------------
 *
 * 1. The allocation ratio is DIMENSIONLESS.
 *
 *    p = additional budget / existing payroll
 *
 *    Both sides are converted to the base currency to form p, but p itself has
 *    no currency. That means an employee's raise is `salary x p` computed
 *    entirely inside their OWN currency -- no per-employee conversion, and so
 *    no 300 separate rounding events. Currency conversion happens four times
 *    total (three payroll subtotals plus the budget), never per row.
 *
 * 2. Rounding happens EXACTLY ONCE, and it is reconciled.
 *
 *    `salary x p` is almost never a whole number of paise/cents/centavos.
 *    Rounding each row independently makes the rows sum to something other
 *    than the budget -- measured on this dataset, off by up to 5 minor units
 *    when rounding to nearest and about 49 when truncating. That is the
 *    difference between a system that says it distributed the budget and one
 *    that actually did.
 *
 *    So each currency group is apportioned by the largest-remainder method:
 *    every row takes the floor of its exact share, then the leftover minor
 *    units go one each to the rows with the largest discarded remainders,
 *    tie-broken by Employee_ID for determinism. The group then sums to its
 *    target EXACTLY.
 *
 * ---------------------------------------------------------------------------
 * The reconciliation invariant (per-currency exact -- Design.md D-05)
 * ---------------------------------------------------------------------------
 *
 * Allocations can sum exactly within each currency, OR sum exactly to the
 * entered budget once converted back to base -- but not both. Three local
 * pools rounded to whole minor units cannot convert back onto the input
 * amount. This engine chooses the first: each currency group reconciles to
 * the paise. The leftover against the entered budget is then computed, bounded
 * and REPORTED as `residualInBase` rather than hidden, and the bound is proven
 * in the tests.
 */

import { minorPerMajor } from './currencies.js';
import { money, sum as sumMoney, add as addMoney } from './money.js';
import {
  rational, mul, div, add as addRational, compare as compareRational,
  scaleFloor, roundHalfUp, ceilToInteger, toFixedString, ZERO, isZero,
} from './rational.js';
import { toBaseRational, fromBaseRational, BASE_CURRENCY, RATE_SET_ID } from './rates.js';

export class AllocationError extends Error {
  /**
   * @param {string} code stable identifier; tests and the UI switch on this
   * @param {string} message developer-facing description
   * @param {object} [details] structured facts the UI can format for the user
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AllocationError';
    this.code = code;
    Object.assign(this, details);
  }
}

/** Decimal places used when rendering the allocation percentage. */
export const PERCENT_PRECISION = 6;

/**
 * Residual share of the budget above which the rounding residue is worth
 * flagging in the result rather than only reporting.
 *
 * The residual bound is ABSOLUTE -- half a minor unit per currency group -- so
 * it stays constant while the budget shrinks and grows as a share of it. Budgets
 * small enough for that share to distort the result are refused outright
 * (BELOW_RESOLUTION, Design.md D-18); this flag covers the honest edge of the
 * accepted range. Just above the floor the residue can reach ~0.16% of a
 * three-dollar budget -- correct, bounded, and worth saying. At realistic
 * budgets it is a few millionths of a percent and the flag never fires.
 */
export const MATERIAL_RESIDUAL_SHARE = { num: 1n, den: 1000n }; // 0.1%

/**
 * The largest accepted budget, as a multiple of existing payroll.
 *
 * A budget of a hundred times payroll is a 10,000% increase. Past that the input
 * is not a budget allocation, it is a data-entry error -- a payroll pasted in
 * minor units, or an amount typed in the wrong currency. The cap exists to catch
 * that, not to protect the arithmetic: money is BigInt and exact well beyond any
 * figure a person can type (Design.md D-23).
 *
 * Expressed as a multiple rather than a fixed amount so the limit is the same
 * economic quantity whichever currency it is entered in. A flat "one trillion"
 * ceiling meant USD 1e12 and INR 1e12 -- amounts differing by a factor of 95.
 */
export const MAX_BUDGET_PAYROLL_MULTIPLE = 100n;

/** Existing payroll in the base currency, exact. Shared by both bounds. */
function payrollInBase(employees) {
  return employees.reduce((acc, e) => addRational(acc, toBaseRational(e.salary)), ZERO);
}

/**
 * The largest budget this demo will allocate, stated in `currency`.
 *
 * Derived from payroll and converted, so USD, INR and MXN all resolve to the
 * same economic amount. Floored, so the stated figure is itself acceptable.
 *
 * @param {object} input
 * @param {Array<{salary:{currency:string,minor:bigint}}>} input.employees
 * @param {string} input.currency the currency the budget will be entered in
 * @returns {{currency:string,minor:bigint}}
 */
export function maximumMeaningfulBudget({ employees, currency }) {
  const maxInBase = mul(payrollInBase(employees), rational(MAX_BUDGET_PAYROLL_MULTIPLE));
  const inTarget = fromBaseRational(maxInBase, currency);
  const scaled = mul(inTarget, rational(minorPerMajor(currency)));
  return money(currency, scaled.num / scaled.den);   // floor: the stated max is allowed
}

/**
 * The smallest budget at which every employee's exact proportional share is at
 * least one unit of their own currency -- one cent, one paise, one centavo.
 *
 * Below this, the "same percentage for everyone" rule cannot be executed: the
 * lowest-paid employees' shares floor to zero, so they receive a 0% increase
 * while others receive more. That is not a rounding detail to disclose; it is
 * the rule failing, and allocate() refuses rather than presenting it as a result
 * (Design.md D-18).
 *
 * Derived from the data rather than fixed as a constant: it moves with payroll,
 * headcount, the smallest salary and the rate set, and is stated to the user in
 * the currency they chose so the error tells them what would work.
 *
 * @param {object} input
 * @param {Array<{salary:{currency:string,minor:bigint}}>} input.employees
 * @param {string} input.currency the currency the budget will be entered in
 * @returns {{currency:string,minor:bigint}}
 */
export function minimumMeaningfulBudget({ employees, currency }) {
  let smallestSalaryMinor = null;
  for (const e of employees) {
    if (e.salary.minor > 0n && (smallestSalaryMinor === null || e.salary.minor < smallestSalaryMinor)) {
      smallestSalaryMinor = e.salary.minor;
    }
  }

  if (smallestSalaryMinor === null) {
    throw new AllocationError('ZERO_PAYROLL', 'Existing payroll is zero; no minimum budget exists.');
  }

  // The binding employee is the one holding the FEWEST MINOR UNITS, which is not
  // the lowest-paid: a cent is worth about 95 paise, so a USD 58,500 salary
  // (5,850,000 cents) binds ahead of an INR 5,80,000 one (58,000,000 paise).
  // salary_minor x p >= 1 for every employee  <=>  p >= 1 / smallest salary.
  const minimumRatio = rational(1n, smallestSalaryMinor);
  const minimumInBaseMajor = mul(payrollInBase(employees), minimumRatio);
  const minimumInTargetMajor = fromBaseRational(minimumInBaseMajor, currency);
  const minimumMinor = ceilToInteger(mul(minimumInTargetMajor, rational(minorPerMajor(currency))));
  return money(currency, minimumMinor);
}

/**
 * @param {object} input
 * @param {Array<{Employee_ID:string,Currency:string,salary:{currency:string,minor:bigint}}>} input.employees
 *        normalised rows from employees.js
 * @param {{currency:string,minor:bigint}} input.budget additional budget, as entered
 * @returns {object} allocation result
 */
export function allocate({ employees, budget }) {
  if (!Array.isArray(employees) || employees.length === 0) {
    throw new AllocationError('NO_EMPLOYEES', 'Cannot allocate a budget across an empty employee list.');
  }
  if (!budget || typeof budget.minor !== 'bigint') {
    throw new AllocationError('INVALID_BUDGET', 'Budget must be a Money value.');
  }
  if (budget.minor < 0n) {
    throw new AllocationError('NEGATIVE_BUDGET', 'Additional budget cannot be negative.');
  }

  // --- 1. Group by currency and total each group's existing payroll ---------
  /** @type {Map<string, typeof employees>} */
  const byCurrency = new Map();
  for (const e of employees) {
    if (!byCurrency.has(e.Currency)) byCurrency.set(e.Currency, []);
    byCurrency.get(e.Currency).push(e);
  }

  const currencies = [...byCurrency.keys()].sort();
  const existingPayrollByCurrency = {};
  for (const c of currencies) {
    existingPayrollByCurrency[c] = sumMoney(byCurrency.get(c).map((e) => e.salary), c);
  }

  // --- 2. Existing payroll and budget in the base currency (exact) ---------
  const existingPayrollInBase = currencies.reduce(
    (acc, c) => addRational(acc, toBaseRational(existingPayrollByCurrency[c])),
    ZERO,
  );

  if (isZero(existingPayrollInBase)) {
    throw new AllocationError(
      'ZERO_PAYROLL',
      'Existing payroll is zero, so a proportional allocation is undefined (every share would be 0/0).',
    );
  }

  const budgetInBase = toBaseRational(budget);

  // --- 3. The dimensionless allocation ratio, held exactly -----------------
  const allocationRatio = div(budgetInBase, existingPayrollInBase);

  // --- 3a. Is the budget inside the range this demo will allocate? ---------
  // Both bounds are derived from the data and stated in the entered currency,
  // so each resolves to the same economic amount whichever currency is used.
  const minimumBudget = minimumMeaningfulBudget({ employees, currency: budget.currency });
  const maximumBudget = maximumMeaningfulBudget({ employees, currency: budget.currency });

  if (budget.minor > maximumBudget.minor) {
    throw new AllocationError(
      'ABOVE_MAXIMUM',
      `Budget exceeds ${MAX_BUDGET_PAYROLL_MULTIPLE}x existing payroll.`,
      { budget, maximumBudget, payrollMultiple: MAX_BUDGET_PAYROLL_MULTIPLE },
    );
  }

  // A zero budget is a legitimate 0% for everyone. Any other budget must give
  // every employee at least one unit of their own currency before rounding,
  // or some receive 0% while others do not -- the rule itself has failed.
  if (budget.minor > 0n) {
    const uncovered = employees.filter(
      (e) => e.salary.minor > 0n && scaleFloor(e.salary.minor, allocationRatio).quotient === 0n,
    );
    if (uncovered.length > 0) {
      throw new AllocationError(
        'BELOW_RESOLUTION',
        `Budget too small to allocate proportionally: ${uncovered.length} of ${employees.length} employees have an exact share below one unit of their currency.`,
        {
          budget,
          minimumBudget,
          uncoveredCount: uncovered.length,
          employeeCount: employees.length,
        },
      );
    }
  }

  // --- 4. Per-currency target pool, then largest-remainder apportionment ---
  const groups = {};
  const rowsById = new Map();

  for (const c of currencies) {
    const members = byCurrency.get(c);
    const payroll = existingPayrollByCurrency[c];

    // The group's exact proportional share, rounded once to a whole minor unit.
    const exactPool = mul(rational(payroll.minor), allocationRatio);
    const poolMinor = roundHalfUp(exactPool);

    // Floor each member's exact share and keep the discarded remainder.
    const parts = members.map((e) => {
      const { quotient, remainder } = scaleFloor(e.salary.minor, allocationRatio);
      return { employee: e, minor: quotient, remainder };
    });

    const flooredTotal = parts.reduce((acc, p) => acc + p.minor, 0n);
    const shortfall = poolMinor - flooredTotal;

    // Provable bound: sum of floors lies in (payroll*p - n, payroll*p], and the
    // pool is within half a minor unit of payroll*p, so shortfall is in [0, n].
    // If this ever fails the arithmetic above is wrong; fail loudly, not quietly.
    if (shortfall < 0n || shortfall > BigInt(parts.length)) {
      throw new AllocationError(
        'APPORTIONMENT_INVARIANT',
        `Internal error: ${c} shortfall ${shortfall} outside [0, ${parts.length}].`,
      );
    }

    // Largest remainder first; Employee_ID ascending as a deterministic tiebreak.
    const order = [...parts].sort((a, b) => {
      if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
      return a.employee.Employee_ID < b.employee.Employee_ID ? -1 : 1;
    });
    // Hand out one extra minor unit at a time until the shortfall is exhausted.
    let remaining = shortfall;
    for (const part of order) {
      if (remaining === 0n) break;
      part.minor += 1n;
      remaining -= 1n;
    }

    const allocated = money(c, poolMinor);
    for (const part of parts) {
      const allocation = money(c, part.minor);
      rowsById.set(part.employee.Employee_ID, {
        ...part.employee,
        allocation,
        updatedSalary: addMoney(part.employee.salary, allocation),
      });
    }

    groups[c] = {
      currency: c,
      employeeCount: members.length,
      existingPayroll: payroll,
      allocationPool: allocated,
      updatedPayroll: addMoney(payroll, allocated),
    };
  }

  // --- 5. Reconciliation: what actually landed, and what is left over ------
  const totalAllocatedInBase = currencies.reduce(
    (acc, c) => addRational(acc, toBaseRational(groups[c].allocationPool)),
    ZERO,
  );
  const residualInBase = addRational(budgetInBase, mul(totalAllocatedInBase, rational(-1n)));

  // Half a minor unit per currency group, converted to base: the proven bound
  // on |residualInBase|. Tested, not asserted by comment.
  const residualBoundInBase = currencies.reduce(
    (acc, c) => addRational(acc, mul(toBaseRational(money(c, 1n)), rational(1n, 2n))),
    ZERO,
  );

  // The residue relative to the budget, which is what tells a reader whether it
  // matters. Undefined for a zero budget: nothing was asked for, so nothing is
  // proportionally off.
  const absResidual = residualInBase.num < 0n ? mul(residualInBase, rational(-1n)) : residualInBase;
  const residualShareOfBudget = isZero(budgetInBase) ? null : div(residualInBase, budgetInBase);
  const residualIsMaterial =
    residualShareOfBudget !== null &&
    compareRational(div(absResidual, budgetInBase), rational(MATERIAL_RESIDUAL_SHARE.num, MATERIAL_RESIDUAL_SHARE.den)) > 0;

  // Preserve the caller's ordering rather than the grouping order.
  const rows = employees.map((e) => rowsById.get(e.Employee_ID));

  return {
    rateSetId: RATE_SET_ID,
    baseCurrency: BASE_CURRENCY,
    budget,
    budgetInBase,
    minimumBudget,
    maximumBudget,
    existingPayrollByCurrency,
    existingPayrollInBase,
    allocationRatio,
    allocationPercent: toFixedString(mul(allocationRatio, rational(100n)), PERCENT_PRECISION),
    currencies,
    groups,
    rows,
    totalAllocatedInBase,
    residualInBase,
    residualBoundInBase,
    residualShareOfBudget,
    residualIsMaterial,
    withinResidualBound: compareRational(absResidual, residualBoundInBase) <= 0,
  };
}
