# CLAUDE.md — Budget Management System

Project instructions and current state. A fresh session should be able to read
this file plus `demo/Design.md` and continue without the prior conversation.

---

## What this is

An engineering assignment in two deliverables:

- **Deliverable 1** — a customer-facing HTML demo: distribute an *additional*
  budget proportionally across 300 employees in three countries/currencies.
- **Deliverable 2** — a production design document describing how D1 would evolve
  into a real system. **Do not start until D1 is complete.**

Roughly 48 hours total. Priority order: D1 working → D1 correct → D1 polished →
D2 → optional extras. Never trade core financial correctness for anything.

---

## Confirmed requirements (authoritative — do not re-litigate)

- **The problem is general.** An organisation operating in any set of countries
  enters an additional budget in any currency; every employee's salary is
  displayed in their own local currency. Nothing about the requirement is
  specific to three countries.
- **The demo dataset is fixed.** The brief calls for mock data, and the mock data
  is 300 synthetic employees in **USA / India / Mexico** paid in **USD / INR /
  MXN**. The country and currency set is configuration held in one table (D-22),
  not an assumption baked into the engine or the UI.
- The user picks the currency they enter the budget in; the selector is built
  from the currency table at runtime.
- The budget is **ADDITIONAL money**, not a target payroll total. 8M payroll +
  2M budget = 10M payroll. This is the single most common misreading of the brief.
- Allocation is by **incremental percentage proportion**: every employee gets the
  same percentage increase, so absolute raises differ with salary. This is the
  only allocation mechanism required for D1.
- Required table columns, none may be removed or renamed:
  `Name`, `Employee_ID`, `Role`, `Country`, `Salary`.
  Added columns (Currency, Original Salary, Additional Allocation, Updated Salary)
  are permitted and used.
- Country filter: All / USA / India / Mexico, defaulting to All.
- **Fixed demo exchange rates. No live API.** Centralised, documented, and stated
  in the README as not representing live market rates.

**Explicitly out of scope for D1:** inflation adjustment, country weighting,
tenure/loyalty points, customer-defined rules, live rates, database, auth,
multi-tenancy, queues, containers, microservices. These belong in D2. Complexity
must be justified by a requirement, not by appearance.

---

## Locked architecture

Full reasoning in `demo/Design.md`. Summary of what must not be changed without
revisiting that ledger:

| | |
|---|---|
| Money | BigInt count of minor units, tagged with currency (D-01) |
| Float policy | **No float anywhere in the money path.** Strings in, strings out. Enforced by a test that greps `src/core/` (D-12) |
| Rates | Exact integer ratios, `1 USD = num/den C`. Base currency USD. Dated snapshot `snapshot-2026-08-26`: 95.27 INR, 16.94 MXN (D-03) |
| Allocation ratio | Dimensionless. Salaries are **never** converted per row (D-04) |
| Reconciliation | **Per-currency exact.** Residual vs entered budget is computed, bounded (≤ $0.00535), expressed as a share of the budget, and flagged when material (D-05) |
| Resolution gate | **Engine refuses** (`BELOW_RESOLUTION`) any budget at which some employee's exact share is under one unit of their currency; states the derived minimum in the entered currency. Zero budget is allowed (D-18) |
| Rounding | Half-up, exactly once per currency group (D-06) |
| Apportionment | Largest remainder, tiebreak ascending `Employee_ID` (D-07) |
| Country filter | View-only. **Never re-run the engine on a filtered subset** (D-08) |
| Sorting / role filter | Also strictly view-only. Money sorts compare **base-currency value**, never raw minor units (D-16). Active sort shown as a removable chip; no tri-state headings (D-17) |
| Display | `currencyDisplay: 'code'` — USD and MXN both render as `$` otherwise (D-10) |
| Presentation | Ledger, not landing page: type-driven hierarchy, dense rows, muted chrome, one accent. Light theme only. Paginated, 10/25/50/100 rows, windowed page numbers (D-14). Interactive elements carry real affordances; data regions stay flat (D-15) |
| Dependencies | None. No build step, no framework, no `node_modules` (D-11) |
| Tests | `node --test`. Invariants, not golden numbers (D-12) |

---

## Layout

```
budget-allocation/
├── README.md               repository entry point; hosted link lives here
├── PROMPT.md               the assignment, verbatim
├── CLAUDE.md               this file
├── design/                 Deliverable 2
│   ├── BRIEF.md            scoping brief
│   └── PRODUCTION-DESIGN.md    the deliverable (not started)
└── demo/                   Deliverable 1
    ├── index.html
    ├── src/
    │   ├── core/          pure, dependency-free, runs in Node and the browser
    │   │   ├── rational.js     exact BigInt fractions
    │   │   ├── currencies.js   currency metadata
    │   │   ├── money.js        Money type, exact decimal parse/format
    │   │   ├── rates.js        frozen rate table, exact conversion
    │   │   ├── employees.js    dataset load + integrity validation
    │   │   ├── allocate.js     the allocation engine
    │   │   └── validate.js     budget input policy
    │   ├── ui/
    │   │   ├── format.js       Intl formatting, string path only
    │   │   ├── render.js       table, summary, filters
    │   │   ├── app.js          wiring and view state
    │   │   └── styles.css
    │   └── data/employees.js   generated by the Python tool
    ├── tests/                  114 tests, node --test, zero deps
    │   ├── helpers/            DOM shim, seeded PRNG
    │   ├── rational · money · rates · employees · validate · allocate
    │   ├── fitness.test.js     architectural constraints
    │   └── ui.test.js          semantics only, never styling or copy
    ├── tools/
    │   ├── generate_employees.py
    │   └── serve.mjs           zero-dependency static server
    ├── employees.json / employees.csv
    ├── vercel.json             static deploy config, no build step
    ├── README.md
    └── Design.md               engineering decision ledger (27 decisions)
```

`src/core/` must stay free of DOM references so the engine is testable in Node.

---

## Status

| Phase | State |
|---|---|
| 0 — Repo inspection | Done |
| 1 — Requirements lock | Done (this file) |
| 2 — Architecture | **Done** — `demo/Design.md`, 27 decisions |
| 3a — Core engine | **Done** — rational, money, currencies, rates, employees, allocate. All invariants verified against the real 300-row dataset |
| 3b — validate.js, data module, UI wiring | **Done** — end-to-end flow verified |
| 4 — Test suite | **Done** — 114 tests, all 8 mutations caught |
| 5 — UX polish | **Done** — rebuilt as a data tool (D-14). Light-only, paginated. Three defects found and fixed |
| 6 — Final review | **Done** — review pass: 1 crash, 3 defects, 1 stale comment fixed; README finalised. Follow-up layout pass (D-19) fixed a sticky-header regression and table reflow |
| 7 — Edge-case review | **Done** — seventeen areas probed by hand and by measurement. Two layout defects (money-cell truncation, stat overflow) fixed by sizing from the data; one false claim in the refusal copy corrected; the budget cap re-derived from payroll (D-23); the two rejection layers made consistent (D-26). A measured contrast sweep found 17 of 43 text styles below WCAG AA; the neutral ramp was re-derived from the contrast floor and a `main` landmark added (D-27) |
| D2 — Design document | Scoping brief written: `design/BRIEF.md`. The deliverable is `design/PRODUCTION-DESIGN.md`, not `DESIGN.md`, so no filename in the repository collides with `demo/Design.md`. Execution not started; to be run in a separate session |
| Deployment | Vercel, static, root directory `demo` (D-21). Link lives in the repository root README |

**Verified so far.** Engine: exact per-currency reconciliation across budgets in all
three currencies; residual within the proven bound of $0.005348 on every case
(3,000 fuzzed budgets across all three currencies, zero violations, max observed
$0.005273); determinism across repeated runs; strict monotonicity; filter
independence; error paths for empty dataset, negative budget and zero payroll.
Validation: 31 input cases including Indian and Western grouping, unicode digits,
hex, exponent notation, currency symbols and over-length strings. Both economic
bounds live in the engine and are asserted on each side in all three currencies. UI: initial render,
six rejection paths, allocation in USD and INR, filter view-independence, reset.

**Suite validated by mutation testing.** Eight deliberate defects were injected and
every one was caught: disabling largest-remainder, reversing the tiebreak, altering
a rate by 0.01, reintroducing a float into the parse path, replacing half-up with
truncation, removing the negative-budget guard, removing the resolution gate, and
sorting money on raw minor units. A suite that passes is not evidence; a suite
that fails when the code is wrong is.

**Two test-authoring gotchas:**

1. `Intl` separates the currency code from the number with **U+00A0 (NBSP)**, not a
   plain space. Any assertion on formatted output must normalise it.
2. The no-float fitness check must strip comments before grepping, or it flags the
   documentation explaining why floats are unsafe.
3. `node --test tests/` searches the directory on Node 20 but is read as a **glob
   pattern** from Node 22, which resolves to the directory itself and throws
   `MODULE_NOT_FOUND`. The test script therefore passes explicit paths
   (`tests/*.test.js`), expanded by the shell, which behaves identically on every
   version. CI found this; a single-version machine cannot.

**UI tests assert semantics only** — element ids, aria state, row counts, cell
values. Never class names, layout or prose. A restyle must not break them; if it
does, the test was written wrong.

---

## Decision rules

**Tier 1 — stop and ask.** Business requirements, financial calculation semantics,
salary/budget correctness, exchange-rate semantics, deliverable scope, ambiguous
user-visible behaviour, security, data integrity, major architecture, external
services. State the ambiguity, the options, the trade-offs, a recommendation and
the reason — then wait. Do not just say "I need clarification."

**Tier 2 — decide, document, continue.** Normal engineering choices. Prefer simple
and conventional. Record in `demo/Design.md` only if materially relevant.

**Tier 3 — just do it.** Formatting, refactors, lint, obvious bugs, basic tests,
docs cleanup, repetitive implementation.

---

## Working rules

- **Do not re-derive locked decisions.** Read `demo/Design.md` instead of re-reasoning
  from first principles.
- **Test the output, don't trust it.** When an assertion fails, establish whether
  the code or the assertion is wrong before changing either. Over this build the
  assertion was at fault more often than the code was — a monotonicity check that
  ignored equal salaries, an NBSP compared against an ASCII space, a selector that
  read the wrong column, a fixture that assumed the lowest salary was also the
  lowest in base currency. Each would have produced a silent, wrong "fix" if taken
  at face value (D-12).
- Research only where it materially improves a decision — money handling,
  security, standards, significant architecture. Not for routine choices.
- Report at phase boundaries, not per file edit.
- Keep this file current. It is the handoff between sessions and between models.

---

## Model routing

The original plan routed architecture, financial-correctness reasoning, test
*design* and final review to the strongest model available, and implementation
against a locked spec, UI, docs and refactors to a cheaper one. That split was
dropped at the start of Phase 3b: capacity was not the binding constraint, and the
handoff cost — re-establishing context, then re-reviewing the cheaper model's
output against the ledger — was larger than the saving. The whole build ran on the
strongest model instead.

What survives from the plan is the part that mattered: every session ends by
writing its conclusions into `demo/Design.md` and this file, so the next one starts
from written state rather than replaying a transcript. That discipline is what
makes the phase boundaries reviewable, and it is independent of which model is
behind them.

---
