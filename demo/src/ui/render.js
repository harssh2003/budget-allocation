/**
 * DOM rendering. Pure functions of (state) -> DOM; no business logic lives here.
 *
 * All employee-derived text is written with textContent rather than innerHTML.
 * The dataset is generated locally and trusted, but a table renderer that is
 * only safe because of where its data happens to come from is a latent bug.
 */

import { formatMoney, formatBaseRational, formatPercent, formatCount } from './format.js';
import { SORTABLE } from './sorting.js';
import { SUPPORTED_COUNTRIES } from '../core/currencies.js';
import { add as addRational, mul, rational, compare } from '../core/rational.js';

const PLACEHOLDER = '—';

/** Which body cell each sortable column corresponds to. */
const SORT_COLUMN_CLASS = Object.freeze({
  name: 'col-name',
  salary: 'col-salary',
  allocation: 'allocation',
  updated: 'updated',
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function cell(tag, className, text) {
  const c = el(tag, className, text);
  if (tag === 'th') c.scope = 'row';
  return c;
}

/**
 * Employee table body.
 * @param {HTMLElement} tbody
 * @param {Array} rows already filtered for display
 * @param {boolean} allocated whether an allocation has been run
 */
export function renderTable(tbody, rows, allocated, sortColumn = null) {
  const tint = (column) => (sortColumn === column ? ' is-sorted-col' : '');
  const fragment = document.createDocumentFragment();

  if (rows.length === 0) {
    const tr = el('tr');
    const td = el('td', 'empty-row', 'No employees match this filter.');
    td.colSpan = 7;
    tr.append(td);
    fragment.append(tr);
  }

  for (const row of rows) {
    const tr = el('tr');
    tr.append(
      cell('th', `col-name${tint('name')}`, row.Name),
      cell('td', 'col-id', row.Employee_ID),
      cell('td', 'col-role', row.Role),
      cell('td', 'col-country', row.Country),
      cell('td', `num${tint('salary')}`, formatMoney(row.salary)),
      cell('td', `${allocated ? 'num allocation' : 'num is-idle'}${tint('allocation')}`,
        allocated ? formatMoney(row.allocation) : PLACEHOLDER),
      cell('td', `${allocated ? 'num updated' : 'num is-idle'}${tint('updated')}`,
        allocated ? formatMoney(row.updatedSalary) : PLACEHOLDER),
    );
    fragment.append(tr);
  }

  tbody.replaceChildren(fragment);
}

const abs = (r) => (r.num < 0n ? mul(r, rational(-1n)) : r);

/**
 * The reconciliation statement.
 *
 * Stated directionally rather than as a signed number: a negative residual means
 * the allocations came to MORE than the budget, and "-USD 0.002942 — -29.4179%"
 * makes a reader decode two minus signs to learn that. The share of the budget
 * is given alongside the absolute figure because the bound is absolute and stays
 * constant as the budget shrinks — at USD 0.01 a residue well inside the bound
 * is still 29% of what was asked for.
 */
function reconciliationNote(result, base) {
  const note = el('p', result.residualIsMaterial ? 'reconciliation is-material' : 'reconciliation');
  const residual = result.residualInBase;

  // Nothing was distributed, so there is no conversion and nothing to reconcile.
  // Saying otherwise invites a reader to look for a residue that cannot exist.
  if (result.budget.minor === 0n) {
    note.append(
      el('b', null, 'Reconciliation. '),
      document.createTextNode('No budget was distributed, so there is nothing to reconcile. '
        + 'Every salary is unchanged.'),
    );
    return note;
  }

  // Stated as a rounding DIFFERENCE, not as exceeding or falling short of the
  // budget. No currency, country or employee received more than its correctly
  // rounded share; the difference appears only when three independently rounded
  // integers are converted back into a single figure (Design.md D-05).
  const amount = formatBaseRational(abs(residual), base, 6);
  const share = result.residualShareOfBudget === null
    ? null
    : compare(abs(mul(result.residualShareOfBudget, rational(1000000n))), rational(1n)) < 0
      ? 'under 0.0001%'
      : formatPercent(abs(result.residualShareOfBudget), 4);

  const sentence = residual.num === 0n
    ? `Converting the three pools back to ${base} lands exactly on the entered budget.`
    : `Converting the three pools back to ${base} leaves a rounding difference of ${amount}`
      + (share ? ` — ${share} of the budget` : '')
      + `, within the proven bound of ${formatBaseRational(result.residualBoundInBase, base, 6)}.`;

  note.append(
    el('b', null, 'Reconciliation. '),
    document.createTextNode(`Allocations sum exactly to each country's pool. ${sentence}`),
    el('span', 'aside', result.residualIsMaterial
      ? 'At this budget that difference is large relative to the amount entered: each currency '
        + 'group rounds to its own minor unit, and those steps together are comparable to the '
        + 'budget itself. Every employee still received their exact rounded share, and the '
        + 'difference becomes negligible at realistic budgets.'
      : 'Three currency pools rounded to whole minor units cannot convert back onto one exact '
        + 'figure. Every employee received their exact rounded share; the difference is reported '
        + 'rather than absorbed into anyone’s salary.'),
  );
  return note;
}

/**
 * A headline figure.
 *
 * Long amounts step the type down rather than overflowing their card: at the
 * maximum budget a value runs to 25 characters, and a monetary figure must never
 * be clipped. The full string is also on `title`, so it stays recoverable
 * whatever the rendering does.
 */
function stat(label, value, note, modifier) {
  const node = el('div', modifier ? `stat ${modifier}` : 'stat');
  const size = value.length > 22 ? ' is-xlong' : value.length > 17 ? ' is-long' : '';
  const valueNode = el('span', `stat-value${size}`, value);
  valueNode.setAttribute('title', value);
  node.append(el('span', 'stat-label', label), valueNode);
  if (note) node.append(el('span', 'stat-note', note));
  return node;
}

function headerCell(text, className) {
  const th = el('th', className, text);
  th.scope = 'col';
  return th;
}

/**
 * Summary: four headline figures, a per-country breakdown, and the
 * reconciliation statement.
 *
 * The reconciliation line is deliberately prominent rather than tucked into a
 * tooltip. Three currencies rounded to whole minor units cannot convert back
 * onto a single exact figure, and a residue that is shown with its proven bound
 * is more trustworthy than one quietly absorbed somewhere (Design.md D-05).
 */
export function renderSummary(container, result) {
  const base = result.baseCurrency;

  const stats = el('div', 'stats');
  stats.append(
    stat('Existing payroll', formatBaseRational(result.existingPayrollInBase, base),
      'all currencies, converted'),
    stat('Additional budget', formatMoney(result.budget),
      result.budget.currency === base
        ? 'as entered'
        : `as entered · ${formatBaseRational(result.budgetInBase, base)}`,
      'is-delta'),
    stat('Increase applied', formatPercent(result.allocationRatio),
      'identical for every employee'),
    // Shows existing + what was actually DISTRIBUTED, which differs from
    // existing + budget by the rounding difference below. Labelled accordingly:
    // "existing + additional" invited a reader to add the two cards above and
    // find a cent missing.
    stat('Updated payroll', formatBaseRational(
      addRational(result.existingPayrollInBase, result.totalAllocatedInBase), base),
      'existing + allocated'),
  );

  const breakdown = el('table', 'breakdown');
  breakdown.append(el('caption', null, 'By country'));

  const thead = el('thead');
  const headRow = el('tr');
  headRow.append(
    headerCell('Country'),
    headerCell('Employees', 'num'),
    headerCell('Existing payroll', 'num'),
    headerCell('Allocation', 'num'),
    headerCell('Updated payroll', 'num'),
  );
  thead.append(headRow);

  const tbody = el('tbody');
  for (const country of SUPPORTED_COUNTRIES) {
    const currency = result.rows.find((r) => r.Country === country)?.Currency;
    const group = currency && result.groups[currency];
    if (!group) continue;

    const tr = el('tr');
    const rowHeader = el('th', null, country);
    rowHeader.scope = 'row';
    tr.append(
      rowHeader,
      el('td', 'num', formatCount(group.employeeCount)),
      el('td', 'num', formatMoney(group.existingPayroll)),
      el('td', 'num delta', formatMoney(group.allocationPool)),
      el('td', 'num', formatMoney(group.updatedPayroll)),
    );
    tbody.append(tr);
  }
  breakdown.append(thead, tbody);

  const breakdownScroll = el('div', 'scroll-x');
  breakdownScroll.append(breakdown);

  container.replaceChildren(stats, breakdownScroll, reconciliationNote(result, base));
  container.hidden = false;
}

/** Filter buttons with live counts. */
export function renderFilters(container, counts, active) {
  const options = ['All', ...SUPPORTED_COUNTRIES];
  const fragment = document.createDocumentFragment();
  for (const option of options) {
    const button = el('button', 'filter-btn');
    button.type = 'button';
    button.dataset.filter = option;
    button.setAttribute('aria-pressed', String(option === active));
    button.append(
      el('span', null, option),
      el('span', 'filter-count', formatCount(option === 'All' ? counts.All : counts[option] ?? 0)),
    );
    fragment.append(button);
  }
  container.replaceChildren(fragment);
}

/**
 * Which page numbers to show, with gaps collapsed.
 *
 * Up to MAX_PAGES_SHOWN pages are listed in full -- at 25 or 50 rows per page
 * that covers the whole ledger, and a stable row of numbers is easier to aim at
 * than one that reshuffles under the cursor. Beyond that (30 pages at 10 rows)
 * the ends and a window around the current page are kept and the rest collapses
 * to a gap marker.
 *
 * @returns {(number|null)[]} page numbers, with null marking an elided run
 */
/**
 * Pages listed in full before any elision kicks in.
 *
 * 12 covers the default view exactly (300 rows at 25 per page), so the common
 * case shows a complete, stable row of numbers. Only the 10-rows-per-page view
 * (30 pages) needs collapsing.
 */
export const MAX_PAGES_SHOWN = 12;

export function pageWindow(page, pageCount, span = 2) {
  // If they all fit, show them all: a fixed row of numbers is easier to aim at
  // than one that reshuffles as you move through it.
  if (pageCount <= MAX_PAGES_SHOWN) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  const shown = new Set([1, 2, pageCount - 1, pageCount]);
  for (let p = page - span; p <= page + span; p++) {
    if (p >= 1 && p <= pageCount) shown.add(p);
  }

  const out = [];
  let previous = 0;
  for (const p of [...shown].sort((a, b) => a - b)) {
    if (p - previous > 1) out.push(null);
    out.push(p);
    previous = p;
  }
  return out;
}

/**
 * Page controls. Pagination is a second view-only concern layered on the filter:
 * neither changes a single allocated figure (Design.md D-08).
 */
export function renderPagination(container, { page, pageCount }) {
  if (pageCount <= 1) {
    container.replaceChildren();
    container.hidden = true;
    return;
  }

  const step = (label, targetPage, disabled) => {
    const node = el('button', 'page-btn is-step', label);
    node.type = 'button';
    node.dataset.page = String(targetPage);
    if (disabled) node.disabled = true;
    return node;
  };

  const children = [step('\u2039 Prev', page - 1, page === 1)];

  for (const entry of pageWindow(page, pageCount)) {
    if (entry === null) {
      const gap = el('span', 'page-gap', '\u2026');
      gap.setAttribute('aria-hidden', 'true');
      children.push(gap);
      continue;
    }
    const node = el('button', 'page-btn page-num', formatCount(entry));
    node.type = 'button';
    node.dataset.page = String(entry);
    node.setAttribute('aria-label', `Page ${entry}`);
    if (entry === page) node.setAttribute('aria-current', 'page');
    children.push(node);
  }

  children.push(step('Next \u203a', page + 1, page === pageCount));

  container.hidden = false;
  container.replaceChildren(...children);
}

/**
 * Reflect sort state onto the header: `aria-sort` for assistive technology, a
 * caret for everyone else. Columns derived from an allocation are disabled
 * until there is one to sort by.
 */
export function renderSortState(thead, sort, allocated) {
  for (const th of thead.querySelectorAll('th')) {
    const key = th.dataset.sort;
    if (!key) continue;

    const button = th.querySelector('button');
    const active = sort.column === key;
    const meta = SORTABLE[key];

    th.setAttribute('aria-sort', active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
    if (button) {
      button.disabled = Boolean(meta && meta.needsAllocation && !allocated);
      const mark = button.querySelector('.sort-mark');
      if (mark) {
        mark.className = active ? `sort-mark is-${sort.direction}` : 'sort-mark';
      }
    }
  }
}

/**
 * The active sort, shown as a removable chip.
 *
 * Sorting is otherwise only visible on the column header itself, which may be
 * scrolled out of view — and once applied there was no way back to the default
 * order. The chip states what the ordering is and carries the control to drop
 * it, so neither question needs a convention to answer (Design.md D-17).
 */
export function renderSortChip(chip, sort) {
  const meta = sort.column && SORTABLE[sort.column];
  if (!meta) {
    chip.hidden = true;
    chip.replaceChildren();
    return;
  }

  const direction = sort.direction === 'asc' ? 'ascending' : 'descending';
  chip.hidden = false;
  chip.setAttribute('aria-label', `Clear sort by ${meta.label}, ${direction}`);
  chip.replaceChildren(
    el('span', 'sort-chip-label', `Sorted: ${meta.label}`),
    el('span', `sort-chip-dir is-${sort.direction}`),
    el('span', 'sort-chip-clear'),
  );
}

/**
 * An allocation the engine refused. BELOW_RESOLUTION carries structured facts,
 * so the message can say what went wrong, why, and what would work -- failing
 * loudly is only useful if it also points forward (Design.md D-18).
 */
/**
 * The assumptions panel behind the rates badge.
 *
 * Built from the same rate table and provenance record the engine uses, so the
 * panel cannot state a rate the calculation did not apply.
 */
export function renderAssumptions(container, { rates, rateSet, baseCurrency, range }) {
  const rateSection = el('section');
  rateSection.append(el('h2', null, 'Exchange rates'));
  const list = el('dl');
  for (const rate of rates.filter((r) => r.currency !== baseCurrency)) {
    list.append(el('dt', null, `1 ${baseCurrency}`), el('dd', null, `${rate.perBase} ${rate.currency}`));
  }
  rateSection.append(list, el('p', null,
    `${baseCurrency} is the base currency: payroll and budget are converted to it to form the `
    + `percentage, and salaries are never converted. ${rateSet.note} `
    + `Snapshot ${rateSet.asOf.slice(0, 10)} (${rateSet.id}), ${rateSet.source}.`));

  const rangeSection = el('section');
  rangeSection.append(el('h2', null, 'Budget range this demo allocates'));
  const rangeList = el('dl');
  for (const r of range) {
    rangeList.append(el('dt', null, r.currency), el('dd', null, `${r.minimum} — ${r.maximum}`));
  }
  rangeSection.append(
    rangeList,
    el('p', null, 'Both bounds are derived from the payroll, so each is the same amount of money '
      + 'whichever currency it is entered in. Below the lower bound some shares would round to '
      + 'nothing; above the upper bound (a hundred times payroll) an entry is more likely a '
      + 'mistake than a budget. Both are demo policies, not requirements of the calculation.'),
  );

  const methodSection = el('section');
  methodSection.append(
    el('h2', null, 'Method'),
    el('p', null, 'Amounts are held as exact integer minor units. Each currency group is '
      + 'apportioned by largest remainder, so allocations sum exactly to that group\u2019s pool. '
      + 'Employee data is synthetic and generated deterministically.'),
  );

  container.replaceChildren(rateSection, rangeSection, methodSection);
}

export function showAllocationError(region, error) {
  // One child, so the flex container lays out icon + prose, not icon + two columns.
  const body = el('span');

  if (error.code === 'BELOW_RESOLUTION') {
    // Deliberately does NOT say "the same percentage cannot be applied": the
    // percentage is exact at any budget. What cannot be done is settle it --
    // pay a share that reaches one whole unit of the employee's currency.
    body.append(
      el('b', null, `${formatMoney(error.budget)} is too small to settle proportionally. `),
      document.createTextNode(
        `The increase it produces is smaller than one unit of their own currency for `
        + `${formatCount(error.uncoveredCount)} of ${formatCount(error.employeeCount)} employees, `
        + 'so their share would round to nothing. '
        + `Enter at least ${formatMoney(error.minimumBudget)} for every share to reach a whole unit.`,
      ),
    );
  } else if (error.code === 'ABOVE_MAXIMUM') {
    body.append(
      el('b', null, `${formatMoney(error.budget)} is larger than this demo will allocate. `),
      document.createTextNode(
        `The limit is ${formatCount(Number(error.payrollMultiple))} times existing payroll — `
        + `${formatMoney(error.maximumBudget)}, the same amount whichever currency it is entered in. `
        + 'Beyond that, an entry is more likely a mistake than a budget.',
      ),
    );
  } else {
    showError(region, error.message);
    return;
  }

  region.replaceChildren(body);
  region.hidden = false;
}

export function showError(region, message) {
  region.textContent = message;
  region.hidden = false;
}

export function clearError(region) {
  region.textContent = '';
  region.hidden = true;
}
