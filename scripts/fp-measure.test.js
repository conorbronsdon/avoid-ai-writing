#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const AIDetector = require('../detector/patterns.js');
const { normalizeUnit, unitsForText } = require('./fp-measure.js');

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

console.log('\nfalse-positive measurement preprocessing\n');

const filler = [
  'The team compared the migration results across three production hosts.',
  'Each host completed the rollback without a retry or a dropped request.',
  'The report includes timestamps, query counts, and the observed recovery time.',
  'Those details give reviewers enough context to reproduce the comparison later.',
  'The final section records the remaining questions for the next deployment.',
].join(' ');

test('normalization preserves heading boundaries and normalizes surrounding spaces', () => {
  const normalized = normalizeUnit(`Opening line.\r\n\r\n  Interesting part of the project:  \r\n\r\n${filler}`);
  assert.ok(normalized.includes('\n\nInteresting part of the project:\n\n'));
});

test('normalization joins a colon-ended hard wrap with a lowercase continuation', () => {
  const normalized = normalizeUnit('Between me and the other world there is ever an unasked question:\nunasked by some through feelings of delicacy; by others through the difficulty of framing it.');
  assert.equal(normalized, 'Between me and the other world there is ever an unasked question: unasked by some through feelings of delicacy; by others through the difficulty of framing it.');
});

for (const unit of ['document', 'paragraph']) {
  test(`${unit} preprocessing keeps a line-anchored detector rule observable`, () => {
    const source = `Opening line.\n\nInteresting part of the project:\n\n${filler}`;
    const chunks = unitsForText(source, unit);
    assert.ok(chunks.length >= 1);
    assert.ok(chunks.some((chunk) => AIDetector.analyzeText(chunk).issues.some((issue) => issue.type === 'emotional-flatline')));
  });
}

for (const unit of ['document', 'paragraph']) {
  test(`${unit} preprocessing does not turn running prose into a heading match`, () => {
    const source = `Opening line. Interesting part of the project: ${filler}`;
    const chunks = unitsForText(source, unit);
    assert.equal(chunks.length, 1);
    const result = AIDetector.analyzeText(chunks[0]);
    assert.ok(!result.issues.some((issue) => issue.type === 'emotional-flatline'));
  });
}

for (const unit of ['document', 'paragraph']) {
  test(`${unit} preprocessing joins a hard wrap before the target words`, () => {
    const source = `Opening prose continues across a source-format soft wrap without a paragraph break.\nInteresting part of the project: ${filler}`;
    const chunks = unitsForText(source, unit);
    assert.ok(chunks.length >= 1);
    assert.ok(chunks.every((chunk) => !AIDetector.analyzeText(chunk).issues.some((issue) => issue.type === 'emotional-flatline')));
  });
}

test('paragraph preprocessing retains a 400-word paragraph after a short heading', () => {
  const paragraph = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
  const standalone = unitsForText(paragraph, 'paragraph');
  const afterHeading = unitsForText(`Context:\n\n${paragraph}`, 'paragraph');

  assert.equal(standalone.length, 1);
  assert.equal(afterHeading.length, 1);
  assert.equal(afterHeading[0], paragraph);
  assert.equal((afterHeading[0].match(/\S+/g) || []).length, 400);
});

test('paragraph preprocessing still attaches a short heading when the combined unit fits', () => {
  const paragraph = Array.from({ length: 399 }, (_, i) => `word${i}`).join(' ');
  const chunks = unitsForText(`Context:\n\n${paragraph}`, 'paragraph');

  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].startsWith('Context:\n'));
  assert.equal((chunks[0].match(/\S+/g) || []).length, 400);
});

console.log(`\n${failed === 0 ? 'all fp-measure tests passed' : `${failed} test(s) failed`}\n`);
process.exit(failed === 0 ? 0 : 1);
