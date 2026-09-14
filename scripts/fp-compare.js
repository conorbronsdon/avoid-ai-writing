#!/usr/bin/env node
'use strict';

/**
 * Compare the frozen legacy corpus preparation with the current preparation.
 *
 * Both runs call fp-measure with the same manifest, loaders, and detector. The
 * corpus manager remains responsible for fetching; this command only measures
 * cache entries whose recorded hashes can be verified.
 */

const fs = require('node:fs');
const path = require('node:path');
const { measure, summarize, wilson, THRESHOLDS } = require('./fp-measure.js');

const MODES = ['legacy', 'current'];
const UNITS = ['paragraph', 'document'];

function sortedObject(entries) {
  return Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b)));
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function rate(successes, n) {
  return { n, flagged: successes, rate: n ? successes / n : 0, ci: wilson(successes, n) };
}

function ratesFor(units) {
  const human = units.filter((record) => record.cls === 'human');
  const machine = units.filter((record) => record.cls === 'machine');
  return Object.fromEntries(THRESHOLDS.map((threshold) => [threshold, {
    fpr: rate(human.filter((record) => record.score >= threshold).length, human.length),
    tpr: rate(machine.filter((record) => record.score >= threshold).length, machine.length),
  }]));
}

function groupedRates(units, key) {
  const groups = new Map();
  for (const record of units) {
    const name = String(record[key] || 'unknown');
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(record);
  }
  return sortedObject([...groups].map(([name, records]) => [name, ratesFor(records)]));
}

function rateDelta(before, after) {
  const out = {};
  for (const threshold of THRESHOLDS) {
    out[threshold] = {};
    for (const metric of ['fpr', 'tpr']) {
      const a = before[threshold][metric];
      const b = after[threshold][metric];
      out[threshold][metric] = {
        n: b.n - a.n,
        flagged: b.flagged - a.flagged,
        rate: b.rate - a.rate,
      };
    }
  }
  return out;
}

function groupedRateComparison(before, after, key, extraNames = []) {
  const a = groupedRates(before, key);
  const b = groupedRates(after, key);
  const names = [...new Set([...Object.keys(a), ...Object.keys(b), ...extraNames])].sort();
  const empty = ratesFor([]);
  return Object.fromEntries(names.map((name) => [name, {
    legacy: a[name] || empty,
    current: b[name] || empty,
    delta: rateDelta(a[name] || empty, b[name] || empty),
  }]));
}

function categoryCounts(summary, units = []) {
  const counts = new Map(summary.discrimination.map((category) => [category.type, { human: 0, machine: 0 }]));
  for (const record of units) {
    for (const type of new Set(record.types)) {
      if (!counts.has(type)) counts.set(type, { human: 0, machine: 0 });
      counts.get(type)[record.cls]++;
    }
  }
  return sortedObject(counts);
}

function compareCategories(legacySummary, currentSummary, legacyUnits, currentUnits) {
  const legacy = categoryCounts(legacySummary, legacyUnits);
  const current = categoryCounts(currentSummary, currentUnits);
  const types = [...new Set([...Object.keys(legacy), ...Object.keys(current)])].sort();
  return Object.fromEntries(types.map((type) => {
    const a = legacy[type] || { human: 0, machine: 0 };
    const b = current[type] || { human: 0, machine: 0 };
    return [type, {
      legacy: a,
      current: b,
      delta: { human: b.human - a.human, machine: b.machine - a.machine },
    }];
  }));
}

function reasonCounts(accounting) {
  return {
    selected: accounting.selected || 0,
    skipped: accounting.skipped || 0,
    unavailableSources: accounting.unavailableSources || 0,
    reasons: sortedObject(Object.entries(accounting.reasons || {})),
  };
}

function compareAccounting(legacy, current) {
  const a = reasonCounts(legacy);
  const b = reasonCounts(current);
  const reasons = [...new Set([...Object.keys(a.reasons), ...Object.keys(b.reasons)])].sort();
  a.reasons = Object.fromEntries(reasons.map((reason) => [reason, a.reasons[reason] || 0]));
  b.reasons = Object.fromEntries(reasons.map((reason) => [reason, b.reasons[reason] || 0]));
  const result = {
    legacy: a,
    current: b,
    delta: {
      selected: b.selected - a.selected,
      skipped: b.skipped - a.skipped,
      unavailableSources: b.unavailableSources - a.unavailableSources,
      reasons: Object.fromEntries(reasons.map((reason) => [reason, (b.reasons[reason] || 0) - (a.reasons[reason] || 0)])),
    },
  };
  const sources = [...new Set([...Object.keys(legacy.bySource || {}), ...Object.keys(current.bySource || {})])].sort();
  result.bySource = Object.fromEntries(sources.map((source) => [source,
    compareAccounting(legacy.bySource?.[source] || {}, current.bySource?.[source] || {}),
  ]));
  return result;
}

function identity(record) {
  return JSON.stringify([
    record.doc,
    record.rowId,
    record.rowIndex,
    record.rowSourceHash,
    record.spans,
  ]);
}

function rowIdentity(record) {
  return JSON.stringify([
    record.doc,
    record.rowId,
    record.rowIndex,
    record.rowSourceHash,
  ]);
}

function diagnostic(record) {
  if (!record) return null;
  return {
    doc: record.doc,
    rowId: record.rowId,
    rowIndex: record.rowIndex,
    cls: record.cls,
    register: record.register,
    model: record.model,
    rowSourceHash: record.rowSourceHash,
    spans: record.spans,
    unitId: record.unitId,
    normalizedHash: record.normalizedHash,
    selectionStatus: record.selectionStatus,
    status: record.status,
    reason: record.reason,
    headingAttached: record.headingAttached,
    headingKind: record.headingKind,
    mergedContinuation: record.mergedContinuation,
    kinds: record.kinds,
    inputWords: record.inputWords,
    detectorWords: record.detectorWords,
    detectorStatus: record.detectorStatus,
    score: record.score,
    types: record.types,
  };
}

function changedFields(a, b) {
  const fields = [
    'spans', 'normalizedHash', 'selectionStatus', 'status', 'reason', 'headingAttached',
    'headingKind', 'mergedContinuation', 'kinds', 'inputWords', 'detectorWords', 'detectorStatus',
    'score', 'types',
  ];
  return fields.filter((field) => !sameJson(a[field], b[field]));
}

function changeImpact(change) {
  if (change.absorbedInto) return 'segmentation';
  if (change.kind !== 'modified') return 'population';
  const detectorFields = new Set([
    'selectionStatus', 'status', 'reason', 'detectorWords', 'detectorStatus',
    'score', 'types',
  ]);
  if (change.fields.some((field) => detectorFields.has(field))) return 'detector';
  if (change.fields.some((field) => field === 'normalizedHash' || field === 'inputWords')) return 'normalization';
  return 'metadata-only';
}

function changePriority(change) {
  if (change.kind === 'modified' && change.impact === 'detector') return 0;
  const populated = change.current || change.legacy;
  if (change.kind !== 'modified' && (populated.selectionStatus === 'selected' || populated.status === 'selected')) return 1;
  if (change.impact === 'normalization') return 2;
  if (change.kind !== 'modified') return 3;
  return 4;
}

function changeSet(legacyRecords, currentRecords, exampleLimit = 40) {
  const units = (records) => records.filter((record) => record.recordKind === 'unit');
  const beforeRecords = units(legacyRecords);
  const afterRecords = units(currentRecords);
  const before = new Map(beforeRecords.map((record) => [identity(record), record]));
  const after = new Map(afterRecords.map((record) => [identity(record), record]));
  const pairedBefore = new Set();
  const pairedAfter = new Set();
  const attachmentPairs = [];
  const changes = [];

  // Preserve exact-span matching as the first and strongest identity rule.
  for (const [key, a] of before) {
    const b = after.get(key);
    if (!b) continue;
    pairedBefore.add(a);
    pairedAfter.add(b);
    const fields = changedFields(a, b);
    if (fields.length) changes.push({ kind: 'modified', key: JSON.parse(key), fields, legacy: diagnostic(a), current: diagnostic(b) });
  }

  // Heading attachment adds a heading span to an otherwise stable body. Pair
  // only exact body spans, within one source row, and only when the candidate
  // is unique in both directions. Ambiguous merges and splits stay added and
  // removed rather than being assigned greedily.
  const unmatchedBefore = beforeRecords.filter((record) => !pairedBefore.has(record));
  const unmatchedAfter = afterRecords.filter((record) => !pairedAfter.has(record));
  const candidatesByCurrent = new Map();
  const candidatesByLegacy = new Map();
  for (const current of unmatchedAfter) {
    if (!current.headingAttached || current.spans.length < 2) continue;
    const bodySpan = current.spans[current.spans.length - 1];
    const candidates = unmatchedBefore.filter((legacy) =>
      rowIdentity(legacy) === rowIdentity(current)
      && legacy.spans.length === 1
      && sameJson(legacy.spans[0], bodySpan));
    candidatesByCurrent.set(current, candidates);
    for (const legacy of candidates) {
      if (!candidatesByLegacy.has(legacy)) candidatesByLegacy.set(legacy, []);
      candidatesByLegacy.get(legacy).push(current);
    }
  }
  for (const [current, candidates] of candidatesByCurrent) {
    if (candidates.length !== 1) continue;
    const legacy = candidates[0];
    if (candidatesByLegacy.get(legacy)?.length !== 1) continue;
    pairedBefore.add(legacy);
    pairedAfter.add(current);
    attachmentPairs.push([legacy, current]);
    const fields = changedFields(legacy, current);
    changes.push({
      kind: 'modified',
      key: JSON.parse(identity(legacy)),
      currentKey: JSON.parse(identity(current)),
      fields,
      legacy: diagnostic(legacy),
      current: diagnostic(current),
    });
  }

  for (const current of afterRecords) {
    if (!pairedAfter.has(current)) {
      changes.push({ kind: 'added', key: JSON.parse(identity(current)), legacy: null, current: diagnostic(current) });
    }
  }
  for (const legacy of beforeRecords) {
    if (pairedBefore.has(legacy)) continue;
    const absorbedBy = legacy.selectionStatus === 'skipped' && legacy.spans.length === 1
      ? attachmentPairs.map(([, current]) => current).filter((current) =>
        rowIdentity(legacy) === rowIdentity(current)
        && current.spans.slice(0, -1).some((span) => sameJson(span, legacy.spans[0])))
      : [];
    changes.push({
      kind: 'removed',
      key: JSON.parse(identity(legacy)),
      legacy: diagnostic(legacy),
      current: null,
      ...(absorbedBy.length === 1 ? { absorbedInto: JSON.parse(identity(absorbedBy[0])) } : {}),
    });
  }

  const counts = { added: 0, removed: 0, modified: 0 };
  const byImpact = { population: 0, detector: 0, normalization: 0, segmentation: 0, 'metadata-only': 0 };
  for (const change of changes) {
    change.impact = changeImpact(change);
    counts[change.kind]++;
    byImpact[change.impact]++;
  }
  changes.sort((a, b) => changePriority(a) - changePriority(b) || identity(a.current || a.legacy).localeCompare(identity(b.current || b.legacy)));
  const absorbedHeadings = changes
    .filter((change) => change.absorbedInto)
    .map((change) => ({ legacyKey: change.key, currentKey: change.absorbedInto }));
  return {
    counts,
    byImpact,
    total: changes.length,
    absorbedHeadings,
    examples: changes.slice(0, exampleLimit),
  };
}

function assertCommonInputs(legacy, current) {
  const fields = ['manifestHash', 'detectorHash', 'measurementHarnessHash', 'detectorOptions', 'sources'];
  for (const field of fields) {
    if (!sameJson(legacy.metadata[field], current.metadata[field])) {
      throw new Error(`Comparison inputs differ between legacy and current runs: ${field}`);
    }
  }

  if (!sameJson(legacy.metadata.rows, current.metadata.rows)) {
    throw new Error('Comparison rows differ between legacy and current runs');
  }
}

function comparisonMetadata(legacy, current) {
  const sources = current.metadata.sources;
  return {
    manifestHash: current.metadata.manifestHash,
    detectorHash: current.metadata.detectorHash,
    measurementHarnessHash: current.metadata.measurementHarnessHash,
    detectorOptions: current.metadata.detectorOptions,
    revision: current.metadata.revision,
    spanEncoding: current.metadata.spanEncoding,
    sourceVerification: sources,
    sourceCounts: {
      verified: sources.filter((source) => source.status === 'verified').length,
      unavailable: sources.filter((source) => source.status === 'unavailable').length,
      injected: sources.filter((source) => source.status === 'injected').length,
    },
    preprocessorHashes: {
      legacy: legacy.metadata.preprocessorHash,
      current: current.metadata.preprocessorHash,
    },
    preprocessorImplementations: {
      legacy: legacy.metadata.preprocessorImplementation,
      current: current.metadata.preprocessorImplementation,
    },
    legacyReference: legacy.metadata.legacyReference,
  };
}

function compareUnit(unit, opts) {
  const common = {
    unit,
    ...(opts.manifest ? { manifest: opts.manifest } : {}),
    ...(opts.loadRows ? { loadRows: opts.loadRows } : {}),
    ...(opts.loadText ? { loadText: opts.loadText } : {}),
    ...(opts.detector ? { detector: opts.detector } : {}),
  };
  const legacy = measure({ ...common, preprocess: 'legacy' });
  const current = measure({ ...common, preprocess: 'current' });
  assertCommonInputs(legacy, current);
  const legacySummary = summarize(legacy);
  const currentSummary = summarize(current);
  const sourceNames = current.metadata.sources.map((source) => source.doc);
  const registerNames = [...new Set([...legacy.records, ...current.records]
    .filter((record) => record.recordKind === 'unit')
    .map((record) => String(record.register || 'unknown')))];

  return {
    metadata: comparisonMetadata(legacy, current),
    runs: { legacy: legacySummary, current: currentSummary },
    comparison: {
      counts: {
        legacy: legacySummary.counts,
        current: currentSummary.counts,
        delta: {
          human: currentSummary.counts.human - legacySummary.counts.human,
          machine: currentSummary.counts.machine - legacySummary.counts.machine,
        },
      },
      accounting: compareAccounting(legacy.accounting, current.accounting),
      categories: compareCategories(legacySummary, currentSummary, legacy.units, current.units),
      rates: {
        overall: {
          legacy: ratesFor(legacy.units),
          current: ratesFor(current.units),
          delta: rateDelta(ratesFor(legacy.units), ratesFor(current.units)),
        },
        bySource: groupedRateComparison(legacy.units, current.units, 'doc', sourceNames),
        byRegister: groupedRateComparison(legacy.units, current.units, 'register', registerNames),
      },
      changes: changeSet(legacy.records, current.records, opts.exampleLimit),
    },
    decisions: { legacy: legacy.records, current: current.records },
  };
}

function compare(opts = {}) {
  const requested = opts.units || UNITS;
  if (!Array.isArray(requested) || !requested.length || requested.some((unit) => !UNITS.includes(unit))) {
    throw new Error('units must contain paragraph, document, or both');
  }
  const modes = {};
  for (const unit of requested) modes[unit] = compareUnit(unit, opts);
  return {
    generatedBy: 'scripts/fp-compare.js',
    schemaVersion: 1,
    thresholds: THRESHOLDS,
    units: requested,
    modes,
  };
}

function publicSummary(result) {
  return {
    ...result,
    modes: Object.fromEntries(Object.entries(result.modes).map(([unit, value]) => [unit, {
      metadata: value.metadata,
      runs: value.runs,
      comparison: value.comparison,
    }])),
  };
}

function writeArtifacts(directory, result) {
  fs.mkdirSync(directory, { recursive: true });
  const summaryPath = path.join(directory, 'summary.json');
  const decisionsPath = path.join(directory, 'decisions.jsonl');
  for (const filename of [summaryPath, decisionsPath]) {
    if (fs.existsSync(filename)) throw new Error(`Refusing to overwrite existing artifact: ${filename}`);
  }

  const lines = [{
    recordKind: 'meta', generatedBy: result.generatedBy, schemaVersion: result.schemaVersion,
    thresholds: result.thresholds, units: result.units,
  }];
  for (const unit of result.units) {
    for (const preprocess of MODES) {
      for (const record of result.modes[unit].decisions[preprocess]) {
        lines.push({ unit, preprocess, ...record });
      }
    }
  }
  fs.writeFileSync(summaryPath, JSON.stringify(publicSummary(result), null, 2) + '\n', { flag: 'wx' });
  try {
    fs.writeFileSync(decisionsPath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n', { flag: 'wx' });
  } catch (error) {
    fs.unlinkSync(summaryPath);
    throw error;
  }
  return { summaryPath, decisionsPath };
}

function pct(value) {
  return `${(100 * value).toFixed(1)}%`;
}

function report(result) {
  const lines = ['Corpus preprocessing comparison'];
  for (const unit of result.units) {
    const mode = result.modes[unit];
    const sources = mode.metadata.sourceCounts;
    const counts = mode.comparison.counts;
    lines.push('', `${unit}: ${sources.verified} verified source(s), ${sources.unavailable} unavailable`);
    lines.push(`  scored human ${counts.legacy.human} -> ${counts.current.human}; machine ${counts.legacy.machine} -> ${counts.current.machine}`);
    lines.push(`  decisions changed: ${mode.comparison.changes.total} (${mode.comparison.changes.counts.added} added, ${mode.comparison.changes.counts.removed} removed, ${mode.comparison.changes.counts.modified} modified)`);
    lines.push('  threshold       legacy FPR -> current       legacy TPR -> current');
    for (const threshold of THRESHOLDS) {
      const rates = mode.comparison.rates.overall;
      lines.push(`  score >= ${String(threshold).padEnd(3)}   ${pct(rates.legacy[threshold].fpr.rate).padStart(6)} -> ${pct(rates.current[threshold].fpr.rate).padEnd(6)}       ${pct(rates.legacy[threshold].tpr.rate).padStart(6)} -> ${pct(rates.current[threshold].tpr.rate)}`);
    }
    const reasons = mode.comparison.accounting;
    lines.push(`  selected/skipped: ${reasons.legacy.selected}/${reasons.legacy.skipped} -> ${reasons.current.selected}/${reasons.current.skipped}`);
    if (sources.unavailable) {
      const unavailable = mode.metadata.sourceVerification.filter((source) => source.status === 'unavailable').map((source) => source.doc);
      lines.push(`  unavailable: ${unavailable.join(', ')}`);
    }
  }
  return lines.join('\n') + '\n';
}

function parseArgs(args) {
  const outIndexes = args.reduce((found, arg, index) => arg === '--out' ? [...found, index] : found, []);
  if (outIndexes.length > 1) throw new Error('Pass --out DIR at most once');
  let out = null;
  const consumed = new Set();
  if (outIndexes.length) {
    const i = outIndexes[0];
    out = args[i + 1];
    if (!out || out.startsWith('-')) throw new Error('Pass --out DIR with a directory path');
    consumed.add(i); consumed.add(i + 1);
  }
  const jsonIndexes = args.reduce((found, arg, index) => arg === '--json' ? [...found, index] : found, []);
  if (jsonIndexes.length > 1) throw new Error('Pass --json at most once');
  for (const index of jsonIndexes) consumed.add(index);
  if (out && jsonIndexes.length) throw new Error('Choose either --json or --out DIR');
  if (consumed.size !== args.length) throw new Error('Usage: node scripts/fp-compare.js [--json | --out DIR]');
  return { json: jsonIndexes.length === 1, out };
}

function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const result = compare();
  if (options.out) {
    const written = writeArtifacts(options.out, result);
    process.stdout.write(`Wrote ${written.summaryPath}\nWrote ${written.decisionsPath}\n`);
  } else if (options.json) process.stdout.write(JSON.stringify(publicSummary(result), null, 2) + '\n');
  else process.stdout.write(report(result));
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error('Error: ' + error.message); process.exitCode = 2; }
}

module.exports = {
  compare,
  compareUnit,
  changeSet,
  categoryCounts,
  groupedRates,
  publicSummary,
  report,
  writeArtifacts,
  parseArgs,
};
