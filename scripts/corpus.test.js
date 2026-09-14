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
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
  stripGutenberg,
  htmlToText,
  applySlice,
  sha256,
  cmdList,
  fetchDoc,
  writeCacheFile,
  FETCH_TIMEOUT_MS,
  rowsFromText,
} = require('./corpus.js');
const { parseCsv } = require('./csv-lite.js');
const { DOMAIN_REGISTER } = require('./dataset-raid.js');

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

test('cache replacement retries Windows-style rename and removal collisions', () => {
  const id = 'corpus-cache-collision-test';
  const cacheFile = path.join(__dirname, '..', 'corpus', 'cache', `${id}.txt`);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, 'old corpus text');
  const originalRenameSync = fs.renameSync;
  const originalRmSync = fs.rmSync;
  let destinationRenames = 0;
  let destinationRemovals = 0;
  fs.renameSync = (source, destination) => {
    if (destination === cacheFile && destinationRenames < 2) {
      destinationRenames += 1;
      const error = new Error('simulated replacement collision');
      error.code = 'EPERM';
      throw error;
    }
    destinationRenames += 1;
    return originalRenameSync(source, destination);
  };
  fs.rmSync = (target, options) => {
    if (target === cacheFile && destinationRemovals++ === 0) {
      const error = new Error('simulated removal collision');
      error.code = 'EPERM';
      throw error;
    }
    return originalRmSync(target, options);
  };
  try {
    writeCacheFile(cacheFile, 'replacement corpus text');
    assert.equal(destinationRenames, 3);
    assert.equal(destinationRemovals, 2);
    assert.equal(fs.readFileSync(cacheFile, 'utf8'), 'replacement corpus text');
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rmSync = originalRmSync;
    originalRmSync(cacheFile, { force: true });
  }
});

test('cache replacement exhaustion preserves a complete competing file', () => {
  const id = 'corpus-cache-exhaustion-test';
  const cacheFile = path.join(__dirname, '..', 'corpus', 'cache', `${id}.txt`);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, 'first complete corpus');
  const originalRenameSync = fs.renameSync;
  const originalRmSync = fs.rmSync;
  let destinationRenames = 0;
  let destinationRemovals = 0;
  fs.renameSync = (_source, destination) => {
    if (destination !== cacheFile) return originalRenameSync(_source, destination);
    destinationRenames += 1;
    const error = new Error('simulated persistent rename collision');
    error.code = 'EEXIST';
    throw error;
  };
  fs.rmSync = (target, options) => {
    if (target !== cacheFile) return originalRmSync(target, options);
    destinationRemovals += 1;
    originalRmSync(target, options);
    fs.writeFileSync(target, 'complete competing corpus');
  };
  try {
    assert.throws(() => writeCacheFile(cacheFile, 'replacement corpus text'), /persistent rename collision/);
    assert.equal(destinationRenames, 4);
    assert.equal(destinationRemovals, 3, 'the final failed rename must not remove the destination');
    assert.equal(fs.readFileSync(cacheFile, 'utf8'), 'complete competing corpus');
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rmSync = originalRmSync;
    originalRmSync(cacheFile, { force: true });
  }
});

test('constructs text and dataset rows from the supplied source snapshot', () => {
  const doc = { id: 'snapshot', source: { type: 'local' }, register: 'docs', class: 'human' };
  assert.deepEqual(rowsFromText(doc, 'captured text'), [{ id: 'snapshot', text: 'captured text', register: 'docs', class: 'human', model: null, domain: null }]);
  assert.strictEqual(rowsFromText(doc, null), null);
  assert.deepEqual(rowsFromText({ ...doc, source: { type: 'dataset' } }, '{"id":"one","text":"first"}\r\n\r\n{"id":"two","text":"second"}\n'), [{ id: 'one', text: 'first' }, { id: 'two', text: 'second' }]);
});

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

test('script and style never reach the text', () => {
  const html = '<article><script>var delve = 1;</script><style>.a{color:red}</style><p>Body.</p></article>';
  const out = htmlToText(html, { selector: 'article' });
  assert.ok(!out.includes('delve'));
  assert.ok(!out.includes('color:red'));
  assert.equal(out, 'Body.');
});

test('authored header, nav, and footer inside the container survive', () => {
  // Semantic elements that are part of the writing must not be stripped by a
  // global chrome rule; only the selector decides what is in scope.
  const html = '<article><header>Site title</header><nav>Home</nav><p>Body.</p><footer>Copyright</footer></article>';
  const out = htmlToText(html, { selector: 'article' });
  assert.ok(out.includes('Site title'), 'authored header survived');
  assert.ok(out.includes('Home'), 'authored nav survived');
  assert.ok(out.includes('Body.'));
  assert.ok(out.includes('Copyright'), 'authored footer survived');
});

test('page chrome outside the container is excluded by the selector', () => {
  const html = '<header>Site title</header><nav>Home</nav><main><p>Body.</p></main><footer>Copyright</footer>';
  const out = htmlToText(html, { selector: 'main' });
  assert.ok(!out.includes('Site title'), 'outer header leaked');
  assert.ok(!out.includes('Home'), 'outer nav leaked');
  assert.ok(!out.includes('Copyright'), 'outer footer leaked');
  assert.equal(out, 'Body.');
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

// ── CSV (the machine corpus arrives as an 11.8 GB CSV) ─────────────────

test('csv: quoted commas and escaped quotes', () => {
  assert.equal(parseCsv('a,b\n"x,y",2\n').rows[0].a, 'x,y');
  assert.equal(parseCsv('a\n"he said ""hi"""\n').rows[0].a, 'he said "hi"');
});

test('csv: a newline inside a quoted field is not a row break', () => {
  // RAID generations contain paragraph breaks. Splitting on newlines would
  // shred the exact text being measured.
  const r = parseCsv('a,b\n"line1\nline2",2\n');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].a, 'line1\nline2');
});

test('csv: CRLF and a missing final newline both parse', () => {
  assert.equal(parseCsv('a,b\r\n1,2\r\n').rows.length, 1);
  assert.equal(parseCsv('a,b\n1,2').rows.length, 1);
});

test('csv: a truncated tail record is dropped, not half-parsed', () => {
  // Byte-range requests always cut the final record. Keeping it would feed a
  // mangled fragment into the measurement.
  const r = parseCsv('a,b\n1,2\n"unterminated', { dropLastPartial: true });
  assert.equal(r.rows.length, 1);
  assert.equal(r.truncated, true);
});

test('csv: empty fields are preserved rather than collapsed', () => {
  assert.equal(parseCsv('a,b,c\n1,,3\n').rows[0].b, '');
});

// ── RAID domain mapping ────────────────────────────────────────────────

test('raid: only defensible registers are mapped', () => {
  assert.equal(DOMAIN_REGISTER.abstracts, 'academic');
  assert.equal(DOMAIN_REGISTER.reddit, 'conversational');
  assert.equal(DOMAIN_REGISTER.code, undefined, 'code is not a prose register');
  assert.equal(DOMAIN_REGISTER.german, undefined, 'non-English domains are out of scope');
});


// ── Corpus listing ─────────────────────────────────────────────────────

test('list preserves preferred register order and sorts observed extras', () => {
  const manifest = {
    version: 1,
    documents: [
      {
        id: 'academic-one',
        year: 2021,
        register: 'academic',
        words: 80,
        source: { type: 'local', path: '/missing/academic-one.txt', license: 'test' },
      },
      {
        id: 'blog-one',
        year: 2020,
        register: 'blog',
        words: 100,
        source: { type: 'local', path: '/missing/blog-one.txt', license: 'test' },
      },
      {
        id: 'zeta-extra',
        year: 2026,
        register: 'zeta',
        words: 0,
        source: { type: 'local', path: '/missing/zeta.txt', license: 'test' },
      },
      {
        id: 'raid-en',
        year: 2026,
        register: 'mixed',
        words: 0,
        source: { type: 'local', path: '/missing/raid-en.txt', license: 'test' },
      },
      {
        id: 'hc3-en',
        year: 2026,
        register: 'mixed',
        words: 0,
        source: { type: 'local', path: '/missing/hc3-en.txt', license: 'test' },
      },
      {
        id: 'alpha-extra',
        year: 2026,
        register: 'alpha-extra',
        words: 0,
        source: { type: 'local', path: '/missing/alpha.txt', license: 'test' },
      },
    ],
  };

  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    assert.equal(cmdList(manifest), 0);
  } finally {
    console.log = originalLog;
  }

  const output = lines.join('\n');
  assert.ok(output.includes('6 document(s) across 5 register(s)'));

  const blogPos = output.indexOf('  blog  ');
  const academicPos = output.indexOf('  academic  ');
  const alphaPos = output.indexOf('  alpha-extra  ');
  const mixedPos = output.indexOf('  mixed  ');
  const zetaPos = output.indexOf('  zeta  ');

  assert.ok(blogPos !== -1 && academicPos !== -1);
  assert.ok(blogPos < academicPos, 'accepted registers keep REGISTERS order');
  assert.ok(academicPos < alphaPos, 'extra registers come after accepted registers');
  assert.ok(alphaPos < mixedPos && mixedPos < zetaPos, 'extra registers sort alphabetically');

  for (const id of [
    'academic-one',
    'blog-one',
    'zeta-extra',
    'raid-en',
    'hc3-en',
    'alpha-extra',
  ]) {
    assert.ok(output.includes(id), `missing printed row for ${id}`);
  }

  assert.ok(output.includes('registers with no coverage yet: technical-blog'));
});

// ── Hashing ────────────────────────────────────────────────────────────

test('sha256 is stable and content-sensitive', () => {
  assert.equal(sha256('abc'), sha256('abc'));
  assert.notEqual(sha256('abc'), sha256('abd'));
  assert.match(sha256('abc'), /^[0-9a-f]{64}$/);
});

test('default fetch timeout matches dataset ranged reads', () => {
  assert.equal(FETCH_TIMEOUT_MS, 180000);
});

let asyncFailed = 0;
async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    asyncFailed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

(async () => {
  await asyncTest('fetch validates cache ids and safely replaces cached content', async () => {
    await assert.rejects(
      () => fetchDoc({ id: '../outside', source: { type: 'url', url: 'https://example.invalid' } }, true),
      /invalid document id/,
    );

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('replacement corpus text');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const id = 'corpus-safe-write-test';
    const cacheFile = path.join(__dirname, '..', 'corpus', 'cache', `${id}.txt`);
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, 'old corpus text');
    try {
      const result = await fetchDoc({ id, source: { type: 'url', url: `http://127.0.0.1:${port}/text` } }, true);
      assert.equal(result.status, 'fetched');
      assert.equal(fs.readFileSync(cacheFile, 'utf8'), 'replacement corpus text');
    } finally {
      server.close();
      fs.rmSync(cacheFile, { force: true });
    }
  });

  await asyncTest('fetch times out with document id and host in the error', async () => {
    const server = http.createServer(() => {});
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const id = 'corpus-fetch-timeout-test';
    const cacheFile = path.join(__dirname, '..', 'corpus', 'cache', `${id}.txt`);
    const doc = { id, source: { type: 'url', url: `http://127.0.0.1:${port}/hang` } };
    try {
      await assert.rejects(
        () => fetchDoc(doc, true, { timeoutMs: 200 }),
        (err) => {
          assert.match(err.message, new RegExp(id));
          assert.match(err.message, /127\.0\.0\.1/);
          assert.match(err.message, /timed out after 200ms/);
          return true;
        },
      );
    } finally {
      server.close();
      if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
    }
  });

  await asyncTest('response body timeout keeps document id and host in the error', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.flushHeaders();
      res.write('partial body');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const id = 'corpus-body-timeout-test';
    const cacheFile = path.join(__dirname, '..', 'corpus', 'cache', `${id}.txt`);
    const doc = { id, source: { type: 'url', url: `http://127.0.0.1:${port}/stall` } };
    try {
      await assert.rejects(
        () => fetchDoc(doc, true, { timeoutMs: 200 }),
        (err) => {
          assert.match(err.message, new RegExp(id));
          assert.match(err.message, /127\.0\.0\.1/);
          assert.match(err.message, /timed out after 200ms/);
          return true;
        },
      );
    } finally {
      server.close();
      if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
    }
  });

  failed += asyncFailed;
  console.log(`\n${failed === 0 ? 'all corpus tests passed' : `${failed} test(s) failed`}\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
