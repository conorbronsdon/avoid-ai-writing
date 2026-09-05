#!/usr/bin/env node
/* Tests for scripts/normalize-quotes.js — run by `npm test`. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { normalize } = require('./normalize-quotes.js');
const { check } = require('./check-style.js');

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; process.stdout.write(`  ✓ ${name}\n`); };
const curly = (s) => normalize(s, 'curly');

t('explicit targets normalize quotes, contractions and possessives', () => {
  assert.strictEqual(curly('She said "you\'ve got the users\' data."'), 'She said “you’ve got the users’ data.”');
  assert.strictEqual(normalize('“You’ve got ‘it’.”', 'straight'), '"You\'ve got \'it\'."');
  for (const q of [undefined, null, '', 'auto']) assert.throws(() => normalize('plain', q), /quotes must/);
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
  for (const args of [[], ['a.md'], ['a.md', '--quotes'], ['a.md', '--quotes', 'auto'],
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

console.log(`\nnormalize-quotes: ${passed} passed.`);
