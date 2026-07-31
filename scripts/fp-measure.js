#!/usr/bin/env node
/**
 * Avoid AI Writing — false-positive measurement
 *
 * Every document in `corpus/manifest.json` was written by a person. So every
 * paragraph this detector flags is a false positive, by construction. No
 * labelling, no judge, no model in the loop: the ground truth is provenance.
 *
 * What this measures and what it does not:
 *
 *   measured      false-positive rate, by register, at several score thresholds
 *   measured      which categories cause the false positives
 *   NOT measured  true-positive rate. That needs machine-written text with
 *                 known provenance, which is a separate corpus and a separate
 *                 argument. An FP rate alone says how often the tool cries wolf,
 *                 not how often it is right.
 *
 * Usage:
 *   node scripts/fp-measure.js                 # report
 *   node scripts/fp-measure.js --json          # machine-readable
 *   node scripts/fp-measure.js --threshold 40  # single threshold
 *   node scripts/fp-measure.js --unit document # score whole documents
 *
 * Dependency-free; runs on node >= 18.
 */

const path = require('node:path');
const AIDetector = require('../detector/patterns.js');
const { readManifest, loadText } = require('./corpus.js');

/** Score thresholds reported as a curve. One number would hide the trade. */
const THRESHOLDS = [25, 40, 50, 65];

/**
 * Paragraphs shorter than this are skipped. The detector no-ops under ~10
 * words, and short fragments produce unstable scores that would swamp the rate
 * with noise rather than signal.
 */
const MIN_WORDS = 50;
const MAX_WORDS = 400;

/**
 * Wilson score interval. Preferred over the normal approximation because these
 * rates run near zero, where the normal interval produces negative lower
 * bounds and implies precision the sample does not have.
 */
function wilson(successes, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [
    Math.max(0, (centre - spread) / denom),
    Math.min(1, (centre + spread) / denom),
  ];
}

function splitParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => {
      const n = (p.match(/\S+/g) || []).length;
      return n >= MIN_WORDS && n <= MAX_WORDS;
    });
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function measure(opts = {}) {
  const manifest = readManifest();
  const unit = opts.unit || 'paragraph';
  const rows = [];
  const skipped = [];

  for (const doc of manifest.documents) {
    const text = loadText(doc);
    if (text === null) {
      skipped.push(doc.id);
      continue;
    }
    const units = unit === 'document' ? [text.replace(/\s+/g, ' ').trim()] : splitParagraphs(text);
    for (const [i, chunk] of units.entries()) {
      const r = AIDetector.analyzeText(chunk);
      if (r.tooShort || r.label === 'Text too long') continue;
      rows.push({
        doc: doc.id,
        register: doc.register,
        index: i,
        words: r.stats.wordCount,
        score: r.score,
        types: r.issues.map((issue) => issue.type),
        // Kept for triage: the first 90 characters of a flagged unit is enough
        // to find it in the source without reproducing the source.
        excerpt: chunk.slice(0, 90),
      });
    }
  }
  return { rows, skipped, unit };
}

function summarize({ rows, skipped, unit }) {
  const registers = [...new Set(rows.map((r) => r.register))].sort();
  const overall = {};
  const byRegister = {};

  for (const t of THRESHOLDS) {
    const flagged = rows.filter((r) => r.score >= t).length;
    const [lo, hi] = wilson(flagged, rows.length);
    overall[t] = { n: rows.length, flagged, rate: rows.length ? flagged / rows.length : 0, ci: [lo, hi] };
  }

  for (const reg of registers) {
    const sub = rows.filter((r) => r.register === reg);
    byRegister[reg] = {};
    for (const t of THRESHOLDS) {
      const flagged = sub.filter((r) => r.score >= t).length;
      const [lo, hi] = wilson(flagged, sub.length);
      byRegister[reg][t] = { n: sub.length, flagged, rate: sub.length ? flagged / sub.length : 0, ci: [lo, hi] };
    }
  }

  // Category attribution at the middle threshold: which rules are doing the
  // damage. A rate without this is a complaint; with it, it is a work list.
  const attribThreshold = 50;
  const counts = new Map();
  for (const r of rows.filter((x) => x.score >= attribThreshold)) {
    for (const type of new Set(r.types)) counts.set(type, (counts.get(type) || 0) + 1);
  }
  const attribution = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  // Categories that fire on human prose at all, regardless of unit score. A
  // rule that never fires on 50k words of human writing is well targeted; one
  // that fires constantly without pushing units over threshold is still noise
  // in detect mode, where every flag is shown to the user.
  const allCounts = new Map();
  for (const r of rows) {
    for (const type of new Set(r.types)) allCounts.set(type, (allCounts.get(type) || 0) + 1);
  }
  const everyFlag = [...allCounts.entries()].sort((a, b) => b[1] - a[1]);

  return { overall, byRegister, attribution, everyFlag, attribThreshold, registers, skipped, unit, totalUnits: rows.length };
}

function report(s, rows) {
  console.log(`\nfalse-positive measurement — ${s.totalUnits} human-written ${s.unit}s\n`);
  console.log('Every unit below was written by a person, so every flag is a false positive.\n');

  console.log('  Overall');
  console.log('  threshold      n  flagged     rate   95% CI');
  for (const t of THRESHOLDS) {
    const o = s.overall[t];
    console.log(
      `  score >= ${String(t).padEnd(3)}${String(o.n).padStart(5)}${String(o.flagged).padStart(9)}${pct(o.rate).padStart(9)}   ${pct(o.ci[0])}–${pct(o.ci[1])}`,
    );
  }

  console.log('\n  By register');
  console.log('  register              n   >=25    >=40    >=50    >=65');
  for (const reg of s.registers) {
    const b = s.byRegister[reg];
    console.log(
      `  ${reg.padEnd(18)}${String(b[25].n).padStart(4)}  ${THRESHOLDS.map((t) => pct(b[t].rate).padStart(6)).join('  ')}`,
    );
  }

  console.log(`\n  Categories causing false positives at score >= ${s.attribThreshold}`);
  if (!s.attribution.length) {
    console.log('    none — no unit crossed the threshold');
  } else {
    for (const [type, n] of s.attribution.slice(0, 12)) {
      console.log(`    ${type.padEnd(28)} ${String(n).padStart(4)} unit(s)`);
    }
  }

  console.log('\n  Categories firing on human prose at any score');
  for (const [type, n] of s.everyFlag.slice(0, 15)) {
    console.log(`    ${type.padEnd(28)} ${String(n).padStart(4)} / ${s.totalUnits} units (${pct(n / s.totalUnits)})`);
  }

  const worst = [...rows].sort((a, b) => b.score - a.score).slice(0, 5);
  if (worst.length) {
    console.log('\n  Worst-scoring human paragraphs');
    for (const w of worst) {
      console.log(`    ${String(w.score).padStart(3)}  ${w.doc}  ${JSON.stringify(w.excerpt.slice(0, 66))}`);
    }
  }

  if (s.skipped.length) {
    console.log(`\n  skipped (text unavailable locally): ${s.skipped.join(', ')}`);
    console.log('  run: node scripts/corpus.js fetch');
  }

  console.log('\n  This is a false-positive rate only. No true-positive rate is claimed,');
  console.log('  because the corpus contains no machine-written text.\n');
}

function main() {
  const args = process.argv.slice(2);
  const unit = args.includes('--unit') ? args[args.indexOf('--unit') + 1] : 'paragraph';
  const measured = measure({ unit });
  const s = summarize(measured);

  if (args.includes('--json')) {
    console.log(JSON.stringify({
      generated_by: 'scripts/fp-measure.js',
      unit: s.unit,
      total_units: s.totalUnits,
      thresholds: THRESHOLDS,
      overall: s.overall,
      by_register: s.byRegister,
      attribution_at_50: s.attribution,
      firing_at_any_score: s.everyFlag,
      skipped: s.skipped,
    }, null, 2));
    return;
  }
  report(s, measured.rows);
}

if (require.main === module) main();

module.exports = { measure, summarize, wilson, THRESHOLDS };
