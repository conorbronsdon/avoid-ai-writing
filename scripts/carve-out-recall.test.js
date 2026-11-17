#!/usr/bin/env node
'use strict';

// Contract for the #140 recall-cost audit. The audit reads the live tree, so
// these tests pin the tool's behavior (one boundary per variant, faithful
// baseline, valid labels) rather than the tree-dependent counts.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AIDetector = require('../detector/patterns.js');
const { CARVE_OUTS, isQuoted } = require('./carve-out-recall.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  process.stdout.write(`  ✓ ${name}\n`);
}

const fires = (re, text) => {
  if (!re) return false;
  re.lastIndex = 0;
  return re.test(text);
};
const byId = Object.fromEntries(CARVE_OUTS.map((c) => [c.id, c]));

// Each loosened variant must catch exactly the shape its boundary suppresses;
// the baseline must not.
const SUPPRESSED = {
  'no-chain-three-items': 'No fluff, no filler.',
  'no-chain-lowercase-after-colon-dash': 'The plan: no fluff, no filler, no jargon.',
  'no-chain-sentence-initial': 'It ships with no fluff, no filler, no jargon.',
  'no-chain-idiom-stop-list': 'No more, no less, no matter what.',
  'did-not-restated-subject': 'It did not ask. It did not wait.',
  // (a noun subject is covered by the separate test below)
  'the-punchline-omitted': 'The punchline is simple.',
  'worth-naming-omitted': 'It is worth naming the cost.',
  'batteries-included-omitted': 'The framework is batteries included.',
  'just-works-out-idiom': 'It just works out to two queries.',
  'just-works-unicode-hyphen': 'And it just works out‑of‑the‑box.',
  'turns-out-sentence-initial': 'The fix, it turns out, was a typo.',
};

test('every carve-out has a suppressed-shape case', () => {
  assert.deepEqual(Object.keys(SUPPRESSED).sort(), CARVE_OUTS.map((c) => c.id).sort());
});

for (const [id, text] of Object.entries(SUPPRESSED)) {
  test(`${id}: loosened variant fires where the baseline does not`, () => {
    const co = byId[id];
    assert.equal(fires(co.base, text), false, 'baseline must stay clean');
    assert.equal(fires(co.loose, text), true, 'variant must fire');
  });
}

test('did-not-restated-subject: the variant covers a short noun subject, and the finder collects it', () => {
  const { FINDERS } = require('./carve-out-recall.js');
  const text = 'It did not ask. The server did not wait.';
  const co = byId['did-not-restated-subject'];
  assert.equal(fires(co.base, text), false);
  assert.equal(fires(co.loose, text), true);
  FINDERS['did-not-chain'].lastIndex = 0;
  assert.ok(FINDERS['did-not-chain'].test(text));
});

test('quote masking credits only rules the baseline has', () => {
  const { measure } = require('./carve-out-recall.js');
  const r = measure();
  const quotedOmitted = r.candidates.filter((c) => c.quoted && ['the-punchline', 'worth-naming', 'batteries-included'].includes(c.form));
  assert.ok(quotedOmitted.length > 0, 'the tree has quoted mentions of omitted forms');
  assert.ok(r.quote.added <= r.candidates.filter((c) => c.quoted && !['the-punchline', 'worth-naming', 'batteries-included'].includes(c.form)).length,
    'quoted omitted-form mentions must not count as masking credit');
  assert.ok(r.quote.hypotheticalOnly >= quotedOmitted.length);
});

test('variants keep every baseline hit (loosening never removes a match)', () => {
  const kept = {
    'no-chain': 'No fluff, no filler, no jargon.',
    'did-not-chain': 'They did not ask for permission, did not wait for the committee.',
    'it-just-works': 'Honestly it just works out of the box.',
    'turns-out': 'We checked. Turns out the cache was cold.',
  };
  for (const co of CARVE_OUTS) {
    if (!co.base) continue;
    const text = kept[co.form];
    assert.equal(fires(co.base, text), true, `${co.id} baseline`);
    assert.equal(fires(co.loose, text), true, `${co.id} variant`);
  }
});

test('baseline patterns match the engine on a scored sample', () => {
  const text = 'We tried three vendors this quarter. No fluff, no filler, no jargon. Honestly it just works out of the box for the team.';
  const types = new Set(AIDetector.analyzeText(text).issues.map((i) => i.type));
  assert.ok(types.has('negation-chain'));
  assert.ok(types.has('dev-blog-boilerplate'));
  assert.equal(fires(byId['no-chain-three-items'].base, text), true);
  assert.equal(fires(byId['just-works-out-idiom'].base, text), true);
});

test('quote detection covers double quotes, curly quotes, inline code, and blockquotes', () => {
  const at = (text, needle) => isQuoted(text, text.indexOf(needle), needle.length);
  assert.equal(at('The rule flags "Turns out" openers.', 'Turns out'), true);
  assert.equal(at('The rule flags “Turns out” openers.', 'Turns out'), true);
  assert.equal(at('The rule flags `Turns out` openers.', 'Turns out'), true);
  assert.equal(at('> Turns out the cache was cold.', 'Turns out'), true);
  assert.equal(at('We checked. Turns out the cache was cold.', 'Turns out'), false);
});

test('labels file uses only the documented labels and strata', () => {
  const labels = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evals/carve-out-recall/labels.json'), 'utf8'));
  const allowedLabels = new Set(Object.keys(labels.labels));
  const allowedStrata = new Set(Object.keys(labels.strata));
  const keys = new Set();
  for (const c of labels.candidates) {
    assert.ok(allowedLabels.has(c.label), `${c.key}: label ${c.label}`);
    assert.ok(allowedStrata.has(c.stratum), `${c.key}: stratum ${c.stratum}`);
    assert.ok(c.note && c.note.length > 0, `${c.key}: note`);
    assert.ok(!keys.has(c.key), `${c.key}: duplicate`);
    keys.add(c.key);
  }
});

console.log(`\ncarve-out-recall: ${passed} passed`);
