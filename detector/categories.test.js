/**
 * Avoid AI Writing — CATEGORIES.md anti-drift contract test
 *
 * CATEGORIES.md is the map between SKILL.md rules and detector `type`s. A map
 * that nothing checks rots — so this test makes the contract executable:
 *
 *   - every detector `type` (TYPE_LABELS key) must be documented in CATEGORIES.md
 *   - every detector `type` referenced in the CATEGORIES.md tables must be real
 *
 * Add a detector type without documenting it → this fails. Rename/remove a type
 * and leave a stale row → this fails. Dependency-free; runs on node >= 18.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AIDetector = require('./patterns.js');

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

const typeKeys = Object.keys(AIDetector.TYPE_LABELS);
const md = fs.readFileSync(path.join(__dirname, 'CATEGORIES.md'), 'utf8');

// Type tokens claimed in the first column of any table row, excluding the
// literal header token `type` and markdown separators. A stray mention in
// prose doesn't count — a type has to land in an actual mapping-table row.
const tableTypes = new Set();
for (const line of md.split('\n')) {
  if (!line.startsWith('|')) continue;
  const firstCell = line.split('|')[1] || '';
  if (/^[\s:-]+$/.test(firstCell)) continue; // separator row
  for (const m of firstCell.matchAll(/`([a-z0-9][a-z0-9-]*)`/g)) {
    if (m[1] !== 'type') tableTypes.add(m[1]);
  }
}

console.log('CATEGORIES.md anti-drift contract');
console.log(`  (${typeKeys.length} detector types, ${tableTypes.size} documented in tables)`);

test('every detector type is documented in a CATEGORIES.md table', () => {
  const missing = typeKeys.filter((k) => !tableTypes.has(k));
  assert.deepEqual(
    missing,
    [],
    `detector types missing from CATEGORIES.md tables: ${missing.join(', ')}`
  );
});

test('every type referenced in the tables is a real detector type', () => {
  const keySet = new Set(typeKeys);
  const stale = [...tableTypes].filter((t) => !keySet.has(t));
  assert.deepEqual(
    stale,
    [],
    `CATEGORIES.md references types that no longer exist: ${stale.join(', ')}`
  );
});

// The engine's `type` total is a DERIVED fact: the true value is
// TYPE_LABELS.length, and every sentence that states a number is a copy of it.
// Copies rot. The README sat at 45 through the two releases that took the real
// total to 47, because nothing compared the prose to the code. This test has
// the true value in hand already, so it is the cheapest place to compare.
//
// Each site is a file plus a regex with ONE capture group around the number.
// A regex that stops matching FAILS rather than passing: a reworded sentence
// has to re-register here instead of silently dropping its own guard. That is
// the same rule scripts/check-pattern-count.sh applies to its README bullets.
//
// Do not add a site that floors or approximates the number ("40+ categories").
// A floored number is a looser fact and would fail on every release.
const COUNT_SITES = [
  ['../README.md', /engine implements (\d+) `type` categories/],
  ['CATEGORIES.md', /engine exposes (\d+) issue `type`s/],
  ['CATEGORIES.md', /the engine's \*\*(\d+) `type`s\*\*/],
];

// One test per site, so breaking three sites reports three failures rather
// than aborting on the first.
for (const [rel, regex] of COUNT_SITES) {
  test(`${rel} states the engine type total, and it matches TYPE_LABELS (${regex.source.slice(0, 28)}…)`, () => {
    const text = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    const matches = [...text.matchAll(new RegExp(regex.source, 'g'))];
    assert.ok(
      matches.length,
      `${rel}: ${regex} no longer matches — the sentence was reworded or ` +
        'removed. Re-point COUNT_SITES in this file at the new wording, or ' +
        'drop the entry only if the number is gone from that file entirely.'
    );
    // Deliberately NOT asserting the regex matches exactly once. This repo
    // records corrections by quoting the superseded wording (see the 3.22.0
    // CHANGELOG entry), so a quoted historical number is an expected, correct
    // thing to find in a guarded file — and README.md's live statement is
    // itself inside a blockquote, so filtering quotes out removes the site.
    // A uniqueness assert therefore reddens a repo with no drift in it, which
    // is worse than the hole it closes: each regex is anchored on distinctive
    // backtick-and-bold syntax, and the value assertion below is the real
    // check. Keep new sites specific enough that the first match is the live
    // one.
    assert.equal(
      Number(matches[0][1]),
      typeKeys.length,
      `${rel} (${regex.source}) says ${matches[0][1]} detector types, ` +
        `TYPE_LABELS has ${typeKeys.length}`
    );
  });
}

if (failed > 0) {
  console.error(`\n${failed} contract check(s) failed.`);
  process.exit(1);
}
console.log('\nCATEGORIES.md contract holds.');
