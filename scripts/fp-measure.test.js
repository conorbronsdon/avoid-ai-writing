#!/usr/bin/env node
/* Focused statistical-helper tests for `npm test`. */
'use strict';
const assert = require('assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { wilson, rocAuc, measure, summarize, legacyPrepareUnits } = require('./fp-measure.js');
const { sha256 } = require('./corpus.js');
const detector = require('../detector/patterns.js');

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; process.stdout.write(`  ✓ ${name}\n`); };
const close = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) <= 1e-12, `${message}: expected ${expected}, got ${actual}`);
};

t('wilson handles empty, boundary, and middle samples with z=2', () => {
  const cases = [
    [0, 0, [0, 0]],
    [0, 4, [0, 0.5]],
    [4, 4, [0.5, 1]],
    [2, 4, [0.1464466094067262, 0.8535533905932737]],
  ];
  for (const [successes, n, expected] of cases) {
    const actual = wilson(successes, n, 2);
    assert.strictEqual(actual.length, 2);
    actual.forEach((bound) => assert.ok(bound >= 0 && bound <= 1, `${successes}/${n} bound ${bound} is outside [0, 1]`));
    close(actual[0], expected[0], `${successes}/${n} lower`);
    close(actual[1], expected[1], `${successes}/${n} upper`);
  }
});

t('rocAuc credits separation, inversion, ties, and empty classes correctly', () => {
  assert.strictEqual(rocAuc([2, 3], [0, 1]), 1);
  assert.strictEqual(rocAuc([0, 1], [2, 3]), 0);
  assert.strictEqual(rocAuc([1, 1], [1, 1]), 0.5);
  assert.strictEqual(rocAuc([1, 2], [0, 1]), 0.875);
  assert.strictEqual(rocAuc([], [0, 1]), null);
  assert.strictEqual(rocAuc([0, 1], []), null);
});

const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
function fixture(rows, options = {}) {
  return measure({ manifest: { documents: [{ id: 'fixture', register: 'docs' }] }, loadRows: () => rows, ...options });
}

t('measurement records filtering and detector exclusions without counting them as scores', () => {
  const result = fixture([
    { id: 'short', text: words(49) },
    { id: 'eligible', text: words(50) },
    { id: 'oversized', text: words(401) },
    { id: 'quoted', text: '> ' + words(30) + '\n> ' + words(30) },
  ]);
  assert.strictEqual(result.records.length, 4);
  assert.deepStrictEqual(result.records.map((r) => r.reason), ['below-min', null, 'above-max', 'detector-too-short']);
  assert.strictEqual(result.records[3].selectionStatus, 'selected');
  assert.strictEqual(result.records[3].inputWords, 62);
  assert.strictEqual(result.records[3].detectorWords, 0);
  assert.strictEqual(result.units.length, 1);
  assert.strictEqual(result.accounting.selected, 1);
  assert.strictEqual(result.accounting.skipped, 3);
  assert.strictEqual(summarize(result).counts.human, 1);
});

t('document preservation is separate from the detector maximum', () => {
  const result = fixture([{ text: words(10001) }], { unit: 'document' });
  assert.strictEqual(result.records[0].inputWords, 10001);
  assert.strictEqual(result.records[0].selectionStatus, 'selected');
  assert.strictEqual(result.records[0].reason, 'detector-too-long');
  assert.strictEqual(result.units.length, 0);
});

t('the paragraph source-word floor stays separate from detector-visible words', () => {
  const quote = Array.from({ length: 5 }, () => '> ' + words(10)).join('\n');
  const result = fixture([{ text: words(10) + '\n' + quote }]);
  assert.strictEqual(result.records[0].inputWords, 65);
  assert.strictEqual(result.records[0].detectorWords, 10);
  assert.strictEqual(result.records[0].status, 'selected');
  assert.strictEqual(result.units.length, 1);
  const shorter = fixture([{ text: words(9) + '\n' + quote }]);
  assert.strictEqual(shorter.records[0].reason, 'detector-too-short');
});

t('source verification rejects changed text and accounts for unavailable sources', () => {
  const text = words(60);
  const manifest = { documents: [{ id: 'fixture', sha256: sha256(text) }] };
  const verified = fixture([{ text }], { manifest, loadText: () => text });
  assert.strictEqual(verified.metadata.sources[0].status, 'verified');
  assert.throws(() => fixture([{ text }], { manifest, loadText: () => text + ' changed' }), /hash mismatch/);
  const unavailable = fixture([], { manifest, loadText: () => null });
  assert.deepStrictEqual(unavailable.skipped, ['fixture']);
  assert.strictEqual(unavailable.accounting.unavailableSources, 1);
  assert.strictEqual(unavailable.accounting.skipped, 0);
  assert.strictEqual(unavailable.records[0].reason, 'source-unavailable');
});

t('stable identities use original spans and retain class metadata', () => {
  const text = words(60) + '\r\n\r\n' + words(70);
  const rows = [{ id: 'paired-answer', class: 'machine', register: 'academic', model: 'fixture-model', text }];
  const current = fixture(rows);
  const legacy = fixture(rows, { preprocess: 'legacy' });
  assert.notStrictEqual(current.metadata.preprocessorHash, legacy.metadata.preprocessorHash);
  assert.strictEqual(current.metadata.preprocessorImplementation, 'structural-module');
  assert.strictEqual(legacy.metadata.preprocessorImplementation, 'legacy-inline');
  assert.strictEqual(current.metadata.measurementHarnessHash, legacy.metadata.measurementHarnessHash);
  assert.deepStrictEqual(current.records.map((r) => r.unitId), legacy.records.map((r) => r.unitId));
  for (const record of current.records) {
    assert.strictEqual(record.cls, 'machine');
    assert.strictEqual(record.model, 'fixture-model');
    assert.strictEqual(record.register, 'academic');
    assert.strictEqual(record.rowSourceHash, sha256(text));
    assert.strictEqual(record.normalizedHash, sha256(text.slice(record.spans[0].start, record.spans[0].end)));
  }
});

t('the default row parser scores the verified snapshot after the source changes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-verified-snapshot-'));
  try {
    const filename = path.join(directory, 'source.txt');
    for (const sourceType of ['local', 'dataset']) {
      const original = sourceType === 'dataset' ? JSON.stringify({ id: 'answer', text: words(60), class: 'machine' }) + '\n' : words(60);
      const replacement = sourceType === 'dataset' ? JSON.stringify({ id: 'changed', text: words(90), class: 'machine' }) + '\n' : words(90);
      fs.writeFileSync(filename, original);
      const doc = { id: 'snapshot', source: { type: sourceType, path: filename }, sha256: sha256(original) };
      let reads = 0;
      const measured = measure({ manifest: { documents: [doc] }, loadText: () => {
        reads++;
        const snapshot = fs.readFileSync(filename, 'utf8');
        fs.writeFileSync(filename, replacement);
        return snapshot;
      } });
      assert.strictEqual(reads, 1);
      assert.strictEqual(measured.metadata.sources[0].sha256, sha256(original));
      assert.strictEqual(measured.records[0].rowSourceHash, sha256(words(60)));
      assert.strictEqual(measured.records[0].inputWords, 60);
      assert.strictEqual(measured.records[0].status, 'selected');
      assert.strictEqual(fs.readFileSync(filename, 'utf8'), replacement);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

t('legacy instrumentation preserves main paragraph filtering and document flattening', () => {
  for (const text of [words(49), words(50), words(400), words(401), '## Heading\n' + words(400), words(60) + '\r\n \r\n' + words(70)]) {
    const expected = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => {
      const n = p.split(/\s+/).filter(Boolean).length;
      return n >= 50 && n <= 400;
    });
    assert.deepStrictEqual(legacyPrepareUnits(text).decisions.filter((r) => r.status === 'selected').map((r) => r.text), expected);
    assert.strictEqual(legacyPrepareUnits(text, 'document').decisions[0].text, text.replace(/\s+/g, ' ').trim());
  }
});

t('category reports include zero observations for every detector category', () => {
  const result = summarize(fixture([{ text: words(60) }]));
  assert.deepStrictEqual(result.discrimination.map((r) => r.type).sort(), Object.keys(detector.TYPE_LABELS).sort());
  const title = result.discrimination.find((r) => r.type === 'title-case-header');
  assert.strictEqual(title.n, 0);
});

process.stdout.write(`\n${passed} fp-measure tests passed\n`);
