/**
 * Avoid AI Writing — preservation validator tests
 *
 * Two failure classes are tested, and the second matters more:
 *
 *   1. The validator catches destructive rewrites (code edited, quote
 *      reworded, URL dropped).
 *   2. The validator does NOT fire on edits this skill documents as correct
 *      (stripping `utm_source=chatgpt.com`, sentence-casing a Title Case
 *      heading, re-aligning a table). A validator that blocks the skill's own
 *      instructions would be turned off within a day.
 *
 * Dependency-free; runs on node >= 18.
 */

const assert = require('node:assert/strict');
const { validate, formatResult } = require('./validate.js');

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

const codes = (result) => result.errors.map((e) => e.code);
const warnCodes = (result) => result.warnings.map((w) => w.code);

console.log('\npreservation validator\n');

// ── Destructive edits must fail ────────────────────────────────────────

test('fenced code edited → error', () => {
  const before = 'Intro.\n\n```js\nconst x = 1;\n```\n\nOutro.';
  const after = 'Intro.\n\n```js\nconst x = 2;\n```\n\nOutro.';
  const r = validate(before, after, { skipResidual: true });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('code-block-modified'));
});

test('fenced code removed → error', () => {
  const before = 'Intro.\n\n```sh\nnpm test\n```\n\nOutro.';
  const after = 'Intro.\n\nOutro.';
  const r = validate(before, after, { skipResidual: true });
  assert.ok(codes(r).includes('code-block-count'));
});

test('blockquote reworded → error', () => {
  const before = 'He said:\n\n> The system is slow and it is getting slower.\n> We need to fix it.\n\nThat is the claim.';
  const after = 'He said:\n\n> The system is slow and getting slower.\n> We need to fix it.\n\nThat is the claim.';
  const r = validate(before, after, { skipResidual: true });
  assert.ok(codes(r).includes('blockquote-modified'));
});

test('table cell content changed → error', () => {
  const before = '| Repo | Stars |\n|---|---|\n| patina | 278 |\n';
  const after = '| Repo | Stars |\n|---|---|\n| patina | 280 |\n';
  const r = validate(before, after, { skipResidual: true });
  assert.ok(codes(r).includes('table-modified'));
});

test('inline code dropped → error', () => {
  const before = 'Run `npm test` before pushing the change.';
  const after = 'Run the test suite before pushing the change.';
  const r = validate(before, after, { skipResidual: true });
  assert.ok(codes(r).includes('inline-code-missing'));
});

test('URL dropped → error', () => {
  const before = 'See https://example.com/report for the numbers.';
  const after = 'See the linked report for the numbers.';
  const r = validate(before, after, { skipResidual: true });
  assert.ok(codes(r).includes('url-missing'));
});

test('file path altered → error', () => {
  const before = 'The engine lives in ./detector/patterns.js today.';
  const after = 'The engine lives in ./detector/patterns.ts today.';
  const r = validate(before, after, { skipResidual: true });
  assert.ok(codes(r).includes('path-missing'));
});

test('section deleted → heading count error', () => {
  const before = '# Title\n\nBody text here.\n\n## Second\n\nMore body text.';
  const after = '# Title\n\nBody text here.';
  const r = validate(before, after, { skipResidual: true });
  assert.ok(codes(r).includes('heading-count'));
});

test('heading nesting changed → error', () => {
  const before = '# Title\n\nBody.\n\n## Sub\n\nMore.';
  const after = '# Title\n\nBody.\n\n### Sub\n\nMore.';
  const r = validate(before, after, { skipResidual: true });
  assert.ok(codes(r).includes('heading-level'));
});

test('frontmatter touched → error', () => {
  const before = '---\ntitle: Draft\n---\n\nBody.';
  const after = '---\ntitle: Draft v2\n---\n\nBody.';
  const r = validate(before, after, { skipResidual: true });
  assert.ok(codes(r).includes('frontmatter-modified'));
});

// ── Documented, correct edits must pass ────────────────────────────────

test('stripping an AI utm_source parameter → no error', () => {
  const before = 'Background: https://example.com/post?utm_source=chatgpt.com and more.';
  const after = 'Background: https://example.com/post and more.';
  const r = validate(before, after, { skipResidual: true });
  assert.equal(r.ok, true, formatResult(r));
});

test('sentence-casing a Title Case heading → warning, not error', () => {
  const before = '## Strategic Negotiations And Key Partnerships\n\nBody text goes here.';
  const after = '## Strategic negotiations and key partnerships\n\nBody text goes here.';
  const r = validate(before, after, { skipResidual: true });
  assert.equal(r.ok, true, formatResult(r));
  assert.ok(warnCodes(r).includes('heading-text'));
});

test('removing an emoji from a heading → warning, not error', () => {
  const before = '## 🚀 What this means\n\nBody text goes here.';
  const after = '## What this means\n\nBody text goes here.';
  const r = validate(before, after, { skipResidual: true });
  assert.equal(r.ok, true, formatResult(r));
});

test('re-aligning table padding → no error', () => {
  const before = '| Repo | Stars |\n|---|---|\n| patina | 278 |\n';
  const after = '| Repo   | Stars |\n| ------ | ----- |\n| patina | 278   |\n';
  const r = validate(before, after, { skipResidual: true });
  assert.equal(r.ok, true, formatResult(r));
});

test('ordinary prose rewrite → no error', () => {
  const before = 'We leverage a robust and comprehensive framework to delve into the landscape of developer tooling.';
  const after = 'We use a reliable framework to look at developer tooling.';
  const r = validate(before, after, { skipResidual: true });
  assert.equal(r.ok, true, formatResult(r));
});

test('four-space list continuation is not treated as code', () => {
  const before = '- First item\n\n    continued paragraph under the item\n\n- Second item';
  const after = '- First item\n\n    continued paragraph under the item\n\n- Second item';
  const r = validate(before, after, { skipResidual: true });
  assert.equal(r.stats.indentedBlocks, 0);
});

test('URL inside a code block is not double-counted as prose', () => {
  const before = '```sh\ncurl https://example.com/api\n```\n\nPlain body text.';
  const after = '```sh\ncurl https://example.com/api\n```\n\nPlain body copy.';
  const r = validate(before, after, { skipResidual: true });
  assert.equal(r.ok, true, formatResult(r));
});

// ── Warnings ──────────────────────────────────────────────────────────

test('dropped figure → warning', () => {
  const before = 'Revenue grew 42% last quarter on 1,200 new accounts.';
  const after = 'Revenue grew sharply last quarter on 1,200 new accounts.';
  const r = validate(before, after, { skipResidual: true });
  assert.equal(r.ok, true);
  assert.ok(warnCodes(r).includes('number-missing'));
});

test('halved text → shrink warning', () => {
  const before = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ') + '.';
  const after = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ') + '.';
  const r = validate(before, after, { skipResidual: true });
  assert.ok(warnCodes(r).includes('large-shrink'));
});

// ── Residual patterns ─────────────────────────────────────────────────

test('rewrite that adds AI patterns → residual error', () => {
  const before = 'The team shipped the parser on Tuesday. It reads 40MB files without the old memory spike.';
  const after = 'The team leveraged a robust, comprehensive approach to delve into the landscape of parsing. '
    + 'It is important to note that this is a testament to their seamless, cutting-edge paradigm. '
    + 'Great question! I hope this helps!';
  const r = validate(before, after);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('residual-grew'), formatResult(r));
});

test('rewrite that removes AI patterns → clean', () => {
  const before = 'We leverage a robust and comprehensive framework to delve into the ever-evolving landscape '
    + 'of developer tooling, showcasing a seamless and cutting-edge paradigm. It is important to note that '
    + 'this is a testament to the team.';
  const after = 'We use a reliable framework to study developer tooling. The team built it in six weeks.';
  const r = validate(before, after);
  assert.equal(r.ok, true, formatResult(r));
  assert.ok(r.stats.residual.issuesAfter <= r.stats.residual.issuesBefore);
});

test('identical input and output is always clean', () => {
  const text = '---\ntitle: Test\n---\n\n# Heading\n\nBody with `code`, a https://example.com link, and ./a/path.js.\n\n> A quote.\n> Second line.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
  const r = validate(text, text);
  assert.equal(r.ok, true, formatResult(r));
  assert.equal(r.warnings.length, 0, formatResult(r));
});

test('non-string input throws', () => {
  assert.throws(() => validate('a', null), TypeError);
});

console.log(`\n${failed === 0 ? 'all preservation tests passed' : `${failed} test(s) failed`}\n`);
process.exit(failed === 0 ? 0 : 1);
