#!/usr/bin/env node
/* Tests for scripts/normalize-quotes.js — run by `npm test`. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { normalize, inferQuotes } = require('./normalize-quotes.js');
const { check } = require('./check-style.js');

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; process.stdout.write(`  ✓ ${name}\n`); };
const curly = (s) => normalize(s, 'curly');

t('explicit targets normalize quotes, contractions and possessives', () => {
  assert.strictEqual(curly('She said "you\'ve got the users\' data."'), 'She said “you’ve got the users’ data.”');
  assert.strictEqual(normalize('“You’ve got ‘it’.”', 'straight'), '"You\'ve got \'it\'."');
  for (const q of [null, '', 'invalid']) assert.throws(() => normalize('plain', q), /quotes must/);
});
t('auto infers double and single marks independently from original prose', () => {
  const original = '“Hello.” “Welcome.” It\'s the users\' choice. `"code"`';
  assert.deepStrictEqual(inferQuotes(original), { double: 'curly', single: 'straight' });
  assert.strictEqual(normalize('"New." It’s done.', 'auto', original), '“New.” It\'s done.');
  assert.strictEqual(normalize('“New.” It’s done.', 'auto', '"Old." It\'s done.'), '"New." It\'s done.');
  assert.strictEqual(normalize('“Old.” “More.” "New."'), '“Old.” “More.” “New.”');
});
t('auto ties use first style and missing evidence preserves that mark family', () => {
  assert.deepStrictEqual(inferQuotes('"First" “second”'), { double: 'straight', single: null });
  assert.deepStrictEqual(inferQuotes('“First” "second"'), { double: 'curly', single: null });
  const draft = '"New" isn’t old.';
  assert.strictEqual(normalize(draft, 'auto', 'No marks. 5\'11" `"code"`'), draft);
  assert.strictEqual(normalize(draft, 'auto', '“Original.”'), '“New” isn’t old.');
});
t('auto ignores protected syntax in the reference document', () => {
  const reference = '---\ntitle: "raw"\n---\n[Docs](url "raw") `"raw"`\n\n“Live.”';
  assert.deepStrictEqual(inferQuotes(reference), { double: 'curly', single: null });
  assert.strictEqual(normalize('"New" [Docs](url "raw")', 'auto', reference), '“New” [Docs](url "raw")');
});
t('nested quotes and interrupted dialogue get their direction', () => {
  assert.strictEqual(curly('She said, "\'Stop,\' he began."'), 'She said, “‘Stop,’ he began.”');
  assert.strictEqual(curly('"I was going--" she stopped.'), '“I was going--” she stopped.');
  assert.strictEqual(curly('**"hello"** and _\'world\'_'), '**“hello”** and _‘world’_');
});
t('existing curly marks survive a curly pass, including mixed text', () => {
  assert.strictEqual(curly('“already” and "new"; ’twas'), '“already” and “new”; ’twas');
});
t('decades educate while feet and inch primes follow the checker carve-out', () => {
  assert.strictEqual(curly('In the \'90s it was 5\'11" tall.'), 'In the ’90s it was 5\'11" tall.');
});
t('leading elisions remain a documented contextual limitation', () => {
  assert.strictEqual(curly("rock 'n' roll"), 'rock ‘n’ roll');
});
t('code adjacency preserves opening quotes and possessive apostrophes', () => {
  assert.strictEqual(curly('say "`git push`"; `--flag`\'s default'), 'say “`git push`”; `--flag`’s default');
});

// Each protected fixture is checked in both directions, with live prose immediately
// afterward. Full equality catches syntax changes and accidental over-masking alike.
const protectedCases = [
  ['frontmatter with BOM and CRLF', '\uFEFF---\r\ntitle: "Raw ‘title’"\r\n---\r\n'],
  ['frontmatter ending with dots', '---\ntitle: "Raw ‘title’"\n...\n'],
  ['nested/mismatched fences', '````md\n```\n~~~\n"raw ‘code’"\n````\n'],
  ['fence with a non-closing info suffix', '~~~\n~~~ text\n"raw ‘code’"\n~~~~\n'],
  ['fence containing blockquote syntax', '```\n> "raw ‘code’"\n```\n'],
  ['blockquote fence', '> ```\n> "raw ‘code’"\n> ```\n'],
  ['list fence', '- item\n\n  ```\n  "raw ‘code’"\n  ```\n'],
  ['space/tab indented code', '    "raw ‘code’"\n\n\t"more ‘code’"\n'],
  ['indented code inside a list', '- item\n\n      "raw ‘code’"\n'],
  ['exact-length inline code', '`` a ` "raw ‘code’" ``\n'],
  ['wrapped inline code', '`raw\n"raw ‘code’"`\n'],
  ['link destination and title', '[docs](https://x/Foo_(bar) "Raw ‘title’")\n'],
  ['escaped destination and title delimiters', '[docs](a\\)b "Raw \\"title\\" (text)")\n'],
  ['wrapped link title', '[docs](https://x\n  "Raw ‘title’")\n'],
  ['angle destination and parenthesized title', '[docs](<a b> (Raw ‘title’))\n'],
  ['nested destination and multiline title', '[docs](a(b(c)) "Raw\n‘title’")\n'],
  ['reference definition and wrapped title', '[ref]: https://x\n  "Raw ‘title’"\n'],
  ['reference identifiers', '[O\'Reilly]\n\n[O\'Reilly]: https://x "Raw ‘title’"\n'],
  ['full and collapsed reference identifiers', '[Read][O\'Reilly] [O\'Reilly][]\n\n[O\'Reilly]: https://x\n'],
  ['HTML attributes and comments', '<span title="Raw ‘title’">text</span> <!-- "raw ‘comment’" -->\n'],
  ['wrapped HTML attributes', '<span\n title="Raw ‘title’">text</span>\n'],
  ['autolinks', '<https://x/O\'Reilly> <o\'reilly@example.com>\n'],
  ['escaped marks', '\\"raw\\" \\‘raw\\’\n'],
];
for (const [name, source] of protectedCases) {
  t(`protects ${name} in both modes`, () => {
    assert.strictEqual(curly(source + '\n"live"'), source + '\n“live”');
    assert.strictEqual(normalize(source + '\n“live”', 'straight'), source + '\n"live"');
    assert.deepStrictEqual(check(source, { quotes: 'curly' }).hard, []);
    assert.deepStrictEqual(check(source, { quotes: 'straight' }).hard, []);
  });
}
t('unclosed fences remain protected through EOF', () => {
  const source = '"live"\n```\n"raw"';
  assert.strictEqual(curly(source), '“live”\n```\n"raw"');
});
t('malformed links cannot hide prose across a single newline or spaces', () => {
  for (const gap of ['\n', '\r\n', ' ']) {
    const source = '[x](url' + gap + 'This is "actual prose")';
    assert.strictEqual(curly(source), source.replace('"actual prose"', '“actual prose”'));
    assert.strictEqual(normalize(source.replace('"actual prose"', '“actual prose”'), 'straight'), source);
  }
  assert.strictEqual(curly('[x](<url\nThis is "prose">)'), '[x](<url\nThis is “prose”>)');
  assert.strictEqual(curly('[x](url "title" extra "prose")'), '[x](url “title” extra “prose”)');
  assert.strictEqual(curly('[x](url "title\n\nactual prose")'), '[x](url “title\n\nactual prose”)');
});
t('a failed outer candidate does not hide a valid later link', () => {
  assert.strictEqual(curly('[x](broken [y](url "Title") "live"'), '[x](broken [y](url "Title") “live”');
});
t('many unmatched link openers finish within a bounded child process', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('assert');
    const { normalize } = require(${JSON.stringify(path.join(__dirname, 'normalize-quotes.js'))});
    for (const token of ['](', '[x](', '](a(']) {
      const prefix = token.repeat(50000);
      assert.strictEqual(normalize(prefix + ' "live"', 'curly'), prefix + ' “live”');
    }
  `], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
});
t('thematic breaks and unclosed frontmatter leave prose live', () => {
  assert.strictEqual(curly('---\n\n"live"\n\n---'), '---\n\n“live”\n\n---');
  assert.strictEqual(curly('---\n"live"'), '---\n“live”');
});
t('lazy and list paragraph continuations remain prose', () => {
  assert.strictEqual(curly('Para\n    "live"'), 'Para\n    “live”');
  assert.strictEqual(curly('- item\n\n    "live"'), '- item\n\n    “live”');
});
t('link labels and HTML body text remain prose', () => {
  assert.strictEqual(curly('["live"](url "Title") <b>"live"</b>'), '[“live”](url "Title") <b>“live”</b>');
  assert.strictEqual(curly('[Docs](url): "Note"'), '[Docs](url): “Note”');
  assert.strictEqual(curly('[sic]: he said "hi" plainly.'), '[sic]: he said “hi” plainly.');
  assert.strictEqual(curly('For n<N, the "tail" sum > epsilon.'), 'For n<N, the “tail” sum > epsilon.');
});
t('hyphens, headings, tables, Unicode and newline bytes stay unchanged', () => {
  const source = '# My Heading\r\n\r\n|--|--|\n110--12 --write https://xn--nxasmq6b.example\n\n中文 😀 "hello"  ';
  assert.strictEqual(curly(source), source.replace('"hello"', '“hello”'));
});
t('both modes are idempotent and their output passes the shared checker', () => {
  const source = 'She said "you\'ve won".\n\n[docs](url "Title") `"code"`';
  for (const quotes of ['straight', 'curly']) {
    const once = normalize(source, quotes);
    assert.strictEqual(normalize(once, quotes), once);
    assert.deepStrictEqual(check(once, { quotes }).hard, []);
  }
});

const withCLI = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nq-cli-'));
  const cli = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'normalize-quotes.js'), ...args], { cwd: dir, encoding: 'utf8' });
  try { fn(dir, cli); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
t('CLI stdout is exact and read-only; --write updates only the requested file', () => withCLI((dir, cli) => {
  const file = path.join(dir, 'curly'); // filename equals option value
  const source = '\uFEFF---\r\ntitle: "Raw"\r\n---\r\n"live"';
  fs.writeFileSync(file, source);
  fs.writeFileSync(path.join(dir, 'other.md'), source);
  const preview = cli('--quotes', 'curly', 'curly');
  assert.strictEqual(preview.status, 0, preview.stderr);
  assert.strictEqual(preview.stdout, source.replace('"live"', '“live”'));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), source);
  const write = cli('curly', '--write', '--quotes', 'curly');
  assert.strictEqual(write.status, 0, write.stderr);
  assert.strictEqual(write.stdout, '');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), preview.stdout);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'other.md'), 'utf8'), source);
}));
t('CLI rejects invalid/missing options, extra files and I/O errors with exit 2', () => withCLI((dir, cli) => {
  fs.writeFileSync(path.join(dir, 'a.md'), '"unchanged"');
  for (const args of [[], ['a.md', '--quotes'], ['a.md', '--quotes', 'invalid'],
    ['a.md', '--reference'], ['a.md', '--reference', '--write'],
    ['a.md', '--reference', 'missing.md'], ['a.md', '--reference', 'a.md', '--quotes', 'curly'],
    ['a.md', '--reference', 'a.md', '--reference', 'a.md'],
    ['a.md', '--quotes', 'curly', '--bogus'], ['a.md', 'b.md', '--quotes', 'curly'],
    ['a.md', '--quotes', 'curly', '--quotes', 'straight'], ['missing.md', '--quotes', 'curly'],
    ['.', '--quotes', 'curly', '--write']]) {
    const r = cli(...args);
    assert.strictEqual(r.status, 2, args.join(' '));
    assert.ok(r.stderr);
    assert.strictEqual(r.stdout, '');
  }
  assert.strictEqual(fs.readFileSync(path.join(dir, 'a.md'), 'utf8'), '"unchanged"');
}));

t('CLI defaults to auto and uses the original reference for preview and write', () => withCLI((dir, cli) => {
  const original = '“Old.” It\'s done.';
  const draft = '"New." It’s done.';
  fs.writeFileSync(path.join(dir, 'original.md'), original);
  fs.writeFileSync(path.join(dir, 'draft.md'), draft);
  const preview = cli('draft.md', '--reference', 'original.md');
  assert.strictEqual(preview.status, 0, preview.stderr);
  assert.strictEqual(preview.stdout, '“New.” It\'s done.');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'draft.md'), 'utf8'), draft);
  const write = cli('draft.md', '--quotes', 'auto', '--reference', 'original.md', '--write');
  assert.strictEqual(write.status, 0, write.stderr);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'draft.md'), 'utf8'), preview.stdout);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'original.md'), 'utf8'), original);
  assert.strictEqual(cli('draft.md').stdout, preview.stdout);
}));


t('inline syntax follows source order and never rewrites protected attributes', () => {
  const cases = [
    ['<span title="`">"live"</span> and `code`', '<span title="`">“live”</span> and `code`'],
    ['`<span title="raw">` and "live"', '`<span title="raw">` and “live”'],
    ['[docs](url "a `tick` and <b>title</b>") "live"', '[docs](url "a `tick` and <b>title</b>") “live”'],
    ['`[docs](url "title")` and "live"', '`[docs](url "title")` and “live”'],
    ['`start\n[ref]: url "title"\nend` and "live"', '`start\n[ref]: url "title"\nend` and “live”'],
    ['<!-- `raw --> "live" `code`', '<!-- `raw --> “live” `code`'],
  ];
  for (const [source, expected] of cases) {
    assert.strictEqual(curly(source), expected);
    assert.strictEqual(normalize(expected, 'straight'), source);
    assert.strictEqual(curly(expected), expected);
  }
});
t('literal HTML blocks stay untouched while ordinary HTML body prose changes', () => {
  for (const tag of ['script', 'style', 'pre', 'textarea', 'SCRIPT']) {
    const source = `<${tag}>\nconst x = "raw";\n\n'raw'\n</${tag}>\n\n"live"`;
    const expected = source.replace('"live"', '“live”');
    assert.strictEqual(curly(source), expected);
    assert.strictEqual(normalize(expected, 'straight'), source);
    assert.deepStrictEqual(check(expected, { quotes: 'curly' }).hard, []);
  }
  assert.strictEqual(curly('<b>"live"</b>'), '<b>“live”</b>');
  assert.strictEqual(curly('`<script>` "live"'), '`<script>` “live”');
});
t('inline code cannot hide a heading or another list item', () => {
  for (const source of ['`one\n# "live"\nend`', '- `one\n- "live" end`', '`one\n---\n"live" end`']) {
    assert.strictEqual(curly(source), source.replace('"live"', '“live”'));
    assert.ok(check(source, { quotes: 'curly' }).hard.length);
  }
  assert.strictEqual(curly('`one\n"code"\nend` "live"'), '`one\n"code"\nend` “live”');
});
t('a list fence ends when its container ends, including sibling items', () => {
  for (const suffix of ['"live"', '- "live"']) {
    const source = '- ```\n  "code"\n\n' + suffix;
    assert.strictEqual(curly(source), source.replace('"live"', '“live”'));
    assert.deepStrictEqual(check(source, { quotes: 'curly' }).hard.map(x => x.line), [4]);
  }
  const source = '- ```\n  "code"\n\n  "still code"';
  assert.strictEqual(curly(source), source);
});
t('escaped reference openers stay prose while actual references retain identifiers', () => {
  const source = "\\[O'Reilly]\n\n[O'Reilly]: /url";
  assert.strictEqual(curly(source), "\\[O’Reilly]\n\n[O'Reilly]: /url");
  assert.ok(check(source, { quotes: 'curly' }).hard.length);
  assert.strictEqual(curly("[O'Reilly]\n\n[O'Reilly]: /url"), "[O'Reilly]\n\n[O'Reilly]: /url");
});
t('bare URLs retain balanced parentheses but leave prose quotes and delimiters live', () => {
  assert.strictEqual(curly('See https://x/Foo_(bar), "live".'), 'See https://x/Foo_(bar), “live”.');
  assert.strictEqual(curly('"https://x/path"'), '“https://x/path”');
  assert.strictEqual(curly("https://x/O'Reilly"), "https://x/O'Reilly");
  assert.strictEqual(curly("Read 'https://x/O'Reilly' today."), "Read ‘https://x/O'Reilly’ today.");
  assert.strictEqual(normalize("Read ‘https://x/O'Reilly’ today.", 'straight'), "Read 'https://x/O'Reilly' today.");
  assert.deepStrictEqual(check('(see https://x/Foo_(bar)), e.g. outside.', { latinAbbrev: 'parentheses' }).hard,
    [{ line: 1, rule: 'latin-abbrev-outside-parens' }]);
  assert.deepStrictEqual(check('(e.g. see https://x/Foo_(bar)).', { latinAbbrev: 'parentheses' }).hard, []);
});

t('frontmatter delimiters allow trailing spaces without exposing metadata', () => {
  for (const end of ['---  ', '...\t']) {
    const source = '--- \t\ntitle: "raw"\n' + end + '\n"live"';
    assert.strictEqual(curly(source), source.replace('"live"', '“live”'));
    assert.deepStrictEqual(check(source, { quotes: 'curly' }).hard.map(x => x.line), [4]);
  }
  assert.strictEqual(curly('---  \n\n"live"\n---'), '---  \n\n“live”\n---');
  assert.strictEqual(curly('---\ntitle: "live"\n---extra'), '---\ntitle: “live”\n---extra');
});
t('quoted URL punctuation leaves an enclosing prose parenthesis visible', () => {
  assert.deepStrictEqual(check("(see 'https://example.com).', e.g. outside.", { latinAbbrev: 'parentheses' }).hard,
    [{ line: 1, rule: 'latin-abbrev-outside-parens' }]);
  assert.deepStrictEqual(check("(e.g. see 'https://example.com/Foo_(bar).').", { latinAbbrev: 'parentheses' }).hard, []);
});

console.log(`\nnormalize-quotes: ${passed} passed.`);
