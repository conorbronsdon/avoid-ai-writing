#!/usr/bin/env node
/*
 * Deterministic, guide-agnostic quote/apostrophe normalization after a rewrite.
 * Usage: node scripts/normalize-quotes.js <file.md> --quotes straight|curly [--write]
 * Prints to stdout unless --write is given. Exit codes: 0 success, 2 usage/I/O error.
 * Markdown protection is shared with check-style.js; every edit is a 1:1 character
 * substitution, so protected source, line endings and whitespace survive verbatim.
 * Dashes and heading case are outside this pass. Curly education is contextual:
 * leading elisions such as 'twas or rock 'n' roll remain ambiguous and need review.
 */
'use strict';

const { markdownProse } = require('./markdown-prose.js');

function straighten(s) {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

function educate(s) {
  const chars = s.split('');
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] !== '"' && chars[i] !== "'") continue;
    let p = i - 1, n = i + 1;
    // Emphasis delimiters are transparent when deciding a quotation's direction.
    while (p >= 0 && /[*_~]/.test(chars[p])) p -= 1;
    while (n < chars.length && /[*_~]/.test(chars[n])) n += 1;
    const prev = chars[p] || '', next = chars[n] || '';
    // Match the checker's feet/inch carve-out. Already-curly marks stay curly.
    if (/\d/.test(prev)) continue;
    const opening = (!prev || /[\s([{—–\-“‘]/.test(prev)) && /\S/.test(next);
    if (chars[i] === '"') chars[i] = opening ? '“' : '”';
    else chars[i] = opening && !/\d/.test(next) ? '‘' : '’';
  }
  return chars.join('');
}

/** Normalize prose marks to an explicit 'straight' or 'curly' target. */
function normalize(text, quotes) {
  if (!['straight', 'curly'].includes(quotes)) throw new TypeError('quotes must be straight or curly');
  const { masked, context } = markdownProse(text);
  // Word-shaped filler keeps quotes around `code` and a possessive after it directed
  // correctly. Restore by offset rather than searching for placeholder text.
  const out = quotes === 'straight' ? straighten(context) : educate(context);
  return out.split('').map((ch, i) => masked[i] === '\0' ? text[i] : ch).join('');
}

module.exports = { normalize };

if (require.main === module) {
  const fs = require('fs');
  const argv = process.argv.slice(2);
  let file = null, quotes = null, write = false;
  try {
    for (let i = 0; i < argv.length; i += 1) {
      const a = argv[i];
      if (a === '--quotes' && quotes === null) {
        quotes = argv[++i];
        if (!['straight', 'curly'].includes(quotes)) throw new Error('--quotes requires straight or curly');
      } else if (a === '--write' && !write) write = true;
      else if (a.startsWith('--')) throw new Error(`unknown or repeated flag: ${a}`);
      else if (file === null) file = a;
      else throw new Error(`unexpected extra argument: ${a}`);
    }
    if (!file || !quotes) throw new Error('usage: normalize-quotes.js <file> --quotes straight|curly [--write]');
    const source = fs.readFileSync(file, 'utf8');
    const result = normalize(source, quotes);
    if (write) {
      if (result !== source) fs.writeFileSync(file, result);
      process.stderr.write(`normalized ${file} (--quotes ${quotes})\n`);
    } else process.stdout.write(result);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
  }
}
