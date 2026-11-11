#!/usr/bin/env node
'use strict';

// Offline preparation for #205. This does not change the installed skill's
// loading policy, route from detector hits, call a model, or measure quality.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const normalize = text => text.replace(/\r\n/g, '\n');
const read = file => fs.readFileSync(file, 'utf8');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const LOADING = /<!-- reference-loading:start -->\n[\s\S]*?<!-- reference-loading:end -->\n\n/g;
// LF-normalized so a CRLF checkout (core.autocrlf on Windows) verifies the same pack.
const generatorHash = () => hash(normalize(read(__filename)));

function snapshot(commit, root = ROOT) {
  assert.match(commit, /^[0-9a-f]{40}$/, 'source must be a full commit SHA');
  const get = file => normalize(execFileSync('git', ['show', `${commit}:${file}`], {
    cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  }));
  return { entry: get('SKILL.md'), reference: get('references/patterns.md') };
}

function headingsOutsideFences(text) {
  const headings = [];
  let offset = 0, fence = null;
  for (const line of text.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && /^\s*$/.test(marker[2])) fence = null;
    } else if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
      fence = { char: marker[1][0], length: marker[1].length };
    } else {
      const heading = line.match(/^(#{2,3}) (.+)$/);
      if (heading) headings.push({ index: offset, level: heading[1].length, title: heading[2] });
    }
    offset += line.length + 1;
  }
  return headings;
}

function partition(reference) {
  assert(reference.startsWith('## What to remove or fix\n'), 'invalid catalog start');
  const headings = headingsOutsideFences(reference);
  const boundaries = headings.filter(h => h.level === 2 && h.title === 'Context profiles');
  assert.equal(boundaries.length, 1, 'invalid profile boundary');
  const end = boundaries[0].index;
  const starts = [0, ...headings.filter(h => h.level === 3 && h.index < end).map(h => h.index), end];
  const modules = [];
  const add = (text, kind, id) => {
    const heading = text.split('\n', 1)[0].replace(/^#+ /, '');
    modules.push({ id: id || slug(heading), heading, kind, text });
  };
  for (let i = 0; i < starts.length - 1; i++) {
    add(reference.slice(starts[i], starts[i + 1]), i === 0 ? 'required' : 'rule', i === 0 ? 'catalog-intro' : undefined);
  }
  const profiles = headings.filter(h => h.level === 2 && h.index >= end);
  for (let i = 0; i < profiles.length; i++) {
    add(reference.slice(profiles[i].index, profiles[i + 1]?.index ?? reference.length), 'required');
  }
  assert.equal(new Set(modules.map(m => m.id)).size, modules.length, 'duplicate module ID');
  assert.equal(modules.map(m => m.text).join(''), reference, 'partition is not lossless');
  return modules;
}

function indexText(modules) {
  return '## Experimental reference index\n\n' +
    'The editing contract and every rule exception still apply. This index lists every rule family, including judgment-only and document-level rules. A detector hit is not a routing decision. Full audits and ambiguous scope require all modules. A focused experiment covers only its declared families and must not claim an exhaustive audit. Missing or unverified modules are an error, not clean findings.\n\n' +
    modules.map(m => `- \`${m.id}\` — ${m.heading}${m.kind === 'required' ? ' (always included)' : ''}`).join('\n') + '\n\n';
}

function prepare(commit, destination, root = ROOT) {
  const sources = snapshot(commit, root);
  const modules = partition(sources.reference);
  const index = indexText(modules);
  const manifest = {
    schema_version: 1, source_commit: commit, generator_sha256: generatorHash(),
    entry_sha256: hash(sources.entry), reference_sha256: hash(sources.reference), index_sha256: hash(index),
    modules: modules.map(({ text, ...m }) => ({ ...m, path: `modules/${m.id}.md`, sha256: hash(text) })),
  };
  // Refuse to overwrite an earlier freeze or leave a mixed-source pack.
  fs.mkdirSync(destination);
  fs.mkdirSync(path.join(destination, 'modules'));
  fs.writeFileSync(path.join(destination, 'SKILL.md'), sources.entry, { flag: 'wx' });
  fs.writeFileSync(path.join(destination, 'index.md'), index, { flag: 'wx' });
  for (let i = 0; i < modules.length; i++) {
    fs.writeFileSync(path.join(destination, manifest.modules[i].path), modules[i].text, { flag: 'wx' });
  }
  fs.writeFileSync(path.join(destination, 'manifest.json'), json(manifest), { flag: 'wx' });
  return manifest;
}

function verify(directory, root = ROOT) {
  const manifest = JSON.parse(read(path.join(directory, 'manifest.json')));
  assert.equal(manifest.schema_version, 1, 'unsupported manifest');
  assert.equal(manifest.generator_sha256, generatorHash(), 'generator changed; prepare a new pack');
  const sources = snapshot(manifest.source_commit, root);
  const expected = partition(sources.reference);
  assert.equal(manifest.entry_sha256, hash(sources.entry), 'entry does not match pinned source');
  assert.equal(manifest.reference_sha256, hash(sources.reference), 'reference does not match pinned source');
  assert.equal(manifest.index_sha256, hash(indexText(expected)), 'index does not match pinned source');
  assert.equal(read(path.join(directory, 'SKILL.md')), sources.entry, 'entry changed');
  assert.equal(read(path.join(directory, 'index.md')), indexText(expected), 'index changed');
  assert.deepEqual(manifest.modules, expected.map(({ text, ...m }) => ({ ...m, path: `modules/${m.id}.md`, sha256: hash(text) })),
    'ordered includes differ from pinned source');
  const realRoot = fs.realpathSync(directory) + path.sep;
  for (let i = 0; i < manifest.modules.length; i++) {
    const file = path.join(directory, manifest.modules[i].path);
    assert(fs.realpathSync(file).startsWith(realRoot), 'module escapes pack');
    assert.equal(read(file), expected[i].text, `module changed: ${manifest.modules[i].id}`);
  }
  return { manifest, sources, modules: expected };
}

function assemble(directory, config, root = ROOT) {
  const { manifest, sources, modules } = verify(directory, root);
  assert(config && typeof config === 'object' && !Array.isArray(config), 'config must be an object');
  assert(Object.keys(config).every(key => ['mode', 'modules'].includes(key)), 'unknown configuration key');
  assert(['full', 'focused'].includes(config.mode), 'mode must be full or focused');
  const requested = config.modules ?? [];
  assert(Array.isArray(requested) && requested.every(x => typeof x === 'string'), 'modules must be an array of IDs');
  assert.equal(new Set(requested).size, requested.length, 'duplicate requested module');
  for (const id of requested) assert(modules.some(m => m.id === id), `unknown requested module: ${id}`);
  for (const id of requested) assert(modules.some(m => m.id === id && m.kind === 'rule'),
    `focus must name rule families; ${id} is always included`);
  assert(config.mode !== 'full' || requested.length === 0, 'full mode must not specify a partial selection');
  const fallback = config.mode === 'focused' && requested.length === 0;
  const full = config.mode === 'full' || fallback;
  const selected = modules.filter(m => full || m.kind === 'required' || requested.includes(m.id));
  const coverage = full ? 'exhaustive' : 'declared-focus-only';
  const index = indexText(modules);
  assert.equal((sources.entry.match(LOADING) || []).length, 1, 'expected one loading block');
  let prompt = sources.entry.replace(LOADING, () => index +
    `Experimental coverage: ${coverage}. Included modules: ${selected.map(m => m.id).join(', ')}.\n\n` +
    'Apply the editing contract and protected-content rules globally. Interpret later instructions to find every AI-ism, review every rule, or declare the text clean only within the coverage declared above. In a focused arm, explicitly limit findings, clean assessments and stop reasons to the included rule families; never certify unloaded families as reviewed.\n\n');
  for (const [name, content] of [
    ['catalog', selected.filter(m => m.id === 'catalog-intro' || m.kind === 'rule').map(m => m.text).join('')],
    ['profiles', selected.filter(m => m.kind === 'required' && m.id !== 'catalog-intro').map(m => m.text).join('')],
  ]) {
    const marker = `<!-- patterns:${name} -->\n\n`;
    assert.equal(prompt.split(marker).length, 2, `expected one ${name} include marker`);
    prompt = prompt.replace(marker, () => content);
  }
  assert(!/<!-- patterns:/.test(prompt), 'unknown include marker');
  return { prompt, trace: {
    schema_version: 1, source_commit: manifest.source_commit, generator_sha256: manifest.generator_sha256,
    config_sha256: hash(json({ mode: config.mode, ...(Object.hasOwn(config, 'modules') ? { modules: requested } : {}) })),
    entry_sha256: manifest.entry_sha256, reference_sha256: manifest.reference_sha256,
    requested_mode: config.mode, loading_mode: fallback ? 'fallback-full' : config.mode,
    coverage, fallback_reason: fallback ? 'No explicit focus was supplied; scope is ambiguous.' : null,
    requested_module_ids: requested, assembled_module_ids: selected.map(m => m.id),
    prompt_sha256: hash(prompt), prompt_utf8_bytes: Buffer.byteLength(prompt), prompt_words: prompt.trim().split(/\s+/).length,
    usage: { kind: 'unavailable' }, model_latency_ms: null,
    observation: 'Verified context assembly only. No model read, editing outcome, token usage, routing overhead or model latency was observed.',
  } };
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === 'prepare' && args.length === 2) console.log(json(prepare(args[0], path.resolve(args[1]))));
  else if (command === 'verify' && args.length === 1) {
    const { manifest } = verify(path.resolve(args[0]));
    console.log(json({ ok: true, source_commit: manifest.source_commit, modules: manifest.modules.length }));
  } else if (command === 'assemble' && args.length === 3) {
    const { prompt, trace } = assemble(path.resolve(args[0]), JSON.parse(read(args[1])));
    const targets = [`${args[2]}.prompt.md`, `${args[2]}.trace.json`];
    assert(targets.every(file => !fs.existsSync(file)), 'refuse to overwrite an existing assembly');
    fs.writeFileSync(targets[0], prompt, { flag: 'wx' });
    fs.writeFileSync(targets[1], json(trace), { flag: 'wx' });
    console.log(json(trace));
  } else throw new Error('Usage: reference-loading.js prepare COMMIT NEW_DIRECTORY | verify DIRECTORY | assemble DIRECTORY CONFIG_JSON OUTPUT_PREFIX');
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { snapshot, partition, prepare, verify, assemble };
