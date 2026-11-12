#!/usr/bin/env node
/* Tests for scripts/build-vale.js — run by `npm test`. */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AIDetector = require('../detector/patterns.js');
const { build, toGo, STATUS, STATUSES } = require('./build-vale.js');

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; process.stdout.write(`  ✓ ${name}\n`); };
const OUT = path.join(__dirname, '..', 'vale', 'AvoidAIWriting');

t('committed style matches the generator output (run `npm run vale:build`)', () => {
  const files = build();
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(OUT, name);
    assert.ok(fs.existsSync(p), `missing vale/AvoidAIWriting/${name}`);
    assert.strictEqual(fs.readFileSync(p, 'utf8'), content, `stale vale/AvoidAIWriting/${name}`);
  }
  const onDisk = [];
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r); else onDisk.push(r);
    }
  })(OUT, '');
  const extra = onDisk.filter((f) => !(f in files));
  assert.deepStrictEqual(extra, [], 'files in vale/AvoidAIWriting not produced by the generator');
});

t('substitution rules do not expose advice as an automatic replacement', () => {
  for (const [name, content] of Object.entries(build())) {
    if (content.includes('extends: substitution')) assert.doesNotMatch(content, /^action:/m, name);
  }
});

t('PATTERN_TABLES is recursively frozen plain data keyed by detector type', () => {
  const P = AIDetector.PATTERN_TABLES;
  assert.match(P.schemaVersion, /^\d+\.\d+\.\d+$/);
  (function walk(v, at) {
    assert.ok(!(v instanceof RegExp) && typeof v !== 'function', `${at} is not plain data`);
    if (v && typeof v === 'object') {
      assert.ok(Object.isFrozen(v), `${at} is not frozen`);
      for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
    }
  })(P, 'PATTERN_TABLES');
  for (const [type, entry] of Object.entries(P.types)) {
    assert.ok(type in AIDetector.TYPE_LABELS, `PATTERN_TABLES names unknown type '${type}'`);
    for (const p of entry.patterns || []) {
      assert.strictEqual(typeof p.source, 'string');
      assert.strictEqual(new RegExp(p.source, p.flags).source, p.source, `${type}: pattern does not round-trip`);
    }
  }
});

t('the manifest gives every detector type exactly one valid status', () => {
  const manifest = JSON.parse(build()['manifest.json']);
  const types = manifest.types.map((x) => x.type);
  assert.deepStrictEqual([...types].sort(), Object.keys(AIDetector.TYPE_LABELS).sort());
  for (const x of manifest.types) {
    assert.ok(STATUSES.includes(x.status), `${x.type}: bad status '${x.status}'`);
    if (x.status === 'verified' || x.status === 'approximation') assert.ok(x.rules.length > 0, `${x.type} is ${x.status} but has no rule`);
    if (x.status === 'unsupported' || x.status === 'unassessed') assert.deepStrictEqual(x.rules, [], `${x.type} is ${x.status} but has rules`);
    if (x.status === 'approximation' || x.status === 'unsupported') assert.ok(x.reason, `${x.type} needs a reason`);
  }
  for (const type of Object.keys(STATUS)) assert.ok(type in AIDetector.TYPE_LABELS, `STATUS names unknown type '${type}'`);
  // A verified type has no gate anywhere in its exported data.
  for (const x of manifest.types.filter((y) => y.status === 'verified')) {
    assert.ok(!JSON.stringify(AIDetector.PATTERN_TABLES.types[x.type]).includes('"gate"'), `${x.type} is gated but marked verified`);
  }
  const sha = crypto.createHash('sha256').update(JSON.stringify(AIDetector.PATTERN_TABLES)).digest('hex');
  assert.strictEqual(manifest.source.sha256, sha);
});

t('toGo keeps backreferences and rewrites \\u escapes', () => {
  assert.strictEqual(toGo(/(\w+)\s+\1/), '(\\w+)\\s+\\1');
  // A string-built pattern keeps the \u escape in .source; it must become \x{...} for RE2.
  assert.strictEqual(toGo(new RegExp("don['\\u2019]t")), "don['\\x{2019}]t");
  assert.strictEqual(toGo(/\bmoreover\b/gi), '\\bmoreover\\b');
  for (const flags of ['s', 'u', 'y', 'gis']) assert.throws(() => toGo(new RegExp('a', flags)), /cannot port flags/);
});

t('rule files declare a level Vale accepts and a message with one match placeholder', () => {
  const files = build();
  for (const [name, content] of Object.entries(files)) {
    if (!name.endsWith('.yml')) continue;
    assert.match(content, /^level: (error|warning|suggestion)$/m, `${name}: bad level`);
    const msg = content.match(/^message: '(.*)'$/m);
    assert.ok(msg, `${name}: no message`);
    const placeholders = (msg[1].match(/%[sd]/g) || []).length;
    assert.ok(placeholders >= 1 && placeholders <= 2, `${name}: ${placeholders} placeholders`);
  }
});

t('the README reports the counts the generator computed', () => {
  const files = build();
  const readme = files['README.md'];
  const { counts } = JSON.parse(files['manifest.json']);
  const yml = Object.keys(files).filter((f) => f.endsWith('.yml')).length;
  assert.ok(readme.includes(`across ${yml} rule files`), 'rule-file count in README is stale');
  assert.ok(readme.includes(`exposes ${Object.keys(AIDetector.TYPE_LABELS).length} issue types`), 'type count in README is stale');
  assert.ok(readme.includes(`${counts.verified} verified, ${counts.approximation} approximation, ${counts.unsupported} unsupported, ${counts.unassessed} unassessed`), 'status counts in README are stale');
});

t('`--check` exits nonzero on a rule file the generator no longer emits', () => {
  // Run the CLI in a private copy of the files it reads, so the shared style
  // directory is never touched.
  const { spawnSync } = require('child_process');
  const os = require('os');
  const root = path.join(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-vale-check-'));
  try {
    for (const rel of ['scripts/build-vale.js', 'detector', 'LICENSE', 'vale/AvoidAIWriting']) {
      fs.cpSync(path.join(root, rel), path.join(tmp, rel), { recursive: true });
    }
    const script = path.join(tmp, 'scripts', 'build-vale.js');
    const clean = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    assert.strictEqual(clean.status, 0, `clean copy must pass --check: ${clean.stderr}`);
    fs.writeFileSync(path.join(tmp, 'vale', 'AvoidAIWriting', 'Leftover.yml'), 'extends: existence\n');
    const res = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    assert.strictEqual(res.status, 1, 'a leftover rule must fail --check');
    assert.match(res.stderr, /extra: vale\/AvoidAIWriting\/Leftover\.yml/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

process.stdout.write(`\n${passed} passed\n`);
