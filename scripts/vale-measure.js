#!/usr/bin/env node
/**
 * Measure the generated Vale style against the same corpus the detector is
 * measured on (corpus/cache, populated by `node scripts/corpus.js fetch`).
 *
 * Two questions:
 *  1. Parity. For every ported existence rule, does Vale report one alert per
 *     span the detector's own regexes match on identical plain text? Spans are
 *     merged when two patterns of one type overlap, because Vale compiles a
 *     type's tokens into one alternation and reports a region once where the
 *     engine lists each pattern. A gap after merging means a regex behaves
 *     differently under Vale's regex engine than under V8.
 *  2. Rates. Alerts per 1,000 words and share of documents with at least one
 *     alert, split by class (human = false positive, machine = true positive),
 *     per rule and per level. Numbers for the JS detector do not transfer to
 *     this style; these are the style's own.
 *
 * Usage: VALE_BIN=/path/to/vale node scripts/vale-measure.js [--json] [--docs]
 *   --docs  measure the repository's own Markdown (which quotes most tells) as
 *           plain text instead of corpus/cache; parity only, no rates.
 * Needs: corpus/cache populated; vale on PATH or VALE_BIN.
 *
 * Every document in corpus/manifest.json is measured. A missing file or one whose
 * hash no longer matches the manifest stops the run, so a published number
 * always covers the whole recorded corpus. The output starts with what a re-run
 * needs to match: the manifest's hash, the row counts, the Vale version, and the
 * hash of the pattern data the style was built from.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const corpus = require('./corpus.js');
const { EXISTENCE_RULES, ruleRegexes } = require('./build-vale.js');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'corpus', 'cache');
const VALE = process.env.VALE_BIN || 'vale';
const STYLE = 'AvoidAIWriting';

function mergedSpanCount(text, regs) {
  const spans = [];
  for (const r of regs) {
    for (const m of text.matchAll(new RegExp(r.source, r.flags.includes('g') ? r.flags : r.flags + 'g'))) {
      if (m[0].length) spans.push([m.index, m.index + m[0].length]);
    }
  }
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let n = 0, end = -1;
  for (const [a, b] of spans) { if (a >= end) { n++; end = b; } else if (b > end) end = b; }
  return n;
}

const REPO_DOCS = ['references/patterns.md', 'SKILL.full.md', 'README.md', 'CHANGELOG.md', 'detector/README.md', 'detector/CATEGORIES.md'];

function loadDocs() {
  if (process.argv.includes('--docs')) {
    return REPO_DOCS.map((f) => ({ id: f, cls: 'docs', register: 'docs', text: fs.readFileSync(path.join(ROOT, f), 'utf8') }));
  }
  const manifest = corpus.readManifest();
  const docs = [];
  const problems = [];
  for (const d of manifest.documents) {
    const text = corpus.loadText(d);
    if (text === null) { problems.push(`missing   ${d.id}`); continue; }
    if (corpus.sha256(text) !== d.sha256) { problems.push(`drift     ${d.id}`); continue; }
    for (const r of corpus.rowsFromText(d, text)) docs.push({ id: r.id, cls: r.class, register: r.register, text: r.text });
  }
  if (problems.length) {
    console.error(problems.map((x) => `  ${x}`).join('\n'));
    console.error(`\n${problems.length} corpus document(s) unavailable or changed. Run \`node scripts/corpus.js fetch\`, then \`node scripts/corpus.js verify\`.`);
    process.exit(1);
  }
  return docs;
}

function wordCount(t) { return (t.match(/\S+/g) || []).length; }

function runVale(dir) {
  const out = execFileSync(VALE, ['--config', path.join(dir, '.vale.ini'), '--output', 'JSON', '--no-exit', dir],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  return out.trim() ? JSON.parse(out) : {};
}

function main() {
  const docs = loadDocs();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaw-vale-'));
  fs.writeFileSync(path.join(tmp, '.vale.ini'),
    `StylesPath = ${path.join(ROOT, 'vale')}\nMinAlertLevel = suggestion\n\n[*.txt]\nBasedOnStyles = ${STYLE}\n`);
  const byFile = new Map();
  docs.forEach((d, i) => {
    const f = path.join(tmp, `${String(i).padStart(4, '0')}.txt`);
    fs.writeFileSync(f, d.text.endsWith('\n') ? d.text : d.text + '\n');
    byFile.set(f, d);
  });
  const alerts = runVale(tmp);

  // Per-doc alert lists
  const perDoc = new Map(docs.map((d) => [d, []]));
  for (const [file, list] of Object.entries(alerts)) {
    const d = byFile.get(path.resolve(file)) || byFile.get(file);
    if (d) perDoc.get(d).push(...list);
  }

  // 1. Parity on existence rules
  const parity = [];
  for (const rule of EXISTENCE_RULES) {
    const regs = ruleRegexes(rule.type);
    let js = 0, vale = 0;
    for (const d of docs) {
      js += mergedSpanCount(d.text, regs);
      vale += perDoc.get(d).filter((a) => a.Check === `${STYLE}.${rule.file}`).length;
    }
    parity.push({ rule: rule.file, js, vale, diff: vale - js });
  }

  // 2. Rates per class
  const classes = ['human', 'machine'];
  const totals = {};
  for (const c of classes) {
    const ds = docs.filter((d) => d.cls === c);
    totals[c] = { docs: ds.length, words: ds.reduce((a, d) => a + wordCount(d.text), 0) };
  }
  const rules = new Set();
  for (const list of perDoc.values()) for (const a of list) rules.add(a.Check);
  const rateRows = [];
  for (const check of [...rules].sort()) {
    const row = { check };
    for (const c of classes) {
      const ds = docs.filter((d) => d.cls === c);
      const n = ds.reduce((a, d) => a + perDoc.get(d).filter((x) => x.Check === check).length, 0);
      const docsHit = ds.filter((d) => perDoc.get(d).some((x) => x.Check === check)).length;
      row[c] = { alerts: n, per1k: totals[c].words ? (1000 * n) / totals[c].words : 0, docShare: ds.length ? docsHit / ds.length : 0 };
    }
    rateRows.push(row);
  }
  const levelRows = [];
  for (const level of ['error', 'warning', 'suggestion']) {
    const row = { level };
    for (const c of classes) {
      const ds = docs.filter((d) => d.cls === c);
      const hit = ds.filter((d) => perDoc.get(d).some((x) => x.Severity === level)).length;
      row[c] = ds.length ? hit / ds.length : 0;
    }
    levelRows.push(row);
  }

  const provenance = {
    corpusManifestSha256: corpus.sha256(fs.readFileSync(path.join(ROOT, 'corpus', 'manifest.json'), 'utf8').replace(/\r\n/g, '\n')),
    corpusDocuments: process.argv.includes('--docs') ? 0 : corpus.readManifest().documents.length,
    vale: execFileSync(VALE, ['--version'], { encoding: 'utf8' }).trim(),
    patternTablesSha256: JSON.parse(fs.readFileSync(path.join(ROOT, 'vale', STYLE, 'manifest.json'), 'utf8')).source.sha256,
  };
  const result = { provenance, docs: totals, parity, rates: rateRows, docShareByLevel: levelRows, examples: {} };
  // A few human false-positive examples per rule, for the eyeball check.
  for (const d of docs.filter((x) => x.cls === 'human')) {
    for (const a of perDoc.get(d)) {
      const ex = (result.examples[a.Check] ||= []);
      if (ex.length < 3) ex.push({ doc: d.id, match: a.Match });
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  if (process.argv.includes('--json')) { console.log(JSON.stringify(result, null, 2)); return; }
  if (process.argv.includes('--docs')) {
    console.log(`Repository docs as plain text: ${docs.length} files\n`);
    console.log('Parity (existence rules): detector regex spans (overlaps merged) vs Vale alerts on identical text');
    for (const p of parity) console.log(`  ${p.rule.padEnd(24)} js=${String(p.js).padStart(5)} vale=${String(p.vale).padStart(5)} ${p.diff ? 'DIFF ' + p.diff : ''}`);
    return;
  }
  const pct = (x) => `${(100 * x).toFixed(1)}%`;
  console.log(`corpus/manifest.json sha256 ${provenance.corpusManifestSha256} (${provenance.corpusDocuments} documents)`);
  console.log(`${provenance.vale}; pattern data sha256 ${provenance.patternTablesSha256}\n`);
  console.log(`Corpus: human ${totals.human.docs} docs / ${totals.human.words.toLocaleString()} words; machine ${totals.machine.docs} docs / ${totals.machine.words.toLocaleString()} words\n`);
  console.log('Parity (existence rules): detector regex spans (overlaps merged) vs Vale alerts on identical text');
  for (const p of parity) console.log(`  ${p.rule.padEnd(24)} js=${String(p.js).padStart(5)} vale=${String(p.vale).padStart(5)} ${p.diff ? 'DIFF ' + p.diff : ''}`);
  console.log('\nShare of documents with at least one alert, by level');
  for (const r of levelRows) console.log(`  ${r.level.padEnd(11)} human(FP) ${pct(r.human).padStart(6)}   machine(TP) ${pct(r.machine).padStart(6)}`);
  console.log('\nPer rule: alerts per 1k words and share of docs hit');
  console.log(`  ${'rule'.padEnd(40)} ${'human/1k'.padStart(9)} ${'humanDocs'.padStart(10)} ${'mach/1k'.padStart(9)} ${'machDocs'.padStart(9)}`);
  for (const r of rateRows) console.log(`  ${r.check.padEnd(40)} ${r.human.per1k.toFixed(2).padStart(9)} ${pct(r.human.docShare).padStart(10)} ${r.machine.per1k.toFixed(2).padStart(9)} ${pct(r.machine.docShare).padStart(9)}`);
}

if (require.main === module) main();
