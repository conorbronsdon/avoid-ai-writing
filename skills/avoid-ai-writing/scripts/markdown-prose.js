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
  const blockStarts = new Set();
  let rawHtml = null;
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
      fence = null; rawHtml = null; inIndent = false; prevBlank = true; listIndents.length = 0;
      blockStarts.add(start);
      quoteDepth = depth;
    }
    if (quote) b = b.slice(quote[0].length);
    const blank = !b.trim();
    const indent = (b.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length;
    // A fenced block belongs to its list item; dedenting leaves that container.
    if (fence && fence.listIndent && !blank && indent < fence.listIndent) {
      fence = null; prevBlank = true; blockStarts.add(start);
    }
    if (rawHtml && rawHtml.listIndent && !blank && indent < rawHtml.listIndent) rawHtml = null;
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
      blockStarts.add(start);
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
      fence = { char: fm[2][0], length: fm[2].length, listIndent: listIndents[listIndents.length - 1] || 0 };
      protect(start, offset - 1); paraBreak.push(false); inIndent = false; prevBlank = false; return;
    }
    const rawStart = b.match(/^ {0,3}<(script|style|pre|textarea)(?:[ \t>]|$)/i);
    if (!rawHtml && rawStart) rawHtml = { name: rawStart[1], listIndent: listIndents[listIndents.length - 1] || 0 };
    if (rawHtml) {
      if (new RegExp('</' + rawHtml.name + '[ \t]*>', 'i').test(b)) rawHtml = null;
      protect(start, offset - 1); paraBreak.push(false); prevBlank = false; return;
    }
    // Inline spans cannot consume headings, thematic breaks, or a following block.
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(b) || /^ {0,3}(?:=+|-+)[ \t]*$/.test(b)
        || /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/.test(b)) {
      blockStarts.add(start); blockStarts.add(offset);
    }
    if (blank) { blockStarts.add(start); blockStarts.add(offset); }
    const ind4 = /^(?: {4}| *\t)/.test(b);
    if (!blank) {
      if (ind4 && (prevBlank || inIndent)) inIndent = true;
      else inIndent = false;
    }
    if (inIndent && !blank) protect(start, offset - 1);
    paraBreak.push(blank);
    prevBlank = blank;
  });

  let s = chars.join('');
  let m;
  // Reference definitions must precede link masking: [Docs](url): "Note" is prose,
  // not a definition manufactured by removing the destination. Protect labels too;
  // changing an apostrophe in an identifier can disconnect its references.
  s = chars.join('');
  const labels = new Set(), definitions = new Map();
  REF_DEF.lastIndex = 0;
  while ((m = REF_DEF.exec(s)) !== null) {
    if (m[0].includes('\0') || /\n[ \t\r]*\n/.test(m[0])) continue;
    definitions.set(m.index, { end: m.index + m[0].length, label: labelKey(m[1]) });
  }
  s = chars.join('');
  // Consume competing inline constructs in source order. HTML before a backtick
  // protects its attributes; a backtick before HTML protects the whole code span.
  // The same ordering keeps code-like text inside link titles literal.
  const linkEnd = inlineLinkEnds(s);
  const html = [new RegExp(TAG.source, 'y'), /<!--[\s\S]*?(?:-->|$)/y,
    /<\?[\s\S]*?(?:\?>|$)/y, /<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/y,
    /<![A-Z][^>]*>/y,
    /<(?:[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\s]*|[^<>\s@]+@[^<>\s@]+)>/y];
  const nextBlock = new Int32Array(s.length + 1);
  let boundary = s.length;
  for (let i = s.length; i >= 0; i -= 1) {
    nextBlock[i] = boundary;
    if (blockStarts.has(i) || s[i] === '\0') boundary = i;
  }
  const tickRun = /`+/y, closeTicks = /`+/g;
  for (let i = 0; i < s.length; i += 1) {
    const definition = definitions.get(i);
    if (definition) {
      labels.add(definition.label); protect(i, definition.end); i = definition.end - 1; continue;
    }
    if (s[i] === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\\u201c\u201d\u2018\u2019]/.test(s[i + 1] || '')) {
      protect(i, i + 2); i += 1; continue;
    }
    if (s[i] === '`') {
      tickRun.lastIndex = i;
      const run = tickRun.exec(s)[0];
      closeTicks.lastIndex = i + run.length;
      let end, found = false;
      while ((end = closeTicks.exec(s)) !== null && end.index < nextBlock[i]) {
        if (end[0].length !== run.length) continue;
        protect(i, closeTicks.lastIndex); i = closeTicks.lastIndex - 1; found = true; break;
      }
      if (!found) i += run.length - 1;
      continue;
    }
    if (s[i] === '<') {
      let matched = false;
      for (const re of html) {
        re.lastIndex = i;
        m = re.exec(s);
        if (!m || m[0].includes('\0')) continue;
        protect(i, re.lastIndex, re === html[0]); i = re.lastIndex - 1; matched = true; break;
      }
      if (matched) continue;
    }
    if (s[i] === ']' && s[i + 1] === '(') {
      const end = linkEnd(i + 2);
      if (end >= 0 && end < nextBlock[i]) { protect(i + 1, end + 1); i = end; }
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
  // Bare URLs exclude prose quotes and terminal punctuation. Retain balanced
  // parentheses inside a URL, but leave an enclosing prose parenthesis visible.
  const urls = /\bhttps?:\/\/[^\s<>"\u201c\u201d\x00]+/g;
  while ((m = urls.exec(s)) !== null) {
    let url = m[0].replace(/[.,;:!?]+$/, '');
    // A surrounding single quote is prose; an internal URL apostrophe is data.
    if (/[‘']/.test(s[m.index - 1] || '') && /[’']$/.test(url)) url = url.slice(0, -1);
    let extra = (url.match(/\)/g) || []).length - (url.match(/\(/g) || []).length;
    while (extra > 0 && url.endsWith(')')) {
      url = url.slice(0, -1).replace(/[.,;:!?]+$/, ''); extra -= 1;
    }
    protect(m.index, m.index + url.length);
  }
  if (text[0] === '\uFEFF') protect(0, 1);
  const masked = chars.join('');
  const context = chars.map((ch, i) => ch === '\0' ? (transparent.has(i) ? '*' : 'a') : ch).join('');
  const prose = masked.split('\n').map((l) => bare(l).replace(/\0/g, ''));
  return { masked, context, prose, paraBreak };
}

module.exports = { markdownProse };
