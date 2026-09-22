#!/usr/bin/env node
/**
 * Avoid AI Writing — detector accuracy measurement
 *
 * The corpus carries two classes, and neither is labelled by a judge:
 *
 *   human    provenance. Public-domain works from 1788–1907, the maintainer's
 *            own pre-2023 blog posts read from web.archive.org, and RAID's
 *            human baseline rows.
 *   machine  RAID's generations, labelled by the people who generated them.
 *
 * So a flag on a human unit is a false positive and a flag on a machine unit
 * is a true positive, by construction rather than by opinion.
 *
 * Reported:
 *   FPR / TPR by threshold, with Wilson intervals
 *   both, split by register and by generating model
 *   ROC-AUC, which needs no threshold at all
 *   which categories fire on which class
 *
 * Usage:
 *   node scripts/fp-measure.js                 # report
 *   node scripts/fp-measure.js --json
 *   node scripts/fp-measure.js --unit document
 *
 * Dependency-free; runs on node >= 18.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const AIDetector = require('../detector/patterns.js');
const { readManifest, rowsFromText, loadText, sha256 } = require('./corpus.js');
const { prepareUnits, normalizeUnit, splitUnits, unitsForText } = require('./fp-preprocess.js');

// Thresholds span the range the detector actually emits, not the range its
// 0-100 scale implies. On real text of either class, paragraph scores top out
// near 10; a table starting at 25 reports 0.0% everywhere and hides that fact
// instead of showing it.
const THRESHOLDS = [3, 5, 10, 15, 25, 50];
const LEGACY_REFERENCE = 'fabd62d9c8785dd0edda35201359bcc635b7d3de';

/** Wilson interval. These rates run near the boundaries, where the normal
 *  approximation produces impossible bounds. */
function wilson(successes, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - spread) / denom), Math.min(1, (centre + spread) / denom)];
}

/**
 * ROC-AUC via the Mann-Whitney U identity, with ties credited a half.
 * Threshold-free, so it survives the fact that this detector's scores are
 * heavily tied near zero.
 */
function rocAuc(posScores, negScores) {
  if (!posScores.length || !negScores.length) return null;
  const all = [...posScores.map((s) => [s, 1]), ...negScores.map((s) => [s, 0])].sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (all[k][1] === 1) rankSum += avgRank;
    i = j + 1;
  }
  const n1 = posScores.length;
  const n0 = negScores.length;
  return (rankSum - (n1 * (n1 + 1)) / 2) / (n1 * n0);
}

const wordCount = (text) => (text.match(/\S+/g) || []).length;

// Frozen preparation from main fabd62d, instrumented without changing which
// text passes its paragraph filter. Both paths use the SAME current detector.
function legacyPrepareUnits(text, mode = 'paragraph') {
  const flatten = (s) => s.replace(/\s+/g, ' ').trim();
  const ranges = [];
  if (mode === 'document') ranges.push({ start: 0, end: text.length });
  else {
    let start = 0;
    for (const match of text.matchAll(/\n\s*\n/g)) {
      ranges.push({ start, end: match.index });
      start = match.index + match[0].length;
    }
    ranges.push({ start, end: text.length });
  }
  return {
    normalizedText: flatten(text),
    decisions: ranges.map((span) => {
      // The legacy separator begins at LF; exclude its preceding CR from the
      // source identity, as the structural scanner does for every line ending.
      if (mode === 'paragraph') {
        while (span.end > span.start && /[\r\n]/.test(text[span.end - 1])) span.end--;
      }
      const normalized = flatten(text.slice(span.start, span.end));
      const inputWords = wordCount(normalized);
      const reason = mode === 'document' ? null : inputWords < 50 ? 'below-min' : inputWords > 400 ? 'above-max' : null;
      return { text: normalized, spans: [span], kinds: ['legacy-flat'], headingAttached: false,
        headingKind: null, inputWords, status: reason ? 'skipped' : 'selected', reason };
    }),
  };
}

function preprocessorFingerprint(preprocess) {
  if (preprocess === 'legacy') {
    return sha256(JSON.stringify({
      implementation: 'legacy-inline',
      reference: LEGACY_REFERENCE,
      dependencies: [wordCount.toString(), legacyPrepareUnits.toString()],
    }));
  }
  return sha256(JSON.stringify({
    implementation: 'structural-module',
    source: fs.readFileSync(path.join(__dirname, 'fp-preprocess.js'), 'utf8'),
  }));
}

function measurementHarnessFingerprint() {
  return sha256(
    fs.readFileSync(__filename, 'utf8')
    + fs.readFileSync(path.join(__dirname, 'fp-preprocess.js'), 'utf8'),
  );
}

function accountingFor(records) {
  const totals = { selected: 0, skipped: 0, unavailableSources: 0, reasons: {} };
  const bySource = {};
  for (const r of records) {
    const bucket = bySource[r.doc] ||= { selected: 0, skipped: 0, unavailableSources: 0, reasons: {} };
    for (const target of [totals, bucket]) {
      if (r.recordKind === 'source') target.unavailableSources++;
      else target[r.status]++;
      if (r.reason) target.reasons[r.reason] = (target.reasons[r.reason] || 0) + 1;
    }
  }
  return { ...totals, bySource };
}

function revision() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

function measure(opts = {}) {
  const manifest = opts.manifest || readManifest();
  const unit = opts.unit || 'paragraph';
  const preprocess = opts.preprocess || 'current';
  if (!['paragraph', 'document'].includes(unit)) throw new Error('Invalid unit: use paragraph or document');
  if (!['current', 'legacy'].includes(preprocess)) throw new Error('Invalid preprocessing: use current or legacy');
  const prepare = preprocess === 'legacy' ? legacyPrepareUnits : prepareUnits;
  const rowsFor = opts.loadRows || null;
  const textFor = opts.loadText || (opts.loadRows ? null : loadText);
  const detector = opts.detector || AIDetector;
  const units = [];
  const skipped = [];
  const records = [];
  const sources = [];
  const rowIdentities = [];

  for (const doc of manifest.documents) {
    const source = { doc: doc.id, expectedSha256: doc.sha256 || null, sha256: null, status: 'injected' };
    let unavailable = false;
    let verifiedText;
    if (textFor) {
      verifiedText = textFor(doc);
      unavailable = verifiedText === null;
      if (!unavailable) {
        source.sha256 = sha256(verifiedText);
        if (!doc.sha256 || source.sha256 !== doc.sha256) throw new Error('Corpus hash mismatch or missing hash: ' + doc.id + '; run corpus.js verify');
        source.status = 'verified';
      }
    }
    // The default path parses the exact bytes just verified. Explicit row
    // loaders remain injectable for tests; they must not trigger a second read.
    const rows = unavailable ? null : rowsFor ? rowsFor(doc) : rowsFromText(doc, verifiedText);
    if (rows === null) {
      source.status = 'unavailable';
      sources.push(source);
      skipped.push(doc.id);
      records.push({ recordKind: 'source', doc: doc.id, rowId: null, status: 'skipped', reason: 'source-unavailable' });
      continue;
    }
    sources.push(source);
    for (const [rowIndex, row] of rows.entries()) {
      if (typeof row.text !== 'string') throw new TypeError('Corpus row text must be a string: ' + doc.id);
      const cls = row.class || doc.class || 'human';
      if (!['human', 'machine'].includes(cls)) throw new Error('Invalid corpus class: ' + cls);
      const rowSourceHash = sha256(row.text);
      rowIdentities.push({ doc: doc.id, rowId: row.id ?? rowIndex, rowIndex, rowSourceHash });
      let index = 0;
      for (const decision of prepare(row.text, unit).decisions) {
        const { text, ...selection } = decision;
        const record = {
          recordKind: 'unit', doc: doc.id, rowId: row.id ?? rowIndex, rowIndex, cls,
          register: row.register || doc.register || 'unknown', model: row.model || null,
          rowSourceHash, ...selection,
          unitId: sha256(JSON.stringify([doc.id, row.id ?? rowIndex, rowIndex, rowSourceHash, decision.spans])),
          normalizedHash: sha256(text), selectionStatus: decision.status,
          index: decision.status === 'selected' ? index++ : null, detectorWords: null, detectorStatus: null,
          score: null, types: [],
        };
        if (decision.status === 'selected') {
          const r = detector.analyzeText(text, { contextMode: 'general', sourceMode: 'plain' });
          record.detectorWords = r.stats?.wordCount ?? null;
          record.detectorStatus = r.label;
          if (r.tooLong || r.label === 'Text too long') record.reason = 'detector-too-long';
          else if (r.tooShort || r.label === 'Too short') record.reason = 'detector-too-short';
          else if (r.label === 'Empty' || r.document_classification === 'UNSCORED') record.reason = 'detector-unscored';
          if (record.reason) record.status = 'skipped';
          else {
            record.score = r.score;
            record.types = r.issues.map((x) => x.type);
            units.push({ ...record, excerpt: text.slice(0, 90) });
          }
        }
        records.push(record);
      }
    }
  }
  const metadata = {
    schemaVersion: 1, unit, preprocess, revision: revision(),
    legacyReference: LEGACY_REFERENCE,
    manifestHash: sha256(JSON.stringify(manifest)), sources, rows: rowIdentities,
    detectorHash: detector === AIDetector ? sha256(fs.readFileSync(path.join(__dirname, '../detector/patterns.js'), 'utf8')) : null,
    measurementHarnessHash: measurementHarnessFingerprint(),
    preprocessorImplementation: preprocess === 'legacy' ? 'legacy-inline' : 'structural-module',
    preprocessorHash: preprocessorFingerprint(preprocess),
    detectorOptions: { contextMode: 'general', sourceMode: 'plain' },
    spanEncoding: 'original UTF-16 code units; start inclusive, end exclusive',
  };
  return { units, skipped, unit, records, metadata, accounting: accountingFor(records) };
}

function rateTable(units, key) {
  const groups = new Map();
  for (const u of units) {
    const g = u[key] || 'unknown';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(u);
  }
  const out = {};
  for (const [g, list] of [...groups.entries()].sort()) {
    out[g] = {};
    for (const t of THRESHOLDS) {
      const flagged = list.filter((u) => u.score >= t).length;
      const [lo, hi] = wilson(flagged, list.length);
      out[g][t] = { n: list.length, flagged, rate: list.length ? flagged / list.length : 0, ci: [lo, hi] };
    }
  }
  return out;
}

function summarize({ units, skipped, unit, accounting, metadata }) {
  const human = units.filter((u) => u.cls === 'human');
  const machine = units.filter((u) => u.cls === 'machine');

  const overall = {};
  for (const t of THRESHOLDS) {
    const fp = human.filter((u) => u.score >= t).length;
    const tp = machine.filter((u) => u.score >= t).length;
    overall[t] = {
      fpr: { n: human.length, flagged: fp, rate: human.length ? fp / human.length : 0, ci: wilson(fp, human.length) },
      tpr: { n: machine.length, flagged: tp, rate: machine.length ? tp / machine.length : 0, ci: wilson(tp, machine.length) },
    };
  }

  const auc = rocAuc(machine.map((u) => u.score), human.map((u) => u.score));

  // Pooling the sources hides the thing worth seeing: RAID is in-domain
  // continuation, HC3 is assistant register, and the detector behaves
  // differently on each.
  const srcOf = (u) => (u.doc.startsWith('cb-') ? 'maintainer-blog' : u.doc);
  const bySource = {};
  for (const src of [...new Set(units.map(srcOf))].sort()) {
    const sub = units.filter((u) => srcOf(u) === src);
    const h = sub.filter((u) => u.cls === 'human').map((u) => u.score);
    const m = sub.filter((u) => u.cls === 'machine').map((u) => u.score);
    bySource[src] = { human: h.length, machine: m.length, auc: rocAuc(m, h) };
  }

  const catByClass = Object.fromEntries(Object.keys(AIDetector.TYPE_LABELS).map((type) => [type, { human: 0, machine: 0 }]));
  for (const u of units) {
    for (const type of new Set(u.types)) {
      catByClass[type] = catByClass[type] || { human: 0, machine: 0 };
      catByClass[type][u.cls]++;
    }
  }
  // A category earns its place by separating the classes. Lift is the ratio of
  // its firing rate on machine text to its rate on human text; below 1 it is
  // firing more often on human writing than on machine writing.
  const discrimination = Object.entries(catByClass).map(([type, c]) => {
    const hr = human.length ? c.human / human.length : 0;
    const mr = machine.length ? c.machine / machine.length : 0;
    return { type, humanRate: hr, machineRate: mr, lift: hr > 0 ? mr / hr : (mr > 0 ? Infinity : 0), n: c.human + c.machine };
  }).sort((a, b) => b.machineRate - a.machineRate);

  return {
    unit,
    counts: { human: human.length, machine: machine.length },
    overall,
    auc,
    bySource,
    byRegister: { human: rateTable(human, 'register'), machine: rateTable(machine, 'register') },
    byModel: rateTable(machine, 'model'),
    discrimination,
    skipped,
    ...(accounting ? { accounting } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function report(s, units) {
  console.log(`\ndetector accuracy — ${s.counts.human} human ${s.unit}s, ${s.counts.machine} machine ${s.unit}s\n`);
  if (s.accounting) {
    console.log(`Scored ${s.accounting.selected} units; skipped ${s.accounting.skipped} units; unavailable sources ${s.accounting.unavailableSources}.`);
    for (const [reason, n] of Object.entries(s.accounting.reasons)) console.log(`  ${reason}: ${n}`);
    console.log('');
  }
  console.log('Human units are human by provenance; machine units are labelled by RAID.');
  console.log('A flag on a human unit is a false positive. A flag on a machine unit is a true positive.\n');

  console.log('  threshold      FPR (95% CI)              TPR (95% CI)');
  for (const t of THRESHOLDS) {
    const o = s.overall[t];
    console.log(
      `  score >= ${String(t).padEnd(3)}`
      + `${pct(o.fpr.rate).padStart(7)} (${pct(o.fpr.ci[0])}–${pct(o.fpr.ci[1])})`.padEnd(26)
      + `${pct(o.tpr.rate).padStart(7)} (${pct(o.tpr.ci[0])}–${pct(o.tpr.ci[1])})`,
    );
  }

  if (s.auc !== null) {
    console.log(`\n  ROC-AUC pooled: ${s.auc.toFixed(3)}   (0.5 = coin flip, 1.0 = perfect separation)`);
  }
  console.log('\n  ROC-AUC by source');
  for (const [src, v] of Object.entries(s.bySource)) {
    const a = v.auc === null ? 'n/a (single class)' : v.auc.toFixed(3);
    console.log(`    ${src.padEnd(18)} human ${String(v.human).padStart(4)}  machine ${String(v.machine).padStart(4)}   AUC ${a}`);
  }

  console.log('\n  TPR by generating model');
  for (const [model, rows] of Object.entries(s.byModel)) {
    const r = rows[25];
    console.log(`    ${model.padEnd(16)} n=${String(r.n).padStart(4)}   ${pct(r.rate).padStart(6)} at >=25`);
  }

  console.log('\n  By register (>=25)');
  const regs = new Set([...Object.keys(s.byRegister.human), ...Object.keys(s.byRegister.machine)]);
  console.log('    register            human n   FPR      machine n   TPR');
  for (const reg of [...regs].sort()) {
    const h = s.byRegister.human[reg] && s.byRegister.human[reg][25];
    const m = s.byRegister.machine[reg] && s.byRegister.machine[reg][25];
    console.log(
      `    ${reg.padEnd(18)}${String(h ? h.n : 0).padStart(7)}${(h ? pct(h.rate) : '-').padStart(8)}`
      + `${String(m ? m.n : 0).padStart(12)}${(m ? pct(m.rate) : '-').padStart(8)}`,
    );
  }

  console.log('\n  Category discrimination (machine rate / human rate)');
  console.log('    category                   human   machine    lift');
  for (const d of s.discrimination.slice(0, 16)) {
    const lift = d.lift === Infinity ? '  inf' : d.lift.toFixed(1).padStart(5);
    console.log(`    ${d.type.padEnd(26)}${pct(d.humanRate).padStart(6)}${pct(d.machineRate).padStart(10)}${lift.padStart(8)}`);
  }

  if (s.skipped.length) {
    console.log(`\n  skipped (unavailable locally): ${s.skipped.join(', ')}`);
  }
  console.log('');
}

function dumpUnits(filename, measured) {
  const lines = [
    { recordKind: 'meta', ...measured.metadata, accounting: measured.accounting },
    ...measured.records,
  ];
  // Dumps are opt-in and contain provenance/hashes, not corpus text.
  fs.writeFileSync(filename, lines.map((r) => JSON.stringify(r)).join('\n') + '\n', { flag: 'wx' });
}

function main() {
  const args = process.argv.slice(2);
  const UNITS = ['paragraph', 'document'];
  const bad = () => {
    console.error('Error: Invalid --unit option. Pass it once as --unit VALUE, with VALUE either "paragraph" or "document".');
    process.exit(2);
  };
  const flags = args.filter((a) => a === '--unit' || a.startsWith('--unit='));
  if (flags.length > 1) bad();

  let unit = 'paragraph';
  if (flags.length === 1) {
    const i = args.indexOf(flags[0]);
    const val = flags[0] === '--unit' ? args[i + 1] : null;
    if (!UNITS.includes(val)) bad();
    unit = val;
  }

  const dumpFlags = args.filter((a) => a === '--dump-units' || a.startsWith('--dump-units='));
  let dump = null;
  if (dumpFlags.length) {
    const flag = dumpFlags[0];
    const value = args[args.indexOf(flag) + 1];
    if (dumpFlags.length !== 1 || flag !== '--dump-units' || !value || value.startsWith('-')) {
      throw new Error('Invalid --dump-units option. Pass it once as --dump-units PATH (a new file).');
    }
    dump = value;
  }
  const consumed = new Set();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--unit' || args[i] === '--dump-units') { consumed.add(i); consumed.add(++i); }
    else if (args[i] === '--json') consumed.add(i);
  }
  if (consumed.size !== args.length) throw new Error('Unknown argument. Use --json, --unit paragraph|document, or --dump-units PATH.');
  const measured = measure({ unit });
  if (dump) dumpUnits(dump, measured);
  const s = summarize(measured);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ generated_by: 'scripts/fp-measure.js', thresholds: THRESHOLDS, ...s }, null, 2));
    return;
  }
  report(s, measured.units);
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error('Error: ' + error.message); process.exitCode = 2; }
}

module.exports = { measure, summarize, wilson, rocAuc, THRESHOLDS, legacyPrepareUnits, accountingFor, dumpUnits, normalizeUnit, splitUnits, unitsForText };
