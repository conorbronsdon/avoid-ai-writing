'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

/** Default `npm test` suites, in run order. */
const SUITES = [
  'scripts/flatten-skill.test.js',
  'detector/patterns.test.js',
  'detector/categories.test.js',
  'detector/validate.test.js',
  'scripts/corpus.test.js',
  'scripts/check-style.test.js',
  'scripts/normalize-quotes.test.js',
  'scripts/fp-measure.test.js',
  'scripts/self-scan.test.js',
  'scripts/test-canonical-skill-package.js',
  'bin/avoid-ai-writing.test.js',
  'bin/avoid-ai-writing-gate.test.js',
  'scripts/rewrite-demo.test.js',
  'scripts/rewrite-eval.test.js',
  'scripts/fp-measure-cli.test.js',
];

function resolveSuite(arg) {
  const abs = path.isAbsolute(arg) ? arg : path.join(root, arg);
  return path.relative(root, abs);
}

function main() {
  const selected = process.argv.slice(2);
  const suites = selected.length ? selected.map(resolveSuite) : SUITES;
  const results = [];

  for (const rel of suites) {
    const abs = path.join(root, rel);
    const child = spawnSync(process.execPath, [abs], { cwd: root, stdio: 'inherit' });
    const status = child.status == null ? 1 : child.status;
    results.push({ rel, ok: status === 0, status });
  }

  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log(`Test summary: ${results.length - failed.length} passed, ${failed.length} failed`);
  for (const r of results) {
    console.log(`  ${r.ok ? 'ok' : 'FAIL'}  ${r.rel}${r.ok ? '' : ` (exit ${r.status})`}`);
  }

  process.exit(failed.length ? 1 : 0);
}

main();
