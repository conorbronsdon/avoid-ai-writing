'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSample, serialize } = require('./vale-export-sample');
const detector = require('../detector/patterns');
const source = fs.readFileSync(path.join(__dirname, '../detector/patterns.js'), 'utf8');
const fixtureDir = path.join(__dirname, 'fixtures/vale-export-94');
const sample = buildSample(source);

assert.equal(serialize(sample), fs.readFileSync(path.join(fixtureDir, 'sample.json'), 'utf8'), 'sample bytes drifted');
assert.equal(serialize(buildSample(source.replace(/\r?\n/g, '\r\n'))), serialize(sample), 'CRLF must reproduce LF output');
assert.equal(serialize(buildSample(source)), serialize(sample), 'repeat export must be deterministic');
assert.throws(() => buildSample(source + '\n'), /Pinned detector source changed/);
assert.throws(() => buildSample(source.replace('utm_source=', 'utm_campaign=')), /Pinned detector source changed/);
function checkFrozen(value) {
  assert(Object.isFrozen(value), 'every exported object and array must be frozen');
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') checkFrozen(child);
  }
}
checkFrozen(sample);
assert.throws(() => { sample.rules[0].patterns[0].source = 'changed'; }, TypeError);
assert.deepEqual(sample.rules.map(rule => rule.type), ['ai-utm-source'], 'sample must stay bounded');
assert(Object.hasOwn(detector.TYPE_LABELS, sample.rules[0].type), 'preserve existing detector type');

const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'cases.json'), 'utf8'));
assert.equal(fixture.type, sample.rules[0].type);
for (const entry of fixture.cases) {
  const raw = sample.rules[0].patterns.some(pattern => new RegExp(pattern.source, pattern.flags).test(entry.text));
  const actual = detector.analyzeText(entry.text, { sourceMode: 'plain', contextMode: 'general' })
    .issues.some(issue => issue.type === fixture.type);
  assert.equal(raw, entry.raw, `${entry.id}: raw JS regex`);
  assert.equal(actual, entry.detector, `${entry.id}: real detector`);
}
console.log(`Vale export proposal: snapshot, pin, recursive freeze and ${fixture.cases.length} compatibility cases passed`);
