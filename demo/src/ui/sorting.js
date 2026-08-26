/**
 * Table sorting. A view concern: sorting reorders rows on screen and never
 * touches an allocated figure (Design.md D-08).
 *
 * The subtlety is comparing money ACROSS currencies. Sorting on raw minor units
 * would rank INR 10,40,000 above USD 105,500 purely because the number is
 * larger -- every Indian employee would float to the top of a "highest salary"
 * sort and the column would be quietly meaningless. Comparison therefore runs on
 * the exact base-currency value of each amount.
 *
 * This is not the per-row conversion that D-04 avoids. That rule is about the
 * money PATH: no displayed or allocated figure is derived from these values.
 * They are sort keys only, computed exactly and then discarded.
 */

import { toBaseRational } from '../core/rates.js';
import { compare as compareRational } from '../core/rational.js';

/** Columns that can be sorted, and how. */
export const SORTABLE = Object.freeze({
  name: { label: 'Name', numeric: false, needsAllocation: false },
  salary: { label: 'Salary', numeric: true, needsAllocation: false },
  allocation: { label: 'Allocation', numeric: true, needsAllocation: true },
  updated: { label: 'Updated salary', numeric: true, needsAllocation: true },
});

const MONEY_OF = {
  salary: (row) => row.salary,
  allocation: (row) => row.allocation,
  updated: (row) => row.updatedSalary,
};

function compareByColumn(a, b, column) {
  if (column === 'name') return a.Name.localeCompare(b.Name, 'en');
  const pick = MONEY_OF[column];
  return compareRational(toBaseRational(pick(a)), toBaseRational(pick(b)));
}

/**
 * @param {Array} rows
 * @param {{column: string|null, direction: 'asc'|'desc'}} sort
 * @returns {Array} a new array; the input is never mutated
 */
export function sortRows(rows, sort) {
  if (!sort || !sort.column || !SORTABLE[sort.column]) return rows;

  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const byColumn = compareByColumn(a, b, sort.column);
    if (byColumn !== 0) return byColumn * sign;
    // Employee_ID breaks ties so the order is identical on every run, whatever
    // the engine's sort implementation does with equal keys.
    return a.Employee_ID < b.Employee_ID ? -1 : 1;
  });
}

/** Clicking a column: first press sorts most-useful-first, second reverses. */
export function nextSort(current, column) {
  const meta = SORTABLE[column];
  if (!meta) return current;
  if (current.column === column) {
    return { column, direction: current.direction === 'desc' ? 'asc' : 'desc' };
  }
  return { column, direction: meta.numeric ? 'desc' : 'asc' };
}
