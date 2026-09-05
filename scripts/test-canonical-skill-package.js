#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert');

const root = path.resolve(process.argv[2] || '.');
const bundleRoots = [path.join(root, 'skills', 'avoid-ai-writing')];
const claudeRoot = path.join(root, 'plugins', 'avoid-ai-writing', 'skills', 'avoid-ai-writing');
if (fs.existsSync(claudeRoot)) bundleRoots.push(claudeRoot);
let skillRoot;
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avoid-ai-writing-skill-'));

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`command failed (${result.status}): node ${args.join(' ')}`);
  }
  return result.stdout.trim();
}

try {
 for (skillRoot of bundleRoots) {
  assert.ok(fs.readFileSync(path.join(skillRoot, "references/patterns.md"), "utf8").includes("## What to remove or fix"));
  const styleFixture = path.join(fixtureRoot, 'technical.md');
  const beforeFixture = path.join(fixtureRoot, 'before.md');
  const afterFixture = path.join(fixtureRoot, 'after.md');
  fs.writeFileSync(styleFixture, '# API behavior\n\nUse the parser for each request.\n');
  fs.writeFileSync(beforeFixture, '# Release note\n\nThe parser keeps `config.json` unchanged.\n');
  fs.copyFileSync(beforeFixture, afterFixture);

  const style = run(['scripts/check-style.js', styleFixture, '--config', 'examples/technical.json']);
  fs.writeFileSync(styleFixture, 'Say "hello" in [docs](url "Title").\n');
  assert.strictEqual(run(['scripts/normalize-quotes.js', styleFixture, '--quotes', 'curly']),
    'Say “hello” in [docs](url "Title").');
  run(['scripts/normalize-quotes.js', styleFixture, '--quotes', 'curly', '--write']);
  const marks = run(['scripts/check-style.js', styleFixture, '--config', 'examples/prose.json']);
  fs.writeFileSync(styleFixture, 'Say "hello" in [docs](url "Title").\n');
  const referenceFixture = path.join(fixtureRoot, 'reference.md');
  fs.writeFileSync(referenceFixture, 'Say “welcome.”\n');
  run(['scripts/normalize-quotes.js', styleFixture, '--reference', referenceFixture, '--write']);
  assert.strictEqual(fs.readFileSync(styleFixture, 'utf8'), 'Say “hello” in [docs](url "Title").\n');
  const preservation = run(['detector/validate.js', beforeFixture, afterFixture]);
  console.log(JSON.stringify({ ok: true, cwd: path.relative(root, skillRoot), style, marks, preservation }, null, 2));
 }
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
