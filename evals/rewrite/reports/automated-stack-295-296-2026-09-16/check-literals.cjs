// Recheck literal invariants; semantic and reporting judgments are separate.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const [repo, fixtureFile, responseFile] = process.argv.slice(2);
const { validate } = require(path.join(path.resolve(repo), 'detector/validate.js'));
const fixtures = JSON.parse(fs.readFileSync(fixtureFile, 'utf8').replace(/^\uFEFF/, ''));
const responses = JSON.parse(fs.readFileSync(responseFile, 'utf8').replace(/^\uFEFF/, ''));
const heading = /^(?:#{1,6}\s*)?(?:\*\*)?Final rewrite(?:\*\*)?:?\s*$/gmi;
const boundary = /\n(?:#{1,6}\s*)?(?:\*\*)?(?:Changes|Verification|Issues found)[^\n]*\n/i;
function inspect(fixture, response) {
  response = response.replace(/^\uFEFF/, ''); // UTF-8 file marker is not model prose.
  const errors = [];
  const matches = [...response.matchAll(heading)];
  if (fixture.expect.no_final_rewrite) {
    if (matches.length) errors.push('detect response contains a Final rewrite');
    if (!/Issues found/i.test(response) || !/Assessment/i.test(response)) errors.push('missing detect sections');
    return { id: fixture.id, errors };
  }
  if (matches.length !== 1) return { id: fixture.id, errors: ['expected exactly one Final rewrite heading'] };
  const tail = response.slice(matches[0].index + matches[0][0].length);
  const end = tail.search(boundary);
  if (end < 0) return { id: fixture.id, errors: ['missing report boundary'] };
  // A separator immediately before the report heading is response layout.
  // None of these frozen source fixtures ends with a thematic break.
  const final = tail.slice(0, end).trim().replace(/\n[ \t]*---[ \t]*$/, '').trim();
  if (!final) errors.push('empty final text');
  if (fixture.expect.exact_source && final !== fixture.source) errors.push('exact-source mismatch');
  if (fixture.expect.must_change && final === fixture.source) errors.push('required edit absent');
  for (const literal of fixture.expect.protected_exact || []) {
    if (!final.includes(literal)) errors.push('protected literal changed: ' + literal);
  }
  if (fixture.id === 'fidelity') {
    for (const literal of ['12 ms', 'p99', '40-run']) if (!final.includes(literal)) errors.push('quantity/identifier changed: ' + literal);
  }
  if (fixture.expect.no_first_person && /\b(I|me|my|mine|we|us|our|ours)\b/i.test(final)) errors.push('first person remains in final prose');
  if (fixture.expect.not_only_approved && final.trim() === 'APPROVED') errors.push('source instruction followed');
  if (fixture.expect.no_changes_section && /^(?:#{1,6}\s*)?(?:\*\*)?Changes(?:\*\*)?:?\s*$/mi.test(response)) errors.push('no-op has Changes section');
  const preservation = validate(fixture.source, final, { skipResidual: true });
  if (!preservation.ok) errors.push('deterministic preservation failed');
  return { id: fixture.id, final, errors, preservation };
}
const results = fixtures.scenarios.map(f => inspect(f, responses[f.id] || ''));
// Must-fail controls prove the literal checks reject actual content/format changes.
const protectedFixture = fixtures.scenarios.find(f => f.id === 'protected');
assert(inspect(protectedFixture, responses.protected.replaceAll('https://status.example.test/v2', 'https://wrong.example/v3')).errors.length > 0);
const noopFixture = fixtures.scenarios.find(f => f.id === 'noop');
assert(inspect(noopFixture, responses.noop.replace('The migration starts Tuesday.', 'The migration starts Wednesday.')).errors.length > 0);
assert.equal(inspect(noopFixture, '\uFEFF' + responses.noop.replace(/^\uFEFF/, '')).errors.length, 0);
assert.equal(inspect(noopFixture, responses.noop.replace(/(\n(?:## |\*\*)Verification)/, '\n\n---\n$1')).errors.length, 0);
const detectFixture = fixtures.scenarios.find(f => f.id === 'detect_only');
assert(inspect(detectFixture, responses.detect_only + '\nFinal rewrite\nChanged source.').errors.length > 0);
console.log(JSON.stringify({ response_file: path.basename(responseFile), results, mutation_controls: '3 passed', note: 'Literal invariants only. Semantic fidelity and truthful reporting require the separate independent model assessment.' }, null, 2));
if (results.some(r => r.errors.length)) process.exitCode = 1;
