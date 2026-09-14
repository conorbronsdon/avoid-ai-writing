#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256 } = require('./corpus.js');
const { changeSet, compare, parseArgs, publicSummary, writeArtifacts } = require('./fp-compare.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  process.stdout.write(`  \u2713 ${name}\n`);
}

const words = (prefix, count) => Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(' ');
const rows = [
  {
    id: 'list-human', class: 'human', register: 'docs', model: null,
    text: `- item one\n${words('human', 55)}`,
  },
  {
    id: 'heading-machine', class: 'machine', register: 'docs', model: 'fixture-model',
    text: `# Fixture heading\n\n${words('machine', 55)}`,
  },
  {
    id: 'short-human', class: 'human', register: 'conversational', model: null,
    text: 'this short row stays visible in the decision accounting',
  },
  {
    id: 'empty-human', class: 'human', register: 'conversational', model: null,
    text: '',
  },
];
const jsonl = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
const manifest = {
  version: 1,
  documents: [{
    id: 'fixture-source', register: 'mixed', class: 'mixed', sha256: sha256(jsonl),
    source: { type: 'dataset', dataset: 'fixture', license: 'test' },
  }],
};
const detector = {
  analyzeText(text) {
    const type = text.includes('\n') ? 'em-dash' : 'tier1';
    return {
      score: 5,
      issues: [{ type }],
      stats: { wordCount: (text.match(/\S+/g) || []).length },
      label: 'Minimal AI signals',
      tooShort: false,
      tooLong: false,
      document_classification: 'SCORED',
    };
  },
};
const loaders = {
  manifest,
  loadText: () => jsonl,
  loadRows: () => rows,
  detector,
};

const result = compare(loaders);

test('runs the same verified source through both preprocessors in both unit modes', () => {
  assert.deepStrictEqual(result.units, ['paragraph', 'document']);
  for (const unit of result.units) {
    const metadata = result.modes[unit].metadata;
    assert.deepStrictEqual(metadata.sourceCounts, { verified: 1, unavailable: 0, injected: 0 });
    assert.strictEqual(metadata.sourceVerification[0].sha256, manifest.documents[0].sha256);
    assert.strictEqual(metadata.sourceVerification[0].status, 'verified');
    assert.notStrictEqual(metadata.preprocessorHashes.legacy, metadata.preprocessorHashes.current);
    assert.deepStrictEqual(metadata.preprocessorImplementations, {
      legacy: 'legacy-inline', current: 'structural-module',
    });
    assert.ok(metadata.measurementHarnessHash);
  }
});

test('reports decision changes by original spans', () => {
  const changes = result.modes.paragraph.comparison.changes;
  assert.ok(changes.counts.removed > 0, JSON.stringify(changes.counts));
  assert.ok(changes.counts.modified > 0, JSON.stringify(changes.counts));
  assert.strictEqual(changes.total, changes.counts.added + changes.counts.removed + changes.counts.modified);
  for (const example of changes.examples) {
    assert.ok(Array.isArray(example.key[4]), 'identity key ends with original spans');
    assert.strictEqual('text' in (example.legacy || {}), false);
    assert.strictEqual('text' in (example.current || {}), false);
  }
});

test('pairs an attached heading with its unique legacy body without changing either identity', () => {
  const base = {
    recordKind: 'unit', doc: 'fixture', rowId: 'row', rowIndex: 0,
    rowSourceHash: 'source', cls: 'human', register: 'docs', model: null,
    selectionStatus: 'selected', status: 'selected', reason: null,
    headingAttached: false, headingKind: null, kinds: ['legacy-flat'],
    inputWords: 55, detectorWords: 55, detectorStatus: 'Clean', score: 0, types: [],
  };
  const legacyHeading = {
    ...base, spans: [{ start: 0, end: 10 }], unitId: 'legacy-heading', normalizedHash: 'heading',
    selectionStatus: 'skipped', status: 'skipped', reason: 'below-min', inputWords: 2,
    detectorWords: null, detectorStatus: null, score: null,
  };
  const legacyBody = {
    ...base, spans: [{ start: 12, end: 100 }], unitId: 'legacy-body', normalizedHash: 'body',
  };
  const current = {
    ...base, spans: [{ start: 0, end: 10 }, { start: 12, end: 100 }],
    unitId: 'current-attached', normalizedHash: 'heading-body', headingAttached: true,
    headingKind: 'atx', kinds: ['atx-heading', 'prose'], inputWords: 57,
    detectorWords: 57, detectorStatus: 'Minimal AI signals', score: 4,
    types: ['title-case-header'],
  };

  const changes = changeSet([legacyHeading, legacyBody], [current], 10);
  assert.deepStrictEqual(changes.counts, { added: 0, removed: 1, modified: 1 });
  const paired = changes.examples.find((change) => change.kind === 'modified');
  assert.deepStrictEqual(paired.key[4], legacyBody.spans);
  assert.deepStrictEqual(paired.currentKey[4], current.spans);
  assert.strictEqual(paired.legacy.unitId, 'legacy-body');
  assert.strictEqual(paired.current.unitId, 'current-attached');
  assert.ok(paired.fields.includes('spans'));
  assert.strictEqual(paired.impact, 'detector');

  const absorbed = changes.examples.find((change) => change.kind === 'removed');
  assert.deepStrictEqual(absorbed.absorbedInto[4], current.spans);
  assert.strictEqual(absorbed.impact, 'segmentation');
  assert.strictEqual(changes.byImpact.population, 0);
  assert.strictEqual(changes.byImpact.segmentation, 1);

  const capped = changeSet([legacyHeading, legacyBody], [current], 0);
  assert.deepStrictEqual(capped.examples, []);
  assert.deepStrictEqual(capped.absorbedHeadings, [{
    legacyKey: absorbed.key,
    currentKey: absorbed.absorbedInto,
  }]);
});

test('leaves ambiguous attachment candidates unpaired and counts each record once', () => {
  const base = {
    recordKind: 'unit', doc: 'fixture', rowId: 'row', rowIndex: 0,
    rowSourceHash: 'source', cls: 'human', register: 'docs', model: null,
    selectionStatus: 'selected', status: 'selected', reason: null,
    headingAttached: false, headingKind: null, kinds: ['legacy-flat'],
    inputWords: 55, detectorWords: 55, detectorStatus: 'Clean', score: 0, types: [],
  };
  const legacy = { ...base, spans: [{ start: 20, end: 100 }], unitId: 'legacy', normalizedHash: 'body' };
  const first = {
    ...base, spans: [{ start: 0, end: 10 }, { start: 20, end: 100 }],
    unitId: 'first', normalizedHash: 'first', headingAttached: true, headingKind: 'atx',
  };
  const second = {
    ...base, spans: [{ start: 11, end: 18 }, { start: 20, end: 100 }],
    unitId: 'second', normalizedHash: 'second', headingAttached: true, headingKind: 'atx',
  };

  const changes = changeSet([legacy], [first, second], 10);
  assert.deepStrictEqual(changes.counts, { added: 2, removed: 1, modified: 0 });
  assert.strictEqual(changes.total, 3);
  assert.strictEqual(changes.examples.some((change) => change.currentKey), false);
});

test('pairs a unique normalized unit when only its source span boundary moves', () => {
  const base = {
    recordKind: 'unit', doc: 'fixture', rowId: 'row', rowIndex: 0,
    rowSourceHash: 'source', cls: 'human', register: 'docs', model: null,
    selectionStatus: 'selected', status: 'selected', reason: null,
    headingAttached: false, headingKind: null, mergedContinuation: false,
    kinds: ['prose'], normalizedHash: 'same-content', inputWords: 55,
    detectorWords: 55, detectorStatus: 'Clean', score: 0, types: [],
  };
  const legacy = { ...base, spans: [{ start: 0, end: 100 }], unitId: 'legacy' };
  const current = { ...base, spans: [{ start: 1, end: 99 }], unitId: 'current' };

  const changes = changeSet([legacy], [current], 10);
  assert.deepStrictEqual(changes.counts, { added: 0, removed: 0, modified: 1 });
  assert.deepStrictEqual(changes.byImpact, {
    population: 0, detector: 0, normalization: 0, segmentation: 0, 'metadata-only': 1,
  });
  assert.deepStrictEqual(changes.examples[0].fields, ['spans']);
  assert.deepStrictEqual(changes.examples[0].key[4], legacy.spans);
  assert.deepStrictEqual(changes.examples[0].currentKey[4], current.spans);
});

test('leaves repeated normalized units unpaired when boundary provenance is ambiguous', () => {
  const base = {
    recordKind: 'unit', doc: 'fixture', rowId: 'row', rowIndex: 0,
    rowSourceHash: 'source', cls: 'human', register: 'docs', model: null,
    selectionStatus: 'selected', status: 'selected', reason: null,
    headingAttached: false, headingKind: null, mergedContinuation: false,
    kinds: ['prose'], normalizedHash: 'duplicate', inputWords: 55,
    detectorWords: 55, detectorStatus: 'Clean', score: 0, types: [],
  };
  const legacy = [
    { ...base, spans: [{ start: 0, end: 50 }], unitId: 'legacy-1' },
    { ...base, spans: [{ start: 51, end: 101 }], unitId: 'legacy-2' },
  ];
  const current = [
    { ...base, spans: [{ start: 1, end: 49 }], unitId: 'current-1' },
    { ...base, spans: [{ start: 52, end: 100 }], unitId: 'current-2' },
  ];

  const changes = changeSet(legacy, current, 10);
  assert.deepStrictEqual(changes.counts, { added: 2, removed: 2, modified: 0 });
  assert.strictEqual(changes.byImpact.population, 4);

  const oneLegacyTwoCurrent = changeSet([legacy[0]], current, 10);
  assert.deepStrictEqual(oneLegacyTwoCurrent.counts, { added: 2, removed: 1, modified: 0 });

  const twoLegacyOneCurrent = changeSet(legacy, [current[0]], 10);
  assert.deepStrictEqual(twoLegacyOneCurrent.counts, { added: 1, removed: 2, modified: 0 });

  const otherRow = { ...current[0], rowId: 'other-row' };
  const differentRows = changeSet([legacy[0]], [otherRow], 10);
  assert.deepStrictEqual(differentRows.counts, { added: 1, removed: 1, modified: 0 });
});

test('compares an empty row that produces no current decisions', () => {
  const changes = result.modes.paragraph.comparison.changes;
  const empty = changes.examples.find((change) => change.legacy?.rowId === 'empty-human');
  assert.ok(empty, 'expected the removed legacy empty-row decision to remain inspectable');
  assert.strictEqual(empty.kind, 'removed');
  assert.strictEqual(empty.impact, 'population');
  assert.strictEqual(empty.current, null);
});

test('detects a type change even when score and source span do not change', () => {
  const modified = result.modes.paragraph.comparison.changes.examples.find((change) =>
    change.kind === 'modified'
      && change.legacy?.rowId === 'list-human'
      && change.fields.includes('types'));
  assert.ok(modified, 'expected list-human type change');
  assert.strictEqual(modified.legacy.score, modified.current.score);
  assert.deepStrictEqual(modified.legacy.spans, modified.current.spans);
  assert.notDeepStrictEqual(modified.legacy.types, modified.current.types);
  assert.notStrictEqual(modified.legacy.normalizedHash, modified.current.normalizedHash);
});

test('includes accepted and skipped accounting with reason deltas', () => {
  const accounting = result.modes.paragraph.comparison.accounting;
  assert.ok(accounting.legacy.selected > 0);
  assert.ok(accounting.current.selected > 0);
  assert.ok(accounting.legacy.skipped > 0);
  assert.ok(accounting.current.skipped > 0);
  assert.strictEqual(accounting.legacy.reasons['below-min'], 3);
  assert.strictEqual(accounting.current.reasons['below-min'], 1);
  assert.ok(Object.hasOwn(accounting.delta.reasons, 'unattached-heading') || Object.hasOwn(accounting.delta.reasons, 'below-min'));
});

test('emits all category counts, including explicit zeros', () => {
  const categories = result.modes.paragraph.comparison.categories;
  assert.deepStrictEqual(categories.chatbot, {
    legacy: { human: 0, machine: 0 },
    current: { human: 0, machine: 0 },
    delta: { human: 0, machine: 0 },
  });
  assert.strictEqual(categories.tier1.legacy.human, 1);
  assert.strictEqual(categories['em-dash'].current.human, 1);
});

test('prioritizes detector and selected-population changes over metadata-only changes', () => {
  const changes = result.modes.paragraph.comparison.changes;
  assert.ok(changes.byImpact.detector > 0);
  assert.ok(changes.byImpact.population > 0);
  assert.ok(changes.byImpact['metadata-only'] >= 0);
  assert.strictEqual(changes.examples[0].impact, 'detector');
  const firstMetadata = changes.examples.findIndex((change) => change.impact === 'metadata-only');
  const lastDetector = changes.examples.findLastIndex((change) => change.impact === 'detector');
  if (firstMetadata !== -1) assert.ok(lastDetector < firstMetadata);
});

test('reports threshold rates overall and by source and register', () => {
  const rates = result.modes.paragraph.comparison.rates;
  assert.strictEqual(rates.overall.legacy[3].fpr.rate, 1);
  assert.strictEqual(rates.overall.current[3].fpr.rate, 1);
  assert.ok(rates.bySource['fixture-source']);
  assert.ok(rates.byRegister.docs);
  assert.ok(rates.byRegister.conversational);
  assert.strictEqual(rates.byRegister.conversational.current[3].fpr.n, 0);
  assert.deepStrictEqual(rates.byRegister.conversational.current[3].fpr.ci, [0, 0]);
  assert.strictEqual(rates.byRegister.docs.current[10].fpr.rate, 0);
});

test('summary and decision artifacts contain hashes and diagnostics without corpus text', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-compare-'));
  const written = writeArtifacts(directory, result);
  const summary = JSON.parse(fs.readFileSync(written.summaryPath, 'utf8'));
  assert.strictEqual(summary.modes.paragraph.decisions, undefined);
  assert.ok(summary.modes.paragraph.metadata.manifestHash);
  assert.ok(summary.modes.paragraph.comparison.changes.absorbedHeadings.length > 0);
  assert.deepStrictEqual(
    summary.modes.paragraph.comparison.changes.absorbedHeadings,
    result.modes.paragraph.comparison.changes.absorbedHeadings,
  );
  const decisions = fs.readFileSync(written.decisionsPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(decisions[0].recordKind, 'meta');
  assert.ok(decisions.some((record) => record.recordKind === 'unit' && record.normalizedHash));
  assert.strictEqual(decisions.some((record) => Object.hasOwn(record, 'text')), false);
  assert.strictEqual(fs.readFileSync(written.summaryPath, 'utf8').includes(words('human', 10)), false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('public JSON excludes full decision streams', () => {
  const summary = publicSummary(result);
  assert.strictEqual(summary.modes.paragraph.decisions, undefined);
  assert.strictEqual(summary.modes.document.decisions, undefined);
});

test('fails on a source hash mismatch before comparing runs', () => {
  assert.throws(
    () => compare({ ...loaders, manifest: { ...manifest, documents: [{ ...manifest.documents[0], sha256: '0'.repeat(64) }] } }),
    /Corpus hash mismatch/,
  );
});

test('validates output CLI options', () => {
  assert.deepStrictEqual(parseArgs([]), { json: false, out: null });
  assert.deepStrictEqual(parseArgs(['--json']), { json: true, out: null });
  assert.deepStrictEqual(parseArgs(['--out', 'results']), { json: false, out: 'results' });
  assert.throws(() => parseArgs(['--json', '--out', 'results']), /either/);
  assert.throws(() => parseArgs(['--out']), /directory path/);
  assert.throws(() => parseArgs(['--wat']), /Usage/);
});

process.stdout.write(`\n${passed} fp-compare tests passed\n`);
