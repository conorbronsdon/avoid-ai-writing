#!/usr/bin/env node
/*
 * check-style.js — deterministic conformance check for a user-supplied house-style
 * config's MECHANICS. It verifies "did the output apply the config it was given"; it
 * does not judge register (that's the model's job). No bundled guides — the rules come
 * entirely from the config you pass.
 *
 * Usage: node scripts/check-style.js <file.md> --config <config.json|name> [--json]
 * Exit codes: 0 clean, 1 a hard violation, 2 a tool/usage error (missing or unreadable
 * config, no mechanics). Unrecognized config keys/values are surfaced as warnings.
 *
 * Hard-checkable mechanics: quotes, latinAbbrev. Heading case, em-dash rate, and number
 * spelling are ADVISORY (heading case can't be verified deterministically — proper nouns
 * make sentence and title case ambiguous). serialComma is declared but model-applied only.
 * See examples/README.md. Skipped before checking: frontmatter (only when it closes), code
 * (fenced and inline), and markdown link destinations, link titles, and reference-definition
 * tails, since a link title is delimited with straight quotes as SYNTAX.
 * HTML tags and their attribute values are masked too. Known limitations: straight
 * feet/inch primes (5'11") after a digit are carved out; an unclosed or multi-line HTML tag
 * still registers, as do quotes inside an HTML comment; and the latinAbbrev parenthesis
 * carve-out tracks depth across wrapped lines but resets at a paragraph break, so an
 * unclosed "(" disables that rule for the rest of its paragraph. A double-backtick code
 * span whose body contains a backtick leaks its body to the quote checks; a reference
 * definition with its title on the following line is read as prose; and indented code
 * inside a LIST item is treated as the item's prose (fence it to skip it).
 */
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Resolve a --config argument to a file path. The decision is by SHAPE, not by what
 * happens to exist in the working directory: an arg with a path separator or a .json
 * suffix is a path (used as-is if it exists, else null); anything else is a bare name
 * resolved against examples/<name>.json. Deciding by shape stops a file named "technical"
 * sitting in the cwd from shadowing examples/technical.json. Bare names can't traverse
 * out of examples/. Null if nothing matches.
 */
function resolveConfig(arg) {
  if (!arg) return null;
  if (/[\\/]/.test(arg) || /\.json$/i.test(arg)) return fs.existsSync(arg) ? arg : null;
  const q = arg.trim().toLowerCase();
  // No traversal guard needed: a bare name has no separator (anything with one took the
  // path branch above), so it joins as a single segment inside examples/ by construction.
  const direct = path.join(__dirname, '..', 'examples', `${q}.json`);
  return fs.existsSync(direct) ? direct : null;
}

// Known mechanics keys and their allowed values (for config validation).
const KNOWN = {
  quotes: ['straight', 'curly'],
  headings: ['sentence', 'title'],
  latinAbbrev: ['parentheses', 'never', 'any'],
  emDash: ['sparing', 'deliberate'],
  spellNumbersUpTo: 'number',
  serialComma: 'boolean',
};

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'vs', 'nor', 'so', 'yet']);
const majorWords = (h) => h.replace(/[*_`]/g, '').trim().split(/\s+/).slice(1)
  .map((w) => w.replace(/[^A-Za-z]/g, ''))
  .filter((b) => b && b !== b.toUpperCase() && !SMALL.has(b.toLowerCase())); // drop acronyms + minor words
const isTitleCase = (h) => majorWords(h).filter((b) => /^[A-Z]/.test(b)).length >= 2;
const looksSentenceCase = (h) => { const w = majorWords(h); return w.length >= 1 && w.every((b) => /^[a-z]/.test(b)); };

/**
 * Blank a markdown link destination and title, `](...)`, keeping the link text. Walks to
 * the MATCHING paren so a nested one in the URL (a Wikipedia disambiguation link, say)
 * doesn't terminate it early and leave a stray `)` behind to corrupt the paren balance.
 * Scans linearly: a regex here is quadratic on `](`-heavy input. An unclosed `](` is not a
 * link, so the rest of the line is left alone rather than swallowed.
 */
function maskLinks(s) {
  let out = '', i = 0;
  for (;;) {
    const j = s.indexOf('](', i);
    if (j < 0) return out + s.slice(i);
    let depth = 0, k = j + 1, closed = false;
    for (; k < s.length; k += 1) {
      if (s[k] === '(') depth += 1;
      else if (s[k] === ')') { depth -= 1; if (depth === 0) { k += 1; closed = true; break; } }
    }
    if (!closed) return out + s.slice(i);
    out += s.slice(i, j + 1); // keep through the ']'
    i = k;
  }
}

/**
 * Blank the tail of a reference definition (`[1]: https://x "Title"`), whose title also
 * uses straight quotes as syntax. Requires a destination and an optional title and nothing
 * else, so ordinary prose that happens to start `[sic]: he said "hi"` is left alone. Title
 * bodies allow backslash escapes, which is how a title legally contains its own delimiter.
 * MUST run before maskLinks: masking `[a](url): x` down to `[a]: x` would otherwise make an
 * ordinary link-led definition list line look like a reference definition and blank it.
 */
const TITLE = '"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|\\((?:\\\\.|[^)\\\\])*\\)';
const REF_DEF = new RegExp(`^(\\s*\\[[^\\]]+\\]:\\s*)(?:<[^>]*>|\\S+)(?:\\s+(?:${TITLE}))?\\s*$`);
const maskRefDef = (s) => s.replace(REF_DEF, '$1');

/**
 * Blank HTML tags, whose attribute values are straight-quoted as syntax. The shape follows
 * CommonMark's raw-HTML grammar (tag name, then attribute-shaped pairs) rather than
 * "<letter ... >": the loose form swallowed ordinary prose containing a comparison, such as
 * `For n<N, the "tail" sum > epsilon`, hiding real violations between the two brackets.
 */
const maskTags = (s) => s.replace(
  /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/g, '');

/** Returns { hard, advisory, warnings } for the config's mechanics; register is not checked. */
function check(text, mechanics) {
  const m = mechanics || {};
  const warnings = [];
  for (const [k, v] of Object.entries(m)) {
    if (!(k in KNOWN)) { warnings.push({ rule: 'unknown-key', detail: k }); continue; }
    const spec = KNOWN[k];
    if (Array.isArray(spec)) { if (!spec.includes(v)) warnings.push({ rule: 'unknown-value', detail: `${k}: ${JSON.stringify(v)}` }); }
    else if (typeof v !== spec) warnings.push({ rule: 'unknown-value', detail: `${k}: ${JSON.stringify(v)} (expected ${spec})` });
  }

  const lines = text.replace(/^\uFEFF/, '').split('\n'); // a BOM would hide the frontmatter
  const bare = (s) => s.replace(/\r$/, '');
  // Frontmatter: skip a leading --- ... --- block only when it actually closes.
  let fmEnd = -1;
  // Only an opener with content on the next line is frontmatter: a document that OPENS
  // with a thematic break (`---`, blank line after) would otherwise be swallowed to the
  // next `---` anywhere in the file, silently hiding everything between.
  if (bare(lines[0]) === '---' && lines.length > 1 && !/^\s*$/.test(bare(lines[1]))) {
    for (let k = 1; k < lines.length; k += 1) { if (bare(lines[k]) === '---') { fmEnd = k; break; } }
  }
  // Fences track their character and length, so an inner ``` doesn't close an outer ````
  // and a ~~~ doesn't close a ``` block. A bare toggle desyncs on a nested fence and then
  // checks the code inside it as prose, which is a hard violation on a correct document.
  let inFence = false, fenceChar = '', fenceLen = 0;
  // Indented code (4+ spaces or a tab) opens only after a blank line and outside a list:
  // a 4-space line directly under a paragraph is lazy continuation (prose), and inside a
  // list item it is the item's own content (prose), so both stay checked. List tracking is
  // approximate (a marker line enters list context, a flush-left non-marker line leaves
  // it); a code block nested inside a list item needs a fence to be skipped.
  let inIndent = false, prevBlank = true, listCtx = false;
  // A paragraph break is a blank line in the ORIGINAL that is not inside frontmatter or a
  // fence. Masked-empty lines aren't breaks (that would cut a parenthetical at a code
  // block), and a blank line inside a fence isn't either.
  const paraBreak = [];
  const prose = lines.map((l, i) => {
    if (i <= fmEnd) { paraBreak.push(false); return ''; }
    const b = bare(l);
    const fm = b.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fm) {
      const ch = fm[1][0], len = fm[1].length;
      if (!inFence) { inFence = true; fenceChar = ch; fenceLen = len; }
      else if (ch === fenceChar && len >= fenceLen && /^\s*$/.test(fm[2])) inFence = false;
      paraBreak.push(false);
      inIndent = false; prevBlank = false;
      return '';
    }
    if (inFence) { paraBreak.push(false); prevBlank = false; return ''; }
    const blank = /^\s*$/.test(b);
    const ind4 = /^(?: {4}|\t)/.test(b);
    if (blank) inIndent = false;
    else if (!inIndent && ind4 && prevBlank && !listCtx) inIndent = true;
    else if (!ind4) inIndent = false;
    const isCode = !blank && inIndent;
    if (!blank && !isCode) {
      if (/^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/.test(b)) listCtx = true;
      else if (/^\S/.test(b)) listCtx = false;
    }
    prevBlank = blank;
    paraBreak.push(blank);
    if (isCode) return '';
    // Strip inline code, then link destinations and reference-definition tails. Markdown
    // link titles are delimited with STRAIGHT quotes as syntax, so leaving them in makes
    // quotes:curly hard-fail an ordinary titled link on a correct document.
    return maskTags(maskLinks(maskRefDef(b.replace(/`+[^`]*`+/g, ''))));
  });
  const joined = prose.join('\n');
  const words = (joined.match(/\b\w+\b/g) || []).length;
  const hard = [];
  const advisory = [];
  const heads = prose.map((l, i) => [i + 1, l.match(/^#{1,6}\s+(.*)$/)]).filter(([, h]) => h);

  if (m.quotes === 'straight') {
    prose.forEach((l, i) => { if (/[“”‘’]/.test(l)) hard.push({ line: i + 1, rule: 'quotes-should-be-straight' }); });
  } else if (m.quotes === 'curly') {
    prose.forEach((l, i) => {
      const c = l.replace(/(\d)['"]/g, '$1'); // carve out feet/inch primes (5'11")
      if (/"/.test(c)) hard.push({ line: i + 1, rule: 'double-quote-should-be-curly' });
      if (/[A-Za-z]'[A-Za-z]|[A-Za-z]'(?!\w)|(^|\s)'/.test(c)) hard.push({ line: i + 1, rule: 'apostrophe-should-be-curly' });
    });
  }

  // Heading case is ADVISORY: proper nouns make sentence vs title case ambiguous, so it
  // can't be verified deterministically without false positives on ordinary headings.
  if (m.headings === 'sentence') {
    heads.forEach(([ln, h]) => { if (isTitleCase(h[1])) advisory.push({ line: ln, rule: 'heading-may-need-sentence-case' }); });
  } else if (m.headings === 'title') {
    heads.forEach(([ln, h]) => { if (looksSentenceCase(h[1])) advisory.push({ line: ln, rule: 'heading-may-need-title-case' }); });
  }

  if (m.latinAbbrev === 'parentheses' || m.latinAbbrev === 'never') {
    // Paren depth carries across lines, so a parenthetical that wraps keeps its carve-out,
    // but RESETS at a blank line: a prose parenthetical can't span a paragraph, and without
    // the reset one stray "(" (a ":(" smiley) would suppress every later finding in the
    // document. That trades an unbounded silent false negative for a paragraph-wide one.
    let depth = 0;
    prose.forEach((l, i) => {
      if (paraBreak[i]) { depth = 0; return; }
      const re = /\b(e\.g\.|i\.e\.)/gi;
      let mm;
      while ((mm = re.exec(l)) !== null) {
        if (m.latinAbbrev === 'never') { hard.push({ line: i + 1, rule: 'latin-abbrev-not-allowed' }); continue; }
        const before = l.slice(0, mm.index);
        const at = depth + (before.match(/\(/g) || []).length - (before.match(/\)/g) || []).length;
        if (at <= 0) hard.push({ line: i + 1, rule: 'latin-abbrev-outside-parens' });
      }
      depth = Math.max(0, depth + (l.match(/\(/g) || []).length - (l.match(/\)/g) || []).length);
    });
  }

  if (m.emDash === 'sparing') {
    const em = (joined.match(/—/g) || []).length;
    if (em > Math.floor(words / 1000)) advisory.push({ rule: 'em-dash-rate', detail: `${em} in ${words} words` });
  }

  if (typeof m.spellNumbersUpTo === 'number') {
    prose.forEach((l, i) => {
      if (/^\s*([-*]|\d+\.)\s/.test(l)) return;
      const nums = (l.match(/(?<![\w.$:])\d{1,3}(?![\w.%:])/g) || []).filter((n) => +n <= m.spellNumbersUpTo);
      if (nums.length) advisory.push({ line: i + 1, rule: 'number-may-need-spelling', detail: nums.join(', ') });
    });
  }

  return { hard, advisory, warnings };
}

module.exports = { check, resolveConfig };

if (require.main === module) {
  // Parse by position, not by value: the old `a !== cfgArg` filter made a file whose name
  // equalled the config value (e.g. a real file `technical` with `--config technical`)
  // unreachable, and silently ignored a second file argument.
  const argv = process.argv.slice(2);
  let cfgArg = null, json = false, file = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--config') {
      const nx = argv[i + 1];
      if (nx !== undefined && !nx.startsWith('--')) { cfgArg = nx; i += 1; } // else: missing value
    } else if (a === '--json') { json = true; }
    else if (a.startsWith('--')) { console.error(`unknown flag: ${a}`); process.exit(2); }
    else if (file === null) { file = a; }
    else { console.error(`unexpected extra argument: ${a}`); process.exit(2); }
  }
  if (!file || !cfgArg) { console.error('usage: check-style.js <file> --config <config.json|name> [--json]'); process.exit(2); }
  const cfgPath = resolveConfig(cfgArg);
  if (!cfgPath) {
    console.error(`config not found: "${cfgArg}"\nPass a path to a JSON config, or a name matching a file in examples/ (for example, --config technical). See examples/README.md.`);
    process.exit(2);
  }
  let config;
  try { config = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); }
  catch (e) { console.error(`could not read config "${cfgPath}": ${e.message}`); process.exit(2); }
  if (!config || typeof config !== 'object' || typeof config.mechanics !== 'object'
      || config.mechanics === null || Array.isArray(config.mechanics)) {
    console.error(`config "${cfgPath}" has no "mechanics" object`); process.exit(2);
  }
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { console.error(`could not read file "${file}": ${e.message}`); process.exit(2); }
  const r = check(text, config.mechanics);
  if (json) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    const w = r.warnings.length ? `, ${r.warnings.length} config warning(s)` : '';
    console.log(`${config.name || cfgPath}: ${r.hard.length} hard, ${r.advisory.length} advisory${w}`);
    r.warnings.forEach((x) => console.log(`  ! ${x.rule}: ${x.detail}`));
    r.hard.forEach((x) => console.log(`  L${x.line || '-'}  ${x.rule}`));
    r.advisory.forEach((x) => console.log(`  L${x.line || '-'}  ${x.rule} (advisory)${x.detail ? `: ${x.detail}` : ''}`));
  }
  process.exit(r.hard.length > 0 ? 1 : 0);
}
