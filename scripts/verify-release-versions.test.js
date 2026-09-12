#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  readChangelogVersion,
  verifyReleaseVersions,
} = require('./verify-release-versions.js');

const scriptPath = path.join(__dirname, 'verify-release-versions.js');

let passed = 0;
const t = (name, fn) => {
  fn();
  passed += 1;
  process.stdout.write(`  ✓ ${name}\n`);
};

function fixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'avoid-ai-writing-release-versions-'));
}

function writeFixture(root, { changelog, packageVersion }) {
  fs.writeFileSync(
    path.join(root, 'CHANGELOG.md'),
    changelog,
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', version: packageVersion }, null, 2) + '\n',
    'utf8',
  );
}

function runCli(root, extraArgs = []) {
  return spawnSync(process.execPath, [scriptPath, '--root', root, ...extraArgs], {
    encoding: 'utf8',
  });
}

t('readChangelogVersion skips Unreleased and reads the first numeric heading', () => {
  const text = `# Changelog

## [Unreleased]

### Added
- Docs only.

## [3.34.0] — 2026-09-11

### Fixed
- Something.
`;
  assert.strictEqual(readChangelogVersion(text), '3.34.0');
});

t('verifyReleaseVersions accepts matching package.json and changelog versions', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [1.2.3] — 2026-01-01\n\n- ok\n',
    packageVersion: '1.2.3',
  });
  const result = verifyReleaseVersions(root);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.changelogVersion, '1.2.3');
  assert.strictEqual(result.packageVersion, '1.2.3');
});

t('verifyReleaseVersions rejects version drift', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [3.35.0] — 2026-09-12\n',
    packageVersion: '3.34.0',
  });
  const result = verifyReleaseVersions(root);
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /package\.json \(3\.34\.0\) != CHANGELOG\.md \(3\.35\.0\)/);
});

t('verifyReleaseVersions rejects changelog with no numeric heading', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [Unreleased]\n\n- only docs\n',
    packageVersion: '1.0.0',
  });
  const result = verifyReleaseVersions(root);
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /Could not find/);
});

t('verifyReleaseVersions rejects malformed package.json', () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '## [1.0.0]\n', 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), '{not json', 'utf8');
  const result = verifyReleaseVersions(root);
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /not valid JSON/);
});

t('verifyReleaseVersions rejects non-semver package version', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [1.0.0]\n',
    packageVersion: 'v1.0.0',
  });
  const result = verifyReleaseVersions(root);
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /not a numeric X\.Y\.Z semver/);
});

t('CLI exits 0 on match and writes github output', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [2.0.0]\n',
    packageVersion: '2.0.0',
  });
  const outputPath = path.join(root, 'github-output.txt');
  const result = runCli(root, ['--github-output', outputPath]);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /agree on 2\.0\.0/);
  assert.strictEqual(fs.readFileSync(outputPath, 'utf8'), 'version=2.0.0\n');
});

t('CLI exits 1 on drift before any release command would run', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [9.9.9]\n',
    packageVersion: '9.9.8',
  });
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir);
  const ghLog = path.join(root, 'gh-calls.log');
  fs.writeFileSync(
    path.join(binDir, 'gh'),
    `#!/bin/sh
echo release-create-called >> "${ghLog.replace(/"/g, '\\"')}"
exit 0
`,
    'utf8',
  );
  fs.chmodSync(path.join(binDir, 'gh'), 0o755);

  const verify = spawnSync(process.execPath, [scriptPath, '--root', root], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  });
  assert.strictEqual(verify.status, 1);
  assert.match(verify.stderr, /::error::/);

  const simulateRelease = spawnSync(
    'bash',
    ['-ec', `
      set -euo pipefail
      cd "${root}"
      if ! node "${scriptPath}" --root .; then
        exit 0
      fi
      gh release create "v$(node -p "require('./verify-release-versions.js').readChangelogVersion(require('fs').readFileSync('CHANGELOG.md','utf8'))")"
    `],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    },
  );
  assert.strictEqual(simulateRelease.status, 0);
  assert.strictEqual(fs.existsSync(ghLog), false);
});

process.stdout.write(`verify-release-versions.test.js: ${passed} passed\n`);
