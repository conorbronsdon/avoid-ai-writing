#!/usr/bin/env node
/*
 * Runs vale/fixtures/cases.json through a pinned Vale binary and the detector.
 * Run by `npm test`.
 *
 * Every rule file the generator writes needs a case that fires and a case that
 * must not. Each case states whether Vale alerts (`vale`) and whether
 * analyzeText reports the rule's type (`detector`); where the two differ, `why`
 * records the known difference. Detector findings must also carry the severity
 * the rule's Vale level was mapped from.
 *
 * Vale comes from VALE_BIN or PATH and must be the version pinned in the cases
 * file. Without it the suite skips, unless VALE_REQUIRED is set: the detector
 * workflow sets it, so CI cannot pass there without running the cases.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const AIDetector = require('../detector/patterns.js');
const { build } = require('./build-vale.js');

const ROOT = path.join(__dirname, '..');
const STYLE = 'AvoidAIWriting';
const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'vale', 'fixtures', 'cases.json'), 'utf8'));
const LEVEL = { critical: 'error', high: 'warning', medium: 'suggestion', low: 'suggestion' };

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; process.stdout.write(`  ✓ ${name}\n`); };

function skipOrFail(reason) {
  if (process.env.VALE_REQUIRED) { console.error(`vale-cases: ${reason}`); process.exit(1); }
  console.log(`  - skipped: ${reason}. Install Vale ${CASES.valeVersion} or set VALE_BIN to run the Vale cases.`);
  process.exit(0);
}

const VALE = process.env.VALE_BIN || 'vale';
const version = spawnSync(VALE, ['--version'], { encoding: 'utf8' });
if (version.error || version.status !== 0) skipOrFail(`no Vale binary at '${VALE}'`);
const found = (version.stdout.match(/\d+\.\d+\.\d+/) || [])[0];
if (found !== CASES.valeVersion) skipOrFail(`Vale ${found} found, cases are pinned to ${CASES.valeVersion}`);

// ─── rules and their detector types, from the generator ───────────────
const files = build();
const manifest = JSON.parse(files['manifest.json']);
const ruleFiles = Object.keys(files).filter((f) => f.endsWith('.yml'));
const ruleName = (file) => file.replace(/\.yml$/, '').split('/').pop();
const typeOf = {};
for (const entry of manifest.types) {
  for (const rule of entry.rules) {
    const name = rule.slice(STYLE.length + 1);
    if (name.endsWith('.*')) {
      const dir = name.slice(0, -2);
      for (const f of ruleFiles) if (f.startsWith(`${dir}/`)) typeOf[ruleName(f)] = entry.type;
    } else typeOf[name] = entry.type;
  }
}
const levelOf = Object.fromEntries(ruleFiles.map((f) => [ruleName(f), files[f].match(/^level: (\w+)$/m)[1]]));

// ─── cases ────────────────────────────────────────────────────────────
const cases = [];
for (const [rule, list] of Object.entries(CASES.rules)) {
  for (const c of list) cases.push({ rule, ...c });
}
const pad = 'The team wrote this short note for the weekly summary and shared it with the group.';
for (const f of ruleFiles.filter((x) => x.startsWith('overuse/'))) {
  const word = AIDetector.PATTERN_TABLES.types.tier3.words.find((w) => w.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').map((x) => x[0].toUpperCase() + x.slice(1)).join('') === ruleName(f));
  assert.ok(word, `missing source word for ${f}`);
  const uses = (n) => Array.from({ length: n }, (_, i) => `Report ${i + 1} was ${word} for us.`).join(' ');
  cases.push({ rule: ruleName(f), id: 'fire', text: `${uses(3)} ${pad}`, vale: true, detector: true });
  cases.push({ rule: ruleName(f), id: 'near-miss', text: `${uses(2)} ${pad}`, vale: false, detector: false });
  for (const [id, near] of [['prefix', `un${word}`], ['suffix', `${word}x`], ['hyphen-prefix', `non-${word}`], ['possessive', `${word}'s`]]) {
    cases.push({ rule: ruleName(f), id, text: `${Array(3).fill(near).join(' ')} ${pad}`, vale: false, detector: false });
  }
}
for (const [rule, phrase] of Object.entries(CASES.occurrence.boilerplate)) {
  const uses = (n) => Array.from({ length: n }, (_, i) => `Note ${i + 1} mentioned ${phrase} again.`).join(' ');
  cases.push({ rule, id: 'fire', text: `${uses(2)} ${pad}`, vale: true, detector: true });
  cases.push({ rule, id: 'near-miss', text: `${uses(1)} ${pad}`, vale: false, detector: false });
}
const boundary = CASES.boundaryFrom;
for (const c of JSON.parse(fs.readFileSync(path.join(ROOT, boundary.file), 'utf8')).cases) {
  cases.push({ rule: boundary.rule, id: `draft-${c.id}`, text: c.text, vale: boundary.vale[c.id], detector: c.detector });
}

// ─── run Vale once over every case ────────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vale-cases-'));
fs.writeFileSync(path.join(dir, '.vale.ini'), [
  `StylesPath = ${path.join(ROOT, 'vale')}`,
  'MinAlertLevel = suggestion',
  `[*.{md,txt}]`,
  `BasedOnStyles = ${STYLE}`,
  '',
].join('\n'));
cases.forEach((c, i) => { c.file = `${String(i).padStart(3, '0')}-${c.rule}-${c.id}.${c.ext || 'md'}`; fs.writeFileSync(path.join(dir, c.file), `${c.text}\n`); });
const run = spawnSync(VALE, ['--output', 'JSON', ...cases.map((c) => c.file)], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
fs.rmSync(dir, { recursive: true, force: true });
assert.ok(run.status === 0 || run.status === 1, `vale exited ${run.status}: ${run.stderr}`);
const alerts = JSON.parse(run.stdout || '{}');
const valeFires = (c) => (alerts[c.file] || []).filter((a) => a.Check.split('.').pop() === c.rule);

// ─── tests ────────────────────────────────────────────────────────────
t('every rule file has a case that fires and a case that must not', () => {
  for (const f of ruleFiles) {
    const name = ruleName(f);
    assert.ok(cases.some((c) => c.rule === name && c.vale === true), `${f}: no case where it fires`);
    assert.ok(cases.some((c) => c.rule === name && c.vale === false), `${f}: no must-not-fire case`);
  }
  for (const rule of Object.keys(CASES.rules)) assert.ok(rule in levelOf, `cases name unknown rule '${rule}'`);
});

t(`Vale ${CASES.valeVersion} alerts exactly where each case says`, () => {
  const wrong = cases.filter((c) => (valeFires(c).length > 0) !== c.vale)
    .map((c) => `${c.rule}/${c.id}: expected ${c.vale ? 'an alert' : 'no alert'}`);
  assert.deepStrictEqual(wrong, []);
});

t('the detector reports the rule type exactly where each case says', () => {
  const wrong = cases.filter((c) => AIDetector.analyzeText(c.text).issues.some((i) => i.type === typeOf[c.rule]) !== c.detector)
    .map((c) => `${c.rule}/${c.id}: expected ${c.detector ? '' : 'no '}'${typeOf[c.rule]}'`);
  assert.deepStrictEqual(wrong, []);
});

t('every difference between Vale and the detector says why', () => {
  for (const c of Object.entries(CASES.rules).flatMap(([rule, list]) => list.map((x) => ({ rule, ...x })))) {
    if (c.vale !== c.detector) assert.ok(c.why, `${c.rule}/${c.id}: Vale and the detector differ with no 'why'`);
  }
});

t('verified rules use the level mapped from the severity the detector reports', () => {
  // Approximations pick their level on purpose (Tier 2 is a suggestion); verified rules mirror the engine.
  const verified = new Set(manifest.types.filter((x) => x.status === 'verified').map((x) => x.type));
  for (const c of cases.filter((x) => x.detector && verified.has(typeOf[x.rule]))) {
    for (const issue of AIDetector.analyzeText(c.text).issues.filter((i) => i.type === typeOf[c.rule])) {
      assert.strictEqual(levelOf[c.rule], LEVEL[issue.severity], `${c.rule}: level ${levelOf[c.rule]} but the detector reports '${issue.severity}'`);
    }
  }
});

process.stdout.write(`\n${passed} passed (${cases.length} cases)\n`);
