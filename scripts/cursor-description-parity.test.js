'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// The Cursor rule is generated from SKILL.md, so the description in its
// frontmatter must be the SKILL.md description with only the Cursor-specific
// template text appended (#452). A second hand-maintained copy of the
// description in the generator drifts silently, because the sync workflow
// diffs the generated file against the generator's own output.
const CURSOR_SUFFIX = ' Activate whenever editing prose-heavy files (Markdown, documentation, blog posts, READMEs, release notes, emails). Cursor port of the avoid-ai-writing skill v';

function frontmatterDescription(file) {
  const match = read(file).match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${file} has YAML frontmatter`);
  const line = match[1].split('\n').find(l => l.startsWith('description:'));
  assert.ok(line, `${file} frontmatter has a description`);
  return line.slice('description:'.length).trim();
}

function expectedCursorDescription(skillFile) {
  const version = read(skillFile).match(/^version: (.+)$/m)[1].trim();
  return `${frontmatterDescription(skillFile)}${CURSOR_SUFFIX}${version}. See https://github.com/conorbronsdon/avoid-ai-writing.`;
}

// The committed rule matches what SKILL.md implies.
assert.equal(
  frontmatterDescription(path.join(root, 'cursor-rules/avoid-ai-writing.mdc')),
  expectedCursorDescription(path.join(root, 'SKILL.md')),
  'Cursor rule description must be derived from the SKILL.md description',
);

// Sentinel control: editing only the SKILL.md description in a scratch copy
// and regenerating must move the rule's description with it.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-desc-'));
try {
  for (const rel of ['SKILL.md', 'references', 'scripts', 'cursor-rules', 'dist']) {
    fs.cpSync(path.join(root, rel), path.join(fixture, rel), { recursive: true });
  }
  const skillPath = path.join(fixture, 'SKILL.md');
  const original = read(skillPath);
  const mutated = original.replace(/^description: /m, 'description: SENTINEL-DESC-XYZ ');
  assert.notEqual(mutated, original, 'Sentinel edit applies to the SKILL.md description');
  fs.writeFileSync(skillPath, mutated);
  execFileSync('bash', [path.join(fixture, 'scripts/sync-cursor-rules.sh')], { stdio: 'pipe' });
  assert.equal(
    frontmatterDescription(path.join(fixture, 'cursor-rules/avoid-ai-writing.mdc')),
    expectedCursorDescription(skillPath),
    'Regenerating after a SKILL.md description edit must update the Cursor rule description',
  );
  // The generator derives the description from exactly one frontmatter line;
  // a missing or duplicated line must fail generation, not ship a wrong rule.
  const regenerate = () => execFileSync('bash', [path.join(fixture, 'scripts/sync-cursor-rules.sh')], { stdio: 'pipe' });
  fs.writeFileSync(skillPath, mutated.replace(/^description: .*$/m, 'description: one\ndescription: two'));
  assert.throws(regenerate, 'A duplicated description line must fail generation');
  fs.writeFileSync(skillPath, mutated.replace(/^description: .*$/m, 'name: avoid-ai-writing'));
  assert.throws(regenerate, 'A missing description line must fail generation');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
console.log('Cursor description parity: committed rule and sentinel regeneration track SKILL.md; missing or duplicate descriptions fail generation');
