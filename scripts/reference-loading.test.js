'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { flatten } = require('./flatten-skill');
const { retainedSha256 } = require('./retained-bytes');
const { snapshot, partition, prepare, verify, assemble } = require('./reference-loading');

const root = path.resolve(__dirname, '..');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-loading-'));
const pack = path.join(directory, 'pack');
const get = file => fs.readFileSync(path.join(pack, file), 'utf8');
const put = (file, text) => fs.writeFileSync(path.join(pack, file), text);
let mutations = 0;
try {
  const manifest = prepare(commit, pack);
  const sources = snapshot(commit);
  const modules = partition(sources.reference);
  assert.equal(modules.map(m => m.text).join(''), sources.reference);
  assert.equal(modules.filter(m => m.kind === 'rule').length,
    [...sources.reference.split('## Context profiles\n')[0].matchAll(/^### /gm)].length);
  // Judgment-only, rare and late rules must remain discoverable in the index.
  for (const id of ['false-agency', 'diff-anchored-writing', 'treadmill-effect-low-information-density-content-test']) {
    assert(manifest.modules.some(m => m.id === id), `missing module: ${id}`);
    assert(get('index.md').includes(`\`${id}\``));
  }
  assert.throws(() => prepare(commit, pack), /EEXIST/);
  assert.throws(() => prepare('main', path.join(directory, 'bad')), /full commit SHA/);
  assert.equal(verify(pack).manifest.source_commit, commit);

  // Heading-shaped examples are part of their enclosing rule, not modules.
  // Include a fake profile boundary, tilde fences, indentation, and a shorter
  // nested backtick run that cannot close the outer fence.
  const fencedRoot = path.join(directory, 'fenced-source');
  fs.mkdirSync(path.join(fencedRoot, 'references'), { recursive: true });
  const example = '````markdown\n### Example heading\n## Context profiles\n```\n### Still an example\n````\n\n  ~~~markdown\n### Tilde example\n  ~~~\n';
  const fencedReference = '## What to remove or fix\n\n### Formatting\nKeep this rule.\n' + example +
    '\n### Other rule\nKeep this separate.\n\n## Context profiles\nRequired context.\n\n## Voice profiles\nRequired voice.\n';
  fs.writeFileSync(path.join(fencedRoot, 'SKILL.md'), sources.entry);
  fs.writeFileSync(path.join(fencedRoot, 'references/patterns.md'), fencedReference);
  execFileSync('git', ['init', '-q', fencedRoot]);
  execFileSync('git', ['add', 'SKILL.md', 'references/patterns.md'], { cwd: fencedRoot });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fenced examples'], { cwd: fencedRoot });
  const fencedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fencedRoot, encoding: 'utf8' }).trim();
  const fencedPack = path.join(directory, 'fenced-pack');
  prepare(fencedCommit, fencedPack, fencedRoot);
  const fencedFocus = assemble(fencedPack, { mode: 'focused', modules: ['formatting'] }, fencedRoot);
  assert(fencedFocus.prompt.includes(example), 'focused assembly dropped part of the rule example');
  assert(!fencedFocus.trace.assembled_module_ids.some(id => id.includes('example')));
  assert.deepEqual(partition(fencedReference).map(m => m.id),
    ['catalog-intro', 'formatting', 'other-rule', 'context-profiles', 'voice-profiles']);

  const full = assemble(pack, { mode: 'full' });
  const focused = assemble(pack, { mode: 'focused', modules: ['copula-avoidance'] });
  const fallback = assemble(pack, { mode: 'focused' });
  assert.equal(full.trace.coverage, 'exhaustive');
  assert.equal(focused.trace.coverage, 'declared-focus-only');
  assert.deepEqual(full.trace.assembled_module_ids, modules.map(m => m.id));
  assert.deepEqual(fallback.trace.assembled_module_ids, full.trace.assembled_module_ids);
  assert.equal(fallback.trace.loading_mode, 'fallback-full');
  assert(focused.trace.prompt_utf8_bytes < full.trace.prompt_utf8_bytes);
  assert.deepEqual(focused.trace.usage, { kind: 'unavailable' });
  assert.equal(focused.trace.model_latency_ms, null);
  assert.equal(focused.trace.generator_sha256, manifest.generator_sha256);
  assert.match(focused.trace.config_sha256, /^[0-9a-f]{64}$/);
  assert.equal(focused.trace.config_sha256,
    assemble(pack, { modules: ['copula-avoidance'], mode: 'focused' }).trace.config_sha256,
    'configuration key order must not change the canonical hash');
  assert.match(focused.prompt, /clean assessments and stop reasons to the included rule families/);
  assert(!full.prompt.includes('<!-- patterns:'));
  assert(!focused.prompt.includes('<!-- patterns:'));
  for (const m of modules.filter(m => m.kind === 'required' || m.id === 'copula-avoidance')) {
    assert(focused.prompt.includes(m.text), `whole module and exceptions must survive: ${m.id}`);
    assert(focused.trace.assembled_module_ids.includes(m.id));
  }
  assert(!focused.trace.assembled_module_ids.includes('false-agency'));
  assert(focused.prompt.includes('`false-agency`'), 'index still exposes unloaded rules');
  assert.throws(() => assemble(pack, { mode: 'focused', modules: ['unknown-rule'] }), /unknown/);
  assert.throws(() => assemble(pack, { mode: 'focused', modules: ['copula-avoidance', 'copula-avoidance'] }), /duplicate/);
  assert.throws(() => assemble(pack, { mode: 'full', modules: ['copula-avoidance'] }), /partial/);
  assert.throws(() => assemble(pack, { mode: 'auto' }), /mode/);
  assert.throws(() => assemble(pack, { mode: 'full', exclude: ['false-agency'] }), /unknown configuration key/);
  for (const id of ['context-profiles', 'catalog-intro', 'voice-profiles']) {
    assert.throws(() => assemble(pack, { mode: 'focused', modules: [id] }), /always included/);
  }
  assert.throws(() => assemble(pack, { mode: 'focused', modules: ['false-agency', 'context-profiles'] }), /always included/);

  // Prove the full arm changes only the loading block, retaining the exact
  // flattened policy, word tables, exceptions and final output contract.
  const canonical = path.join(directory, 'canonical');
  fs.mkdirSync(path.join(canonical, 'references'), { recursive: true });
  fs.writeFileSync(path.join(canonical, 'SKILL.md'), sources.entry);
  fs.writeFileSync(path.join(canonical, 'references/patterns.md'), sources.reference);
  const loadingBlock = sources.entry.match(/<!-- reference-loading:start -->\n[\s\S]*?<!-- reference-loading:end -->\n\n/)[0];
  const insertion = full.prompt.slice(full.prompt.indexOf('## Experimental reference index'),
    full.prompt.indexOf('## Editing contract'));
  assert.equal(full.prompt.replace(insertion, ''), flatten(canonical));
  assert(!full.prompt.includes(loadingBlock));

  const originalManifest = get('manifest.json');
  const changeManifest = fn => {
    const altered = JSON.parse(originalManifest); fn(altered);
    put('manifest.json', JSON.stringify(altered));
    assert.throws(() => verify(pack)); mutations++;
    put('manifest.json', originalManifest);
  };
  changeManifest(m => m.modules.reverse());
  changeManifest(m => m.modules.splice(2, 1));
  changeManifest(m => m.modules.push(m.modules[0]));
  changeManifest(m => { m.modules[2].path = '../outside.md'; });
  changeManifest(m => { m.reference_sha256 = 'forged'; });
  changeManifest(m => { m.generator_sha256 = 'forged'; });
  for (const file of ['SKILL.md', 'index.md', manifest.modules[2].path]) {
    const original = get(file);
    put(file, original + '\nChanged policy.\n');
    assert.throws(() => assemble(pack, { mode: 'full' })); mutations++;
    put(file, original);
  }
  const missing = manifest.modules.find(m => m.id === 'false-agency').path;
  const saved = get(missing);
  fs.unlinkSync(path.join(pack, missing));
  assert.throws(() => assemble(pack, { mode: 'full' }), /ENOENT/); mutations++;
  assert.throws(() => assemble(pack, { mode: 'focused', modules: ['copula-avoidance'] }), /ENOENT/);
  put(missing, saved);
  assert.equal(verify(pack).manifest.source_commit, commit);

  const protocol = JSON.parse(fs.readFileSync(path.join(root, 'evals/rewrite/reference-loading-205.json'), 'utf8'));
  assert.equal(new Set(protocol.cases.map(c => c.id)).size, protocol.cases.length);
  for (const c of protocol.cases) {
    assert(c.request && c.source && c.register && c.review_criteria.length);
    const arm = assemble(pack, { mode: 'focused', modules: c.focus });
    assert(c.focus.every(id => arm.trace.assembled_module_ids.includes(id)));
  }
  const report = path.join(root, 'evals/rewrite/reports/reference-loading-preparation-205-2026-10-15');
  const retainedGenerator = retainedSha256(path.join(report, 'generator-source.js.txt'));
  for (const arm of ['full', 'focused', 'fallback']) {
    const trace = JSON.parse(fs.readFileSync(path.join(report, `${arm}-trace.json`), 'utf8'));
    assert.equal(trace.generator_sha256, retainedGenerator, 'historical trace must name its retained generator');
  }
  console.log(`Reference-loading preparation: lossless full arm, declared focus, fallback, ${mutations} corruption controls and ${protocol.cases.length} development cases passed. No model-quality or token-saving claim.`);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
