/* Shared Markdown protection for check-style.js and normalize-quotes.js. */
'use strict';

const TITLE = '"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|\\((?:\\\\.|[^)\\\\])*\\)';
const REF_DEF = new RegExp(`^ {0,3}\\[((?:\\\\.|[^\\]\\n])+)\\]:[ \\t]*(?:\\r?\\n[ \\t]*)?(?:<[^>\\n]*>|\\S+)(?:[ \\t]*(?:\\r?\\n[ \\t]*)?(?:${TITLE}))?[ \\t]*\\r?$`, 'gm');
const TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/g;
const labelKey = (s) => s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\])/g, '$1').trim().replace(/\s+/g, ' ').toLowerCase();

// Precompute suffix boundaries so even failed, nested candidates take O(1) each.
// A bare destination has balanced parentheses and no whitespace. Whitespace may
// separate it from a title, but cannot turn arbitrary following prose into a title.
function inlineLinkEnds(s) {
  const n = s.length;
  const escaped = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    if (s[i] === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\]/.test(s[i + 1] || '')) {
      escaped[++i] = 1;
    }
  }
  const bare = new Int32Array(n + 1), space = new Int32Array(n + 1);
  const lines = new Int32Array(n + 1);
  const delimiters = ['"', "'", ')', '>'];
  const closing = Object.fromEntries(delimiters.map((d) => [d, new Int32Array(n + 1).fill(-1)]));
  bare[n] = space[n] = n;
  for (let i = n - 1; i >= 0; i -= 1) {
    const ch = s[i];
    const ws = /[ \t\r\n]/.test(ch);
    space[i] = ws ? space[i + 1] : i;
    lines[i] = ws ? lines[i + 1] + (ch === '\n' ? 1 : 0) : 0;
    for (const d of delimiters) {
      const blocked = ch === '\0' || (ch === '\n' && lines[i] > 1)
        || (d === '>' && /[<>\r\n]/.test(ch) && ch !== '>')
        || (d === ')' && ch === '(' && !escaped[i]);
      closing[d][i] = blocked ? -1 : ch === d && !escaped[i] ? i : closing[d][i + 1];
    }
    if (ch === '\\' && escaped[i + 1]) bare[i] = bare[i + 2];
    else if (ch === '(' && !escaped[i]) {
      const end = bare[i + 1];
      bare[i] = s[end] === ')' && !escaped[end] ? bare[end + 1] : i;
    } else bare[i] = /[\s\x00-\x1f<>]/.test(ch) || (ch === ')' && !escaped[i]) ? i : bare[i + 1];
  }
  const skipSpace = (i) => lines[i] > 1 ? -1 : space[i];
  return (start) => {
    let k = skipSpace(start);
    if (k < 0) return -1;
    if (s[k] === '<') {
      const end = closing['>'][k + 1];
      if (end < 0) return -1;
      k = end + 1;
    } else k = bare[k];
    if (s[k] === ')') return k;
    const end = skipSpace(k);
    if (end < 0 || end === k) return -1;
    if (s[end] === ')') return end;
    const delimiter = s[end] === '(' ? ')' : s[end];
    if (delimiter !== '"' && delimiter !== "'" && s[end] !== '(') return -1;
    const titleEnd = closing[delimiter][end + 1];
    if (titleEnd < 0) return -1;
    k = skipSpace(titleEnd + 1);
    return k >= 0 && s[k] === ')' ? k : -1;
  };
}

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
  const linkEnd = inlineLinkEnds(s);
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\') { i += 1; continue; }
    if (s[i] !== ']' || s[i + 1] !== '(') continue;
    const k = linkEnd(i + 2);
    if (k >= 0) { protect(i + 1, k + 1); i = k; }
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
