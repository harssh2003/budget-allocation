# Design Decisions — Deliverable 1

Engineering decision ledger for the budget allocation demo. Each entry records a
decision that materially shapes the implementation. Trivial choices (naming, CSS,
file layout) are deliberately excluded.

Base currency for all internal calculation: **USD**. Rate set: `snapshot-2026-08-26`.

---

## D-01 — Money is an exact integer count of minor units, held as BigInt

**Context.** Every number in this system is money. The demo sums a 300-row payroll
across three currencies, scales it by a ratio, and must report that the result
reconciles against what the user entered.

**Alternatives considered.**

| Option | Assessment |
|---|---|
| IEEE-754 `Number` (float) | Rejected. Fails at the boundaries, see below. |
| `Number` constrained to safe integers (minor units) | Viable, rejected on maintenance grounds. |
| `decimal.js` / `big.js` | Rejected. Adds a dependency to solve a problem we do not have. |
| **BigInt count of minor units** | **Chosen.** |

**Trade-offs.** BigInt cannot be mixed with `Number` without an explicit
conversion, which is mildly inconvenient and entirely the point — the friction is
what stops a float leaking into the money path. It is slower than `Number`, which
is irrelevant at 300 rows.

**Why not float.** The failures are concentrated at the parse and format
boundaries, which is exactly where money enters and leaves the system:

```
Number("1234.15") * 100  ->  123415.00000000001
(1.005).toFixed(2)       ->  "1.00"      // expected 1.01
(8.575).toFixed(2)       ->  "8.57"      // expected 8.58
0.1 + 0.2                ->  0.30000000000000004
```

Parsing a decimal string straight into minor units and formatting straight back
out removes this entire class of bug rather than mitigating it.

**A reason deliberately NOT claimed.** It is tempting to justify BigInt with the
2<sup>53</sup> argument: `salary × budget` overflows `Number.MAX_SAFE_INTEGER` as an
intermediate, therefore floats break. That argument was tested against this
dataset and **does not hold**. IEEE-754 multiply and divide are correctly rounded,
so the relative error survives the subsequent division and stays far below one
minor unit. Float only diverges once the *result itself* exceeds 2<sup>53</sup> —
around ₹90 trillion:

```
budget 1e18 paise   exact 87219294237572704   float 87219294237572704   err   0
budget 1e19 paise   exact 872192942375727049  float 872192942375727104  err -55
```

The honest justification for BigInt is therefore narrower and stated as such: it
removes the need to re-establish a magnitude proof at every future multiply site,
and it makes the multiply-first-then-divide ordering (required to preserve ratio
precision) unconditionally exact. Correctness here comes from **exact integer
representation plus a reconciled rounding policy (D-06, D-07)**, not from BigInt's
range.

**Impact.** `src/core/money.js`. Salaries convert from JSON `number` to Money once,
at the dataset boundary, with a `Number.isSafeInteger` guard (`src/core/employees.js`).

---

## D-02 — Currency metadata is data, not constants

**Decision.** `minorExponent` lives in `src/core/currencies.js` per currency;
nothing hard-codes `100`.

**Reason.** All three demo currencies happen to use two decimal places, so
hard-coding would work today and break the moment a zero-decimal currency (JPY,
KRW) or three-decimal currency (BHD, KWD) is added. The cost of doing it properly
is one lookup.

**Impact.** `minorPerMajor()` is the single source of scale. Deliverable 2 extends
this table rather than editing arithmetic.

---

## D-03 — Exchange rates are exact integer ratios, not decimals

**Context.** Fixed demo rates, no live API (per requirements).

**Decision.** Each rate is stored as `1 USD = num/den <currency>`:

| Currency | Ratio | Rate |
|---|---|---|
| USD | `1/1` | 1.00 |
| INR | `9527/100` | 95.27 |
| MXN | `1694/100` | 16.94 |

**Alternative considered.** A decimal rate table (`INR→USD = 0.010496`).

**Trade-off / reason.** A decimal table does not round-trip. Storing INR→USD as
`0.010496` alongside USD→INR as `95.27` gives two mutually inconsistent rates:
convert a value out and back and it does not return. With an exact ratio the
inverse is simply `den/num`, so invertibility holds by construction. Verified:
converting ₹166,770,000 → USD → INR returns the input exactly.

**Provenance, not just values.** These are **a dated snapshot, not live rates**:
captured 2026-08-26 11:42 UTC, mid-market reference via Morningstar. The snapshot
date is carried in `RATE_SET_ID` (`snapshot-2026-08-26`) and every allocation
result reports the rate set it used, because a monetary result is only
reproducible if you know which rates produced it. An earlier draft used rounder
placeholder values (83.50 / 17.20); those had drifted more than 12% from market,
which is a needless credibility cost for a demo whose subject is money. Rate
*versioning* is the Deliverable 2 concept this previews.

**Impact.** `src/core/rates.js`. Rate display is formatted from the exact ratio, so
the rate shown can never drift from the rate used.

---

## D-04 — The allocation ratio is dimensionless; salaries are never converted

**Context.** The obvious implementation converts all 300 salaries to a base
currency, allocates, then converts each result back.

**Decision.** Do not. `p = additional budget ÷ existing payroll` is a **ratio** — it
has no currency. Each employee's raise is therefore `salary × p` computed entirely
inside their own currency.

**Trade-off / reason.** The naive approach performs 600 conversions and rounds at
every one of them, accumulating error it then cannot account for. This approach
converts **four times total**: three payroll subtotals and the budget, all at
aggregate level. Fewer conversions, no per-row rounding, and the displayed salary
is trivially in the right currency because it never left it.

**Impact.** `src/core/allocate.js`. This is what makes D-05's residual bound as
tight as it is.

---

## D-05 — Reconciliation invariant: per-currency exact *(approved decision)*

**Context.** Requirements state the total allocation must reconcile against the
entered budget "subject to the defined currency conversion and rounding policy."
Those two goals are mutually exclusive and the tension is unavoidable: allocations
can sum exactly **within each currency**, or sum exactly **to the entered budget in
base currency**, but not both. Three local pools rounded to whole minor units
cannot convert back onto the input amount.

**Alternatives considered.**

- **A — per-currency exact.** Each currency group reconciles to the minor unit.
  Residual against the entered budget is computed, bounded and displayed.
- **B — global exact.** Force the headline total to match by assigning the leftover
  to one employee. Reconciles perfectly, but that employee receives a different
  percentage increase from everyone else, breaking the stated allocation rule.

**Chosen: A.** B buys a cosmetically perfect total by violating the one business
rule the feature exists to implement, and its "invariant" is an artefact of the
fix-up rather than a property that can be meaningfully tested. A residual that is
computed, bounded and shown is a system that knows its own limits; a residual
silently absorbed into one person's salary is one that does not.

**The bound is proven, not asserted.** Each group's pool is within half a minor
unit of its exact share, so the residual is at most the sum over currencies of half
a minor unit converted to base — **≤ $0.00535** for this rate set. Asserted in
`tests/` on every case, including fuzzed budgets.

> **Superseded in part by D-18.** The residual-share reporting below remains, but
> budgets small enough for the residue to distort the result are now *refused*
> before this point rather than disclosed. See D-18 for why.

**The bound is absolute, which is not the whole story.** Half a minor unit per
currency group stays constant while the budget shrinks, so the *relative* size of
the residue grows without limit as the budget approaches zero:

| Budget | Distributed | Residue as share of budget |
|---|---|---|
| USD 0.01 | USD 0.012942 | **29.4179%** |
| USD 1 | USD 1.002620 | 0.2620% |
| USD 100 | USD 100.001454 | 0.0015% |
| USD 2,000,000 | USD 1,999,999.998804 | under 0.0001% |

At USD 0.01 the three groups round to 1 cent, 10 paise and 3 centavos — together
worth more than the cent that was entered. The arithmetic is correct and inside
the bound, but reporting only the absolute figure would let a 29% distortion read
as negligible. `allocate()` therefore also returns `residualShareOfBudget` and
`residualIsMaterial` (threshold 0.1%), and the UI states the residue as a share of
the budget and says plainly when the demo is below its meaningful resolution.

**Stated directionally.** A negative residual means the allocations came to *more*
than the budget; rendering that as "−USD 0.002942 — −29.4179%" asks the reader to
decode two minus signs. The UI says "exceed" or "fall short of" with unsigned
figures instead.

**Impact.** `allocate()` returns `residualInBase`, `residualBoundInBase`,
`residualShareOfBudget`, `residualIsMaterial` and `withinResidualBound`.

---

## D-06 — Rounding: half-up, applied exactly once per currency group

**Decision.** Each group's pool is `roundHalfUp(payroll × p)`. This is the **only**
rounding operation in the engine; every intermediate is an exact rational.

**Alternative considered.** Banker's rounding (half-to-even).

**Trade-off / reason.** Half-even exists to remove systematic upward bias when
rounding many values. Here rounding is applied to exactly three aggregate values
per allocation, so there is no population for bias to accumulate over. Half-up is
the convention a finance reviewer expects and is easier to reason about.
Noted as a candidate for revisit in Deliverable 2, where per-transaction rounding
does occur at volume.

**Impact.** `roundHalfUp()` in `src/core/rational.js`.

---

## D-07 — Largest-remainder apportionment with a deterministic tiebreak

**Context.** `salary × p` is almost never a whole number of minor units. Rounding
each row independently makes the rows sum to something other than the pool.
Measured on this dataset (India group): **round-to-nearest drifts by up to 5 minor
units, truncation by 49.** That is the difference between a system that says it
distributed the budget and one that did.

**Decision.** Each row takes the floor of its exact share; the leftover minor units
go one each to the rows with the largest discarded remainders, tie-broken by
ascending `Employee_ID`.

**Consequences, both accepted and documented:**

1. The group sums to its pool **exactly**. Verified on every test case.
2. A row's allocation differs from its exact share by at most one minor unit, so
   the effective percentage increase is uniform to within **6×10⁻⁶ percentage
   points** at demo magnitudes.
3. **Two employees on identical salaries may receive raises differing by one minor
   unit.** This is unavoidable — an indivisible unit cannot be split between two
   people — and is true of every apportionment method. What matters is that it is
   deterministic (the lower `Employee_ID` wins) and bounded at exactly one unit.
   Surfaced here rather than discovered later.

The shortfall is provably in `[0, n]`; the engine asserts this and throws
`APPORTIONMENT_INVARIANT` rather than silently producing a wrong split.

**Impact.** `src/core/allocate.js`.

---

## D-08 — The country filter is a view transform and never re-runs the engine

**Decision.** Allocation is always computed across **all** employees. Filtering
changes which rows are rendered, nothing else.

**Reason.** If the engine re-ran over the filtered subset, selecting "USA" would
redistribute the entire budget across 100 people and change every number on screen.
Verified: the same employee receives $12,058.38 under an all-employee allocation
and $17,051.19 under a USA-only one. The first is correct; the second answers a
different question. Guarded by an explicit test.

---

## D-09 — Budget input validation

**Decision.** The budget field is parsed from string to exact minor units with no
`Number` involvement. Policy:

| Input | Behaviour |
|---|---|
| Empty / whitespace | Rejected, specific message |
| Negative | Rejected, specific message (not a generic "invalid") |
| **Zero** | **Accepted** — a 0% allocation is a valid query, not an error |
| Non-numeric, hex, unicode digits | Rejected |
| Exponent notation (`1e9`) | Rejected — ambiguous in a money field |
| Grouping separators (`,`, spaces) | Stripped before validation |
| More decimals than the currency supports | Rejected with the currency's limit named, never silently truncated |
| Above the documented maximum | Rejected |

**On grouping separators.** Placement is deliberately *not* validated. Western
grouping (`2,000,000`) and Indian grouping (`20,00,000`) are both correct and
differ; rejecting either would be a bug. Accepting a slightly permissive superset
is the right trade for a demo whose users span both conventions.

**On the upper bound.** Because money is BigInt, the ceiling is a **product**
decision rather than a technical limit. An explicit, documented, tested maximum is
better than unbounded input with undefined presentation behaviour.

---

## D-10 — Display: currency code, not symbol

**Context.** Salaries render in each employee's local currency.

**Finding that forced the decision.** `Intl.NumberFormat` renders both USD and MXN
as `$1,234.00` — identical glyphs, different money:

```
en-US / USD  ->  $1,234.00
es-MX / MXN  ->  $1,234.00
```

On a table showing USA and Mexico rows together this is genuinely ambiguous.

**Decision.** `currencyDisplay: 'code'` (`USD 105,500.00`, `MXN 585,000.00`), plus an
explicit Currency column. Each currency keeps its own locale, so INR retains
correct lakh/crore grouping (`INR 1,66,77,000.00`).

**Also.** `Intl.NumberFormat.format()` accepts a **string** and formats it exactly
(verified, Node 20 and modern browsers). Money is therefore formatted directly from
its exact decimal string — no float at the display boundary either.

---

## D-11 — No build step, no runtime dependencies

**Decision.** Plain ES modules, no framework, no bundler, no `node_modules`.

**Reason.** Requirements call for a demo that is fast to run and easy to review. A
build step is friction paid before seeing anything work.

**Known trade-off.** `<script type="module">` will not load over `file://`. A
Anyone who double-clicks `index.html` gets a blank page. Mitigated by making the
one-line run command the first thing in the README, and by shipping a
single-file build for zero-friction viewing.

---

## D-12 — Testing: invariants over examples

**Decision.** `node --test`, zero dependencies. Tests assert **properties that must
hold for every input**, not a handful of golden numbers:

| # | Invariant |
|---|---|
| I1 | Each currency group's rows sum **exactly** to its pool |
| I2 | Pool = `roundHalfUp(payroll × p)` |
| I3 | Global residual within its proven bound |
| I4 | Every row within one minor unit of its exact share |
| I5 | Percentage increase uniform across all employees |
| I6a | Strictly higher salary never receives a smaller raise |
| I6b | Equal salaries differ by at most one minor unit |
| I7 | Updated salary = original + allocation |
| I8 | Byte-identical output across repeated runs |
| I9 | Filtering the view does not change allocations |

Plus a validation table of adversarial inputs, error-path coverage, and fuzzed
budgets across all three currencies.

**Note.** I6 initially failed. Investigation showed the *test* was wrong, not the
engine: the violations were all between employees on identical salaries, and the
correct invariant is the strict-inequality form above. Recorded because the
distinction between "the code is wrong" and "the assertion is wrong" is the whole
value of the exercise.

**Architectural fitness function.** A test greps `src/core/` for `parseFloat`,
`Number(`, `.toFixed(` and `Math.round`, failing if any appear. The no-float rule is
enforced by the suite rather than by reviewer vigilance.

---

## D-13 — Dataset is generated deterministically and validated on load

**Decision.** `tools/generate_employees.py` (seeded, stdlib-only, self-validating)
is the single source of truth, emitting JSON, CSV and a JS module. `loadEmployees()`
re-validates at runtime: required columns present, `Employee_ID` unique, country
supported, `Currency` consistent with `Country`, salary a non-negative safe integer.

**Reason.** A demo whose numbers are wrong because a row was malformed is worse
than one that refuses to start. All violations are collected and reported together
rather than failing on the first.

---

## D-14 — Presentation: a ledger, not a landing page

**Context.** The first build of the UI was competent but generic — every region
wrapped in a bordered card, one accent colour on flat grey, hierarchy carried by
text colour, and marketing-style whitespace. For a tool whose subject is 300
salaries across three currencies, that is the wrong shape.

**Decision.** Rebuild the presentation layer around three rules:

1. **The data is the subject.** Chrome is muted, figures are high-contrast, and
   nothing decorative competes with a number. Tabular figures throughout, money
   right-aligned, identifiers in monospace at reduced weight.
2. **Hierarchy comes from type.** A deliberate scale with real size and weight
   contrast, rather than boxes and colour.
3. **Density over whitespace.** Rules and alignment separate regions instead of
   nested cards. The summary is a stat strip divided by hairlines, not a grid of
   four tiles.

**Trade-off.** Denser interfaces are less forgiving — misalignment and
inconsistent spacing that a card layout would hide become visible. That is the
point: the same scrutiny that catches a rounding error catches a column heading
sitting left of its figures.

**Two defects this surfaced, both fixed:**

- Numeric column headings rendered left-aligned above right-aligned figures.
  `.ledger thead th` outranked a bare `.num`, so the alignment is now restated at
  matching specificity.
- The page scrolled horizontally on narrow viewports — **measured at 133px of
  overflow**. Two causes: grid items default to `min-width: auto` and refuse to
  shrink below their content, and the per-country table set `white-space: nowrap`
  with no scroll container. Wide tables now scroll inside their own container and
  the page body never does.

**Pagination over scrolling.** 300 rows in a fixed-height scroll box reads as a
wall of numbers and gives no sense of position. The ledger pages at a
user-selectable 10 / 25 / 50 / 100 rows, with Prev/Next, direct page numbers, and
an explicit "Showing 1–25 of 300".

Page numbers are windowed rather than listed in full: at 10 rows the ledger runs
to 30 pages, so first, last and a window around the current page are always shown
and skipped runs collapse to a single gap marker. `pageWindow()` is exported and
tested directly — the elision logic is the part most likely to be wrong at
boundaries, and it is exhaustively checked across every page of every page count
for four invariants (ends present, current present, ascending, no duplicates).

Changing the page size keeps the row currently at the top of the page in view
rather than jumping to the start: resizing is a zoom, not a reset. Paging is a
second view-only concern layered on the filter — changing the filter returns to
page one, and neither touches a single allocated figure (D-08).

**Light only.** A dark variant was built and then removed. Light, restrained, a
single blue accent and a muted green for the increase column is the convention
across compensation and finance tooling; committing to it fully is better than
maintaining two themes in a demo, and a half-tuned dark mode is a liability rather
than a feature. `color-scheme: light` is declared so native form controls stay
light when the operating system is set to dark. Landing on this palette is
convergent with the category, not derived from any particular product.

---

## D-15 — Affordance is not decoration

**Context.** D-14 pushed the interface away from a generic card-and-gradient look
and went too far: filters, page controls and selects ended up as flat text with no
indication they could be interacted with. An engineer can work that out. A
non-technical user cannot, and this is a customer-facing demo.

**Decision.** Restore interaction cues without restoring ornament. The rule that
separates the two: **interactive elements should look interactive; static regions
stay quiet.** Chrome is earned by things that respond to input, not applied evenly.

| Element | Before | After |
|---|---|---|
| Currency + amount | Two separate boxes | One joined input group — they are one decision, so they read as one control; the group takes the focus ring |
| Primary action | Same weight as everything | Filled, keyed shadow, hover and press states |
| Country filter | Text with a thin underline | Segmented control: a track groups the options, the raised segment shows the current setting |
| Pagination | Thin outlined boxes | Same segmented treatment, current page filled |
| Selects | Native arrow, varies per platform | Drawn chevron, consistent and sized to the surrounding type |
| Errors | A tinted strip | Bordered callout with an icon mark |
| First run | Nothing | A dashed prompt naming the next action, which hides itself once used |

Data regions were left flat. The ledger, the stat strip and the breakdown gained
nothing but a row-hover transition.

**Two defects this surfaced, both found by measuring rather than by eye:**

1. **`[hidden]` had silently stopped working.** The UA rule is `display: none` at
   the lowest possible specificity, so any class that sets `display` defeats it —
   and `.error`, `.prompt`, `.pagination` and `.actions` are all flex containers
   toggled through the `hidden` property. An empty error box rendered on first
   load. Fixed with an explicit `[hidden] { display: none !important; }`.

   Worth noting the test suite could not have caught this: the DOM shim records
   the `hidden` property faithfully, but it does not compute style, so a element
   that is "hidden" in the shim and visible in a browser looks identical to it.
   Layout defects need layout measurement, and that is what found this one.

2. **The amount field was 8px shorter than the group containing it.**
   `.input-group input` and the global `input[type="text"]` have identical
   specificity, so source order silently decided the height. Both group rules were
   given higher specificity so the sizing no longer depends on where they sit in
   the file.

**Method note.** A patch to the filter styles silently did nothing because it was
written against a stale copy of the block. Every subsequent stylesheet edit
asserts its anchor before substituting, so a missed match fails loudly instead of
producing a page that looks unchanged for no visible reason.

---

## D-16 — Sorting and a role filter, and why the sort key is not the salary

**Context.** Review feedback: the ledger read as inert, there was no way to rank
employees, and the only slice available was country. Each request was assessed on
whether it earns its place rather than adopted wholesale.

| Request | Verdict | Reason |
|---|---|---|
| Sort by salary | **Adopted** | Not a convenience feature. Sorting by salary descending puts the allocation column in the same order, which makes the central business claim — *the same percentage for everyone, so larger salaries receive larger amounts* — directly inspectable rather than asserted in prose. |
| Filter by role | **Adopted** | The natural second dimension for compensation data, and one `<select>`. It also forced the filter layer to become a general predicate rather than a country-specific branch. |
| Rows-per-page moved beside "Showing X–Y" | **Adopted** | Groups the "what am I looking at" controls together and leaves the footer to "where am I". |
| Show all page numbers, no elision | **Adopted in part** | Every page is now listed up to 12, which covers the default view (300 rows at 25 per page) exactly, so the common case never reshuffles. At 10 rows per page the ledger runs to 30 pages, where a full list stops being an aid. |

**The part that mattered: the sort key.**

Sorting money across currencies on its raw minor units is meaningless. INR figures
are roughly 95× larger numerically, so a "highest salary" sort would rank every
Indian employee above every American one regardless of value:

```
sorted on base value (correct)       sorted on raw minor units (wrong)
  USA     231,000.00 USD               India   46,30,000.00 INR
  USA     221,000.00 USD               India   44,50,000.00 INR
  USA     214,500.00 USD               India   38,30,000.00 INR
```

Comparison therefore runs on the exact base-currency value of each amount. The
same applies at the other end: the lowest-paid employee in the dataset is Indian
(₹5,80,000 ≈ USD 6,087.96), which a raw-number sort would never surface — a test
asserts both extremes by `Employee_ID`.

**This is not the per-row conversion D-04 avoids.** That rule governs the money
*path*: no displayed or allocated figure may be derived through a per-row
conversion. These values are sort keys, computed exactly and discarded. Kept in
`src/ui/sorting.js` rather than in the engine so the boundary stays visible.

**Consequences handled.**

- Sorting and filtering are strictly view-only; a test captures all 100 USA
  allocations, applies three different sorts, and asserts every one is unchanged.
- Re-sorting returns to page one, because the old page number refers to an
  ordering that no longer exists.
- Columns derived from an allocation are disabled until there is one.
- A sort on `allocation` or `updated salary` is dropped on Reset, since it refers
  to figures that no longer exist.
- Country counts on the segmented control are computed against the role-filtered
  set. "USA 100" while a role filter hides 92 of them is a number that contradicts
  the table beneath it.
- Ties break on `Employee_ID`, so ordering is identical on every run whatever the
  engine's sort does with equal keys.

**Header treatment.** Sortable headings are buttons — hit area, hover, caret,
`aria-sort` — and the active column is tinted. Non-sortable headings stay plain
text. Same rule as D-15: only what responds to input looks live.

---

## D-17 — Returning to the default order

**Context.** D-16 gave the ledger a two-state sort: click a heading for
descending, click again for ascending. There was no third state, so once a column
was sorted there was no route back to the default `Employee_ID` order. Review
feedback raised this and proposed two fixes.

**Alternatives considered.**

| Option | Assessment |
|---|---|
| **Tri-state heading** (asc → desc → none) | Rejected. The conventional answer, and the worst one here. A third click that *removes* sorting is a convention many users have never met; they experience it as the sort vanishing. It also makes clicks one and two less predictable, and the third state — "no state" — is the hardest of the three to indicate on a heading. |
| **Make `Employee_ID` sortable** | Rejected. The default order already *is* `Employee_ID` ascending, so clicking it produces **visually identical rows** while the heading changes. A control that appears to do nothing is worse than no control, and "sort by ID descending" is not a question anyone has. |
| **Show the active sort as a removable chip** | **Chosen.** |

**Chosen approach and why.** The underlying problem is not that the sort cannot be
removed — it is that the sort is **invisible** unless you happen to be looking at
the right column heading, which may be scrolled out of view on a narrow screen. A
chip in the view-controls row states the ordering and carries the control to drop
it:

```
default            (no chip)                    EMP-001  EMP-002  EMP-003
one click          Sorted: Salary ▼  ×          EMP-074  EMP-075  EMP-036
two clicks         Sorted: Salary ▲  ×          EMP-138  EMP-137  EMP-197
clear              (no chip)                    EMP-001  EMP-002  EMP-003
```

This answers two questions with one control — *what am I sorted by?* and *how do I
undo it?* — and requires no convention to be known in advance. It sits beside the
role and rows-per-page controls, where the other "what am I looking at" state
already lives. The chip is a button, so it is reachable by keyboard and carries
`aria-label="Clear sort by Salary, descending"` rather than relying on the caret
glyph alone.

**Consequences.** Clearing returns to page one, since the page number referred to
an ordering that no longer exists. The chip disappears when Reset drops a sort on
an allocation-derived column, and survives Reset when the sorted column does
(salary exists with or without an allocation) — both are covered by tests.

**Marks are drawn, not typed.** The first build used `▼`, `▲` and `×` as text.
All three sat visibly high in their containers, and no amount of flex centring
fixed it: centring positions the glyph's *em box*, while the ink inside that box
sits wherever the typeface puts it. The marks are now SVG masks filled with
`currentColor`, so they are geometrically centred and still inherit hover and
active colours. Measured after the change:

```
chip caret vs chip centre          0px
clear cross vs its circle centre   0px
header caret vs its label centre   0px
```

The same reasoning already applied to the drawn select chevron (D-15); using it
consistently means no mark in the interface depends on a typeface's metrics.

**The sorted column is tinted through the whole table**, not just its heading. On
a wide table the heading may be the only indication of what the ordering is based
on, and it scrolls out of view; a column tint keeps the answer on screen wherever
you are in the data.

**Test-suite note.** These tests share a single application lifecycle by design,
so view state carries between them. Adding the chip exposed a test that silently
inherited a sort from the test before it. A `resetView()` helper now establishes
filter, role, page size and sort explicitly, so each test states the view it
depends on instead of inheriting one.

Direction is asserted through the mark's class rather than a glyph, and the
column tint through the cell that carries it — assertions on semantics survive a
change of iconography, assertions on `▼` do not.

---

## D-18 — Below-resolution budgets are refused, not disclosed

**Context.** Entering INR 1.00 produced a summary panel reading `0.0000%`,
`INR 1.00`, `USD 17,299,437.79`, and three country allocations of one cent, ten
paise and three centavos — followed by a reconciliation note explaining that the
result was 22% off. Every number was arithmetically correct and every invariant
held. The result was still wrong, because it presented as a success something
that was not one.

The arithmetic is not where it failed. At INR 1.00 the increase is 0.0000058%, and
for the lower-paid employees that comes to less than one unit of their currency.
Their share floors to zero. **They receive a 0% increase while others receive
more** — the one rule the demo exists to demonstrate is not executable at that
budget, and the summary said nothing about it.

**Alternatives considered.**

| Option | Assessment |
|---|---|
| Allocate and disclose the residue (status quo) | Rejected. "Succeed loudly with a disclaimer." The headline figures are what a reader takes in; the footnote is not. A reader sees "22% of it" as "the tool is 22% wrong." |
| Allocate, and make the reconciliation warning more prominent | Rejected for the same reason. The summary panel still reports `0.0000%` and an updated payroll as if the operation had been carried out. Louder small print is still small print. |
| Reject at input with a fixed minimum (e.g. "at least USD 5") | Rejected. A magic number. The real floor depends on payroll, headcount, the smallest salary and the rate set. Change the dataset and the constant is silently wrong, in either direction. |
| **Refuse when the rule cannot be applied to everyone; derive and state the minimum** | **Chosen.** |

**The criterion.** An allocation is refused when any employee's *exact*
proportional share is less than one unit of their own currency — equivalently,
when the floor step of the apportionment yields zero for anyone. That is a
closed-form condition on the data, not a threshold chosen by hand:

```
every employee:  salary_minor × p  ≥  1
          <=>    p  ≥  1 / smallest_salary_minor
   minimum budget  =  ceil( payroll_base × p_min , converted to the entered currency )
```

`minimumMeaningfulBudget()` computes it exactly and `allocate()` throws
`BELOW_RESOLUTION` carrying the budget, the minimum, and how many employees fell
under the line. The minimum is stated **in the currency the user chose**, so the
refusal tells them what would work rather than only what did not:

```
USD 2.95   BELOW_RESOLUTION   1 of 300 under one cent
USD 2.96   accepted           300 / 300 receive at least one unit
```

The boundary is exact in every supported currency (USD 2.96 / INR 281.73 /
MXN 50.10) and a test asserts both sides of it. A zero budget is *not* below
resolution: it is an exact 0% for everyone, which satisfies the rule.

**Why the engine refuses rather than the UI.** The engine's contract is
"distribute this budget so that every employee receives the same percentage." If
it cannot, returning a result that quietly violates that contract is the
ship-and-lie failure mode. Throwing is the honest behaviour, and any future
consumer of the engine gets the protection without having to remember a check.

**What the user sees.** The error region — red, iconed, the field marked invalid —
states what, why and the way forward: *"INR 0.01 is too small to settle
proportionally. The increase it produces is smaller than one unit of their own
currency for 300 of 300 employees, so their share would round to nothing. Enter at
least INR 281.73 for every share to reach a whole unit."* No partial result is
produced: the throw happens before anything is assigned, so there is nothing
half-allocated to render. If an earlier allocation succeeded it stays on screen
beside the error, because a rejected submission changes nothing (D-26).

**A correction to the original wording.** The first version of this message said
*"the same percentage cannot be applied to everyone"*. That was **false**. The
percentage is an exact rational and is applied at any budget, however small: at
INR 0.01 it is 121/19,942,220,991,500, or 0.000000000607%. What fails is
*settlement* — paying a share that reaches one whole unit of the employee's
currency. The wording now says so, because a demo that argues for financial
precision cannot afford an imprecise claim in its most-read sentence.

**Which employee binds the threshold — and it is not who you would guess.** The
minimum is set by the employee holding the *fewest minor units*, not the lowest
salary. That is **EMP-043 (USA, USD 58,500 = 5,850,000 cents)**, not EMP-138
(India, ₹5,80,000 ≈ USD 6,088), who earns a tenth as much but holds 58,000,000
paise. A cent is worth about 95 paise, so granularity binds before pay does.

**A property of the threshold, stated because it is easy to over-claim.** Meeting
the minimum guarantees *everyone receives something*, not *everyone receives the
same percentage to display precision*. At exactly INR 281.73 the effective
increase varies between employees by up to 31% of `p`, because one minor unit is
a large fraction of a very small share. At USD 50 that spread is 2%; at
USD 2,000,000 it is 0.0001%. The guarantee is coverage, not uniformity of the
settled figure — uniformity of the *ratio* is exact everywhere (D-07).

**On the general principle.** Fail loudly rather than quietly — yes, but the
useful version of that rule is *fail loudly and point forward*. A refusal that
says only "too small" sends the user guessing. Because the minimum is derived
rather than fixed, the message can always name a number that works.

**A measurement note, recorded because the first diagnosis was wrong.** Checking
the refusal state by computed style returned the *default* border colour on some
runs and the error colour on others. The first explanation reached for was lazy
`:has()` invalidation. It was not: with the transition disabled the colour was
correct on every run. `getComputedStyle` read mid-way through a 140ms
`border-color` fade returns the fade's *start* value, and headless timing made
"mid-way" the common case. Two changes followed. The invalid state is now a class
the app sets alongside `aria-invalid` — deterministic, and testable without a
style engine — and it enters with `transition: none`, so an error snaps in rather
than fading. Both are improvements on their own merits; neither was the fix for
the bug originally suspected, and the code comment now says why the rule exists
rather than repeating the wrong reason.

**What D-05's residual reporting still does.** For accepted budgets the residue
share is still computed and reported, and still flagged if it exceeds 0.1%. Just
above the floor (USD 2.97) that flag does fire — the residue is ~0.16% of a
three-dollar budget, which is correct, bounded, and worth saying. At realistic
budgets it never fires. The gate handles the failure case; the disclosure handles
the honest edge of the success case.

---

## D-19 — Review pass on layout, and a sticky header that had stopped working

Five pieces of review feedback, assessed rather than adopted wholesale.

| Feedback | Verdict |
|---|---|
| Table reshapes when filters change | **Adopted** — real, and worse than it looked |
| Title should stay visible while scrolling | **Adopted in altered form** — a slim bar, not the masthead |
| Accent rule under the title looks unfinished | **Adopted** — it was redundant |
| Font is small and stale | **Adopted in part** — sizes up; typeface unchanged, with reason |
| Assumptions should open from the rates badge | **Adopted** |

**The table was genuinely moving.** `table-layout: auto` re-measures every column
against the rows currently visible, so filtering changed the geometry:

```
                Name  ID  Role  Ctry Curr  Salary Alloc Updated
all employees    172 130   210   101  110    152   143   173
India            174 128   207   100  108    157   147   170
India + Eng Mgr  153 134   187   105  113    164   155   178
```

Every boundary shifted. Declared column widths with `table-layout: fixed` now
hold all three states identical, with no cell clipped and no horizontal page
scroll. The cost is that unusually long content ellipsises rather than widening
the column — the right trade for a table people read while changing filters.
(The cause was table layout, not flexbox; the table is not a flex container.)

**A sticky header that had already stopped working.** Investigating the
"keep the title visible" request turned up a live regression: the ledger head had
`position: sticky` but was not sticking at all.

`overflow-x: auto` computes `overflow-y` to `auto` as well, which makes the
wrapper a scroll container — and a sticky child then resolves against *that*
container, not the page. While the wrapper had `max-height: 36rem` this worked.
Pagination removed the max-height (D-14) and the header silently stopped
sticking; nothing failed, so nothing caught it. The wrapper is now `overflow:
visible` at widths where the table fits, with the scroller returning below
1040px, and the head sticks again.

**A slim bar rather than a sticky masthead.** The masthead is 153px — a fifth of
the viewport, permanently, on a page whose subject is a table. A 44px bar appears
once the masthead scrolls past, carrying the title and the rates control. The
ledger head sticks *below* it via a `--sticky-offset` custom property, so the two
do not overlap. Verified: at scroll 1006, bar bottom 45, head top 44.

**Frame-scheduled updates could not be verified, so they were not shipped.** The
bar's first implementation used an `IntersectionObserver`, then a
`requestAnimationFrame`-throttled scroll handler. Under headless Chrome neither
re-evaluates — the observer reports its initial intersection and stops. The
shipped version compares `window.scrollY` against a cached masthead height,
recomputed on resize: no layout read per scroll, no frame dependency, and every
transition demonstrable. Elegance that cannot be checked is not worth having in
a codebase that has otherwise refused to guess.

Headless also *drops* scroll events (`scrollTo(1200)` moved the page but fired
one event, not two), which first read as the bar failing to retract. Driving the
handler explicitly showed the state machine correct at every position. Worth
recording: this harness can prove a behaviour present, but its absence is not
evidence.

**Typography: sizes, not a typeface.** Body 14→15px, table cells 13→14px, heads
11→12px, headline 30→32px, with more weight contrast. No web font: the demo makes
a point of fetching nothing at runtime, and adding a font request to a page whose
headline claim is "no rate API is called" trades a real property for a cosmetic
one. On any current OS the system stack resolves to a competent UI face; the
staleness was size and weight, not shape.

**The accent rule went.** The masthead already has a bottom border, so a second
short rule a few pixels above it read as unresolved rather than as a device.

**Assumptions moved into the badge.** The rate table, the derived minimum budget
and the method note now open from `Demo · rates fixed …` as a panel, rather than
living only at the foot of a page most viewers will not scroll to. Attaching them
to the control that already names the assumption is the natural place for them.
The panel is built from the same `rateTable()` and `minimumMeaningfulBudget()`
the engine uses, so it cannot state a rate or a floor the calculation does not
apply. The footer keeps a one-line disclosure for anyone who never opens it, and
for print. The badge is a real button with `aria-expanded` and `aria-controls`;
the panel dismisses on outside click and on Escape, returning focus to the badge.

**Not adopted: separators as boxes.** The view controls needed separation, but
wrapping each in a bordered container would have reintroduced the card-on-card
look D-14 removed. A single hairline between groups does the work.

**Test-suite note.** The shim now seeds each node from its real tag in
`index.html` — every attribute, not just `hidden` — so a test cannot pass against
markup that does not carry what it asserts. `aria-expanded` on the badge is
checked this way. The sticky bar itself remains untested: it depends on scroll
position and element geometry, neither of which exists in the shim, and shimming
them to cover six lines of presentational logic would cost more than it protects.
It is verified by measurement in a real rendering engine instead.

---

## D-20 — Column widths belong to the headings, not the data

**Context.** D-19's fixed column widths were sized against the *values* in each
column. The headings are uppercase with letter-spacing and are frequently wider,
so three of them were being clipped:

```
              column   heading needs
 Currency @1440   71px     86px   << clipped
 Employee_ID @1024 88px   105px   << clipped
 Country @1024     68px    78px   << clipped
```

**Decision.** Size every column to the wider of its heading and its content, and
drop the Currency column.

**On dropping Currency.** It was the worst case — an eight-character heading over
three-character values — but the reason to remove it is that it repeated
information already in every cell beside it. Money renders as `USD 105,500.00`, so
the column restated the code 25 times a page and cost 6% of the table's width. It
was optional (the brief's required columns are Name, Employee_ID, Role, Country,
Salary); currency remains visible on every amount and in the Country column.
Reversible in three lines if it is wanted back.

**The scroll breakpoint had a dead band.** `.ledger` has a `min-width`; below the
width at which it fits, `.ledger-scroll` must scroll horizontally, and above it
overflow must stay `visible` or the sticky head stops working (D-19). Those two
numbers were set independently — `min-width: 66rem` against a `1040px` media
query — leaving 1040–1104px where the table overflowed its container with no
scrollbar. The query is now expressed in the same unit and derived from the same
figure (`69rem` = 66rem table + 3rem of wrapper padding), with a comment tying
them together. Verified at the boundary: 1110px fits without scrolling, 1104px
scrolls.

**Masthead.** The title and tagline were already flush left at every width; what
made the row feel wrong was the text block's fixed `max-width: 44rem` crowding
the badge as the viewport narrowed — down to a 37px gap at 1024px. The block now
flexes (`flex: 1 1 26rem`) with the tagline capped by a *measure* (`62ch`) rather
than a pixel width, so it stays readable at any root font size and the badge
wraps beneath it below 620px instead of being squeezed.

**Footer.** Two paragraphs of three-to-four lines restated what the assumptions
panel now holds. Cut to one line each with a small-caps label, capped to the same
62ch measure. Both lines hold at two lines across the full range.

**Verified across eight widths** (1600 → 620px): no clipped heading or cell, title
and tagline aligned at every width, no horizontal page scroll anywhere, and the
table head sticky throughout.

---

## D-21 — Hosting the demo

**Context.** The repository is the deliverable and runs locally with one command.
A hosted copy removes even that step: a link that opens to a working page in
seconds, and proof the demo runs somewhere other than the machine it was built
on. The requirements on a host are modest — static files over HTTPS, the correct
`text/javascript` type for ES modules, no build, and, importantly, **no
configuration added to the repository** for something that is an operational
setting rather than a project artefact.

**Alternatives considered.**

| Option | Assessment |
|---|---|
| **Vercel** | Import the repository, set the root directory to `demo`, framework preset *Other*, no build command. Serves the folder statically over HTTPS with correct module types and a `max-age=0, must-revalidate` cache policy. Nothing is added to the repository. Clean URL. |
| GitHub Pages | Keeps demo and source under one host, which is appealing. But the demo lives in a subfolder, so publishing needs either an Actions workflow — a `.github/workflows/` file in the repository — or restructuring; and the URL carries the `/demo/` path. |
| Netlify, Cloudflare Pages | Equivalent to Vercel for a static folder. No distinguishing advantage here; either would do. |
| No hosting | Forfeits the five-second path to a working page for no saving. |

**Chosen: Vercel.** Zero footprint in the repository and the shortest path from
link to working page. The repository stays fully runnable without it.

**What would change the decision.** A preference for everything under one host —
then GitHub Pages with a workflow. Or a need for response headers: the page has no
inline script or style, so a strict `Content-Security-Policy` would work, and a
`vercel.json` could carry it. That file was deliberately not added — shipping
hosting configuration inside a demo that argues against unnecessary
infrastructure is the wrong trade. Headers, CSP and edge configuration are
Deliverable 2 concerns and are covered there.

**Consequences.** The link lives in the repository's root README so it is filled
in once. The development server's `no-store` header (D-15) does not apply on the
host; its revalidating cache policy is equivalent for this purpose. Relative paths
throughout `index.html` and the modules mean the page is indifferent to being
served from a subpath, so the decision is reversible by re-deploying elsewhere
with no code change.

---

## D-22 — The problem is general; the dataset is not

**Context.** Every screen, document and test in this repository shows three
countries and three currencies, and a reader could take that for the problem. It
is not. The requirement is a budget-allocation system for **any organisation,
operating in whatever countries it operates in, entering its budget in whatever
currency it plans in**. The brief asked for mock data to demonstrate that, and
USA / India / Mexico with USD / INR / MXN is the mock data.

The distinction cost nothing in Deliverable 1 — a demo on static data behaves the
same whether its three currencies are a sample or the universe — but it decides
what "done" means for the production design, so it is recorded here rather than
left implicit.

**What in the demo is general, and what is fixed to the dataset.**

| Concern | Status |
|---|---|
| Allocation engine | General. Groups by whatever currencies the data contains; the ratio is dimensionless (D-04); apportionment is per-group. |
| Money representation | General. The minor-unit exponent is per-currency data (D-02); a zero- or three-decimal currency needs a table entry, not code. |
| Exchange rates | General in form — exact ratios for any pair (D-03). **Fixed in content**: three rates, because the brief requires a frozen snapshot and no live API. |
| Formatting | General. Locale and grouping come from the currency table. |
| Country filter, summary breakdown, budget-currency selector | General. Built from the currency and country tables at runtime. The selector had been the one hard-coded list in the interface; it now renders from the table, and a test asserts it. |
| Dataset | Fixed. 300 synthetic employees in three countries, as asked. |

**Decision.** Keep the three-currency configuration for the demo, and make the
boundary a stated property: the country and currency set lives in one table
(`currencies.js`) and one rate table (`rates.js`), and nothing else in the code
knows how many entries there are. Adding a fourth currency is two table entries
and touches neither the engine, the interface, nor the tests' invariants.

**Consequences for Deliverable 2.** Countries, currencies and rate sets are
**tenant data, not platform constants**: per-tenant country lists, any budget
currency, minor-unit exponents of 0, 2 and 3, rate coverage for arbitrary pairs
via a base currency, and privacy obligations for whichever jurisdictions a tenant
operates in. The three regimes the design brief names are examples drawn from the
demo dataset, not the set.

---

## D-23 — The maximum budget is derived from payroll, not fixed in major units

**Context.** Validation capped the budget at 10^12 major units of whatever
currency was entered. Review raised two objections, and both hold.

**It was not the same limit in every currency.** One trillion USD is USD 1e12;
one trillion INR is USD 10.5 billion. The same written figure permitted amounts
differing by a factor of 95 — a cap on the *numeral*, not on the money. For a
system whose entire argument is that a number means nothing without its currency,
that was the wrong shape of rule.

**It was not technically necessary.** The comment claimed a "product limit", which
was honest, but 10^12 was chosen because it is a round number. Money is BigInt and
exact far beyond it (tested at 10^30); 10^12 major units is 10^14 minor, itself
below 2^53. Nothing about the arithmetic needed protecting.

**Alternatives considered.**

| Option | Assessment |
|---|---|
| Keep the flat cap | Rejected. Currency-inconsistent, and the figure is arbitrary. |
| Remove it entirely | Rejected. Something must stop an entry that is plainly a mistake — a payroll pasted in minor units, an amount typed in the wrong currency — before it becomes a page of twenty-digit numbers. |
| Cap in the base currency | Better: currency-consistent. Still an arbitrary figure, and it would drift from meaning as payroll changed. |
| **Cap as a multiple of existing payroll** | **Chosen.** |

**Chosen.** The maximum is **100 × existing payroll**, computed in the base
currency and converted to whichever currency the budget is entered in:

```
USD  1,729,943,778.01
INR  1,64,81,17,43,731.40      all three = USD 1,729,943,778.01
MXN  29,305,247,599.55
```

A hundred times payroll is a 10,000% increase. Past that the input is more likely
an error than a budget, and saying so is a claim about the *money* rather than
about the digits.

**Why 100 — and what the multiplier is not.** The multiplier is not derived from
anything. It is a round number chosen to sit far above any defensible raise pool
and far below the magnitudes that make the output meaningless. What is defensible
is the *form* of the rule, not the constant:

- it is **payroll-relative**, so it needs no maintenance when the dataset changes —
  a fixed figure would be too tight for a fifty-thousand-person company and
  absurdly loose for a five-person one;
- it is **currency-neutral**, so the same economic amount is refused whichever
  currency it is typed in. A cap that let a user spend more by switching currencies
  would be a real defect, and the flat cap was one;
- it is **disclosed**, stating both the rule and the resulting figure. Nothing is
  clamped or truncated silently.

Only the first of those three depended on picking a number, and any number in that
region would serve. The claim being made is "this is a fat-finger guard", not "this
is the correct ceiling".

**Why cap at all, when nothing breaks without it.** Nothing does break. The
arithmetic is exact rational BigInt and would allocate 10^30 correctly. The cap
protects the *claim*, not the calculation: this tool presents itself as
distributing a raise pool, and a budget of a hundred times payroll multiplies every
salary by roughly 101 — arithmetically fine, but no longer a compensation decision.
Rendering a correct result that does not describe the thing the page says it is
doing is worse than refusing. There was also already an undisclosed bound at the
other end (`minimumMeaningfulBudget`); having a floor and no ceiling was the
asymmetry worth removing.

**Where it is enforced.** In the engine, beside `minimumMeaningfulBudget`, as
`ABOVE_MAXIMUM`. Both bounds are now derived from the same data, stated in the
entered currency, and symmetric. `validate.js` keeps only a 32-character guard on
the string — a syntactic bound, explicitly not an economic one.

**Consequences.** The bound moves with the dataset, which is correct: it is a
statement about this payroll. Both bounds appear together in the assumptions
panel, labelled as demo policies rather than requirements of the calculation. The
boundary is exact in all three currencies, and the stated maximum is itself
allocatable (floored, not rounded).

**In production this rule does not live here.** A multiple hard-coded in the
allocation engine is the wrong home for a number the business owns. The real
ceiling in a production system is the *approved* budget, which comes from finance;
the real guard is an approval threshold above which a second signature is
required, and that threshold is policy — per-organisation, versioned, auditable.
The engine's honest responsibility is narrower: given a budget, distribute it
exactly. Judging whether the budget is sane belongs to the layer that owns budget
authority, which is where `design/BRIEF.md` places it for Deliverable 2. The constant
here is a demo standing in for that layer, and is labelled as a demo policy in the
assumptions panel rather than as a property of the calculation.

---

## D-24 — A monetary value is never shortened; the layout yields instead

**Context.** Two display defects, found by driving the interface at the extremes
rather than by reading the code.

**The ledger silently truncated money.** With `table-layout: fixed` (D-19) and
percentage column widths, a long amount overflowed its cell and
`text-overflow: ellipsis` cut it. Measured at 1100px with a large budget: **26 of
75 money cells lost digits** — "USD 64,117,928.73" needed 165px in a 158px cell.
Silent digit loss in a financial table is the worst class of display bug, because
the value still looks like a value.

**The summary card overflowed.** `.stat-value` was `nowrap` at a fixed 23px in a
`minmax(175px, 1fr)` track. A near-maximum INR budget renders to 25 characters —
291px of ink in a 297px card — so it painted over its neighbour at every desktop
width.

**Decision.** Money is never abbreviated, never truncated, never rendered in
compact notation. The layout adapts to the value:

| | |
|---|---|
| Ledger | Money column width comes from `--money-col`, set by the application from the longest amount **in the whole result** — not the visible page, so filtering still cannot move the columns (D-19). The table's `min-width` grows with it and the wrapper scrolls. `text-overflow: ellipsis` now applies only to names and roles, which may legitimately be shortened. |
| Summary | Values over 17 characters step down to 1.1875rem, over 22 to 1rem, and carry the full string on `title`. Tracks are `minmax(min(100%, 15rem), 1fr)` so the strip reflows rather than forcing the page wider. |

**Rejected: compact notation** (`INR 165B`). It hides digits in the one place a
reader is checking them. **Rejected: horizontal scroll on the summary** — headline
figures should be visible without interaction. **Rejected: wrapping** — a number
broken across two lines is harder to read than a smaller one.

**Verified** at the largest allocatable budget across 1600 → 900px: **zero money
cells truncated at any width**, no stat overflows its card or overlaps its
neighbour, and the page never scrolls horizontally. The only truncation left is
long employee names below 1100px, which is intended.

---

## D-25 — Saying "rounding difference" rather than "exceeds the budget"

**Context.** The reconciliation note read *"Converted back to USD they exceed the
entered budget by USD 0.002779"*. Factually true and badly framed: on a page about
money, "exceeds the budget" reads as an overspend.

**Why it is not an overspend.** Verified numerically at USD 2,000,000. The exact
per-currency shares sum, converted back, to **exactly** the entered budget. The
difference is created entirely by rounding each of the three pools to a whole
minor unit:

| Currency | Exact share (minor) | Pool | Rounding move |
|---|---|---|---|
| INR | 1,928,039,536.5385 | 1,928,039,537 | +0.4615 paise |
| MXN | 621,696,504.6313 | 621,696,505 | +0.3687 centavos |
| USD | 143,062,452.7487 | 143,062,453 | +0.2513 cents |

Those three moves, converted to USD, are +0.0000484, +0.0002177 and +0.0025130 —
**summing to exactly the reported 0.0027791**. No currency, country or employee
received more than its correctly rounded share. A test now asserts this identity
directly, so the residual can never be slack the algorithm failed to account for.

**Decision.** The note states a *rounding difference* against a proven bound, adds
"Every employee received their exact rounded share", and drops the
exceed/fall-short framing. A zero budget gets its own sentence — *"No budget was
distributed, so there is nothing to reconcile"* — rather than a conversion caveat
about a conversion that did not happen.

**Also corrected: the updated-payroll card.** It displayed `existing + allocated`
under the label *"existing + additional"*. Those differ by the rounding
difference, so in **50 of 300 fuzzed budgets** a reader adding the two cards above
it would land a cent away from the third. The value is right — it is what was
actually distributed — so the label changed, not the number.

**The residual bound is a property of the rate set, not of the algorithm.** It is
half a minor unit per currency, converted: USD 0.005348 here, under one cent only
because these three currencies happen to make it so. A fourth currency, or one
whose minor unit exceeded two cents, would break the sub-cent claim. A test now
pins it, so adding a currency fails in the suite rather than quietly in the
interface.

---

## D-26 — A rejected submission changes nothing

**Context.** The form had two rejection layers that disagreed with each other. An
amount the parser could not read (`abc`, `-5`, `1e9`) showed an error and left any
previous allocation on screen. An amount the parser accepted but the engine
refused (below the resolution floor, above the payroll cap) showed an error and
*discarded* the previous allocation. Same gesture, same visible outcome — an error
message — and two different consequences for work already on screen.

Neither behaviour was wrong on its own. The inconsistency was, and it was
invisible: nothing in the interface distinguishes the two layers, so the rule a
user infers from one submission is contradicted by the next.

**How it arose.** Not by design. `dropAllocation()` was added to the refusal path
in the Phase 6 review to fix a crash — a sort on an allocation-derived column
outlived the allocation, and the next paint sorted rows on a field they no longer
had. Clearing the result cleared the sort with it. The crash was real and the
patch worked; it just settled a behavioural question as a side effect, on the path
that happened to be broken.

**Alternatives considered.**

| Option | Assessment |
|---|---|
| Both layers clear the result | Rejected. It makes a typo destructive: a mistyped character in the next amount discards a completed allocation. The failure means "I could not read this", which is no reason to throw away something already computed and correct. |
| Both layers keep the result | **Chosen.** |
| Keep the difference and explain it | Rejected. It would need the interface to teach the user which layer rejected them — a distinction that exists for implementation reasons and has no meaning to a reader. |

**Chosen.** A submission that fails leaves the application exactly as it was. The
error appears, the field is marked invalid, and nothing else moves. **Reset stays
the one action that clears an allocation**, which is what it is for, and it is on
screen throughout.

**Why the stale result is safe to leave.** The summary names the budget it was
computed for — *"Additional budget · USD 2,000,000 · as entered"* — so a result
from an earlier submission is self-labelling rather than ambiguous. It sits beside
an error stating what was rejected and why. A reader is not left guessing which
number the table belongs to.

**The crash does not return.** It cannot recur on this path, because the cause is
gone rather than compensated for. The refusal throws before the assignment, so
`state.result` keeps a value whose rows still carry the allocation the sort reads;
there is no longer a moment where the sort and the data disagree. The pairing that
matters — allocation-derived sorts exist only while an allocation does — is now
held by `dropAllocation()` on Reset alone, and Reset is the only path that takes an
allocation away. Allocation-derived headings are disabled without a result, so the
sort cannot be established out of step in the first place.

**Consequences.** The refusal path lost a line rather than gaining one. Three UI
tests changed: the one that asserted the old clearing behaviour now asserts the
single rule across *both* layers, and the crash regression test now checks that
the sort and its column survive together instead of disappearing together.

---

## D-27 — The neutral ramp is set by contrast, not by taste

**Context.** A contrast sweep over every distinct text style on the page, measured
in the browser against each element's real computed background, found **17 of 43
below WCAG AA**. The failures were not incidental — they were the interface's own
structure:

| Element | Ratio | Needs |
|---|---|---|
| Every column heading | 2.30 : 1 | 4.5 : 1 |
| `100` count beside each country filter | 2.30 : 1 | 4.5 : 1 |
| `before allocation` sub-labels | 2.30 : 1 | 4.5 : 1 |
| `‹ Prev` / `Next ›` | 2.30 : 1 | 4.5 : 1 |
| Section eyebrows, stat labels, table caption | 2.52 : 1 | 4.5 : 1 |
| `Showing 1–25 of 300` | 2.52 : 1 | 4.5 : 1 |
| Employee IDs, field hints, footnotes | 4.14–4.28 : 1 | 4.5 : 1 |

Two tokens produced all seventeen: `--ink-3: #737b85` and `--ink-4: #9aa1aa`. The
worst case is `--ink-4` on `--track` (`#eff1f4`), the table-head background —
2.30:1 for 12px uppercase type. The accent, gain and alert colours all passed
(5.6–6.5:1); the problem was confined to the greys.

**Why it happened.** The ramp was chosen by eye, on a display where light grey on
near-white reads as "quiet". Quiet and unreadable are indistinguishable to the
author and completely different to the reader. Nothing in the build would have
caught it: the tests assert semantics, and the fitness checks look at source
structure, not rendered pixels.

**Alternatives considered.**

| Option | Assessment |
|---|---|
| Darken only the failing elements | Rejected. Seventeen local overrides to avoid changing two variables, and the ramp would still be wrong for the next element that uses it. |
| Darken the backgrounds instead | Rejected. `--track` exists to separate the head from the body; deepening it enough to fix a 2.30:1 foreground would make the head heavier than the data. |
| Keep four tiers, re-derive them from the contrast floor | **Chosen.** |
| Drop to three tiers | Rejected without needing to be: four tiers still fit above the floor. |

**Chosen.** The floor is 4.5:1 against `#eff1f4`, the lightest surface any of these
sit on. The lightest neutral that clears it is `#666e78`, which becomes `--ink-4`.
`--ink-3` is then placed evenly between it and `--ink-2`:

| Token | Was | Now | On `--track` |
|---|---|---|---|
| `--ink` | `#0f1419` | unchanged | 16.36 : 1 |
| `--ink-2` | `#454c56` | unchanged | 7.67 : 1 |
| `--ink-3` | `#737b85` | `#565d66` | 3.79 → **5.89 : 1** |
| `--ink-4` | `#9aa1aa` | `#666e78` | 2.30 → **4.56 : 1** |

**What it costs.** The two muted tiers are closer together than before — 5.89:1
against 4.56:1, where they used to be 3.79 against 2.30. The hierarchy survives
because it was never carried by colour alone: size, weight, letter-spacing and
uppercasing all separate a column heading from a value, and they are untouched.
The trade is a smaller gap between two tiers against seventeen pieces of text
becoming legible, which is not a close call.

**Re-measured after the change: 0 of 43 below AA.**

**And a landmark.** The same pass found the page had `banner`, `contentinfo`,
`navigation` and `alert` but no `main` — no target for "skip to content". The
three sections are now wrapped in `<main>`. `.section:last-of-type` still resolves
to the ledger section, so the border treatment is unchanged, and measurement at
eight widths confirms the layout is identical.

**What this says about the rest.** The defect was invisible to every check the
project had, and it was found only by measuring. That is the argument for the
production design treating contrast as a build-time assertion rather than a review
item.
