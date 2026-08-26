/**
 * Employee dataset loading and integrity validation.
 *
 * The raw dataset arrives as JSON with Salary as a JavaScript number. This is
 * the boundary where it becomes exact Money, and it is the only place that
 * conversion is allowed to happen. Everything downstream works in BigInt
 * minor units.
 *
 * The dataset is checked rather than trusted. A demo whose numbers are wrong
 * because a row was malformed is worse than one that refuses to start, so
 * every violation is collected and reported together.
 */

import { COUNTRY_CURRENCY, currencyMeta, minorPerMajor } from './currencies.js';
import { money } from './money.js';

export const REQUIRED_FIELDS = Object.freeze(['Name', 'Employee_ID', 'Role', 'Country', 'Salary']);

export class DatasetError extends Error {
  constructor(problems) {
    super(`Employee dataset failed validation (${problems.length} problem(s)):\n  - ${problems.join('\n  - ')}`);
    this.name = 'DatasetError';
    this.problems = problems;
  }
}

/**
 * Validate and normalise raw employee records into rows carrying exact Money.
 *
 * @param {Array<Record<string, unknown>>} raw
 * @returns {Array<{Name:string,Employee_ID:string,Role:string,Country:string,Currency:string,salary:{currency:string,minor:bigint}}>}
 */
export function loadEmployees(raw) {
  if (!Array.isArray(raw)) throw new DatasetError(['dataset is not an array']);
  if (raw.length === 0) throw new DatasetError(['dataset is empty']);

  const problems = [];
  const seenIds = new Set();
  const rows = [];

  raw.forEach((rec, index) => {
    const where = `row ${index}${rec && rec.Employee_ID ? ` (${rec.Employee_ID})` : ''}`;

    for (const field of REQUIRED_FIELDS) {
      if (rec == null || rec[field] === undefined || rec[field] === null || rec[field] === '') {
        problems.push(`${where}: missing required field "${field}"`);
        return;
      }
    }

    const { Name, Employee_ID, Role, Country, Salary } = rec;

    // Compared as strings, so a numeric 1 and a string "1" cannot both pass.
    const id = String(Employee_ID);
    if (seenIds.has(id)) {
      problems.push(`${where}: duplicate Employee_ID`);
      return;
    }
    seenIds.add(id);

    const currency = COUNTRY_CURRENCY[Country];
    if (!currency) {
      problems.push(`${where}: unsupported Country ${JSON.stringify(Country)}`);
      return;
    }

    // The dataset carries a Currency column. If present it must agree with the
    // country, otherwise the two sources of truth have diverged.
    if (rec.Currency !== undefined && rec.Currency !== currency) {
      problems.push(`${where}: Currency ${JSON.stringify(rec.Currency)} does not match Country ${Country} (expected ${currency})`);
      return;
    }

    if (typeof Salary !== 'number' || !Number.isFinite(Salary)) {
      problems.push(`${where}: Salary must be a finite number, got ${JSON.stringify(Salary)}`);
      return;
    }
    if (Salary < 0) {
      problems.push(`${where}: Salary must not be negative (${Salary})`);
      return;
    }
    if (!Number.isSafeInteger(Salary)) {
      // Salaries in this dataset are whole major units. A non-integer would mean
      // the source data has sub-unit precision we would silently discard, and a
      // value beyond 2^53 would already have lost precision before reaching us.
      problems.push(`${where}: Salary must be a safe whole number of ${currency}, got ${Salary}`);
      return;
    }

    rows.push(Object.freeze({
      Name: String(Name),
      Employee_ID: String(Employee_ID),
      Role: String(Role),
      Country: String(Country),
      Currency: currency,
      salary: money(currency, BigInt(Salary) * minorPerMajor(currency)),
    }));
  });

  if (problems.length > 0) throw new DatasetError(problems);
  return rows;
}
