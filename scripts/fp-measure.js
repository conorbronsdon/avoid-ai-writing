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

const AIDetector = require('../detector/patterns.js');
const { readManifest, loadRows } = require('./corpus.js');

// Thresholds span the range the detector actually emits, not the range its
// 0-100 scale implies. On real text of either class, paragraph scores top out
// near 10; a table starting at 25 reports 0.0% everywhere and hides that fact
// instead of showing it.
const THRESHOLDS = [3, 5, 10, 15, 25, 50];

/**
 * Units shorter than this are skipped: the detector no-ops under ~10 words and
 * short fragments produce unstable scores that would swamp the rates with
 * noise. The ceiling keeps one long document from dominating.
 */
const MIN_WORDS = 50;
const MAX_WORDS = 400;

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

function splitUnits(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => {
      const n = (p.match(/\S+/g) || []).length;
      return n >= MIN_WORDS && n <= MAX_WORDS;
    });
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

function measure(opts = {}) {
  const manifest = readManifest();
  const unit = opts.unit || 'paragraph';
  const units = [];
  const skipped = [];

  for (const doc of manifest.documents) {
    const rows = loadRows(doc);
    if (rows === null) { skipped.push(doc.id); continue; }
    for (const row of rows) {
      const chunks = unit === 'document'
        ? [row.text.replace(/\s+/g, ' ').trim()]
        : splitUnits(row.text);
      for (const [i, chunk] of chunks.entries()) {
        const r = AIDetector.analyzeText(chunk);
        if (r.tooShort || r.label === 'Text too long') continue;
        units.push({
          doc: doc.id,
          rowId: row.id,
          cls: row.class || 'human',
          register: row.register || doc.register,
          model: row.model || null,
          index: i,
          score: r.score,
          types: r.issues.map((x) => x.type),
          excerpt: chunk.slice(0, 90),
        });
      }
    }
  }
  return { units, skipped, unit };
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

function summarize({ units, skipped, unit }) {
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

  const catByClass = {};
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
  };
}

function report(s, units) {
  console.log(`\ndetector accuracy — ${s.counts.human} human ${s.unit}s, ${s.counts.machine} machine ${s.unit}s\n`);
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

function main() {
  const args = process.argv.slice(2);
  const unit = args.includes('--unit') ? args[args.indexOf('--unit') + 1] : 'paragraph';
  const measured = measure({ unit });
  const s = summarize(measured);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ generated_by: 'scripts/fp-measure.js', thresholds: THRESHOLDS, ...s }, null, 2));
    return;
  }
  report(s, measured.units);
}

if (require.main === module) main();

module.exports = { measure, summarize, wilson, rocAuc, THRESHOLDS };
