/**
 * Architectural fitness functions.
 *
 * These assert properties of the codebase rather than of its output. The
 * no-float rule (Design.md D-01) is the kind of constraint that erodes quietly
 * during a refactor, so it is enforced by the suite rather than by reviewer
 * vigilance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Comments explain why floats are unsafe; they must not trip the check itself. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const readSource = (relative) => stripComments(readFileSync(join(ROOT, relative), 'utf8'));

const MONEY_PATH = [
  ...readdirSync(join(ROOT, 'src/core')).map((f) => `src/core/${f}`),
  'src/ui/format.js',
];

test('no floating-point entry points exist in the money path', () => {
  const forbidden = [
    [/\bparseFloat\s*\(/, 'parseFloat'],
    [/\bparseInt\s*\(/, 'parseInt'],
    [/\bNumber\s*\(/, 'Number()'],
    [/\.toFixed\s*\(/, '.toFixed()'],
    [/\bMath\.(round|floor|ceil|abs)\s*\(/, 'Math rounding'],
  ];

  for (const file of MONEY_PATH) {
    const source = readSource(file);
    for (const [pattern, label] of forbidden) {
      assert.ok(
        !pattern.test(source),
        `${file} uses ${label}. Money must stay exact — see Design.md D-01.`,
      );
    }
  }
});

test('the core engine has no DOM dependency, so it runs under Node', () => {
  for (const file of MONEY_PATH.filter((f) => f.startsWith('src/core/'))) {
    const source = readSource(file);
    for (const global of ['document', 'window', 'navigator', 'localStorage']) {
      assert.ok(
        !new RegExp(`\\b${global}\\b`).test(source),
        `${file} references ${global}; the engine must stay environment-free.`,
      );
    }
  }
});

test('the project has no runtime dependencies', () => {
  const files = readdirSync(ROOT);
  assert.ok(!files.includes('node_modules'), 'node_modules should not exist (Design.md D-11)');
  if (files.includes('package.json')) {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.deepEqual(pkg.dependencies ?? {}, {}, 'no runtime dependencies');
  }
});

test('exchange rates are declared in exactly one place', () => {
  // A second rate table is how a demo starts disagreeing with itself.
  const offenders = [];
  for (const file of MONEY_PATH.concat(['src/ui/render.js', 'src/ui/app.js'])) {
    if (file.endsWith('rates.js')) continue;
    if (/95\.27|9527|16\.94|1694/.test(readSource(file))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'rate values must live only in src/core/rates.js');
});
