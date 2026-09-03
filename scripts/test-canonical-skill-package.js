#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(process.argv[2] || '.');
const skillRoot = path.join(root, 'skills', 'avoid-ai-writing');
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
  const styleFixture = path.join(fixtureRoot, 'technical.md');
  const beforeFixture = path.join(fixtureRoot, 'before.md');
  const afterFixture = path.join(fixtureRoot, 'after.md');
  fs.writeFileSync(styleFixture, '# API behavior\n\nUse the parser for each request.\n');
  fs.writeFileSync(beforeFixture, '# Release note\n\nThe parser keeps `config.json` unchanged.\n');
  fs.copyFileSync(beforeFixture, afterFixture);

  const style = run(['scripts/check-style.js', styleFixture, '--config', 'examples/technical.json']);
  const preservation = run(['detector/validate.js', beforeFixture, afterFixture]);
  console.log(JSON.stringify({ ok: true, cwd: path.relative(root, skillRoot), style, preservation }, null, 2));
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
