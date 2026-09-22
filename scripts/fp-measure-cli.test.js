#!/usr/bin/env node
/* Tests for scripts/fp-measure.js CLI option validation — run by `npm test`. */
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { sha256 } = require('./corpus.js');

// Exercise the real CLI against a tiny verified cache, independent of local
// downloads. Populating the full corpus must not make npm test run it repeatedly.
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-measure-cli-'));
process.on('exit', () => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
for (const directory of ['scripts', 'detector', 'corpus/cache']) fs.mkdirSync(path.join(fixtureRoot, directory), { recursive: true });
for (const file of ['scripts/fp-measure.js', 'scripts/fp-preprocess.js', 'scripts/corpus.js', 'detector/patterns.js']) {
  fs.copyFileSync(path.join(__dirname, '..', file), path.join(fixtureRoot, file));
}
const fixtureText = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
fs.writeFileSync(path.join(fixtureRoot, 'corpus/cache/fixture.txt'), fixtureText);
fs.writeFileSync(path.join(fixtureRoot, 'corpus/manifest.json'), JSON.stringify({ documents: [
  { id: 'fixture', class: 'human', register: 'docs', source: { type: 'url' }, sha256: sha256(fixtureText) },
] }));
const CLI = path.join(fixtureRoot, 'scripts/fp-measure.js');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

// Invalid invocations must exit with code 2, write stderr naming accepted values, and emit no stdout JSON
const invalidCases = [
  ['--unit typo', ['--unit', 'typo']],
  ['--unit typo --json', ['--unit', 'typo', '--json']],
  ['trailing --unit', ['--unit']],
  ['--unit --json', ['--unit', '--json']],
  ['--unit=document equals syntax', ['--unit=document']],
  ['--unit paragraph --unit typo', ['--unit', 'paragraph', '--unit', 'typo']],
  ['--unit paragraph --unit document', ['--unit', 'paragraph', '--unit', 'document']],
  ['--unit paragraph --unit trailing', ['--unit', 'paragraph', '--unit']],
];

for (const [label, args] of invalidCases) {
  const res = run(args);
  assert.strictEqual(res.status, 2, `${label}: expected exit status 2`);
  assert.strictEqual(res.stdout, '', `${label}: expected empty stdout`);
  assert.ok(res.stderr.includes('paragraph'), `${label}: expected stderr to name "paragraph"`);
  assert.ok(res.stderr.includes('document'), `${label}: expected stderr to name "document"`);
}

// Valid invocations exit with code 0 and report correct unit in JSON
const validCases = [
  ['default unit (omitted)', ['--json'], 'paragraph'],
  ['explicit paragraph', ['--unit', 'paragraph', '--json'], 'paragraph'],
  ['explicit document', ['--unit', 'document', '--json'], 'document'],
];

for (const [label, args, expectedUnit] of validCases) {
  const res = run(args);
  assert.strictEqual(res.status, 0, `${label}: expected exit status 0, stderr: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.unit, expectedUnit, `${label}: expected unit ${expectedUnit}`);
}

const dumpPath = path.join(fixtureRoot, 'units.jsonl');
const dumped = run(['--json', '--dump-units', dumpPath]);
assert.strictEqual(dumped.status, 0, dumped.stderr);
const records = fs.readFileSync(dumpPath, 'utf8').trim().split('\n').map(JSON.parse);
assert.strictEqual(records[0].recordKind, 'meta');
assert.strictEqual(records[0].sources[0].status, 'verified');
assert.strictEqual(records[1].status, 'selected');
assert.strictEqual(records[1].inputWords, 60);
assert.ok(!fs.readFileSync(dumpPath, 'utf8').includes('word0'), 'dump must omit source text');
const original = fs.readFileSync(dumpPath, 'utf8');
const overwrite = run(['--dump-units', dumpPath]);
assert.strictEqual(overwrite.status, 2);
assert.strictEqual(overwrite.stdout, '');
assert.strictEqual(fs.readFileSync(dumpPath, 'utf8'), original);
for (const args of [['--dump-units'], ['--dump-units', '--json'], ['--dump-units=x'], ['--dump-units', 'x', '--dump-units', 'y'], ['--typo']]) {
  const result = run(args);
  assert.strictEqual(result.status, 2, JSON.stringify(args));
  assert.strictEqual(result.stdout, '');
}
fs.writeFileSync(path.join(fixtureRoot, 'corpus/cache/fixture.txt'), fixtureText + ' changed');
const mismatch = run(['--json']);
assert.strictEqual(mismatch.status, 2);
assert.strictEqual(mismatch.stdout, '');
assert.match(mismatch.stderr, /hash mismatch/);

console.log('fp-measure cli: ok');
