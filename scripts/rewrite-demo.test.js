const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('../evals/rewrite/demo.json');

// Explicit regression checks, not a general semantic preservation validator.
function violations(output) {
  return [
    ...fixture.required_facts.filter(x => !new RegExp(x.pattern, 'i').test(output)).map(x => `missing:${x.id}`),
    ...fixture.forbidden_additions.filter(x => new RegExp(x.pattern, 'i').test(output)).map(x => `added:${x.id}`),
  ];
}
const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
const demo = readme.split('## Quick demo\n')[1].split('\n## ')[0];
assert.equal(demo.match(/\*\*Input:\*\*\n> (.+)/)[1], fixture.source);
assert.deepEqual(violations(demo.match(/\*\*Output:\*\*\n> (.+)/)[1]), []);
for (const output of fixture.acceptable_outputs) assert.deepEqual(violations(output), []);
for (const {output, reason} of fixture.rejected_outputs) assert.ok(violations(output).length, reason);
console.log('README demo fidelity checks passed (case-specific constraints only).');
