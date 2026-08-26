/**
 * Application wiring: input -> validate -> allocate -> render.
 *
 * The one rule this file must not break: the country filter is a VIEW concern.
 * Allocation is always computed across every employee, and filtering only
 * changes which of the already-computed rows are rendered. Re-running the
 * engine on a filtered subset would redistribute the whole budget among those
 * employees and silently answer a different question (Design.md D-08).
 */

import { EMPLOYEES } from '../data/employees.js';
import { loadEmployees } from '../core/employees.js';
import { allocate, minimumMeaningfulBudget, maximumMeaningfulBudget } from '../core/allocate.js';
import { validateBudget } from '../core/validate.js';
import { SUPPORTED_COUNTRIES } from '../core/currencies.js';
import { rateTable, BASE_CURRENCY, RATE_SET } from '../core/rates.js';
import { SUPPORTED_CURRENCIES } from '../core/currencies.js';
import { toMajorString } from '../core/money.js';
import {
  renderTable, renderSummary, renderFilters, renderPagination, renderSortState, renderSortChip,
  showError, showAllocationError, clearError, renderAssumptions,
} from './render.js';
import { sortRows, nextSort, SORTABLE } from './sorting.js';
import { formatCount, formatMoney } from './format.js';

const dom = {
  form: document.getElementById('budget-form'),
  currency: document.getElementById('budget-currency'),
  amount: document.getElementById('budget-amount'),
  group: document.getElementById('budget-group'),
  error: document.getElementById('budget-error'),
  reset: document.getElementById('reset-btn'),
  summary: document.getElementById('summary'),
  filters: document.getElementById('filters'),
  tbody: document.getElementById('employee-rows'),
  pagination: document.getElementById('pagination'),
  pageSize: document.getElementById('page-size'),
  role: document.getElementById('role-filter'),
  head: document.getElementById('ledger-head'),
  sortChip: document.getElementById('sort-chip'),
  shown: document.getElementById('rows-shown'),
  prompt: document.getElementById('idle-prompt'),
  rateProvenance: document.getElementById('rate-provenance'),
  rateBadge: document.getElementById('rate-badge'),
  assumptions: document.getElementById('assumptions'),
  stickyBar: document.getElementById('sticky-bar'),
  stickyMeta: document.getElementById('sticky-meta'),
  masthead: document.querySelector('header.masthead'),
};

const NO_SORT = Object.freeze({ column: null, direction: 'desc' });

/**
 * Computed once. Allocation replaces `rows`; `filter`, `page` and `pageSize` are
 * view state and never touch it.
 */
const state = {
  employees: loadEmployees(EMPLOYEES),
  result: null,
  filter: 'All',
  role: 'All',
  page: 1,
  pageSize: 25,
  sort: NO_SORT,
};

/** Roles present in the data, so the filter cannot drift from the dataset. */
const ROLES = [...new Set(state.employees.map((e) => e.Role))].sort();

/** Rows matching the role filter, before the country filter narrows further. */
function roleMatched(rows) {
  return state.role === 'All' ? rows : rows.filter((r) => r.Role === state.role);
}

/**
 * Country counts reflect the active role filter. Showing "USA 100" while a role
 * filter is hiding 92 of them would be a number that contradicts the table.
 */
function countryCounts(rows) {
  const scoped = roleMatched(rows);
  return SUPPORTED_COUNTRIES.reduce(
    (acc, country) => {
      acc[country] = scoped.filter((e) => e.Country === country).length;
      return acc;
    },
    { All: scoped.length },
  );
}

/** Rows passing both filters, then ordered by the active sort. */
function visibleRows() {
  const rows = state.result ? state.result.rows : state.employees;
  const byRole = roleMatched(rows);
  const byCountry = state.filter === 'All' ? byRole : byRole.filter((r) => r.Country === state.filter);
  return sortRows(byCountry, state.sort);
}

function paint() {
  const rows = visibleRows();
  const pageCount = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, pageCount);

  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);

  sizeMoneyColumns();
  renderTable(dom.tbody, pageRows, state.result !== null, state.sort.column);
  renderFilters(dom.filters, countryCounts(state.result ? state.result.rows : state.employees), state.filter);
  renderSortState(dom.head, state.sort, state.result !== null);
  renderSortChip(dom.sortChip, state.sort);
  renderPagination(dom.pagination, { page: state.page, pageCount });

  dom.shown.textContent = rows.length === 0
    ? 'No employees match this filter'
    : `Showing ${formatCount(start + 1)}\u2013${formatCount(start + pageRows.length)} of ${formatCount(rows.length)}`;
  dom.reset.hidden = state.result === null;
  // The first-run prompt yields to an error: two competing instructions is worse
  // than one.
  dom.prompt.hidden = state.result !== null || !dom.error.hidden;
}

/**
 * Reset is the only path that takes the allocation away, and a sort on a column
 * derived from it must go with it, or the next paint sorts rows on a field they
 * do not have. Allocation-derived headings are disabled while there is no
 * result, so clearing the sort here is what keeps that pairing true.
 */
function dropAllocation() {
  state.result = null;
  state.page = 1;
  if (SORTABLE[state.sort.column]?.needsAllocation) state.sort = NO_SORT;
  dom.summary.hidden = true;
  dom.summary.replaceChildren();
}

/**
 * Width of the money columns, in characters, taken from the longest value in the
 * WHOLE result -- not the visible page.
 *
 * Fixed table layout keeps the columns still while you filter (D-19), but with
 * percentage widths a long amount was quietly truncated with an ellipsis: at
 * 1100px, 26 of 75 money cells lost digits. Sizing from the data instead means a
 * monetary value is never shortened, and taking the maximum across every row
 * rather than the page keeps the columns from moving as the view changes.
 */
function sizeMoneyColumns() {
  const rows = state.result ? state.result.rows : state.employees;
  let longest = 0;
  for (const row of rows) {
    for (const amount of [row.salary, row.allocation, row.updatedSalary]) {
      if (amount) longest = Math.max(longest, formatMoney(amount).length);
    }
  }
  // +1 for the ch-unit approximation of proportional digits, floored at the
  // width the column headings themselves need.
  document.documentElement.style.setProperty('--money-col', `${Math.max(longest + 1, 16)}ch`);
}

function markInvalid(invalid) {
  if (invalid) {
    dom.amount.setAttribute('aria-invalid', 'true');
    dom.group.classList.add('is-invalid');
  } else {
    dom.amount.removeAttribute('aria-invalid');
    dom.group.classList.remove('is-invalid');
  }
}

function runAllocation(event) {
  event.preventDefault();
  const currency = dom.currency.value;
  const check = validateBudget(dom.amount.value, currency);

  if (!check.ok) {
    showError(dom.error, check.message);
    markInvalid(true);
    paint();
    dom.amount.focus();
    return;
  }

  clearError(dom.error);
  markInvalid(false);

  try {
    state.result = allocate({ employees: state.employees, budget: check.value });
  } catch (error) {
    // A rejected submission is a no-op. The assignment above threw, so `result`
    // still holds the last allocation that succeeded, and it stays on screen
    // beside the error -- self-labelled, since the summary names the budget it
    // was computed for. Discarding it here would have made a refused budget more
    // destructive than an unreadable one, which took the same path a few lines
    // up and left the result alone (Design.md D-26).
    showAllocationError(dom.error, error);
    markInvalid(true);
    paint();
    return;
  }

  renderSummary(dom.summary, state.result);
  paint();
}

function resetAllocation() {
  dropAllocation();
  dom.amount.value = '';
  clearError(dom.error);
  markInvalid(false);
  paint();
  dom.amount.focus();
}

dom.form.addEventListener('submit', runAllocation);
dom.reset.addEventListener('click', resetAllocation);
dom.amount.addEventListener('input', () => {
  clearError(dom.error);
  markInvalid(false);
  paint();
});
dom.filters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state.filter = button.dataset.filter;
  state.page = 1;   // a new filter starts at its first page, not page 7 of the last one
  paint();
});

dom.role.addEventListener('change', () => {
  state.role = dom.role.value;
  state.page = 1;
  paint();
});

dom.sortChip.addEventListener('click', () => {
  state.sort = NO_SORT;
  state.page = 1;
  paint();
});

dom.head.addEventListener('click', (event) => {
  const button = event.target.closest('[data-sort-key]');
  if (!button || button.disabled) return;
  state.sort = nextSort(state.sort, button.dataset.sortKey);
  state.page = 1;   // a re-sort makes the current page number meaningless
  paint();
});

dom.pagination.addEventListener('click', (event) => {
  const button = event.target.closest('[data-page]');
  if (!button || button.disabled) return;
  state.page = Number(button.dataset.page);
  paint();
});

dom.pageSize.addEventListener('change', () => {
  // Keep the row currently at the top of the page in view rather than jumping
  // back to the start: changing the page size is a zoom, not a reset.
  const firstRowIndex = (state.page - 1) * state.pageSize;
  state.pageSize = Number(dom.pageSize.value);
  state.page = Math.floor(firstRowIndex / state.pageSize) + 1;
  paint();
});

// The currency selector is built from the currency table, so the demo's set of
// currencies is declared in exactly one place. Nothing in the UI knows how many
// there are (Design.md D-22).
dom.currency.replaceChildren(
  ...SUPPORTED_CURRENCIES.map((code) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = code;
    return option;
  }),
);
dom.currency.value = BASE_CURRENCY;

dom.role.replaceChildren(
  ...['All', ...ROLES].map((role) => {
    const option = document.createElement('option');
    option.value = role;
    option.textContent = role === 'All' ? 'All roles' : role;
    return option;
  }),
);

// --- assumptions panel -------------------------------------------------------

dom.rateBadge.textContent = `Demo · rates fixed ${RATE_SET.asOf.slice(0, 10)}`;
dom.stickyMeta.textContent = `Rates fixed ${RATE_SET.asOf.slice(0, 10)}`;
// Two lines: the statement, then the rates themselves. Short enough to read at a
// glance; the panel behind the badge carries the detail.
const rateLines = document.createElement('span');
rateLines.className = 'rate-lines';
rateLines.textContent = rateTable()
  .filter((r) => r.currency !== BASE_CURRENCY)
  .map((r) => `1 ${BASE_CURRENCY} = ${r.perBase} ${r.currency}`)
  .join('  ·  ');

dom.rateProvenance.replaceChildren(
  document.createTextNode(`Fixed snapshot, ${RATE_SET.asOf.slice(0, 10)}. No rate API is called.`),
  rateLines,
);

renderAssumptions(dom.assumptions, {
  rates: rateTable(),
  rateSet: RATE_SET,
  baseCurrency: BASE_CURRENCY,
  range: SUPPORTED_CURRENCIES.map((currency) => ({
    currency,
    minimum: formatMoney(minimumMeaningfulBudget({ employees: state.employees, currency })),
    maximum: formatMoney(maximumMeaningfulBudget({ employees: state.employees, currency })),
  })),
});

function setAssumptionsOpen(open) {
  dom.assumptions.hidden = !open;
  dom.rateBadge.setAttribute('aria-expanded', String(open));
}

dom.rateBadge.addEventListener('click', (event) => {
  event.stopPropagation();
  setAssumptionsOpen(dom.assumptions.hidden);
});

// A panel that can only be closed by the control that opened it is a trap on a
// page this size, so dismiss on outside click and on Escape as well.
document.addEventListener('click', (event) => {
  if (dom.assumptions.hidden) return;
  if (!dom.assumptions.contains?.(event.target)) setAssumptionsOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || dom.assumptions.hidden) return;
  setAssumptionsOpen(false);
  dom.rateBadge.focus();
});

// --- sticky bar --------------------------------------------------------------

// The sticky bar appears once the masthead has scrolled past.
//
// Compared against a cached height rather than measured on each scroll: reading
// a bounding rect forces layout, and the masthead's height only changes on
// resize. That leaves one number comparison per scroll event and a DOM write
// only when the state actually flips.
//
// A frame-scheduled variant (requestAnimationFrame, or an IntersectionObserver)
// is the tidier pattern, but neither could be verified here -- headless Chrome
// runs the initial callback and never re-evaluates -- and an unverifiable
// behaviour is not worth the elegance.
if (typeof window !== 'undefined' && dom.stickyBar && dom.masthead) {
  const BAR_HEIGHT = '2.75rem';
  let threshold = 0;
  let shown = null;

  const measure = () => {
    threshold = dom.masthead.offsetTop + dom.masthead.offsetHeight;
  };

  const sync = () => {
    const stuck = window.scrollY > threshold;
    if (stuck === shown) return;
    shown = stuck;
    dom.stickyBar.classList.toggle('is-shown', stuck);
    dom.stickyBar.setAttribute('aria-hidden', String(!stuck));
    // The ledger head sticks below the bar rather than behind it.
    document.documentElement.style.setProperty('--sticky-offset', stuck ? BAR_HEIGHT : '0px');
  };

  window.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', () => { measure(); sync(); }, { passive: true });
  measure();
  sync();
}

paint();
