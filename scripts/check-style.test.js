#!/usr/bin/env node
/* Tests for scripts/check-style.js — run by `npm test`. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { check, resolveConfig } = require('./check-style.js');

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; process.stdout.write(`  ✓ ${name}\n`); };

// --- quotes (hard) ---
t('quotes:straight flags curly marks; a clean doc passes', () => {
  assert.strictEqual(check('# ok\n\nplain "straight" text', { quotes: 'straight' }).hard.length, 0);
  assert.ok(check('# ok\n\nuse the “retry” option', { quotes: 'straight' }).hard.some((x) => x.rule === 'quotes-should-be-straight'));
});
t('quotes:curly flags straight quotes and apostrophes', () => {
  const r = check('She said "hi" and it\'s fine.', { quotes: 'curly' });
  assert.ok(r.hard.some((x) => x.rule === 'double-quote-should-be-curly'));
  assert.ok(r.hard.some((x) => x.rule === 'apostrophe-should-be-curly'));
});
t('quotes:curly carves out feet/inch primes (5\'11")', () => {
  assert.strictEqual(check('The wall is 5\'11" tall.', { quotes: 'curly' }).hard.length, 0);
});

// --- latinAbbrev (hard): never (Google) vs parentheses (Chicago) ---
t('latinAbbrev:never flags any e.g./i.e.', () => {
  assert.ok(check('Retry, e.g. 3 times.', { latinAbbrev: 'never' }).hard.some((x) => x.rule === 'latin-abbrev-not-allowed'));
  assert.strictEqual(check('Retry, for example 3 times.', { latinAbbrev: 'never' }).hard.length, 0);
});
t('latinAbbrev:parentheses flags outside parens, not inside (must-not-fire)', () => {
  assert.ok(check('Retry, e.g. 3 times.', { latinAbbrev: 'parentheses' }).hard.some((x) => x.rule === 'latin-abbrev-outside-parens'));
  assert.strictEqual(check('Retry a few times (e.g., 3).', { latinAbbrev: 'parentheses' }).hard.length, 0);
});

// --- heading case is ADVISORY now (proper nouns make it undecidable) ---
t('a title-case heading is advisory under headings:sentence, never hard', () => {
  const r = check('# Configure Your Retries\n\ntext', { headings: 'sentence' });
  assert.strictEqual(r.hard.length, 0);
  assert.ok(r.advisory.some((x) => x.rule === 'heading-may-need-sentence-case'));
});
t('a proper-noun heading is NOT a hard violation', () => {
  // "# Configure Docker and Kubernetes" is correct sentence case; must not hard-fail.
  assert.strictEqual(check('# Configure Docker and Kubernetes\n\ntext', { headings: 'sentence' }).hard.length, 0);
  assert.strictEqual(check('# Deploying to Google Cloud\n\ntext', { headings: 'sentence' }).hard.length, 0);
});
t('headings:title flags a fully-lowercase heading as advisory', () => {
  assert.ok(check('# a plain heading\n\ntext', { headings: 'title' }).advisory.some((x) => x.rule === 'heading-may-need-title-case'));
});

// --- config validation: unrecognized keys/values become warnings ---
t('unknown key and unknown value are warned, not silently ignored', () => {
  const r = check('text', { quote: 'straight', headings: 'sentance' });
  assert.ok(r.warnings.some((x) => x.rule === 'unknown-key' && x.detail === 'quote'));
  assert.ok(r.warnings.some((x) => x.rule === 'unknown-value' && x.detail.startsWith('headings')));
});
t('a valid config produces no warnings', () => {
  assert.strictEqual(check('text', { quotes: 'straight', headings: 'sentence', serialComma: true }).warnings.length, 0);
});

// --- structure/code protection ---
t('frontmatter that closes is skipped; unterminated frontmatter does NOT swallow the doc', () => {
  assert.strictEqual(check('---\ntitle: "x"\n---\n# ok\n\nRun `git --force`.', { quotes: 'straight' }).hard.length, 0);
  // no closing --- : the body must still be checked, not silently blanked
  assert.ok(check('---\nx\n\nuse the “retry” option', { quotes: 'straight' }).hard.some((x) => x.rule === 'quotes-should-be-straight'));
});
t('empty/omitted mechanics check nothing and warn nothing', () => {
  const r = check('anything "here" it\'s fine', {});
  assert.strictEqual(r.hard.length, 0);
  assert.strictEqual(r.warnings.length, 0);
});
t('markdown link titles and reference definitions are syntax, not curly-quote violations', () => {
  // Link titles MUST use straight quotes; flagging them hard-fails a correct document.
  assert.strictEqual(check('See the [docs](https://x.example "The Title") for more.', { quotes: 'curly' }).hard.length, 0);
  assert.strictEqual(check('[1]: https://x.example "Ref Title"', { quotes: 'curly' }).hard.length, 0);
  // A real straight quote in prose on the same line is still caught.
  assert.ok(check('He said "hi" in [docs](https://x.example "T").', { quotes: 'curly' }).hard.length > 0);
});
t('a parenthetical that wraps across lines keeps its latinAbbrev carve-out', () => {
  const wrapped = 'A long aside (this parenthetical wraps,\ne.g. across two lines) ends here.';
  assert.strictEqual(check(wrapped, { latinAbbrev: 'parentheses' }).hard.length, 0);
  // Still fires once the parenthetical has closed.
  assert.ok(check('An aside (closed here).\ne.g. now outside.', { latinAbbrev: 'parentheses' }).hard.some((x) => x.rule === 'latin-abbrev-outside-parens'));
});
t('a stray "(" does not suppress later latinAbbrev findings past the paragraph', () => {
  // Regression: paren depth carried document-wide, so one ":(" silenced every later
  // finding. Depth must reset at a blank line.
  const stray = 'This made me sad :( honestly.\n\nLater we argue, e.g. this point, outside any parens.';
  assert.ok(check(stray, { latinAbbrev: 'parentheses' }).hard.some((x) => x.rule === 'latin-abbrev-outside-parens'));
});
t('a link whose URL contains parentheses does not corrupt the paren balance', () => {
  // Regression: [^)]* mis-terminated on a nested paren and left a stray ")" behind.
  const wiki = '(We cite [Foo](https://en.wikipedia.org/wiki/Foo_(bar)), e.g. this one.)';
  assert.strictEqual(check(wiki, { latinAbbrev: 'parentheses' }).hard.length, 0);
  // ...and its straight-quoted title is still masked for quotes:curly.
  assert.strictEqual(check('[Foo](https://en.wikipedia.org/wiki/Foo_(bar) "The Title")', { quotes: 'curly' }).hard.length, 0);
});
t('an unclosed "](" is left alone rather than swallowing the rest of the line', () => {
  assert.ok(check('weird ]( text with "quotes" here.', { quotes: 'curly' }).hard.length > 0);
});
t('prose that merely looks like a reference definition keeps its quotes checked', () => {
  assert.ok(check('[sic]: he said "hi" plainly.', { quotes: 'curly' }).hard.length > 0);
});
t('a link-led definition-list line is not swallowed as a reference definition', () => {
  // Regression: masking the destination left "[Docs]: ..." which re-parsed as a ref
  // definition, silently blanking the rest of an ordinary line.
  assert.ok(check('[Docs](https://d.example): "Note"', { quotes: 'curly' }).hard.length > 0);
  assert.ok(check('[Docs](https://d.example): e.g. outside.', { latinAbbrev: 'parentheses' }).hard.length > 0);
});
t('a reference-definition title may contain escaped quotes', () => {
  assert.strictEqual(check('[1]: https://x.example "say \\"hi\\""', { quotes: 'curly' }).hard.length, 0);
});
t('a parenthetical survives an intervening code block or code-only line', () => {
  // Regression: fenced/code-only lines mask to '' and were read as paragraph breaks,
  // resetting the paren depth mid-parenthetical.
  const fenced = '(See the config, for instance:\n```json\n{}\n```\nand, e.g., it closes here.)';
  assert.strictEqual(check(fenced, { latinAbbrev: 'parentheses' }).hard.length, 0);
  // A BLANK line inside the fence is not a paragraph break either.
  const gappy = '(See the config:\n```json\n{\n\n}\n```\nand, e.g., it closes here.)';
  assert.strictEqual(check(gappy, { latinAbbrev: 'parentheses' }).hard.length, 0);
  const inline = '(An aside about\n`some code`\ne.g. still inside the parens.)';
  assert.strictEqual(check(inline, { latinAbbrev: 'parentheses' }).hard.length, 0);
});
t('HTML attribute values are syntax, not curly-quote violations', () => {
  assert.strictEqual(check('<div class="callout">\n\nText.', { quotes: 'curly' }).hard.length, 0);
  assert.strictEqual(check('<img alt="a chart" />', { quotes: 'curly' }).hard.length, 0);
});
t('prose containing a comparison is not mistaken for an HTML tag', () => {
  // Regression: a loose "<letter ... >" mask swallowed everything between the brackets,
  // hiding real violations in ordinary technical prose.
  assert.ok(check('For n<N, the "tail" sum > epsilon.', { quotes: 'curly' }).hard.length > 0);
  assert.ok(check('if a<b it isn\'t > c.', { quotes: 'curly' }).hard.length > 0);
  assert.ok(check('When x<y (e.g. small) > z holds.', { latinAbbrev: 'never' }).hard.length > 0);
});
t('a UTF-8 BOM does not hide the frontmatter', () => {
  assert.strictEqual(check('﻿---\ntitle: "x"\n---\nClean text.', { quotes: 'curly' }).hard.length, 0);
});
t('nested and mismatched fences do not leak code as prose (no false hard violation)', () => {
  // An inner ``` inside an outer ```` is code content; curly quotes there must NOT flag.
  const nested = '# ok\n\n````\nouter\n```\ninner “q”\n```\n````\n\nclean text';
  assert.strictEqual(check(nested, { quotes: 'straight' }).hard.length, 0);
  // A ~~~ line inside a ``` block does not close it either.
  const tilde = '# ok\n\n```\n~~~\ninner “q”\n~~~\n```\n\nclean text';
  assert.strictEqual(check(tilde, { quotes: 'straight' }).hard.length, 0);
  // Prose after a properly closed fence is still checked.
  assert.ok(check('# ok\n\n```\ncode\n```\n\nuse the “retry” option', { quotes: 'straight' }).hard.some((x) => x.rule === 'quotes-should-be-straight'));
});

// --- resolution (filename / path / unknown / traversal); no guide aliases ---
// path.join, not a '/' literal: on Windows these are examples\technical.json, so a
// hardcoded forward slash fails the whole suite locally while ubuntu CI stays green.
const EX = (f) => path.join(__dirname, '..', 'examples', f);
t('resolveConfig: filename, path, unknown, traversal (no guide aliases)', () => {
  assert.strictEqual(resolveConfig('technical'), EX('technical.json'));
  assert.strictEqual(resolveConfig('prose'), EX('prose.json'));
  assert.strictEqual(resolveConfig(EX('technical.json')), EX('technical.json'));
  assert.strictEqual(resolveConfig('cmos'), null);   // no guide alias resolution
  assert.strictEqual(resolveConfig('no-such-guide'), null);
  assert.strictEqual(resolveConfig('../package'), null); // bare names can't traverse
});
t('a bare name is not shadowed by a same-named file in the working directory', () => {
  // A file literally named "technical" in cwd must NOT hijack the bare-name lookup.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-shadow-'));
  fs.writeFileSync(path.join(dir, 'technical'), '# not a config');
  const cwd = process.cwd();
  process.chdir(dir);
  try { assert.strictEqual(resolveConfig('technical'), EX('technical.json')); }
  finally { process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- shipped example configs are generic (no guide names/aliases), parse, and apply ---
t('example configs are generic, parse with register + mechanics', () => {
  const tech = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'technical.json'), 'utf8'));
  const prose = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'prose.json'), 'utf8'));
  for (const cfg of [tech, prose]) {
    assert.ok(Array.isArray(cfg.register) && cfg.register.length);
    assert.ok(cfg.mechanics && typeof cfg.mechanics === 'object');
    assert.ok(cfg.aliases === undefined, 'no aliases shipped');
    assert.ok(!/google|chicago|cmos|apa/i.test(cfg.name || ''), 'name is guide-neutral');
  }
  assert.strictEqual(tech.mechanics.latinAbbrev, 'never');
  assert.strictEqual(prose.mechanics.latinAbbrev, 'parentheses');
  assert.strictEqual(check('# Configure retries\n\nSet the value.', tech.mechanics).hard.length, 0);
});

// --- CLI exit codes: 0 clean, 1 hard, 2 tool error ---
const cli = (mdText, cfgArg) => {
  const f = path.join(os.tmpdir(), `cs-${passed}-${Math.floor(process.hrtime()[1])}.md`);
  fs.writeFileSync(f, mdText);
  const r = spawnSync('node', [path.join(__dirname, 'check-style.js'), f, '--config', cfgArg], { encoding: 'utf8' });
  fs.unlinkSync(f);
  return r.status;
};
t('CLI exits 0 clean, 1 on a hard violation, 2 on a tool error', () => {
  assert.strictEqual(cli('# ok\n\nplain text', 'technical'), 0);
  assert.strictEqual(cli('# ok\n\nuse the “curly” quote', 'technical'), 1); // technical => quotes straight
  assert.strictEqual(cli('# ok\n\ntext', 'no-such-guide'), 2);
});

// raw-argv runner: write {name: content} files into a temp dir, run the CLI from that
// dir with the given argv, return exit status; cleans up.
const cliRaw = (files, argv) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cli-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  const r = spawnSync('node', [path.join(__dirname, 'check-style.js'), ...argv], { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return r.status;
};
t('CLI: a second file, an unknown flag, and a missing --config value each exit 2', () => {
  assert.strictEqual(cliRaw({ 'a.md': '# ok\n\ntext', 'b.md': '# ok\n\ntext' }, ['a.md', 'b.md', '--config', 'technical']), 2);
  assert.strictEqual(cliRaw({ 'a.md': '# ok\n\ntext' }, ['a.md', '--config', 'technical', '--bogus']), 2);
  assert.strictEqual(cliRaw({ 'a.md': '# ok\n\ntext' }, ['a.md', '--config']), 2);
});
t('CLI: a config whose mechanics is null or an array exits 2, not a false-green 0', () => {
  const withCfg = (cfgJson) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-mech-'));
    fs.writeFileSync(path.join(dir, 'a.md'), '# ok\n\ntext');
    fs.writeFileSync(path.join(dir, 'c.json'), cfgJson);
    const r = spawnSync('node', [path.join(__dirname, 'check-style.js'), 'a.md', '--config', 'c.json'], { cwd: dir, encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    return r.status;
  };
  assert.strictEqual(withCfg('{"mechanics": null}'), 2);
  assert.strictEqual(withCfg('{"mechanics": []}'), 2);
  assert.strictEqual(withCfg('{"mechanics": {"quotes": "straight"}}'), 0);
});
t('CLI: a file named like the config value is still reachable (not filtered by value)', () => {
  // `--config technical` resolves to examples/; the positional file also named `technical`
  // must be read and checked (clean => 0), not treated as unreachable.
  assert.strictEqual(cliRaw({ technical: '# ok\n\nplain text' }, ['technical', '--config', 'technical']), 0);
});

// --- indented code blocks (masked) vs lazy continuation and list content (prose) ---
t('4-space indented code after a blank line is masked (must-not-fire)', () => {
  assert.strictEqual(check('Para.\n\n    code with "straight" quotes\n\nMore.', { quotes: 'curly' }).hard.length, 0);
  assert.strictEqual(check('Para.\n\n\tx = f(a, e.g., b)\n\nMore.', { latinAbbrev: 'never' }).hard.length, 0);
});
t('a 4-space line directly under a paragraph is lazy continuation and still checked', () => {
  assert.ok(check('Para starts\n    still "prose" here.', { quotes: 'curly' }).hard.length > 0);
});
t('4-space content inside a list item is prose and still checked', () => {
  assert.ok(check('- item\n\n    second "para" of the item', { quotes: 'curly' }).hard.length > 0);
});
t('a paragraph after a list resets list context, so indented code masks again', () => {
  assert.strictEqual(check('- item\n\nPlain paragraph.\n\n    code "x"\n\nAfter.', { quotes: 'curly' }).hard.length, 0);
});

// --- a leading thematic break is not frontmatter ---
t('a document opening with --- then a blank line is not frontmatter (must-fire)', () => {
  assert.ok(check('---\n\nHe said "hi".\n\n---\n\nmore', { quotes: 'curly' }).hard.length > 0);
});
t('real frontmatter still masks, including a quoted value', () => {
  assert.strictEqual(check('---\ntitle: "Straight quotes are yaml"\n---\n\nplain text', { quotes: 'curly' }).hard.length, 0);
});

// --- bare-name containment is by construction (no separator reaches that branch) ---
t('dot-bearing bare names resolve inside examples/ only, and miss', () => {
  assert.strictEqual(resolveConfig('..'), null);
  assert.strictEqual(resolveConfig('foo..bar'), null);
});

console.log(`\ncheck-style: ${passed} passed.`);
