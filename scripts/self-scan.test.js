#!/usr/bin/env node
/* Exemption-span tests for `npm test`. */
'use strict';
const assert = require('assert');
const { applyExemptions } = require('./self-scan.js');

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; process.stdout.write(`  ✓ ${name}\n`); };
const blank = (text) => text.replace(/[^\n]/g, ' ');
const before = 'Ordinary prose before.\n';
const after = '\nOrdinary prose after.';

const exempt = (name, middle, protectedText) => t(name, () => {
  const source = before + middle + after;
  const expected = source.replace(protectedText, blank(protectedText));
  const actual = applyExemptions(source);
  assert.strictEqual(actual, expected, 'the complete output must contain only the blanked exempt span');
  assert.strictEqual(actual.length, source.length, 'string length must be preserved');
  assert.deepStrictEqual([...actual.matchAll(/\n/g)].map((m) => m.index), [...source.matchAll(/\n/g)].map((m) => m.index), 'newline indices must be preserved');
  assert.strictEqual(actual.slice(0, before.length), before, 'leading ordinary prose must remain byte-for-byte unchanged');
  assert.strictEqual(actual.slice(-after.length), after, 'trailing ordinary prose must remain byte-for-byte unchanged');
});

exempt('blanks a triple-backtick fence', '```js\nconst raw = "quoted";\n```', '```js\nconst raw = "quoted";\n```');
exempt('blanks a triple-tilde fence', '~~~text\nraw "quoted"\n~~~', '~~~text\nraw "quoted"\n~~~');
exempt('blanks a mixed-marker example inside a backtick fence', '```md\n~~~\nraw "quoted"\n```', '```md\n~~~\nraw "quoted"\n```');
exempt('blanks a shorter backtick example inside a longer fence', '````md\n```\nraw "quoted"\n````', '````md\n```\nraw "quoted"\n````');
exempt('blanks a fence with indented opening and closing markers', '  ```js\nraw "quoted"\n  ```', '  ```js\nraw "quoted"\n  ```');
exempt('blanks a CRLF fence without consuming following prose', '```js\r\nraw "quoted"\r\n```', '```js\r\nraw "quoted"\r\n```');

t('identical text before a fence is not blanked in place of the fence', () => {
  const repeated = '```text\nraw "quoted"\n```';
  const source = `${repeated}\nordinary prose\n${repeated}`;
  const actual = applyExemptions(source);
  assert.strictEqual(actual, `${blank(repeated)}\nordinary prose\n${blank(repeated)}`);
});
exempt('blanks a multirow pipe-delimited table', '| name | note |\n| --- | --- |\n| alpha | "raw" |', '| name | note |\n| --- | --- |\n| alpha | "raw" |');
exempt('blanks a blockquote', '> quoted "raw"\n> another row', '> quoted "raw"\n> another row');
exempt('blanks inline backticks', 'Use `raw "code"` here.', '`raw "code"`');
exempt('blanks paired straight double quotes', 'The "quoted text" stays exempt.', '"quoted text"');
exempt('blanks paired curly double quotes', 'The “quoted text” stays exempt.', '“quoted text”');
exempt('blanks paired straight single quotes', "The 'quoted text' stays exempt.", "'quoted text'");

t('ordinary prose remains unchanged', () => {
  const source = 'Ordinary prose before and after has no exempt span.';
  assert.strictEqual(applyExemptions(source), source);
});

process.stdout.write(`\n${passed} self-scan exemption tests passed\n`);
