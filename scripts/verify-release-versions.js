#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Same line anchor the release workflow has used since npm publish guards landed. */
const CHANGELOG_HEADING_RE = /^## \[([0-9]+\.[0-9]+\.[0-9]+)\]/;
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;

function readChangelogVersion(changelogText) {
  for (const line of changelogText.split('\n')) {
    const match = line.match(CHANGELOG_HEADING_RE);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function readPackageVersion(packageJsonText) {
  let parsed;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    return { error: 'package.json is not valid JSON' };
  }
  const version = parsed && parsed.version;
  if (typeof version !== 'string' || version.length === 0) {
    return { error: 'package.json is missing a string "version" field' };
  }
  if (!SEMVER_RE.test(version)) {
    return { error: `package.json version (${version}) is not a numeric X.Y.Z semver` };
  }
  return { version };
}

/**
 * @param {string} root Repository root containing CHANGELOG.md and package.json
 * @returns {{ ok: true, changelogVersion: string, packageVersion: string } | { ok: false, message: string }}
 */
function verifyReleaseVersions(root) {
  const changelogPath = path.join(root, 'CHANGELOG.md');
  const packagePath = path.join(root, 'package.json');

  let changelogText;
  try {
    changelogText = fs.readFileSync(changelogPath, 'utf8');
  } catch {
    return { ok: false, message: 'Could not read CHANGELOG.md' };
  }

  const changelogVersion = readChangelogVersion(changelogText);
  if (!changelogVersion) {
    return {
      ok: false,
      message: "Could not find a '## [X.Y.Z]' heading in CHANGELOG.md",
    };
  }
  if (!SEMVER_RE.test(changelogVersion)) {
    return {
      ok: false,
      message: `Latest CHANGELOG.md version (${changelogVersion}) is not a numeric X.Y.Z semver`,
    };
  }

  let packageText;
  try {
    packageText = fs.readFileSync(packagePath, 'utf8');
  } catch {
    return { ok: false, message: 'Could not read package.json' };
  }

  const pkg = readPackageVersion(packageText);
  if (pkg.error) {
    return { ok: false, message: pkg.error };
  }

  if (pkg.version !== changelogVersion) {
    return {
      ok: false,
      message:
        `package.json (${pkg.version}) != CHANGELOG.md (${changelogVersion}) — fix the drift, then re-run. ` +
        'Publishing or tagging a mismatched version bakes the drift into the registry and release list.',
    };
  }

  return { ok: true, changelogVersion, packageVersion: pkg.version };
}

function formatGithubError(message) {
  return `::error::${message}`;
}

function main(argv) {
  const args = argv.slice(2);
  let root = process.cwd();
  let githubOutput = null;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--root') {
      root = path.resolve(args[i + 1] || '');
      i += 1;
    } else if (args[i] === '--github-output') {
      githubOutput = args[i + 1] || process.env.GITHUB_OUTPUT || null;
      i += 1;
    } else if (args[i] === '--help' || args[i] === '-h') {
      process.stdout.write(
        'Usage: node scripts/verify-release-versions.js [--root DIR] [--github-output FILE]\n',
      );
      process.exit(0);
    } else {
      process.stderr.write(`Unknown argument: ${args[i]}\n`);
      process.exit(2);
    }
  }

  const result = verifyReleaseVersions(root);
  if (!result.ok) {
    process.stderr.write(`${formatGithubError(result.message)}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `package.json and CHANGELOG.md agree on ${result.changelogVersion}\n`,
  );
  if (githubOutput) {
    fs.appendFileSync(githubOutput, `version=${result.changelogVersion}\n`, 'utf8');
  }
  process.exit(0);
}

module.exports = {
  CHANGELOG_HEADING_RE,
  readChangelogVersion,
  readPackageVersion,
  verifyReleaseVersions,
};

if (require.main === module) {
  main(process.argv);
}
