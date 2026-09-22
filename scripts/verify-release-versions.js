#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NUMERIC_IDENTIFIER = '(?:0|[1-9][0-9]*)';
const SEMVER_RE = new RegExp(`^${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}$`);
const CHANGELOG_HEADING_RE = new RegExp(
  `^## \\[(${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER})\\](?:\\s|$)`,
);
const CHANGELOG_SECTION_RE = /^##\s+(.+)$/;
const UNRELEASED_HEADING_RE = /^## \[Unreleased\](?:\s|$)/;
const SKILL_FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const VERSIONED_FILES = [
  { path: 'SKILL.md', label: 'SKILL.md', kind: 'skill' },
  {
    path: path.join('plugins', 'avoid-ai-writing', '.claude-plugin', 'plugin.json'),
    label: 'Claude plugin manifest',
    kind: 'json',
  },
  {
    path: path.join('.codex-plugin', 'plugin.json'),
    label: 'OpenAI plugin manifest',
    kind: 'json',
  },
];

function readChangelogVersion(changelogText) {
  for (const line of changelogText.split(/\r?\n/)) {
    if (!CHANGELOG_SECTION_RE.test(line) || UNRELEASED_HEADING_RE.test(line)) continue;
    const match = line.match(CHANGELOG_HEADING_RE);
    return match ? match[1] : null;
  }
  return null;
}

function readJsonVersion(jsonText, label) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { error: `${label} is not valid JSON` };
  }
  const version = parsed && parsed.version;
  if (typeof version !== 'string' || version.length === 0) {
    return { error: `${label} is missing a string "version" field` };
  }
  if (!SEMVER_RE.test(version)) {
    return { error: `${label} version (${version}) is not a numeric X.Y.Z semver` };
  }
  return { version };
}

function readPackageVersion(packageJsonText) {
  // Releases use numeric X.Y.Z tags only; prereleases intentionally fail closed.
  return readJsonVersion(packageJsonText, 'package.json');
}

function readSkillVersion(skillText) {
  const frontmatter = skillText.match(SKILL_FRONTMATTER_RE);
  if (!frontmatter) {
    return { error: 'SKILL.md is missing valid YAML frontmatter' };
  }

  const versionLines = frontmatter[1]
    .split(/\r?\n/)
    .filter((line) => /^version\s*:/.test(line));
  if (versionLines.length !== 1) {
    return { error: 'SKILL.md frontmatter must contain exactly one top-level version field' };
  }

  const match = versionLines[0].match(/^version\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*(?:#.*)?$/);
  const version = match && (match[1] ?? match[2] ?? match[3]);
  if (!version) {
    return { error: 'SKILL.md is missing a string "version" field' };
  }
  if (!SEMVER_RE.test(version)) {
    return { error: `SKILL.md version (${version}) is not a numeric X.Y.Z semver` };
  }
  return { version };
}

function verifyVersionChanged(previousPackageJsonText, currentVersion) {
  const previous = readPackageVersion(previousPackageJsonText);
  if (previous.error) {
    return { ok: false, message: `Previous package.json ${previous.error}` };
  }
  const current = readPackageVersion(JSON.stringify({ version: currentVersion }));
  if (current.error) return { ok: false, message: current.error };
  if (previous.version === currentVersion) {
    return {
      ok: false,
      message:
        `package.json version did not change (${currentVersion}) — push-triggered releases require a new version; ` +
        'use workflow_dispatch only for documented recovery of an unchanged version.',
    };
  }
  const previousParts = previous.version.split('.').map(BigInt);
  const currentParts = currentVersion.split('.').map(BigInt);
  let increased = false;
  for (let index = 0; index < currentParts.length; index += 1) {
    if (currentParts[index] === previousParts[index]) continue;
    increased = currentParts[index] > previousParts[index];
    break;
  }
  if (!increased) {
    return {
      ok: false,
      message: `package.json version moved backward from ${previous.version} to ${currentVersion}`,
    };
  }
  return { ok: true, previousVersion: previous.version, currentVersion };
}

/**
 * @param {string} root Repository root containing the release version files
 * @returns {{ ok: true, changelogVersion: string, packageVersion: string, skillVersion: string, claudePluginVersion: string, openaiPluginVersion: string } | { ok: false, message: string }}
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
      message: "The first release heading after Unreleased must be '## [X.Y.Z]' with numeric semver",
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

  const versions = {};
  for (const file of VERSIONED_FILES) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, file.path), 'utf8');
    } catch {
      return { ok: false, message: `Could not read ${file.label}` };
    }
    const parsed = file.kind === 'skill'
      ? readSkillVersion(text)
      : readJsonVersion(text, file.label);
    if (parsed.error) return { ok: false, message: parsed.error };
    if (parsed.version !== pkg.version) {
      return {
        ok: false,
        message:
          `${file.label} (${parsed.version}) != package.json and CHANGELOG.md (${pkg.version}) — ` +
          'fix the drift before publishing or tagging.',
      };
    }
    versions[file.label] = parsed.version;
  }

  return {
    ok: true,
    changelogVersion,
    packageVersion: pkg.version,
    skillVersion: versions['SKILL.md'],
    claudePluginVersion: versions['Claude plugin manifest'],
    openaiPluginVersion: versions['OpenAI plugin manifest'],
  };
}

function formatGithubError(message) {
  return `::error::${message}`;
}

function main(argv) {
  const args = argv.slice(2);
  let root = process.cwd();
  let githubOutput = null;
  let previousPackageJson = null;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--root') {
      root = path.resolve(args[i + 1] || '');
      i += 1;
    } else if (args[i] === '--github-output') {
      githubOutput = args[i + 1];
      if (typeof githubOutput !== 'string' || githubOutput.length === 0) {
        process.stderr.write(`${formatGithubError('--github-output requires a non-empty output path')}\n`);
        process.exit(2);
      }
      i += 1;
    } else if (args[i] === '--previous-package-json') {
      previousPackageJson = args[i + 1];
      if (typeof previousPackageJson !== 'string' || previousPackageJson.length === 0) {
        process.stderr.write(`${formatGithubError('--previous-package-json requires a non-empty path')}\n`);
        process.exit(2);
      }
      i += 1;
    } else if (args[i] === '--help' || args[i] === '-h') {
      process.stdout.write(
        'Usage: node scripts/verify-release-versions.js [--root DIR] [--github-output FILE] [--previous-package-json FILE]\n',
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

  if (previousPackageJson) {
    let previousText;
    try {
      previousText = fs.readFileSync(previousPackageJson, 'utf8');
    } catch {
      process.stderr.write(`${formatGithubError('Could not read previous package.json')}\n`);
      process.exit(1);
    }
    const changed = verifyVersionChanged(previousText, result.packageVersion);
    if (!changed.ok) {
      process.stderr.write(`${formatGithubError(changed.message)}\n`);
      process.exit(1);
    }
    process.stdout.write(`package.json version changed from ${changed.previousVersion} to ${changed.currentVersion}\n`);
  }

  process.stdout.write(
    `Release version files agree on ${result.changelogVersion}\n`,
  );
  if (githubOutput) {
    fs.appendFileSync(githubOutput, `version=${result.changelogVersion}\n`, 'utf8');
  }
  process.exit(0);
}

module.exports = {
  CHANGELOG_HEADING_RE,
  SEMVER_RE,
  readChangelogVersion,
  readPackageVersion,
  readSkillVersion,
  verifyVersionChanged,
  verifyReleaseVersions,
};

if (require.main === module) {
  main(process.argv);
}
