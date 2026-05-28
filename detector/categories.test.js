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

if (failed > 0) {
  console.error(`\n${failed} contract check(s) failed.`);
  process.exit(1);
}
console.log('\nCATEGORIES.md contract holds.');
