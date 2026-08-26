# Budget Allocation Demo

A small, self-contained web application that distributes an **additional** budget
across an organisation's employees, wherever they are and whatever currency they
are paid in. Every employee receives the same percentage increase on their
existing salary, calculated and displayed in their own currency.

The demo runs on a synthetic workforce of 300 employees in the USA, India and
Mexico. That is the dataset, not the problem: the country and currency set is
configuration held in one table, and the engine is indifferent to how many
entries it has.

No frameworks, no build step, no runtime dependencies. Node 20 or newer is all
that is required.

---

## Run it

```bash
cd demo
npm start          # serves the demo at http://localhost:8000
```

Hosted copy: <https://budget-allocation-demo.vercel.app> — if you would rather not
run it locally.

The application is plain HTML and ES modules. Browsers will not load ES modules
from a `file://` URL, so the folder has to be served over HTTP. `npm start` runs a
35-line static server bundled with the project; any static server works equally
well (`python3 -m http.server 8000`, for example).

```bash
npm test           # 114 tests, node --test, no dependencies to install
```

---

## What it does

1. Choose the currency you are entering the budget in — USD, INR or MXN.
2. Enter the amount. This is **extra money added on top of the existing payroll**,
   not a target total: 2,000,000 against an 8,000,000 payroll produces a payroll
   of 10,000,000.
3. Select **Allocate budget**.

The summary shows the existing payroll, the budget, the percentage increase
applied, and the updated payroll, with a per-country breakdown and a
reconciliation statement. The employee table shows each person's original salary,
their allocation, and their updated salary, all in local currency.

The table shows Name, Employee_ID, Role, Country, the original salary, the
allocation and the updated salary. It can be filtered by country and role, sorted
by name or any money column, and paged at 10 / 25 / 50 / 100 rows. **None of these change a single allocated
figure** — the allocation is always computed across all 300 employees, and the
controls only change which rows are shown and in what order.

---

## How the allocation works

The rule is *proportional incremental allocation*: every employee receives the
same percentage increase, so absolute raises scale with salary.

```
existing payroll   =  sum of all salaries, converted to USD
additional budget  =  the entered amount, converted to USD
increase (p)       =  additional budget ÷ existing payroll

for each employee:
  allocation       =  salary × p          (in the employee's own currency)
  updated salary   =  salary + allocation
```

Two things about this are worth knowing, because they are where naive
implementations go wrong:

- **The ratio `p` is dimensionless.** Conversion to USD happens only to form it —
  four conversions in total, never one per employee. Each raise is computed
  inside the employee's own currency, so no salary is ever converted and rounded
  back.
- **Rounding is reconciled.** `salary × p` is almost never a whole number of
  cents, paise or centavos. Rounding each row independently makes the rows sum to
  something other than the budget. Each currency group is instead apportioned by
  the *largest-remainder* method, so the rows in every group sum **exactly** to
  that group's pool.

Three currency pools rounded to whole minor units cannot convert back onto a
single exact figure, so the total distributed differs from the entered budget by
a residue. That residue is bounded (at most half a minor unit per currency,
converted — under USD 0.0054 for these rates), computed, and **shown** in the
reconciliation statement rather than hidden.

### Worked example

Budget **USD 2,000,000** against the demo payroll:

| | |
|---|---|
| Existing payroll (all currencies, in USD) | USD 17,299,437.78 |
| Increase applied | 11.5611% |
| Updated payroll | USD 19,299,437.78 |

| Country | Existing payroll | Allocation | Updated payroll |
|---|---|---|---|
| USA | USD 12,374,500.00 | USD 1,430,624.53 | USD 13,805,124.53 |
| India | INR 16,67,70,000.00 | INR 1,92,80,395.37 | INR 18,60,50,395.37 |
| Mexico | MXN 53,775,000.00 | MXN 6,216,965.05 | MXN 59,991,965.05 |

Employee EMP-001, on USD 105,500.00, receives USD 12,196.93 and moves to
USD 117,696.93. Every other employee receives the same 11.5611%.

Entering the equivalent amount in another currency — **INR 19,05,40,000** at the
demo rate — produces byte-identical allocations for all 300 employees. Conversion
is exact, so it makes no difference which currency the budget is entered in.

### Budgets too small to allocate

At very small budgets some employees' share comes to less than one unit of their
currency and would round to zero — they would receive 0% while others receive
more, which breaks the rule. The percentage itself is exact at any budget; what
cannot be done is *settle* it. Rather than present that as a result, the demo
refuses and states the smallest budget at which every share reaches a whole unit:
**USD 2.96 / INR 281.73 / MXN 50.10** for this dataset.

The upper bound is **100× existing payroll** — USD 1,729,943,778.01, and the same
amount of money in INR and MXN. Beyond a 10,000% increase an entry is more likely
a mistake than a budget.

Both bounds are derived from the data rather than fixed, so they move with the
payroll and mean the same thing in every currency. A budget of zero is accepted:
it is an exact 0% for everyone.

---

## Exchange rates

Rates are a **fixed snapshot, not live rates**. They were captured once, on
2026-08-26 at 11:42 UTC (mid-market reference, Morningstar via Google Finance),
and are frozen so that the demo is deterministic and reviewable:

| | |
|---|---|
| 1 USD | 95.27 INR |
| 1 USD | 16.94 MXN |

No rate API is called at any point. The rates will drift from market over time;
the snapshot date is carried in the rate-set identifier (`snapshot-2026-08-26`),
which every allocation result reports, so a result can always be traced to the
rates that produced it. Rates are stored as exact ratios rather than decimals, so
converting an amount out and back returns it exactly.

Rates are defined in one place, `src/core/rates.js`, and a test fails if the
values appear anywhere else.

---

## The demo dataset

| Country | Currency | Employees |
|---|---|---|
| USA | USD | 100 |
| India | INR | 100 |
| Mexico | MXN | 100 |

Three countries because the brief asked for mock data across three, and because
exchange rates are a frozen snapshot rather than a live feed. Nothing else fixes
the number: filters, the summary breakdown, the budget-currency selector and all
formatting are built from the currency table at runtime, and adding a currency is
a table entry plus a rate — no engine or interface change.

Salaries are always displayed in the employee's local currency, using that
currency's own conventions — INR uses Indian lakh/crore grouping
(`INR 16,67,70,000.00`). Every amount carries its currency **code** rather than a
symbol, because `Intl` renders both USD and MXN as `$`, which is ambiguous on a
table showing both. Since each amount is labelled, there is no separate currency
column.

The budget may be entered in any of the three currencies.

---

## The data

The 300 employees are synthetic. `tools/generate_employees.py` produces them
deterministically (fixed seed, Python standard library only) and validates the
result before writing. It emits three files from the same source so they cannot
drift apart:

| File | Purpose |
|---|---|
| `employees.json` | Portable copy for review |
| `employees.csv` | Spreadsheet-friendly view |
| `src/data/employees.js` | ES module the application and tests import |

```bash
npm run generate   # requires python3; rewrites all three files identically
```

Every record has the required columns `Name`, `Employee_ID`, `Role`, `Country`
and `Salary`, plus `Currency`. The application re-validates the dataset on load
and refuses to start if a record is malformed.

---

## Input

The budget field accepts digits with an optional decimal point. Grouping
separators are fine — both `2,000,000` and `20,00,000` are accepted, and spaces
pasted from a spreadsheet are stripped. Each rejection says specifically what is
wrong: negative amounts, scientific notation, currency symbols typed into the
field, or more decimal places than the currency supports.

Two further bounds are economic rather than syntactic, so the engine applies them
and states them in the entered currency: a budget too small for every employee's
share to reach one minor unit is refused, and so is one above **100 times existing
payroll** (`USD 1,729,943,778.01`, the same amount whichever currency it is typed
in). Both are demo policies, disclosed in the assumptions panel; see
[`Design.md`](Design.md) D-18 and D-23.

---

## Assumptions

- The problem is general — any organisation, any countries, any budget currency.
  The three-country workforce is the demonstration dataset.
- The budget is **additional** money to distribute, not a target payroll.
- All employees receive the same percentage increase. No other allocation rule
  (country weighting, tenure, inflation adjustment) is applied; those belong to
  the production design.
- Salaries in the dataset are whole units of their currency.
- USD is the internal calculation currency. Nothing displayed depends on this
  choice; it affects only the residue's reporting currency.

---

## Limitations

- **Rates are frozen.** They were near market when captured and will drift.
- **Three currencies are configured**, because the rates are a fixed snapshot.
  The set is not a limit of the design; see `Design.md` D-22.
- **The summary reflects the last allocation run.** Changing the currency or
  amount afterwards does not update it until **Allocate budget** is selected
  again.
- A decimal without a leading zero (`.5`) is rejected; enter `0.5`.
- Very small budgets are refused rather than allocated — see above for why. So
  are budgets above 100× existing payroll. Both bounds are **demo policies**, not
  requirements of the calculation, and both are derived from the payroll so they
  are the same amount of money in every currency.
- Requires a modern browser with ES module and `BigInt` support (all current
  browsers). Must be served over HTTP, not opened as a file.

---

## Project layout

```
demo/
├── index.html                the page
├── src/
│   ├── core/                 pure calculation; no DOM, runs in Node and the browser
│   │   ├── rational.js       exact fractions over BigInt
│   │   ├── money.js          money as integer minor units, exact parse/format
│   │   ├── currencies.js     currency metadata
│   │   ├── rates.js          the frozen rate snapshot, exact conversion
│   │   ├── employees.js      dataset loading and integrity checks
│   │   ├── validate.js       budget input policy
│   │   └── allocate.js       the allocation engine
│   ├── ui/                   rendering, sorting, formatting, wiring
│   └── data/employees.js     generated dataset
├── tests/                    114 tests; invariants, boundaries, fuzzing, UI
├── tools/
│   ├── generate_employees.py
│   └── serve.mjs             the static server behind `npm start`
├── employees.json / .csv
├── package.json              scripts and the Node version floor; no dependencies
├── vercel.json               static hosting: no build, no install
├── Design.md                 engineering decision ledger (27 decisions)
└── README.md
```

The suite runs in CI on Node 20 and 22 (`.github/workflows/test.yml`). There is no
install step, because there is nothing to install.

The test suite has been checked by mutation testing: eight deliberate defects —
disabling the reconciliation, reversing a tiebreak, altering a rate by 0.01,
reintroducing floating point, replacing the rounding mode, removing a validation
guard, removing the minimum-budget check, and sorting money on raw units — each
cause at least one test to fail.

The reasoning behind every material decision is in [`Design.md`](Design.md).
