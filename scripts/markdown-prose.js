/* Shared Markdown protection for check-style.js and normalize-quotes.js. */
'use strict';

const TITLE = '"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|\\((?:\\\\.|[^)\\\\])*\\)';
const REF_DEF = new RegExp(`^ {0,3}\\[((?:\\\\.|[^\\]\\n])+)\\]:[ \\t]*(?:\\r?\\n[ \\t]*)?(?:<[^>\\n]*>|\\S+)(?:[ \\t]*(?:\\r?\\n[ \\t]*)?(?:${TITLE}))?[ \\t]*\\r?$`, 'gm');
const TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/g;
const labelKey = (s) => s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\])/g, '$1').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Return an offset-stable mask and the checker's prose lines / paragraph breaks.
 * A protected character becomes NUL; newlines remain in place. Consumers can remove
 * masked characters for checks or use word-shaped filler for quote adjacency, then
 * restore from the source. No Markdown is serialized or whitespace reconstructed.
 */
function markdownProse(text) {
  const chars = text.split('');
  const transparent = new Set();
  const protect = (a, b, tag = false) => {
    for (let i = a; i < b; i += 1) {
      if (text[i] === '\n' || text[i] === '\r') continue;
      chars[i] = '\0';
      if (tag) transparent.add(i);
    }
  };
  const lines = text.split('\n');
  const bare = (s) => s.replace(/\r$/, '');
  let fmEnd = -1;
  // A leading thematic break followed by a blank is not frontmatter.
  if (bare(lines[0]).replace(/^\uFEFF/, '') === '---' && lines.length > 1 && lines[1].trim()) {
    for (let k = 1; k < lines.length; k += 1) {
      if (/^(?:---|\.\.\.)$/.test(bare(lines[k]))) { fmEnd = k; break; }
    }
  }

  let fence = null, inIndent = false, prevBlank = true, offset = 0, quoteDepth = 0;
  const listIndents = [];
  const paraBreak = [];
  lines.forEach((line, i) => {
    const start = offset;
    offset += line.length + 1;
    if (i <= fmEnd) { protect(start, offset - 1); paraBreak.push(false); return; }
    let b = bare(line).replace(/^\uFEFF/, '');
    // Strip container prefixes for block recognition, retaining source offsets.
    const quote = fence
      ? (quoteDepth ? b.match(new RegExp(`^(?: {0,3}>[ \\t]?){${quoteDepth}}`)) : null)
      : b.match(/^(?: {0,3}>[ \t]?)+/);
    const depth = quote ? (quote[0].match(/>/g) || []).length : 0;
    if (depth !== quoteDepth) {
      fence = null; inIndent = false; prevBlank = true; listIndents.length = 0;
      quoteDepth = depth;
    }
    if (quote) b = b.slice(quote[0].length);
    const blank = !b.trim();
    const indent = (b.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length;
    if (!blank && !fence) {
      while (listIndents.length && indent < listIndents[listIndents.length - 1]) listIndents.pop();
    }
    const base = listIndents[listIndents.length - 1] || 0;
    const marker = !fence && b.match(/^( *)(?:[-*+]|\d{1,9}[.)])([ \t]+|$)/);
    if (marker && indent - base < 4) {
      // More than four spaces after a marker starts code at the item's content indent.
      const padding = marker[2].length > 4 ? 1 : Math.max(1, marker[2].length);
      const contentIndent = marker[0].length - marker[2].length + padding;
      listIndents.push(contentIndent);
      b = b.slice(Math.min(contentIndent, b.length));
      prevBlank = true; inIndent = false;
    } else if (base) {
      let consumed = 0, columns = 0;
      while (consumed < b.length && /[ \t]/.test(b[consumed]) && columns < base) {
        columns += b[consumed] === '\t' ? 4 - columns % 4 : 1;
        consumed += 1;
      }
      b = b.slice(consumed);
    }

    const fm = b.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (fm && fm[2][0] === fence.char && fm[2].length >= fence.length && /^\s*$/.test(fm[3])) fence = null;
      protect(start, offset - 1); paraBreak.push(false); prevBlank = false; return;
    }
    if (fm && !(fm[2][0] === '`' && fm[3].includes('`'))) {
      fence = { char: fm[2][0], length: fm[2].length };
      protect(start, offset - 1); paraBreak.push(false); inIndent = false; prevBlank = false; return;
    }
    const ind4 = /^(?: {4}| *\t)/.test(b);
    if (!blank) {
      if (ind4 && (prevBlank || inIndent)) inIndent = true;
      else inIndent = false;
    }
    if (inIndent && !blank) protect(start, offset - 1);
    paraBreak.push(blank);
    prevBlank = blank;
  });

  // Exact-length backtick runs; a longer run or an embedded single tick cannot close
  // a span. Spans may wrap lines, but cannot cross a block or paragraph boundary.
  let s = chars.join('');
  const ticks = /`+|\\[\s\S]/g;
  let m;
  while ((m = ticks.exec(s)) !== null) {
    if (m[0][0] !== '`') continue;
    const close = /`+/g;
    close.lastIndex = ticks.lastIndex;
    let end;
    while ((end = close.exec(s)) !== null) {
      if (/\0|\n[ \t\r]*\n/.test(s.slice(ticks.lastIndex, end.index))) break;
      if (end[0].length !== m[0].length) continue;
      protect(m.index, close.lastIndex);
      ticks.lastIndex = close.lastIndex;
      break;
    }
  }

  // Reference definitions must precede link masking: [Docs](url): "Note" is prose,
  // not a definition manufactured by removing the destination. Protect labels too;
  // changing an apostrophe in an identifier can disconnect its references.
  s = chars.join('');
  const labels = new Set();
  REF_DEF.lastIndex = 0;
  while ((m = REF_DEF.exec(s)) !== null) {
    if (m[0].includes('\0') || /\n[ \t\r]*\n/.test(m[0])) continue;
    labels.add(labelKey(m[1]));
    protect(m.index, m.index + m[0].length);
  }
  s = chars.join('');
  // Matching parentheses, escaped delimiters, angle destinations and quoted titles.
  // An unclosed ]( is prose; do not swallow the remainder of the document.
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\') { i += 1; continue; }
    if (s[i] !== ']' || s[i + 1] !== '(') continue;
    let depth = 1, quote = '', angle = false, k = i + 2;
    for (; k < s.length; k += 1) {
      const ch = s[k];
      if (ch === '\0' || (ch === '\n' && /^[ \t\r]*\n/.test(s.slice(k + 1)))) break;
      if (ch === '\\') { k += 1; continue; }
      if (quote) { if (ch === quote) quote = ''; continue; }
      if (angle) { if (ch === '>') angle = false; continue; }
      if ((ch === '"' || ch === "'") && /\s/.test(s[k - 1])) { quote = ch; continue; }
      if (ch === '<') { angle = true; continue; }
      if (ch === '(') depth += 1;
      if (ch === ')' && --depth === 0) { protect(i + 1, k + 1); i = k; break; }
    }
  }
  s = chars.join('');
  const refs = /\[((?:\\.|[^\]\\\n])*)\](?:[ \t]*\[((?:\\.|[^\]\\\n])*)\])?/g;
  while ((m = refs.exec(s)) !== null) {
    if (m[0].includes('\0')) continue;
    if (m[2] !== undefined) {
      if (!m[2]) { if (labels.has(labelKey(m[1]))) protect(m.index, refs.lastIndex); }
      else if (labels.has(labelKey(m[2]))) protect(refs.lastIndex - m[2].length - 2, refs.lastIndex);
    } else if (s[refs.lastIndex] !== '\0' && labels.has(labelKey(m[1]))) protect(m.index, refs.lastIndex);
  }

  s = chars.join('');
  // Tags follow links, so title contents cannot masquerade as tags. Comments and
  // multi-line attributes are protected as source, while comparison prose stays live.
  const syntax = [TAG, /<!--[\s\S]*?(?:-->|$)/g, /<\?[\s\S]*?(?:\?>|$)/g,
    /<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g, /<![A-Z][^>]*>/g,
    /<(?:[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\s]*|[^<>\s@]+@[^<>\s@]+)>/g,
    /\bhttps?:\/\/[^\s<>]+/g, /\\[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\“”‘’]/g];
  for (const re of syntax) {
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) protect(m.index, m.index + m[0].length, re === TAG);
    s = chars.join('');
  }
  if (text[0] === '\uFEFF') protect(0, 1);
  const masked = chars.join('');
  const context = chars.map((ch, i) => ch === '\0' ? (transparent.has(i) ? '*' : 'a') : ch).join('');
  const prose = masked.split('\n').map((l) => bare(l).replace(/\0/g, ''));
  return { masked, context, prose, paraBreak };
}

module.exports = { markdownProse };
