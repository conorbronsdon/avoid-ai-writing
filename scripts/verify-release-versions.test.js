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

function writeFixture(root, { changelog, packageVersion, packageJson }) {
  fs.writeFileSync(
    path.join(root, 'CHANGELOG.md'),
    changelog,
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(packageJson || { name: 'fixture', version: packageVersion }, null, 2) + '\n',
    'utf8',
  );
}

function runCli(root, extraArgs = []) {
  return spawnSync(process.execPath, [scriptPath, '--root', root, ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: '' },
  });
}

function runGuardedMutation(root, mutationLog, mutation) {
  const verify = runCli(root);
  if (verify.status !== 0) return verify;
  return spawnSync(
    process.execPath,
    ['-e', "require('node:fs').appendFileSync(process.argv[1], process.argv[2] + '\\n')", mutationLog, mutation],
    { encoding: 'utf8' },
  );
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

t('verifyReleaseVersions accepts an Unreleased-only documentation edit above the current release', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [Unreleased]\n\n- Docs only.\n\n## [3.34.0] — 2026-09-11\n',
    packageVersion: '3.34.0',
  });
  assert.deepStrictEqual(verifyReleaseVersions(root), {
    ok: true,
    changelogVersion: '3.34.0',
    packageVersion: '3.34.0',
  });
});

t('verifyReleaseVersions accepts CRLF changelog headings', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [Unreleased]\r\n\r\n## [3.34.0] — 2026-09-11\r\n',
    packageVersion: '3.34.0',
  });
  assert.strictEqual(verifyReleaseVersions(root).ok, true);
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
  assert.match(result.message, /first release heading/);
});

t('verifyReleaseVersions rejects a malformed current heading instead of falling back', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [Unreleased]\n\n## [3.35]\n\n## [3.34.0]\n',
    packageVersion: '3.34.0',
  });
  const result = verifyReleaseVersions(root);
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /first release heading/);
});

t('verifyReleaseVersions rejects malformed package.json', () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '## [1.0.0]\n', 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), '{not json', 'utf8');
  const result = verifyReleaseVersions(root);
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /not valid JSON/);
});

t('verifyReleaseVersions rejects package.json without a version', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [1.0.0]\n',
    packageJson: { name: 'fixture' },
  });
  const result = verifyReleaseVersions(root);
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /missing a string "version" field/);
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

t('verifyReleaseVersions rejects a prerelease package version', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [1.0.0]\n',
    packageVersion: '1.0.0-rc.1',
  });
  const result = verifyReleaseVersions(root);
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /not a numeric X\.Y\.Z semver/);
});

t('verifyReleaseVersions rejects numeric identifiers with leading zeroes', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [01.2.3]\n',
    packageVersion: '01.2.3',
  });
  const result = verifyReleaseVersions(root);
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /first release heading/);
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

t('CLI rejects an empty github output path', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [2.0.0]\n',
    packageVersion: '2.0.0',
  });
  const result = spawnSync(process.execPath, [scriptPath, '--root', root, '--github-output', ''], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: path.join(root, 'real-actions-output.txt') },
  });
  assert.strictEqual(result.status, 2);
  assert.match(result.stderr, /requires a non-empty output path/);
  assert.strictEqual(fs.existsSync(path.join(root, 'real-actions-output.txt')), false);
});

t('invalid input reaches neither mocked release creation nor npm publication', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [9.9.9]\n',
    packageVersion: '9.9.8',
  });
  const mutationLog = path.join(root, 'mutations.log');
  const release = runGuardedMutation(root, mutationLog, 'gh release create');
  const publish = runGuardedMutation(root, mutationLog, 'npm publish');
  assert.strictEqual(release.status, 1);
  assert.strictEqual(publish.status, 1);
  assert.match(release.stderr, /::error::/);
  assert.match(publish.stderr, /::error::/);
  assert.strictEqual(fs.existsSync(mutationLog), false);
});

t('valid input reaches the simulated success path', () => {
  const root = fixtureRoot();
  writeFixture(root, {
    changelog: '## [4.5.6]\n',
    packageVersion: '4.5.6',
  });
  const mutationLog = path.join(root, 'mutations.log');
  const release = runGuardedMutation(root, mutationLog, 'gh release create');
  const publish = runGuardedMutation(root, mutationLog, 'npm publish');
  assert.strictEqual(release.status, 0);
  assert.strictEqual(publish.status, 0);
  assert.strictEqual(fs.readFileSync(mutationLog, 'utf8'), 'gh release create\nnpm publish\n');
});

t('workflow runs the shared guard before both release mutations', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  const publishMarker = '\n  publish-npm:';
  const publishStart = workflow.indexOf(publishMarker);
  assert.ok(publishStart > 0, 'publish-npm job must exist');
  const releaseJob = workflow.slice(0, publishStart);
  const publishJob = workflow.slice(publishStart);
  const releaseGuards = [...releaseJob.matchAll(/node scripts\/verify-release-versions\.js/g)];
  const publishGuards = [...publishJob.matchAll(/node scripts\/verify-release-versions\.js/g)];
  assert.strictEqual(releaseGuards.length, 1);
  assert.strictEqual(publishGuards.length, 1);
  assert.ok(releaseGuards[0].index < /^\s+gh release create/m.exec(releaseJob).index);
  assert.ok(publishGuards[0].index < /^\s+run: npm publish --provenance/m.exec(publishJob).index);
});

process.stdout.write(`verify-release-versions.test.js: ${passed} passed\n`);
