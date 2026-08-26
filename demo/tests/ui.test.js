/**
 * UI layer, executed under Node against the DOM shim in ./helpers/dom.js.
 *
 * These assertions are deliberately restricted to SEMANTICS and DATA -- element
 * ids, aria state, row counts, cell values. They never assert on class names,
 * layout or prose copy, so restyling or rewording the demo cannot break them.
 *
 * app.js reads the document at module scope and the ES module cache holds one
 * instance per process, so the tests below share a single application lifecycle
 * and run in order, mirroring how a user would actually drive the page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { installDOM, normaliseSpaces, NBSP } from './helpers/dom.js';
import { pageWindow } from '../src/ui/render.js';
import { SUPPORTED_CURRENCIES } from '../src/core/currencies.js';
import { minimumMeaningfulBudget, maximumMeaningfulBudget } from '../src/core/allocate.js';
import { loadEmployees } from '../src/core/employees.js';
import { EMPLOYEES } from '../src/data/employees.js';
import { toMajorString } from '../src/core/money.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

const dom = installDOM(
  ['budget-form', 'budget-currency', 'budget-amount', 'budget-error', 'reset-btn',
   'summary', 'filters', 'employee-rows', 'rows-shown', 'rate-provenance', 'pagination', 'page-size', 'idle-prompt',
   'role-filter', 'ledger-head', 'sort-chip', 'rate-badge', 'budget-group', 'assumptions',
   'sticky-bar', 'sticky-meta'],
  HTML,
);
dom.get('budget-currency').value = 'USD';
dom.get('budget-amount').value = '';
dom.get('page-size').value = '25';

await import('../src/ui/app.js');

const $ = (id) => dom.get(id);
const rows = () => $('employee-rows').children;
const cellsOf = (row) => row.children.map((c) => c.textContent);
const columns = { name: 0, id: 1, role: 2, country: 3, salary: 4, allocation: 5, updated: 6 };
const PAGE_SIZE = 25;
const pageButtons = () => dom.get('pagination').children.filter((c) => c.tagName === 'BUTTON');
const numberButtons = () => pageButtons().filter((b) => /^\d+$/.test(b.textContent));
const clickPage = (label) => {
  const button = pageButtons().find((b) => b.textContent.includes(label));
  assert.ok(button, `no page control labelled "${label}" is currently shown`);
  dom.get('pagination').dispatch('click', { target: button });
};
const setPageSize = (size) => {
  dom.get('page-size').value = String(size);
  dom.get('page-size').dispatch('change');
};
const setRole = (role) => {
  dom.get('role-filter').value = role;
  dom.get('role-filter').dispatch('change');
};
/**
 * The header markup is static in index.html, which the shim does not parse, so
 * sort clicks are dispatched with a synthetic target carrying the same dataset
 * the real button would. Sort BEHAVIOUR is what these assert; the indicator
 * rendering is markup the shim cannot represent.
 */
const clickSort = (key) => {
  const target = { dataset: { sortKey: key }, disabled: false, closest: () => target };
  dom.get('ledger-head').dispatch('click', { target });
};
const idsOnPage = () => rows().map((r) => cell(r, 'id'));
const clearSort = () => dom.get('sort-chip').dispatch('click');
/** Direction is carried as a class on a drawn mark, not as a text glyph. */
const chipDirection = () => {
  const mark = dom.get('sort-chip').children.find((c) => c.className.startsWith('sort-chip-dir'));
  return mark ? mark.className.replace('sort-chip-dir ', '') : null;
};
const sortedCells = (column) =>
  rows().map((r) => r.children.filter((c) => c.className.includes('is-sorted-col'))).flat();

/**
 * These tests share one application lifecycle by design, so view state carries
 * across them. Any test that cares about the starting view says so rather than
 * inheriting whatever the previous one left behind.
 */
const resetView = ({ filter = 0, role = 'All', pageSize = 25 } = {}) => {
  clearSort();
  setRole(role);
  clickFilter(filter);
  setPageSize(pageSize);
};
const clickFilter = (index) => dom.get('filters').dispatch('click', { target: $('filters').children[index] });
const cell = (row, column) => cellsOf(row)[columns[column]];
const rowFor = (id) => rows().find((r) => cell(r, 'id') === id);
const submit = (amount, currency = 'USD') => {
  $('budget-currency').value = currency;
  $('budget-amount').value = amount;
  $('budget-form').dispatch('submit');
};

test('pageWindow elides long runs and never drops the ends', () => {
  // Up to MAX_PAGES_SHOWN every page is listed. 12 pages is the default view
  // (300 rows at 25 per page), so the common case never elides at all.
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(1, 3), [1, 2, 3]);
  assert.deepEqual(pageWindow(5, 9), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(pageWindow(1, 12), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(pageWindow(7, 12), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  // Beyond that, both ends stay put and a window follows the current page.
  assert.deepEqual(pageWindow(1, 13), [1, 2, 3, null, 12, 13]);
  assert.deepEqual(pageWindow(1, 30), [1, 2, 3, null, 29, 30]);
  assert.deepEqual(pageWindow(15, 30), [1, 2, null, 13, 14, 15, 16, 17, null, 29, 30]);
  assert.deepEqual(pageWindow(30, 30), [1, 2, null, 28, 29, 30]);

  for (const pageCount of [1, 2, 5, 9, 10, 12, 30, 120]) {
    for (let page = 1; page <= pageCount; page++) {
      const window = pageWindow(page, pageCount);
      const numbers = window.filter((n) => n !== null);
      assert.ok(numbers.includes(1) && numbers.includes(pageCount), 'ends always present');
      assert.ok(numbers.includes(page), 'current page always present');
      assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), 'ascending');
      assert.equal(new Set(numbers).size, numbers.length, 'no duplicates');
    }
  }
});

test('renders the first page before any allocation is run', () => {
  assert.equal(rows().length, PAGE_SIZE);
  assert.match($('rows-shown').textContent, /1.25 of 300/);
  assert.equal($('summary').hidden, true);
  assert.equal($('reset-btn').hidden, true);
  assert.equal($('budget-error').hidden, true);
  assert.equal($('idle-prompt').hidden, false, 'a first-time reader is told what to do');
});

test('required columns carry data, allocation columns show a placeholder', () => {
  const first = rowFor('EMP-001');
  assert.equal(cell(first, 'name'), 'Andrew Anderson');
  assert.equal(cell(first, 'role'), 'DevOps Engineer');
  assert.equal(cell(first, 'country'), 'USA');
  assert.ok(cell(first, 'salary').includes('105,500.00'));
  assert.equal(cell(first, 'allocation'), '—');
  assert.equal(cell(first, 'updated'), '—');
});

test('the budget currency selector is built from the currency table, not the markup', () => {
  // Adding a currency to currencies.js must surface here with no HTML change.
  const options = $('budget-currency').children.map((o) => o.value);
  assert.deepEqual(options, [...SUPPORTED_CURRENCIES]);
  assert.equal($('budget-currency').value, 'USD', 'defaults to the base currency');
});

test('offers All plus one filter per country, defaulting to All', () => {
  const buttons = $('filters').children;
  assert.equal(buttons.length, 4);
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
  assert.ok(buttons.slice(1).every((b) => b.getAttribute('aria-pressed') === 'false'));
});

test('the masthead badge states that rates are fixed, with the snapshot date', () => {
  assert.match($('rate-badge').textContent, /rates fixed 2026-08-26/);
});

test('states the exchange-rate assumption, excluding the base currency', () => {
  const text = normaliseSpaces($('rate-provenance').textContent);
  assert.match(text, /fixed snapshot/i);
  assert.match(text, /95\.27 INR/);
  assert.match(text, /16\.94 MXN/);
  assert.ok(!/1 USD = 1\.00 USD/.test(text), 'the base currency needs no rate line');
});

test('the assumptions panel opens from the badge and closes every expected way', () => {
  assert.equal($('assumptions').hidden, true);
  assert.equal($('rate-badge').getAttribute('aria-expanded'), 'false');
  assert.equal($('rate-badge').getAttribute('aria-controls'), 'assumptions');

  $('rate-badge').dispatch('click');
  assert.equal($('assumptions').hidden, false);
  assert.equal($('rate-badge').getAttribute('aria-expanded'), 'true');

  $('rate-badge').dispatch('click');                                  // toggles
  assert.equal($('assumptions').hidden, true);

  $('rate-badge').dispatch('click');
  document.dispatch('click', { target: $('employee-rows') });         // outside click
  assert.equal($('assumptions').hidden, true, 'clicking away dismisses it');

  $('rate-badge').dispatch('click');
  document.dispatch('keydown', { key: 'Escape' });
  assert.equal($('assumptions').hidden, true, 'Escape dismisses it');
  assert.equal(document.activeElement, $('rate-badge'), 'and returns focus to the control');

  document.dispatch('keydown', { key: 'Escape' });                    // harmless when closed
  assert.equal($('assumptions').hidden, true);
});

test('the assumptions panel states the rates, the base currency and the budget range', () => {
  $('rate-badge').dispatch('click');
  const text = normaliseSpaces($('assumptions').textContent);

  assert.match(text, /Exchange rates/);
  assert.match(text, /95\.27 INR/);
  assert.match(text, /16\.94 MXN/);
  assert.match(text, /USD is the base currency/, 'the conversion basis must not be a black box');
  assert.match(text, /snapshot-2026-08-26/, 'the rate-set identifier makes a result traceable');

  // Both bounds come from the engine, so the panel cannot state a limit the
  // allocator does not actually enforce.
  const emp = loadEmployees(EMPLOYEES);
  assert.match(text, /Budget range this demo allocates/);
  for (const currency of SUPPORTED_CURRENCIES) {
    for (const bound of [minimumMeaningfulBudget, maximumMeaningfulBudget]) {
      const shown = toMajorString(bound({ employees: emp, currency }))
        .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      assert.ok(text.includes(shown.split('.')[0].slice(-6)),
        `${currency} bound ${shown} should appear in the panel`);
    }
  }
  assert.match(text, /demo policies, not requirements/, 'the limits are ours, and say so');

  assert.match(text, /Method/);
  assert.match(text, /largest remainder/);
  $('rate-badge').dispatch('click');
});

test('a budget above the cap is refused, naming the limit in the entered currency', () => {
  resetView();
  submit('900,000,000,000', 'INR');

  assert.equal($('budget-error').hidden, false);
  assert.equal($('summary').hidden, true, 'no partial result for a refused allocation');
  assert.equal($('budget-amount').getAttribute('aria-invalid'), 'true');

  const text = normaliseSpaces($('budget-error').textContent);
  assert.match(text, /larger than this demo will allocate/);
  assert.match(text, /100 times existing payroll/);
  assert.match(text, /INR 1,64,81,17,43,731\.40/, 'the limit is stated in the currency entered');
  assert.match(text, /same amount whichever currency/);

  // And the stated limit is itself allocatable.
  submit('164,81,17,43,731.40', 'INR');
  assert.equal($('budget-error').hidden, true);
  assert.equal($('summary').hidden, false);
});

test('the refusal for a tiny budget does not claim the percentage is inapplicable', () => {
  resetView();
  submit('0.01', 'INR');
  const text = normaliseSpaces($('budget-error').textContent);

  assert.match(text, /too small to settle proportionally/);
  assert.match(text, /round to nothing/);
  assert.match(text, /INR 281\.73/);
  // The percentage is exact at any budget; only settlement fails. Claiming
  // otherwise was factually wrong.
  assert.ok(!/same percentage cannot be applied/.test(text));
});

test('a zero budget says there is nothing to reconcile, not that conversion failed', () => {
  resetView();
  submit('0', 'INR');
  const recon = normaliseSpaces($('summary').textContent);

  assert.match(recon, /nothing to reconcile/);
  assert.match(recon, /Every salary is unchanged/);
  // Nothing was converted, so the conversion caveat must not appear.
  assert.ok(!/cannot convert back onto one exact figure/.test(recon));
  assert.ok(!/rounding difference/.test(recon));
});

test('a non-zero allocation reports a rounding difference, not an overspend', () => {
  resetView();
  submit('2,000,000', 'USD');
  const text = normaliseSpaces($('summary').textContent);

  assert.match(text, /rounding difference of USD 0\.002779/);
  assert.match(text, /within the proven bound/);
  assert.match(text, /Every employee received their exact rounded share/);
  // "exceed the entered budget" read as an overspend for a sub-cent artefact.
  assert.ok(!/exceed the entered budget/.test(text));
  assert.ok(!/fall short of the entered budget/.test(text));
  // The updated-payroll card is labelled for what it actually shows.
  assert.match(text, /existing \+ allocated/);
  assert.ok(!/existing \+ additional/.test(text));
});

test('money columns are sized from the longest amount in the whole result', () => {
  resetView();
  submit('2,000,000', 'USD');
  const modest = document.documentElement.style.getPropertyValue('--money-col');
  assert.match(modest, /^\d+ch$/, 'the width is set from the data, not left to a percentage');

  submit('160,000,000,000', 'INR');   // near the cap: much longer amounts
  const huge = document.documentElement.style.getPropertyValue('--money-col');
  assert.ok(parseInt(huge, 10) > parseInt(modest, 10), 'a larger budget must widen the money columns');

  // Filtering must NOT change the width, or the columns would move as the view
  // changes -- the defect fixed by using the whole result rather than the page.
  clickFilter(1);
  assert.equal(document.documentElement.style.getPropertyValue('--money-col'), huge);
  setRole('Data Analyst');
  assert.equal(document.documentElement.style.getPropertyValue('--money-col'), huge);
  resetView();
});

test('the budget field points at its error message for assistive technology', () => {
  assert.equal($('budget-amount').getAttribute('aria-describedby'), 'budget-error');
  assert.equal($('budget-error').getAttribute('role'), 'alert');
});

test('rejects invalid input with a specific message and no allocation', () => {
  // A rejected submission never clears a previous result (D-26), so this test
  // starts from a known empty state rather than inheriting one.
  resetView();
  if (!$('reset-btn').hidden) $('reset-btn').dispatch('click');

  for (const [amount, expected] of [
    ['', /budget amount/i],
    ['-5', /negative/i],
    ['abc', /number/i],
    ['1e9', /notation/i],
    ['1.005', /decimal place/i],
    ['$50', /currency selector/i],
  ]) {
    submit(amount);
    assert.equal($('budget-error').hidden, false, `${amount} should show an error`);
    assert.match($('budget-error').textContent, expected);
    assert.equal($('budget-amount').getAttribute('aria-invalid'), 'true');
    assert.equal($('summary').hidden, true, `${amount} must not produce a summary`);
    assert.equal(cell(rowFor('EMP-001'), 'allocation'), '—');
  }
});

test('refuses a budget too small to apply the rule, and says what would work', () => {
  resetView();
  submit('1', 'INR');

  // Loud: an error, the field marked invalid, and no partial result anywhere.
  assert.equal($('budget-error').hidden, false);
  assert.equal($('budget-amount').getAttribute('aria-invalid'), 'true');
  assert.equal($('summary').hidden, true, 'no summary for a refused allocation');
  assert.equal(cell(rowFor('EMP-001'), 'allocation'), '—', 'ledger stays pre-allocation');
  assert.equal($('reset-btn').hidden, true);

  // Useful: what, why, and the minimum in the currency they chose.
  const text = normaliseSpaces($('budget-error').textContent);
  assert.match(text, /INR 1\.00 is too small/);
  assert.match(text, /300 of 300 employees/);
  assert.match(text, /INR 281\.73/);

  // And the way forward works.
  submit('281.73', 'INR');
  assert.equal($('budget-error').hidden, true);
  assert.equal($('summary').hidden, false);
});

test('a refusal while sorted on an allocation column does not crash the view', () => {
  // Found in review: the refusal path nulled the result but kept the sort, so
  // the next paint sorted pre-allocation rows on a field they do not have. The
  // result is no longer nulled (D-26), which removes the mismatch at its source
  // -- the rows keep the field the sort reads.
  resetView();
  submit('2,000,000', 'USD');
  clickSort('allocation');
  assert.equal($('sort-chip').hidden, false);
  const topBefore = cell(rows()[0], 'id');

  submit('1', 'USD');                       // refused
  assert.equal($('budget-error').hidden, false);
  assert.equal($('sort-chip').hidden, false, 'the sort outlives a rejected submission');
  assert.equal(rows().length, 25, 'the ledger still renders');
  assert.equal(cell(rows()[0], 'id'), topBefore, 'in the order it was already in');
  assert.notEqual(cell(rows()[0], 'allocation'), '\u2014', 'the sorted column still has values');

  // The same holds for a column that does not depend on the allocation.
  clickSort('salary');
  submit('abc', 'USD');
  assert.equal($('sort-chip').hidden, false);
  assert.match($('sort-chip').textContent, /Salary/);
  clearSort();
});

test('the first-run prompt yields to an error message', () => {
  resetView();
  $('reset-btn').dispatch('click');
  assert.equal($('idle-prompt').hidden, false);
  submit('-5');
  assert.equal($('idle-prompt').hidden, true, 'one instruction at a time');
  $('budget-amount').dispatch('input');
  assert.equal($('idle-prompt').hidden, false);
});

test('a rejected submission changes nothing, whichever layer rejects it', () => {
  // The two rejection layers used to disagree: an unreadable amount left the
  // result alone, a refused one discarded it. One rule now covers both (D-26).
  resetView();
  submit('2,000,000', 'USD');
  const summary = $('summary').textContent;
  const allocation = cell(rowFor('EMP-001'), 'allocation');
  assert.equal($('summary').hidden, false);

  for (const [amount, layer] of [['abc', 'validation'], ['1', 'the engine']]) {
    submit(amount, 'USD');
    assert.equal($('budget-error').hidden, false, `${layer} should reject ${amount}`);
    assert.equal($('summary').hidden, false, `${layer} must not discard the result`);
    assert.equal($('summary').textContent, summary, `${layer} must not alter it either`);
    assert.equal(cell(rowFor('EMP-001'), 'allocation'), allocation);
    assert.equal($('reset-btn').hidden, false, 'and the way to clear it stays offered');
  }

  // Reset remains the one action that does clear it.
  $('reset-btn').dispatch('click');
  assert.equal($('summary').hidden, true);
  assert.equal(cell(rowFor('EMP-001'), 'allocation'), '\u2014');
});

test('clears the error state as soon as the field is edited', () => {
  submit('-5');
  assert.equal($('budget-error').hidden, false);
  $('budget-amount').dispatch('input');
  assert.equal($('budget-error').hidden, true);
  assert.equal($('budget-amount').getAttribute('aria-invalid'), null);
});

test('the invalid state is carried by both the field and its group, and always together', () => {
  const invalid = () => ({
    attr: $('budget-amount').getAttribute('aria-invalid') === 'true',
    cls: $('budget-group').classList.contains('is-invalid'),
  });

  submit('-5');                       // validation failure
  assert.deepEqual(invalid(), { attr: true, cls: true });
  $('budget-amount').dispatch('input');
  assert.deepEqual(invalid(), { attr: false, cls: false });

  submit('1', 'INR');                 // engine refusal
  assert.deepEqual(invalid(), { attr: true, cls: true });
  submit('2,000,000', 'USD');         // success clears it
  assert.deepEqual(invalid(), { attr: false, cls: false });

  submit('abc');
  $('reset-btn').hidden = false;      // reset is only shown after a success; force for the check
  submit('2,000,000', 'USD');
  submit('abc');
  $('reset-btn').dispatch('click');   // reset clears it
  assert.deepEqual(invalid(), { attr: false, cls: false });
});

test('runs an allocation and fills the derived columns', () => {
  submit('2,000,000', 'USD');
  assert.equal($('budget-error').hidden, true);
  assert.equal($('summary').hidden, false);
  assert.equal($('reset-btn').hidden, false);
  assert.equal($('idle-prompt').hidden, true, 'the prompt gets out of the way once used');

  const first = rowFor('EMP-001');
  assert.ok(cell(first, 'allocation').includes('12,196.93'));
  assert.ok(cell(first, 'updated').includes('117,696.93'));
  // Salary column is untouched, so original and updated are both visible.
  assert.ok(cell(first, 'salary').includes('105,500.00'));
});

test('shows each salary in its own currency, unambiguously', () => {
  // Intl renders USD and MXN identically as "$1,234.00", so the demo uses the
  // currency code instead (Design.md D-10). Each country lives on its own page,
  // so the filter is used to bring one row of each into view.
  const usd = rowFor('EMP-001');
  clickFilter(2);
  const inr = rows()[0];
  clickFilter(3);
  const mxn = rows()[0];
  clickFilter(0);

  assert.ok(cell(usd, 'salary').startsWith('USD'));
  assert.ok(cell(inr, 'salary').startsWith('INR'));
  assert.ok(cell(mxn, 'salary').startsWith('MXN'));
  for (const row of [usd, inr, mxn]) assert.ok(!cell(row, 'salary').includes('$'));

  // INR uses Indian lakh grouping, not Western thousands grouping.
  assert.match(normaliseSpaces(cell(inr, 'salary')), /^INR \d{1,2},\d\d,\d\d\d\.\d\d$/);
  assert.ok(cell(inr, 'salary').includes(NBSP), 'Intl separates code and number with U+00A0');
});

test('summary reports the four headline figures and discloses the residual', () => {
  const text = $('summary').textContent;
  assert.match(text, /17,299,437\.78/);   // existing payroll, base currency
  assert.match(text, /2,000,000\.00/);    // additional budget as entered
  assert.match(text, /11\.5611%/);        // allocation percentage
  assert.match(text, /19,299,437\.78/);   // updated payroll
  assert.match(text, /[Rr]econcil/);
  assert.match(text, /bound/);
});

test('summary breaks the allocation down by country', () => {
  const text = normaliseSpaces($('summary').textContent);
  for (const country of ['USA', 'India', 'Mexico']) assert.match(text, new RegExp(country));
  assert.match(text, /INR 16,67,70,000\.00/);
  assert.match(text, /MXN 53,775,000\.00/);
});

test('a budget in another currency converts and reports both amounts', () => {
  submit('1,00,00,000', 'INR');
  const text = normaliseSpaces($('summary').textContent);
  assert.match(text, /INR 1,00,00,000\.00/);   // as entered
  assert.match(text, /USD 104,964\.84/);       // converted to base
  assert.match(text, /0\.6068%/);
});

test('filtering changes the view but never the allocation (D-08)', () => {
  submit('2,000,000', 'USD');
  const before = cell(rowFor('EMP-001'), 'allocation');

  $('filters').dispatch('click', { target: $('filters').children[1] });   // USA

  assert.equal(rows().length, PAGE_SIZE);
  assert.match($('rows-shown').textContent, /1.25 of 100/);
  assert.equal($('filters').children[1].getAttribute('aria-pressed'), 'true');
  assert.equal($('filters').children[0].getAttribute('aria-pressed'), 'false');
  assert.ok(rows().every((r) => cell(r, 'country') === 'USA'));

  // The number on the row must be byte-identical to the unfiltered view.
  assert.equal(cell(rowFor('EMP-001'), 'allocation'), before);
});

test('each country filter selects only that country', () => {
  for (const [index, country] of [[2, 'India'], [3, 'Mexico']]) {
    clickFilter(index);
    assert.equal(rows().length, PAGE_SIZE);
    assert.match($('rows-shown').textContent, /of 100/);
    assert.ok(rows().every((r) => cell(r, 'country') === country));
  }
  clickFilter(0);
  assert.match($('rows-shown').textContent, /of 300/);
});

test('paginates without touching a single allocated figure', () => {
  submit('2,000,000', 'USD');
  clickFilter(0);
  setPageSize(25);

  assert.equal(rows().length, 25);
  assert.equal(cell(rows()[0], 'id'), 'EMP-001');
  const onFirstPage = cell(rowFor('EMP-001'), 'allocation');

  clickPage('Next');
  assert.equal(cell(rows()[0], 'id'), 'EMP-026');
  assert.equal(rows().length, 25);

  clickPage('12');
  assert.equal(cell(rows()[rows().length - 1], 'id'), 'EMP-300');
  assert.match($('rows-shown').textContent, /276.300 of 300/);

  clickPage('1');
  assert.equal(cell(rowFor('EMP-001'), 'allocation'), onFirstPage);
});

test('offers direct page numbers with the current one marked', () => {
  clickFilter(0);
  setPageSize(25);
  clickPage('1');

  // The default view is 12 pages, which is listed in full -- no gap marker.
  const labels = numberButtons().map((b) => b.textContent);
  assert.deepEqual(labels, ['1','2','3','4','5','6','7','8','9','10','11','12']);
  assert.ok(!$('pagination').textContent.includes('\u2026'), 'nothing to elide at 12 pages');
  assert.equal(numberButtons().find((b) => b.getAttribute('aria-current') === 'page').textContent, '1');

  clickPage('12');
  assert.equal(numberButtons().find((b) => b.getAttribute('aria-current') === 'page').textContent, '12');
  assert.equal(cell(rows()[0], 'id'), 'EMP-276');

  // At 10 rows the ledger runs to 30 pages, which does elide.
  setPageSize(10);
  assert.ok($('pagination').textContent.includes('\u2026'), 'long runs collapse to a gap marker');
  const many = numberButtons().map((b) => b.textContent);
  assert.ok(many.includes('1') && many.includes('30'), 'both ends stay reachable');
  assert.ok(many.length < 30, 'and the rest are elided');
  setPageSize(25);
  clickPage('1');
});

test('step controls disable at the ends of the range', () => {
  clickFilter(0);
  setPageSize(25);
  clickPage('1');
  const steps = () => pageButtons().filter((b) => /Prev|Next/.test(b.textContent));

  const [prevStart, nextStart] = steps();
  assert.ok(prevStart.disabled, 'Prev disabled on page 1');
  assert.ok(!nextStart.disabled, 'Next enabled on page 1');

  clickPage('12');
  const [prevEnd, nextEnd] = steps();
  assert.ok(!prevEnd.disabled, 'Prev enabled on last page');
  assert.ok(nextEnd.disabled, 'Next disabled on last page');
});

test('rows per page can be changed, keeping the top row in view', () => {
  clickFilter(0);
  setPageSize(25);
  clickPage('1');
  clickPage('Next');
  clickPage('Next');
  assert.equal(cell(rows()[0], 'id'), 'EMP-051');   // page 3 of 25

  setPageSize(10);
  assert.equal(rows().length, 10);
  assert.equal(cell(rows()[0], 'id'), 'EMP-051', 'the row at the top stays at the top');
  assert.match($('rows-shown').textContent, /51.60 of 300/);

  setPageSize(100);
  assert.equal(rows().length, 100);
  assert.equal(cell(rows()[0], 'id'), 'EMP-001');   // 51 falls inside the first 100

  setPageSize(50);
  assert.equal(rows().length, 50);
  setPageSize(25);
});

test('pagination disappears when everything fits on one page', () => {
  clickFilter(2);            // India, 100 rows
  setPageSize(100);
  assert.equal(rows().length, 100);
  assert.equal($('pagination').hidden, true, 'no controls when there is only one page');
  setPageSize(25);
  assert.equal($('pagination').hidden, false);
  clickFilter(0);
});

test('changing the filter returns to the first page', () => {
  clickFilter(0);
  setPageSize(25);
  clickPage('12');
  assert.equal(cell(rows()[0], 'id'), 'EMP-276');

  clickFilter(2);   // India: 100 rows, 4 pages -- page 12 no longer exists
  assert.equal(cell(rows()[0], 'id'), 'EMP-101');
  assert.match($('rows-shown').textContent, /1.25 of 100/);
  clickFilter(0);
});

test('populates the role filter from the data', () => {
  const options = $('role-filter').children.map((o) => o.textContent);
  assert.equal(options[0], 'All roles');
  assert.ok(options.includes('Software Engineer'));
  assert.ok(options.includes('Engineering Manager'));
  assert.equal(new Set(options).size, options.length, 'no duplicate roles');
});

test('role and country filters compose', () => {
  clickFilter(0);
  setRole('Software Engineer');
  setPageSize(100);
  assert.ok(rows().every((r) => cell(r, 'role') === 'Software Engineer'));
  const allEngineers = rows().length;

  clickFilter(2);   // India
  assert.ok(rows().every((r) => cell(r, 'role') === 'Software Engineer' && cell(r, 'country') === 'India'));
  assert.ok(rows().length < allEngineers);

  clickFilter(0);
  setRole('All');
  setPageSize(25);
});

test('country counts respect the active role filter', () => {
  clickFilter(0);
  setRole('All');
  const before = $('filters').children[1].textContent;   // USA

  setRole('Software Engineer');
  const after = $('filters').children[1].textContent;
  assert.notEqual(before, after, 'a count that ignored the role filter would contradict the table');

  setRole('All');
});

test('sorts salary across currencies by value, not by digit count', () => {
  clickFilter(0);
  setRole('All');
  setPageSize(25);
  submit('2,000,000', 'USD');

  clickSort('salary');   // first press: highest first
  // INR figures are ~95x larger numerically. Sorting raw minor units would put
  // every Indian salary on top; sorting by converted value must not.
  assert.equal(cell(rows()[0], 'id'), 'EMP-074');
  assert.equal(cell(rows()[0], 'country'), 'USA');
  assert.ok(cell(rows()[0], 'salary').includes('231,000.00'));

  clickSort('salary');   // second press reverses
  // The smallest salary by VALUE is Indian (INR 5,80,000 = USD 6,087.96), not
  // the smallest USD figure. Sorting on the raw number would never find it.
  assert.equal(cell(rows()[0], 'id'), 'EMP-138');
  assert.equal(cell(rows()[0], 'country'), 'India');
});

test('sorting is view-only and leaves allocations untouched', () => {
  // USA at 100 rows per page is a single page, so a given employee stays on
  // screen whatever the sort does to the ordering.
  setRole('All');
  clickFilter(1);
  setPageSize(100);
  submit('2,000,000', 'USD');

  const before = new Map(rows().map((r) => [cell(r, 'id'), cell(r, 'allocation')]));
  assert.equal(before.size, 100);

  clickSort('salary');
  clickSort('allocation');
  clickSort('name');

  const after = new Map(rows().map((r) => [cell(r, 'id'), cell(r, 'allocation')]));
  assert.equal(after.size, before.size, 'sorting must not add or drop rows');
  for (const [id, allocation] of before) {
    assert.equal(after.get(id), allocation, `${id} changed under sorting`);
  }

  clickSort('name');   // leave the sort in a known state
  setPageSize(25);
  clickFilter(0);
});

test('sorting is deterministic across repeated runs', () => {
  clickFilter(0);
  setRole('All');
  submit('2,000,000', 'USD');
  clickSort('salary');
  const first = idsOnPage().join(',');
  for (let i = 0; i < 5; i++) {
    clickSort('salary');   // desc -> asc
    clickSort('salary');   // asc -> desc
    assert.equal(idsOnPage().join(','), first, `run ${i} diverged`);
  }
});

test('the active sort is shown and can be cleared', () => {
  resetView();
  submit('2,000,000', 'USD');

  // No sort applied: nothing to state, nothing to clear.
  assert.equal($('sort-chip').hidden, true);
  const defaultOrder = idsOnPage();
  assert.equal(defaultOrder[0], 'EMP-001');

  clickSort('salary');
  assert.equal($('sort-chip').hidden, false, 'an active sort must be visible somewhere');
  assert.match($('sort-chip').textContent, /Sorted: Salary/);
  assert.equal(chipDirection(), 'is-desc', 'and must state its direction');
  assert.match($('sort-chip').getAttribute('aria-label'), /Clear sort by Salary, descending/);
  assert.notDeepEqual(idsOnPage(), defaultOrder);

  clickSort('salary');   // reverse
  assert.equal(chipDirection(), 'is-asc');
  assert.match($('sort-chip').getAttribute('aria-label'), /ascending/);

  clearSort();
  assert.equal($('sort-chip').hidden, true);
  assert.deepEqual(idsOnPage(), defaultOrder, 'clearing restores the default Employee_ID order');
});

test('the sorted column is marked through the whole table', () => {
  resetView();
  submit('2,000,000', 'USD');
  assert.equal(sortedCells().length, 0, 'nothing is marked when nothing is sorted');

  clickSort('salary');
  // One tinted cell per visible row, and it is the salary cell.
  assert.equal(sortedCells().length, rows().length);
  for (const row of rows()) {
    const marked = row.children.filter((c) => c.className.includes('is-sorted-col'));
    assert.equal(marked.length, 1);
    assert.equal(marked[0].textContent, cell(row, 'salary'));
  }

  clickSort('allocation');
  for (const row of rows()) {
    const marked = row.children.filter((c) => c.className.includes('is-sorted-col'));
    assert.equal(marked[0].textContent, cell(row, 'allocation'));
  }

  clearSort();
  assert.equal(sortedCells().length, 0);
});

test('clearing the sort returns to the first page', () => {
  resetView();
  submit('2,000,000', 'USD');
  clickSort('salary');
  clickPage('5');
  assert.match($('rows-shown').textContent, /101.125 of 300/);

  clearSort();
  assert.match($('rows-shown').textContent, /1.25 of 300/);
  assert.equal(idsOnPage()[0], 'EMP-001');
});

test('the chip disappears when Reset drops an allocation-derived sort', () => {
  resetView();
  submit('2,000,000', 'USD');
  clickSort('allocation');
  assert.equal($('sort-chip').hidden, false);

  $('reset-btn').dispatch('click');
  assert.equal($('sort-chip').hidden, true, 'the sort went with the allocation, so the chip must too');
  assert.equal(idsOnPage()[0], 'EMP-001');
});

test('a sort on a column that survives Reset keeps its chip', () => {
  resetView();
  submit('2,000,000', 'USD');
  clickSort('salary');            // salary exists with or without an allocation
  $('reset-btn').dispatch('click');
  assert.equal($('sort-chip').hidden, false);
  assert.match($('sort-chip').textContent, /Sorted: Salary/);
  clearSort();
});

test('re-sorting returns to the first page', () => {
  resetView();
  submit('2,000,000', 'USD');

  // 12 pages, so page 3 is inside the initial window; page 4 is not.
  clickPage('3');
  assert.match($('rows-shown').textContent, /51.75 of 300/);

  clickSort('salary');
  assert.match($('rows-shown').textContent, /1.25 of 300/, 'a re-sort makes the old page number meaningless');
});

test('reset returns the page to its pre-allocation state', () => {
  clickFilter(0);
  setRole('All');
  setPageSize(25);
  submit('2,000,000', 'USD');
  clickSort('allocation');
  $('reset-btn').dispatch('click');

  assert.equal($('summary').hidden, true);
  assert.equal($('reset-btn').hidden, true);
  assert.equal($('budget-amount').value, '');
  assert.equal($('budget-error').hidden, true);
  assert.equal(rows().length, 25);
  assert.match($('rows-shown').textContent, /1.25 of 300/);
  // A sort on an allocation-derived column is dropped with the allocation, so
  // the ledger returns to its natural order.
  assert.equal(cell(rows()[0], 'id'), 'EMP-001');
  assert.equal(cell(rowFor('EMP-001'), 'allocation'), '—');
  assert.ok(cell(rowFor('EMP-001'), 'salary').includes('105,500.00'));
});
