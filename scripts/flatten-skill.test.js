'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {flatten} = require('./flatten-skill');
const root = path.resolve(__dirname, '..');
const normalized = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
assert.equal(flatten(root), normalized(path.join(root, 'SKILL.full.md')), 'Flattened artifact must equal canonical content');
assert.ok(normalized(path.join(root, 'SKILL.md')).split('\n').length < 500, 'Entry skill stays below 500 lines');
// Both single-file targets must carry the same portable instructions.
const portableBody = file => normalized(path.join(root, file))
 .replace(/^---\n[\s\S]*?\n---\n/, '')
 .replace(/<!-- GENERATED[\s\S]*?-->/, '').trim();
assert.equal(portableBody('dist/avoid-ai-writing.md'), portableBody('cursor-rules/avoid-ai-writing.mdc'));
assert.ok(!portableBody('dist/avoid-ai-writing.md').includes('<!-- patterns:'));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-split-'));
try {
 fs.mkdirSync(path.join(fixture, 'references'));
 const front = normalized(path.join(root, 'SKILL.md'));
 const patterns = normalized(path.join(root, 'references/patterns.md'));
 fs.writeFileSync(path.join(fixture, 'SKILL.md'), front);
 fs.writeFileSync(path.join(fixture, 'references/patterns.md'), patterns);
 assert.equal(flatten(fixture), flatten(root));
 fs.writeFileSync(path.join(fixture, 'references/patterns.md'), patterns.replace('## Context profiles', '## Missing profiles'));
 assert.throws(() => flatten(fixture), /boundaries/);
 fs.writeFileSync(path.join(fixture, 'references/patterns.md'), patterns);
 for (const mutation of [front.replace('<!-- patterns:catalog -->', ''), front + '\n<!-- patterns:catalog -->\n\n', front.replace('<!-- reference-loading:start -->', '')]) {
  fs.writeFileSync(path.join(fixture, 'SKILL.md'), mutation);
  assert.throws(() => flatten(fixture), /Expected/);
 }
 fs.writeFileSync(path.join(fixture, 'SKILL.md'), front);
 fs.writeFileSync(path.join(fixture, 'references/patterns.md'), patterns.replace('delve / delve into', 'MUTATED vocabulary'));
 assert.notEqual(flatten(fixture), flatten(root), 'Reference mutation must change the generated artifact');
} finally { fs.rmSync(fixture, {recursive:true, force:true}); }
console.log('Split skill: canonical parity, size limit, and five mutation controls passed');
