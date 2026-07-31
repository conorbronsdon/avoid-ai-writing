/**
 * Avoid AI Writing — corpus helper tests
 *
 * These helpers decide what text a false-positive measurement actually sees.
 * A silent extraction bug would not crash anything; it would quietly change a
 * published rate, which is the worse failure. Hence tests.
 *
 * Dependency-free; runs on node >= 18.
 */

const assert = require('node:assert/strict');
const { stripGutenberg, htmlToText, applySlice, sha256 } = require('./corpus.js');

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

console.log('\ncorpus helpers\n');

// ── Gutenberg boilerplate ──────────────────────────────────────────────

test('strips Gutenberg header and footer', () => {
  const raw = [
    'The Project Gutenberg eBook of Something',
    'This eBook is for the use of anyone anywhere...',
    '*** START OF THE PROJECT GUTENBERG EBOOK SOMETHING ***',
    '',
    'The actual prose begins here.',
    '',
    '*** END OF THE PROJECT GUTENBERG EBOOK SOMETHING ***',
    'Updated editions will replace the previous one...',
  ].join('\n');
  const out = stripGutenberg(raw);
  assert.equal(out, 'The actual prose begins here.');
});

test('leaves text without Gutenberg markers alone', () => {
  const raw = 'Just some prose.\n\nMore prose.';
  assert.equal(stripGutenberg(raw), raw);
});

// ── HTML extraction ────────────────────────────────────────────────────

test('container mode pulls the named element', () => {
  const html = '<nav>Home About</nav><article><p>First para.</p><p>Second para.</p></article><footer>Copyright</footer>';
  const out = htmlToText(html, { selector: 'article' });
  assert.ok(out.includes('First para.'));
  assert.ok(out.includes('Second para.'));
  assert.ok(!out.includes('Home About'), 'navigation leaked in');
  assert.ok(!out.includes('Copyright'), 'footer leaked in');
});

test('container mode accepts a bare selector string', () => {
  const html = '<article><p>Body.</p></article>';
  assert.ok(htmlToText(html, 'article').includes('Body.'));
});

test('paragraph mode filters by an attribute marker', () => {
  const html = [
    '<p class="nav">Skip to content</p>',
    '<p class="" style="white-space:pre-wrap;">Real body text here.</p>',
    '<p class="" style="white-space:pre-wrap;">More body text.</p>',
    '<p class="footer">All rights reserved</p>',
  ].join('');
  const out = htmlToText(html, { mode: 'paragraphs', match: 'white-space:pre-wrap' });
  assert.ok(out.includes('Real body text here.'));
  assert.ok(out.includes('More body text.'));
  assert.ok(!out.includes('Skip to content'));
  assert.ok(!out.includes('All rights reserved'));
});

test('paragraph mode without a match takes every paragraph', () => {
  const html = '<p>One.</p><p>Two.</p>';
  const out = htmlToText(html, { mode: 'paragraphs' });
  assert.ok(out.includes('One.') && out.includes('Two.'));
});

test('extraction throws rather than returning empty text', () => {
  assert.throws(() => htmlToText('<div>no article</div>', { selector: 'article' }), /no <article>/);
  assert.throws(() => htmlToText('<div>no paras</div>', { mode: 'paragraphs' }), /no <p> elements/);
});

test('entities are decoded and tags removed', () => {
  const html = '<article><p>Ben &amp; Jerry&#8217;s &#8212; a test &lt;here&gt;</p></article>';
  const out = htmlToText(html, { selector: 'article' });
  assert.equal(out, 'Ben & Jerry’s — a test <here>');
});

test('em dashes survive extraction', () => {
  // The em-dash rule is measured against this corpus, so an extraction step
  // that silently dropped or converted dashes would corrupt that number.
  const html = '<article><p>One thing &#8212; and another — plus a third.</p></article>';
  const out = htmlToText(html, { selector: 'article' });
  assert.equal((out.match(/—/g) || []).length, 2);
});

test('script and style contents never reach the text', () => {
  const html = '<article><script>var delve = 1;</script><style>.a{color:red}</style><p>Body.</p></article>';
  const out = htmlToText(html, { selector: 'article' });
  assert.ok(!out.includes('delve'));
  assert.ok(!out.includes('color:red'));
});

// ── Slicing ────────────────────────────────────────────────────────────

test('slice.after starts at the marker', () => {
  const out = applySlice('Front matter here. MARKER the real text begins.', { after: 'MARKER' });
  assert.equal(out, 'the real text begins.');
});

test('slice.after throws on a missing marker rather than silently taking everything', () => {
  assert.throws(() => applySlice('some text', { after: 'NOPE' }), /marker not found/);
});

test('slice.maxWords bounds the sample', () => {
  const text = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
  const out = applySlice(text, { maxWords: 10 });
  assert.equal((out.match(/\S+/g) || []).length, 10);
});

test('no slice returns the text unchanged', () => {
  assert.equal(applySlice('unchanged', null), 'unchanged');
});

// ── Hashing ────────────────────────────────────────────────────────────

test('sha256 is stable and content-sensitive', () => {
  assert.equal(sha256('abc'), sha256('abc'));
  assert.notEqual(sha256('abc'), sha256('abd'));
  assert.match(sha256('abc'), /^[0-9a-f]{64}$/);
});

console.log(`\n${failed === 0 ? 'all corpus tests passed' : `${failed} test(s) failed`}\n`);
process.exit(failed === 0 ? 0 : 1);
