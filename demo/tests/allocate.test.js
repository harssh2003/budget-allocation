import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPLOYEES } from '../src/data/employees.js';
import { loadEmployees } from '../src/core/employees.js';
import { allocate, minimumMeaningfulBudget, maximumMeaningfulBudget, MAX_BUDGET_PAYROLL_MULTIPLE, AllocationError } from '../src/core/allocate.js';
import { fromMajorString, toMajorString, money } from '../src/core/money.js';
import { toBaseRational } from '../src/core/rates.js';
import { SUPPORTED_CURRENCIES } from '../src/core/currencies.js';
import { rational, add, mul, compare, scaleFloor, roundHalfUp, toFixedString, ZERO } from '../src/core/rational.js';
import { mulberry32, randomAmount } from './helpers/random.js';

const employees = loadEmployees(EMPLOYEES);
const neg = (r) => mul(r, rational(-1n));
const abs = (r) => (r.num < 0n ? neg(r) : r);

/**
 * Every property the allocation must satisfy, for ANY budget and currency.
 * Applied to a fixed matrix, to boundary values, and to fuzzed inputs.
 */
function assertInvariants(result, label) {
  const where = (name) => `${label}: ${name}`;

  for (const currency of result.currencies) {
    const group = result.groups[currency];
    const rows = result.rows.filter((r) => r.Currency === currency);

    // I1 -- the whole point: each currency group reconciles EXACTLY.
    const rowSum = rows.reduce((acc, r) => acc + r.allocation.minor, 0n);
    assert.equal(rowSum, group.allocationPool.minor, where(`I1 ${currency} rows sum to pool`));

    // I2 -- the pool is the group's exact share, rounded once.
    const expected = roundHalfUp(mul(rational(group.existingPayroll.minor), result.allocationRatio));
    assert.equal(group.allocationPool.minor, expected, where(`I2 ${currency} pool`));

    // I6a -- a strictly higher salary never receives a strictly smaller raise.
    // I6b -- identical salaries may differ by at most one minor unit, because an
    //        indivisible unit cannot be split between two people (Design.md D-07).
    for (const a of rows) {
      for (const b of rows) {
        if (a.salary.minor > b.salary.minor) {
          assert.ok(a.allocation.minor >= b.allocation.minor, where(`I6a ${a.Employee_ID} vs ${b.Employee_ID}`));
        } else if (a.salary.minor === b.salary.minor) {
          const spread = a.allocation.minor - b.allocation.minor;
          assert.ok(spread <= 1n && spread >= -1n, where(`I6b ${a.Employee_ID} vs ${b.Employee_ID}`));
        }
      }
    }

    // Group totals are internally consistent.
    assert.equal(
      group.updatedPayroll.minor,
      group.existingPayroll.minor + group.allocationPool.minor,
      where(`${currency} updated payroll`),
    );
  }

  // I3 -- the cross-currency residual stays inside its proven bound.
  assert.ok(result.withinResidualBound, where(
    `I3 residual ${toFixedString(result.residualInBase, 10)} exceeded bound ${toFixedString(result.residualBoundInBase, 10)}`,
  ));

  for (const row of result.rows) {
    // I4 -- every row is its exact floor, plus at most one minor unit.
    const { quotient } = scaleFloor(row.salary.minor, result.allocationRatio);
    const adjustment = row.allocation.minor - quotient;
    assert.ok(adjustment === 0n || adjustment === 1n, where(`I4 ${row.Employee_ID} adjusted by ${adjustment}`));

    // I7 -- updated salary is exactly original + allocation.
    assert.equal(
      row.updatedSalary.minor,
      row.salary.minor + row.allocation.minor,
      where(`I7 ${row.Employee_ID}`),
    );

    // Allocations are never negative and never in the wrong currency.
    assert.ok(row.allocation.minor >= 0n, where(`I4 ${row.Employee_ID} negative allocation`));
    assert.equal(row.allocation.currency, row.salary.currency, where(`${row.Employee_ID} currency`));
  }

  // I5 -- the percentage increase is uniform to within one minor unit per row.
  for (const row of result.rows) {
    if (row.salary.minor === 0n) continue;
    const effective = rational(row.allocation.minor, row.salary.minor);
    const deviation = abs(add(effective, neg(result.allocationRatio)));
    const oneUnit = rational(1n, row.salary.minor);
    assert.ok(compare(deviation, oneUnit) <= 0, where(`I5 ${row.Employee_ID} deviation too large`));
  }

  // Row set is preserved: same employees in, same employees out, same order.
  assert.equal(result.rows.length, employees.length, where('row count'));
}

test('worked example from the brief: equal percentage, unequal absolute raises', () => {
  // Payroll 250,000 with a 50,000 additional budget is exactly 20%.
  const fixture = loadEmployees([
    { Name: 'A', Employee_ID: 'EMP-A', Role: 'Engineer', Country: 'USA', Salary: 150000 },
    { Name: 'B', Employee_ID: 'EMP-B', Role: 'Engineer', Country: 'USA', Salary: 100000 },
  ]);
  const result = allocate({ employees: fixture, budget: fromMajorString('USD', '50000') });

  assert.equal(result.allocationPercent, '20.000000');
  const [a, b] = result.rows;
  assert.equal(toMajorString(a.allocation), '30000.00');
  assert.equal(toMajorString(b.allocation), '20000.00');
  assert.equal(toMajorString(a.updatedSalary), '180000.00');
  assert.equal(toMajorString(b.updatedSalary), '120000.00');

  // Same percentage, different absolute amounts -- the requirement in one assertion.
  assert.equal(compare(rational(a.allocation.minor, a.salary.minor), rational(b.allocation.minor, b.salary.minor)), 0);
  assert.notEqual(a.allocation.minor, b.allocation.minor);
});

test('the budget is ADDITIONAL money, not a target payroll', () => {
  const fixture = loadEmployees([
    { Name: 'A', Employee_ID: 'EMP-A', Role: 'Engineer', Country: 'USA', Salary: 8000000 },
  ]);
  const result = allocate({ employees: fixture, budget: fromMajorString('USD', '2000000') });
  // 8M payroll + 2M budget = 10M payroll, not 8M.
  assert.equal(toMajorString(result.groups.USD.updatedPayroll), '10000000.00');
  assert.equal(result.allocationPercent, '25.000000');
});

test('invariants hold across budgets in every supported currency', () => {
  const matrix = [
    ['USD', '2000000'], ['USD', '2.96'], ['USD', '10'], ['USD', '0'],
    ['INR', '27438913.70'], ['INR', '281.73'], ['INR', '164811743731.40'],
    ['MXN', '1234567.89'], ['MXN', '50.10'], ['MXN', '500000000'],
  ];
  for (const [currency, amount] of matrix) {
    const result = allocate({ employees, budget: fromMajorString(currency, amount) });
    assertInvariants(result, `${amount} ${currency}`);
  }
});

test('a zero budget allocates nothing and is not an error', () => {
  const result = allocate({ employees, budget: fromMajorString('USD', '0') });
  assert.equal(result.allocationPercent, '0.000000');
  assert.ok(result.rows.every((r) => r.allocation.minor === 0n));
  assert.ok(result.rows.every((r) => r.updatedSalary.minor === r.salary.minor));
  assert.equal(compare(result.residualInBase, ZERO), 0);
  assertInvariants(result, 'zero budget');
});

test('refuses a budget at which the rule cannot be applied to everyone', () => {
  // USD 1 across a USD 17.3M payroll is a 0.0000058% increase. For 92 of the
  // 300 employees that is less than one cent, paise or centavo: they would get
  // 0% while the rest get more. That is the rule failing, not a rounding note.
  for (const [currency, amount, expectUncovered] of [
    ['USD', '0.01', 300], ['USD', '1', 92], ['INR', '1', 300], ['MXN', '10', 108],
  ]) {
    assert.throws(
      () => allocate({ employees, budget: fromMajorString(currency, amount) }),
      (e) => {
        assert.ok(e instanceof AllocationError);
        assert.equal(e.code, 'BELOW_RESOLUTION');
        assert.equal(e.uncoveredCount, expectUncovered, `${amount} ${currency}`);
        assert.equal(e.employeeCount, 300);
        assert.equal(e.minimumBudget.currency, currency, 'minimum stated in the currency entered');
        assert.equal(e.budget.minor, fromMajorString(currency, amount).minor);
        return true;
      },
      `${amount} ${currency} should be refused`,
    );
  }
});

test('the minimum budget is exact at the boundary', () => {
  for (const currency of ['USD', 'INR', 'MXN']) {
    const minimum = minimumMeaningfulBudget({ employees, currency });

    // One minor unit below: refused, and only just.
    assert.throws(
      () => allocate({ employees, budget: money(currency, minimum.minor - 1n) }),
      (e) => e.code === 'BELOW_RESOLUTION' && e.uncoveredCount >= 1,
      `${currency}: one unit under the minimum should be refused`,
    );

    // At the minimum: accepted, every employee receives at least one unit, and
    // all invariants hold.
    const result = allocate({ employees, budget: minimum });
    assert.ok(result.rows.every((r) => r.allocation.minor >= 1n), `${currency}: everyone covered at the minimum`);
    assertInvariants(result, `${currency} minimum`);
    assert.equal(result.minimumBudget.minor, minimum.minor, 'the result reports the minimum too');
  }
});

test('the minimum is the same amount of money whichever currency states it', () => {
  const usd = minimumMeaningfulBudget({ employees, currency: 'USD' });
  const inr = minimumMeaningfulBudget({ employees, currency: 'INR' });
  const mxn = minimumMeaningfulBudget({ employees, currency: 'MXN' });
  assert.equal(toMajorString(usd), '2.96');
  assert.equal(toMajorString(inr), '281.73');
  assert.equal(toMajorString(mxn), '50.10');
  // Each is the ceiling of the same base value in its own minor unit, so they
  // agree to within one minor unit once converted back.
  const spread = [usd, inr, mxn].map((m) => toBaseRational(m));
  for (const a of spread) for (const b of spread) {
    const diff = abs(add(a, neg(b)));
    assert.ok(compare(diff, rational(2n, 100n)) < 0, 'minimums agree to within a cent');
  }
});

test('a zero budget is not below resolution: it is an exact 0% for everyone', () => {
  const result = allocate({ employees, budget: fromMajorString('USD', '0') });
  assert.equal(result.allocationPercent, '0.000000');
  assert.ok(result.rows.every((r) => r.allocation.minor === 0n));
});

test('minimumMeaningfulBudget refuses a zero payroll', () => {
  const zeroPayroll = employees.map((e) => ({ ...e, salary: money(e.Currency, 0n) }));
  assert.throws(() => minimumMeaningfulBudget({ employees: zeroPayroll, currency: 'USD' }),
    (e) => e.code === 'ZERO_PAYROLL');
});

test('fuzzed budgets satisfy every invariant', () => {
  const rand = mulberry32(20260826);   // seeded, so a failure reproduces
  for (let i = 0; i < 60; i++) {
    const currency = ['USD', 'INR', 'MXN'][i % 3];
    const amount = randomAmount(rand, 50_000_000);
    const result = allocate({ employees, budget: fromMajorString(currency, amount) });
    assertInvariants(result, `fuzz#${i} ${amount} ${currency}`);
  }
});

test('output is deterministic across repeated runs', () => {
  const signature = () =>
    allocate({ employees, budget: fromMajorString('INR', '27438913.70') })
      .rows.map((r) => `${r.Employee_ID}:${r.allocation.minor}`).join('|');
  const first = signature();
  for (let i = 0; i < 10; i++) assert.equal(signature(), first, `run ${i} diverged`);
});

test('allocation depends on the whole population, not a filtered view (D-08)', () => {
  const budget = fromMajorString('USD', '2000000');
  const full = allocate({ employees, budget });
  const usaOnly = allocate({ employees: employees.filter((e) => e.Country === 'USA'), budget });

  const fromFull = full.rows.find((r) => r.Employee_ID === 'EMP-001').allocation.minor;
  const fromSubset = usaOnly.rows.find((r) => r.Employee_ID === 'EMP-001').allocation.minor;

  // These MUST differ. If the UI ever re-ran the engine on a filtered subset it
  // would silently answer a different question, and this test would go quiet.
  assert.notEqual(fromFull, fromSubset);
  assert.ok(fromSubset > fromFull, 'a smaller population should absorb more of the same budget');
});

test('identical salaries differ by at most one minor unit, deterministically', () => {
  const fixture = loadEmployees(
    Array.from({ length: 3 }, (_, i) => ({
      Name: `E${i}`, Employee_ID: `EMP-${String(i).padStart(3, '0')}`,
      Role: 'Engineer', Country: 'USA', Salary: 100000,
    })),
  );
  // 100 / 3 cannot be split evenly into cents.
  const result = allocate({ employees: fixture, budget: fromMajorString('USD', '100') });
  const allocations = result.rows.map((r) => r.allocation.minor);
  assert.equal(allocations.reduce((a, b) => a + b, 0n), result.groups.USD.allocationPool.minor);
  assert.ok(Math.max(...allocations.map(Number)) - Math.min(...allocations.map(Number)) <= 1);
  // The extra unit goes to the lowest Employee_ID, every time.
  assert.equal(result.rows[0].allocation.minor, allocations[0]);
  assert.ok(result.rows[0].allocation.minor >= result.rows[2].allocation.minor);
});

test('reports the residual and its bound rather than hiding them', () => {
  const result = allocate({ employees, budget: fromMajorString('USD', '2000000') });
  assert.ok('residualInBase' in result);
  assert.ok('residualBoundInBase' in result);
  assert.equal(result.withinResidualBound, true);
  // The bound is half a minor unit per currency group, converted to base.
  const expectedBound = result.currencies.reduce(
    (acc, c) => add(acc, mul(toBaseRational(money(c, 1n)), rational(1n, 2n))),
    ZERO,
  );
  assert.equal(compare(result.residualBoundInBase, expectedBound), 0);
  assert.ok(compare(abs(result.residualInBase), result.residualBoundInBase) <= 0);
});

test('the maximum is derived from payroll and is the same money in every currency', () => {
  // A flat "one trillion" cap meant USD 1e12 and INR 1e12 -- amounts 95x apart.
  const inBase = SUPPORTED_CURRENCIES.map((currency) =>
    toBaseRational(maximumMeaningfulBudget({ employees, currency })));
  for (const value of inBase) {
    // Equal to within one minor unit of the currency it was floored in.
    assert.ok(compare(abs(add(value, neg(inBase[0]))), rational(1n, 100n)) < 0,
      'the cap must resolve to the same economic amount in every currency');
  }
  // And it is exactly the stated multiple of payroll.
  const payroll = allocate({ employees, budget: fromMajorString('USD', '1000') }).existingPayrollInBase;
  const expected = mul(payroll, rational(MAX_BUDGET_PAYROLL_MULTIPLE));
  assert.ok(compare(abs(add(inBase[0], neg(expected))), rational(1n, 100n)) < 0);
});

test('the maximum boundary is exact in every currency', () => {
  for (const currency of SUPPORTED_CURRENCIES) {
    const max = maximumMeaningfulBudget({ employees, currency });

    const atMax = allocate({ employees, budget: max });
    assertInvariants(atMax, `${currency} at maximum`);
    assert.equal(atMax.maximumBudget.minor, max.minor, 'the result reports the maximum too');

    assert.throws(
      () => allocate({ employees, budget: money(currency, max.minor + 1n) }),
      (e) => {
        assert.equal(e.code, 'ABOVE_MAXIMUM');
        assert.equal(e.maximumBudget.currency, currency, 'stated in the currency entered');
        assert.equal(e.payrollMultiple, MAX_BUDGET_PAYROLL_MULTIPLE);
        return true;
      },
      `${currency}: one unit above the maximum must be refused`,
    );
  }
});

test('the rounding difference is exactly the sum of the per-pool rounding moves', () => {
  // The residual is not slack in the algorithm: it is the three half-up steps,
  // converted back. Proving that is what makes the bound meaningful.
  for (const [currency, amount] of [['USD', '2000000'], ['INR', '27438913.70'], ['MXN', '1234567.89']]) {
    const result = allocate({ employees, budget: fromMajorString(currency, amount) });
    let movesInBase = ZERO;
    for (const c of result.currencies) {
      const exact = mul(rational(result.groups[c].existingPayroll.minor), result.allocationRatio);
      const move = add(rational(result.groups[c].allocationPool.minor), neg(exact));  // ≤ ½ unit
      assert.ok(compare(abs(move), rational(1n, 2n)) <= 0, `${c}: rounding move exceeded half a unit`);
      movesInBase = add(movesInBase, mul(toBaseRational(money(c, 1n)), move));
    }
    // residual = budget − Σpools = −Σ(rounding moves)
    assert.equal(compare(result.residualInBase, neg(movesInBase)), 0,
      `${amount} ${currency}: residual is not the sum of the rounding moves`);
  }
});

test('the residual bound is under one unit of the base currency for this rate set', () => {
  // A property of the CONFIGURED RATES, not of the algorithm: a fourth currency,
  // or one whose minor unit is worth over two cents, would break it. Pinned so
  // that adding a currency fails here rather than silently in the interface.
  const result = allocate({ employees, budget: fromMajorString('USD', '2000000') });
  assert.ok(compare(result.residualBoundInBase, rational(1n, 100n)) < 0,
    'residual bound must stay below one cent, or the reconciliation wording needs revisiting');
});

test('economically equal budgets allocate identically whichever currency is entered', () => {
  // 1 USD = 95.27 INR = 16.94 MXN, so these three are the same money.
  const signature = (r) => r.rows.map((x) => `${x.Employee_ID}:${x.allocation.minor}`).join('|');
  for (const triple of [['100', '9527', '1694'], ['2000000', '190540000', '33880000']]) {
    const [usd, inr, mxn] = ['USD', 'INR', 'MXN'].map((c, i) =>
      allocate({ employees, budget: fromMajorString(c, triple[i]) }));
    assert.equal(compare(usd.allocationRatio, inr.allocationRatio), 0);
    assert.equal(compare(usd.allocationRatio, mxn.allocationRatio), 0);
    assert.equal(signature(usd), signature(inr), 'USD and INR entries must agree row for row');
    assert.equal(signature(usd), signature(mxn), 'USD and MXN entries must agree row for row');
  }
});

test('reports the residue relative to the budget, not just in absolute terms', () => {
  // The bound is absolute -- half a minor unit per currency group -- so it stays
  // constant as the budget shrinks and grows as a share of it. Budgets small
  // enough for that share to distort the result are refused before this point
  // (BELOW_RESOLUTION); for accepted budgets the share is still reported, and
  // flagged if it ever exceeds 0.1%.
  const nearFloor = allocate({ employees, budget: fromMajorString('USD', '2.97') });
  const large = allocate({ employees, budget: fromMajorString('USD', '2000000') });

  assert.ok(nearFloor.withinResidualBound);
  assert.ok(large.withinResidualBound);

  // Just above the floor the residue is ~0.16% of a three-dollar budget: still
  // correct, still bounded, and worth saying so.
  assert.equal(nearFloor.residualIsMaterial, true);
  assert.equal(toFixedString(mul(nearFloor.residualShareOfBudget, rational(100n)), 4), '0.1556');

  // At USD 2,000,000 it rounds away entirely at four decimal places.
  assert.equal(large.residualIsMaterial, false);
  assert.equal(toFixedString(mul(large.residualShareOfBudget, rational(100n)), 4), '0.0000');
});

test('a zero budget has no residual share to report', () => {
  const result = allocate({ employees, budget: fromMajorString('USD', '0') });
  assert.equal(result.residualShareOfBudget, null);
  assert.equal(result.residualIsMaterial, false);
});

test('at realistic budgets the residue is never material', () => {
  const negligible = ['10', '100', '10000', '2000000'].map((a) => allocate({ employees, budget: fromMajorString('USD', a) }));
  assert.ok(negligible.every((r) => !r.residualIsMaterial));
});

test('surfaces the rate set used, so a result can be reproduced', () => {
  const result = allocate({ employees, budget: fromMajorString('USD', '10') });
  assert.equal(result.rateSetId, 'snapshot-2026-08-26');
  assert.equal(result.baseCurrency, 'USD');
});

test('rejects inputs it cannot meaningfully allocate', () => {
  const budget = fromMajorString('USD', '1000');

  assert.throws(() => allocate({ employees: [], budget }),
    (e) => e instanceof AllocationError && e.code === 'NO_EMPLOYEES');

  assert.throws(() => allocate({ employees, budget: money('USD', -1n) }),
    (e) => e.code === 'NEGATIVE_BUDGET');

  assert.throws(() => allocate({ employees, budget: null }),
    (e) => e.code === 'INVALID_BUDGET');

  assert.throws(() => allocate({ employees, budget: { currency: 'USD', minor: 100 } }),
    (e) => e.code === 'INVALID_BUDGET');

  // Every salary zero: the proportional share of each employee is 0/0.
  const zeroPayroll = employees.map((e) => ({ ...e, salary: money(e.Currency, 0n) }));
  assert.throws(() => allocate({ employees: zeroPayroll, budget }),
    (e) => e.code === 'ZERO_PAYROLL');
});
