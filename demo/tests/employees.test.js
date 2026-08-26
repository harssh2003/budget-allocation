import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPLOYEES } from '../src/data/employees.js';
import { loadEmployees, DatasetError, REQUIRED_FIELDS } from '../src/core/employees.js';

const valid = { Name: 'A', Employee_ID: 'EMP-001', Role: 'Engineer', Country: 'USA', Salary: 100000 };

test('the shipped dataset loads and matches the brief', () => {
  const rows = loadEmployees(EMPLOYEES);
  assert.equal(rows.length, 300);
  for (const country of ['USA', 'India', 'Mexico']) {
    assert.equal(rows.filter((r) => r.Country === country).length, 100);
  }
  assert.equal(new Set(rows.map((r) => r.Employee_ID)).size, 300);
});

test('every required column is present on every record', () => {
  for (const record of EMPLOYEES) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(record[field] !== undefined && record[field] !== '', `${record.Employee_ID} missing ${field}`);
    }
  }
});

test('country and currency agree throughout', () => {
  const expected = { USA: 'USD', India: 'INR', Mexico: 'MXN' };
  for (const row of loadEmployees(EMPLOYEES)) {
    assert.equal(row.Currency, expected[row.Country], row.Employee_ID);
    assert.equal(row.salary.currency, expected[row.Country]);
  }
});

test('salaries become exact minor units', () => {
  const rows = loadEmployees([valid]);
  assert.equal(rows[0].salary.minor, 10000000n);   // 100,000.00 USD
  assert.equal(typeof rows[0].salary.minor, 'bigint');
});

test('rejects a malformed dataset and reports every problem at once', () => {
  assert.throws(() => loadEmployees([]), DatasetError);
  assert.throws(() => loadEmployees('nope'), DatasetError);

  const bad = [
    { ...valid, Employee_ID: 'EMP-001' },
    { ...valid, Employee_ID: 'EMP-001' },                       // duplicate id
    { ...valid, Employee_ID: 'EMP-003', Country: 'Canada' },    // unsupported country
    { ...valid, Employee_ID: 'EMP-004', Currency: 'EUR' },      // currency contradicts country
    { ...valid, Employee_ID: 'EMP-005', Salary: -1 },           // negative
    { ...valid, Employee_ID: 'EMP-006', Salary: 1.5 },          // sub-unit precision
    { ...valid, Employee_ID: 'EMP-007', Salary: 'lots' },       // wrong type
    { ...valid, Employee_ID: 'EMP-008', Salary: Number.NaN },
    { ...valid, Employee_ID: 'EMP-009', Salary: Number.MAX_SAFE_INTEGER + 2 },
    { ...valid, Employee_ID: 'EMP-010', Role: '' },             // empty required field
    { ...valid, Employee_ID: 11 },                              // numeric id...
    { ...valid, Employee_ID: '11' },                            // ...and its string twin
  ];

  try {
    loadEmployees(bad);
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof DatasetError);
    // All violations are collected, not just the first.
    assert.equal(error.problems.length, 10);
    assert.match(error.message, /duplicate Employee_ID/);
    assert.match(error.message, /unsupported Country/);
    assert.match(error.message, /does not match Country/);
  }
});

test('an unsafe salary is refused rather than silently rounded', () => {
  // Beyond 2^53 the value has already lost precision before it reaches us.
  assert.throws(
    () => loadEmployees([{ ...valid, Salary: Number.MAX_SAFE_INTEGER + 2 }]),
    /must be a safe whole number/,
  );
});
