'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { TYPE_LABELS } = require('../detector/patterns');
const { flatten } = require('./flatten-skill');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'references/patterns.md'), 'utf8');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'evals/rewrite/editorial-cards-206.json'), 'utf8'));

// This checks the readable pilot's IDs, mapping and contrasting examples;
// it does not judge semantic quality or execute an editing rule engine.
function check(text, cases = fixtures.cases) {
  const cards = [...text.matchAll(/\*\*Editorial decision card: `(ec-[a-z-]+)`\*\*\n([\s\S]*?)(?=\n\*\*Editorial decision card:|\n### |\n## |$)/g)];
  assert(cards.length >= 12 && cards.length <= 15, 'pilot must stay bounded');
  const ids = cards.map(c => c[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate editorial rule ID');
  for (const [, id, body] of cards) {
    for (const label of ['Apply', 'Edit', 'Keep', 'Flag a gap']) {
      assert.match(body, new RegExp(`^- \\*\\*${label}:\\*\\* \\S`, 'm'), `${id}: missing ${label}`);
    }
    const mapping = body.match(/^\*\*Detector types:\*\* (.+)$/m);
    assert(mapping, `${id}: missing detector mapping`);
    const types = [...mapping[1].matchAll(/`([^`]+)`/g)].map(m => m[1]);
    for (const type of types) assert(Object.hasOwn(TYPE_LABELS, type), `${id}: unknown detector type ${type}`);
    if (!mapping[1].startsWith('none ')) {
      assert(types.length, `${id}: explicit mapping required`);
    }
    const pairedCases = cases.filter(c => c.rule_id === id);
    assert(pairedCases.some(c => c.decision === 'edit'), `${id}: missing edit task`);
    assert(pairedCases.some(c => c.decision === 'keep'), `${id}: missing preserve task`);
  }
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length, 'duplicate fixture ID');
  for (const c of cases.filter(c => c.rule_id !== undefined)) {
    assert(ids.includes(c.rule_id), `${c.id}: unknown editorial rule ID ${c.rule_id}`);
  }
  return cards;
}
const cards = check(source);
for (const mutation of [
  source.replace('`ec-meaningful-actually`', '`ec-supported-contrast`'),
  source.replace('**Detector types:** `negative-parallelism`', '**Detector types:** `invented-detector`'),
  source.replace('- **Keep:**', '- **Dropped keep example:**'),
  source.replace('- **Flag a gap:**', '- **Dropped gap guard:**'),
  source.replace('`hollow-intensifier` does not cover this word', '`invented-detector` does not cover this word'),
  source.replace('`hollow-intensifier` does not cover this word', '`Hollow-Intensifier` does not cover this word'),
  source.replace('`hollow-intensifier` does not cover this word', '`invented_detector` does not cover this word'),
]) assert.throws(() => check(mutation), 'mutation must fail the card contract');
assert.throws(() => check(source, [...fixtures.cases, fixtures.cases[0]]), /duplicate fixture ID/);
assert.throws(() => check(source, [...fixtures.cases,
  { ...fixtures.cases[0], id: 'orphan-fixture', rule_id: 'ec-unknown' }]), /unknown editorial rule ID/);
for (const [, , body] of cards) assert(flatten(root).includes(body), 'portable artifact must retain the whole card');
const existing = JSON.parse(fs.readFileSync(path.join(root, 'evals/rewrite/cases.json'), 'utf8'));
for (const c of fixtures.cases.filter(c => c.existing_case_id)) {
  const original = existing.find(x => x.id === c.existing_case_id);
  assert(original && original.split === 'development', 'do not expose a held-out case as a development probe');
  assert.equal(c.source, original.source, 'reused input must remain exact');
}
// Retained development receipts are historical evidence, not a live semantic
// grading rule. Check completeness, frozen hashes and the claimed exact-scope
// invariants without turning these wordings into preferred future rewrites.
const report = path.join(root, 'evals/rewrite/reports/editorial-cards-206-2026-10-15/followup');
const readJson = file => JSON.parse(fs.readFileSync(path.join(report, file), 'utf8'));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const method = readJson('method-frozen.json');
for (const file of ['inputs', 'expectations']) {
  assert.equal(sha(fs.readFileSync(path.join(report, `${file}.json`))), method[`${file}_sha256`]);
}
const inputs = readJson('inputs.json');
const snapshots = readJson('sources.json');
for (const arm of ['A', 'B']) {
  assert.equal(snapshots[arm].local_source_commit, method.conditions[arm]);
  for (const source of Object.values(snapshots[arm].sources)) {
    assert.equal(sha(fs.readFileSync(path.join(report, source.path))), source.sha256);
  }
  const rows = readJson(`${arm}-responses.json`);
  assert.equal(rows.length, inputs.length);
  assert.deepEqual(rows.map(r => r.id).sort(), inputs.map(r => r.id).sort());
  for (const row of rows) {
    assert(row.final_text && row.response.includes(row.final_text), 'complete response must contain the reported final artifact');
  }
  const scope = rows.find(r => r.id === 'technical-03').final_text;
  const original = inputs.find(r => r.id === 'technical-03').source;
  assert(scope.startsWith(original.split('. ')[0] + '. '), 'untargeted first sentence changed');
  assert(scope.endsWith('The active account is not necessarily the right one.'), 'untargeted final sentence changed');
  assert.equal(rows.find(r => r.id === 'personal-03').final_text,
    inputs.find(r => r.id === 'personal-03').source, 'reported punctuation-only no-op must be exact');
}
const review = readJson('blind-review.json');
assert.equal(review.length, inputs.length);
assert.deepEqual(review.map(r => r.task).sort((a, b) => a - b), inputs.map((_, i) => i + 1));
for (const row of review) for (const arm of ['X', 'Y']) {
  for (const field of ['preservation_failure', 'unnecessary_edit', 'missed_justified_edit', 'reporting_failure']) {
    assert.equal(typeof row[arm][field], 'boolean');
  }
}
console.log(`${cards.length} editorial cards: IDs, mappings, paired tasks, portability and nine mutation controls passed; no model-quality claim.`);
