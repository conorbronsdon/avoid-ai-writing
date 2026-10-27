/* Offline example: run the real corpus CLI against a disposable manifest. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const os = require('node:os');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-intake-example-'));
fs.mkdirSync(path.join(fixture, 'scripts'));
fs.mkdirSync(path.join(fixture, 'corpus'));
fs.copyFileSync(path.join(__dirname, 'corpus.js'), path.join(fixture, 'scripts/corpus.js'));
const candidates = require('../corpus/intake-candidates.json');
const documents = JSON.parse(JSON.stringify(candidates.documents));
const manifestPath = path.join(fixture, 'corpus/manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, documents }));

// Synthetic text tests extraction only. It is never labelled corpus evidence.
const bodies = [
  'This requirement applies to every implementation. '.repeat(15).trim(),
  'A reference identifies the requested resource. '.repeat(1000).trim(),
  'This public newsletter discusses security research. '.repeat(15).trim(),
];
const responses = {
  'https://www.rfc-editor.org/rfc/rfc2119.txt': `Synthetic front matter\n1. MUST\n${bodies[0]}`,
  'https://www.rfc-editor.org/rfc/rfc3986.txt': `Contents\n   1.  Introduction . . . . . . . . . . . . . . . . . . . . . . . . .  4\n1.  Introduction\n\n   A Uniform Resource Identifier (URI) provides a simple and extensible ${bodies[1]}\nCAP-EXCLUDED`,
  'https://www.schneier.com/crypto-gram/archives/1998/0515.html':
    `<nav>Archive navigation</nav><main>Site furniture<article><p>${bodies[2]}</p></article></main>`,
};
const responsesPath = path.join(fixture, 'responses.json');
fs.writeFileSync(responsesPath, JSON.stringify(responses));
async function run(args, expected = 0) {
  const filename = path.join(fixture, 'scripts/corpus.js');
  const cliModule = { exports: {} };
  const localRequire = createRequire(filename);
  const cliRequire = (id) => localRequire(id);
  cliRequire.main = cliModule;
  let output = '';
  let finish;
  const exited = new Promise((resolve) => { finish = resolve; });
  const log = (...values) => { output += values.join(' ') + '\n'; };
  const context = vm.createContext({
    require: cliRequire, module: cliModule, __dirname: path.dirname(filename),
    process: { argv: ['node', filename, ...args], exit: finish },
    console: { log, error: log }, AbortSignal, URL,
    Buffer, Int32Array, SharedArrayBuffer, Atomics,
    fetch: async (url) => {
      const current = JSON.parse(fs.readFileSync(responsesPath, 'utf8'));
      if (!Object.hasOwn(current, url)) throw new Error('offline fixture rejects URL: ' + url);
      return { ok: true, text: async () => current[url] };
    },
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  assert.equal(await exited, expected, output);
  return output;
}

(async () => {
  await run(['fetch']);
  const recorded = fs.readFileSync(manifestPath, 'utf8');
  const stored = JSON.parse(recorded);
  for (const [i, doc] of stored.documents.entries()) {
    const text = fs.readFileSync(path.join(fixture, 'corpus/cache', `${doc.id}.txt`), 'utf8');
    assert.equal(text, bodies[i], `${doc.id}: exclude front matter and site furniture`);
    assert.equal(doc.words, bodies[i].split(/\s+/).length);
    assert.equal(doc.sha256, createHash('sha256').update(bodies[i]).digest('hex'));
  }
  assert.match(await run(['verify']), /ok/);
  await run(['fetch', '--force']);
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), recorded, 'second fetch preserves metadata');
  await run(['verify']);
  const first = stored.documents[0];
  const changed = { ...responses, [first.source.url]: responses[first.source.url] + '\nChanged upstream body.' };
  fs.writeFileSync(responsesPath, JSON.stringify(changed));
  await run(['fetch', '--force']);
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), recorded, 'changed source must not replace recorded hash');
  assert.match(await run(['verify'], 1), /DRIFT/);
  fs.writeFileSync(responsesPath, JSON.stringify(responses));
  await run(['fetch', '--force']);
  await run(['verify']);
  console.log('PASS: extraction, word cap, hash/word recording, repeat fetch, drift rejection, restoration');
  console.log(`Disposable fixture: ${fixture}`);
})().catch((err) => { console.error(err); process.exitCode = 1; });
