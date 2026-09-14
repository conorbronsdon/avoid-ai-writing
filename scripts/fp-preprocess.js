'use strict';

/**
 * Structural preprocessing for the false-positive measurement harness.
 *
 * Markdown structure is kept where the detector can observe it. Only ordinary
 * hard-wrapped prose is folded. Paragraph eligibility is deliberately a
 * separate final step so skipped candidates remain available for diagnostics.
 */

const MIN_WORDS = 50;
const MAX_WORDS = 400;

const ATX = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
const BULLET_LIST = /^[ \t]*[-+*•][ \t]+/;
const ORDERED_LIST = /^[ \t]*(\d+)[.)][ \t]+/;
const LIST = /^[ \t]*(?:[-+*•]|\d+[.)])[ \t]+/;
const LIST_CONTINUATION = /^(?: {2,}|\t)\S/;
const QUOTE = /^[ \t]*>/;
const INDENTED = /^(?: {4}|\t)/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const THEMATIC = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

function wordCount(text) {
  return (text.match(/\S+/g) || []).length;
}

function scanLines(input) {
  const lines = [];
  let start = 0;
  let i = 0;

  while (i < input.length) {
    if (input[i] !== '\r' && input[i] !== '\n') {
      i += 1;
      continue;
    }
    const newlineEnd = input[i] === '\r' && input[i + 1] === '\n' ? i + 2 : i + 1;
    lines.push({ text: input.slice(start, i), start, end: i, fullEnd: newlineEnd });
    start = newlineEnd;
    i = newlineEnd;
  }

  if (start < input.length || input.length === 0) {
    lines.push({ text: input.slice(start), start, end: input.length, fullEnd: input.length });
  }
  return lines;
}

function isBlank(line) {
  return /^[ \t]*$/.test(line.text);
}

function firstLetterCase(text) {
  const match = text.match(/\p{L}/u);
  if (!match) return null;
  const letter = match[0];
  if (letter.toLocaleUpperCase() === letter.toLocaleLowerCase()) return null;
  return letter === letter.toLocaleLowerCase() ? 'lower' : 'upper';
}

function isColonCandidate(text) {
  const trimmed = text.trim();
  return trimmed.endsWith(':') && wordCount(trimmed) <= 20;
}

function addKind(kinds, kind) {
  if (!kinds.includes(kind)) kinds.push(kind);
}

function potentialIndentedCodeLines(lines) {
  const result = lines.map(() => false);
  for (let i = 0; i < lines.length; i++) {
    result[i] = !isBlank(lines[i])
      && INDENTED.test(lines[i].text)
      && (i === 0 || isBlank(lines[i - 1]) || result[i - 1]);
  }
  return result;
}

// An ordered marker other than numeric 1 cannot interrupt an open paragraph.
// This narrow distinction follows https://spec.commonmark.org/0.31.2/#list-items
// and keeps a hard-wrapped year such as `1859.` in prose.
function startsListRun(lines, kinds, indentedCode, index) {
  if (BULLET_LIST.test(lines[index].text)) return true;
  const ordered = lines[index].text.match(ORDERED_LIST);
  if (!ordered) return false;
  if (Number(ordered[1]) === 1 || index === 0 || isBlank(lines[index - 1])) return true;
  const previousKinds = kinds[index - 1];
  return previousKinds.length > 0
    || QUOTE.test(lines[index - 1].text)
    || indentedCode[index - 1];
}

/** Classify lines without changing their source offsets. */
function classify(lines) {
  const kinds = lines.map(() => []);
  const fences = new Map();
  const indentedCode = potentialIndentedCodeLines(lines);

  // A fence closes only with the same marker and at least the opener length.
  // Different or shorter markers inside it are content. An unclosed fence owns
  // the remainder of the input.
  for (let i = 0; i < lines.length; i++) {
    if (kinds[i].length || isBlank(lines[i])) continue;
    const opener = lines[i].text.match(FENCE);
    if (!opener) continue;
    const marker = opener[1][0];
    const length = opener[1].length;
    let end = lines.length - 1;
    for (let j = i + 1; j < lines.length; j++) {
      const close = lines[j].text.match(/^[ \t]{0,3}(`+|~+)[ \t]*$/);
      if (close && close[1][0] === marker && close[1].length >= length) {
        end = j;
        break;
      }
    }
    for (let j = i; j <= end; j++) addKind(kinds[j], 'fenced-code');
    fences.set(i, end);
    i = end;
  }

  // Explicit headings take priority over the punctuation rules below.
  for (let i = 0; i < lines.length; i++) {
    if (kinds[i].includes('fenced-code') || isBlank(lines[i])) continue;
    if (ATX.test(lines[i].text)) addKind(kinds[i], 'atx-heading');
  }

  // A dash line is a setext underline when it follows eligible title text;
  // otherwise the same shape is a thematic break.
  for (let i = 0; i + 1 < lines.length; i++) {
    if (kinds[i].length || isBlank(lines[i]) || kinds[i + 1].includes('fenced-code')) continue;
    if (!SETEXT.test(lines[i + 1].text)) continue;
    if (ATX.test(lines[i].text) || LIST.test(lines[i].text) || QUOTE.test(lines[i].text) || INDENTED.test(lines[i].text)) continue;
    addKind(kinds[i], 'setext-heading');
    addKind(kinds[i + 1], 'setext-heading');
    i += 1;
  }
  for (let i = 0; i < lines.length; i++) {
    if (!kinds[i].length && THEMATIC.test(lines[i].text)) addKind(kinds[i], 'thematic-break');
  }

  // Mark complete list runs, including lazy continuation and blank-separated
  // subsequent items or indented continuation. This keeps line structure and
  // prevents continuation text from being folded as an unrelated paragraph.
  for (let i = 0; i < lines.length; i++) {
    if (kinds[i].length || !startsListRun(lines, kinds, indentedCode, i)) continue;
    let j = i;
    while (j < lines.length) {
      if (kinds[j].some((kind) => kind.endsWith('heading') || kind === 'fenced-code')) break;
      if (QUOTE.test(lines[j].text) || kinds[j].includes('thematic-break')) break;
      if (!isBlank(lines[j])) addKind(kinds[j], 'list');
      if (!isBlank(lines[j])) {
        j += 1;
        continue;
      }

      let next = j;
      while (next < lines.length && isBlank(lines[next])) next += 1;
      if (next < lines.length && !kinds[next].length && (LIST.test(lines[next].text) || LIST_CONTINUATION.test(lines[next].text))) {
        j = next;
        continue;
      }
      break;
    }
    i = Math.max(i, j - 1);
  }

  for (let i = 0; i < lines.length; i++) {
    if (kinds[i].length || isBlank(lines[i])) continue;
    if (QUOTE.test(lines[i].text)) addKind(kinds[i], 'blockquote');
    else if (
      INDENTED.test(lines[i].text)
      && (i === 0 || isBlank(lines[i - 1]) || kinds[i - 1].includes('indented-code'))
    ) addKind(kinds[i], 'indented-code');
  }

  // Colon headings are intentionally narrow. At the beginning of a prose
  // block, an immediate lowercase continuation makes the whole run prose. A
  // short standalone block may introduce the next block regardless of case.
  for (let i = 0; i < lines.length; i++) {
    if (kinds[i].length || isBlank(lines[i]) || !isColonCandidate(lines[i].text)) continue;
    const atBlockStart = i === 0 || isBlank(lines[i - 1]) || isHeadingKinds(kinds[i - 1]);
    if (!atBlockStart) continue;

    const next = i + 1;
    const standalone = next >= lines.length || isBlank(lines[next]);
    if (!standalone) {
      if (kinds[next].length || firstLetterCase(lines[next].text) !== 'upper') continue;
    }
    addKind(kinds[i], 'colon-inferred');
  }

  for (let i = 0; i < lines.length; i++) {
    if (!kinds[i].length && !isBlank(lines[i])) addKind(kinds[i], 'prose');
  }

  return { kinds, fences };
}

function isHeadingKinds(kinds) {
  return kinds.includes('atx-heading') || kinds.includes('setext-heading') || kinds.includes('colon-inferred');
}

function headingKind(kinds) {
  if (kinds.includes('atx-heading')) return 'atx';
  if (kinds.includes('setext-heading')) return 'setext';
  if (kinds.includes('colon-inferred')) return 'colon-inferred';
  return null;
}

function hasHardBreak(text) {
  return /(?: {2,}|\\)$/.test(text);
}

function normalizedRange(lines, classified, start, end, preserveTerminalNewline = false) {
  let output = '';
  let previousJoined = false;
  for (let i = start; i < end; i++) {
    const line = lines[i];
    const ordinary = classified.kinds[i].length === 1 && classified.kinds[i][0] === 'prose';
    const nextOrdinary = i + 1 < end
      && classified.kinds[i + 1].length === 1
      && classified.kinds[i + 1][0] === 'prose';
    const joinNext = ordinary && nextOrdinary && !isBlank(line) && !isBlank(lines[i + 1]) && !hasHardBreak(line.text);

    let value = line.text;
    if (previousJoined) value = value.replace(/^[ \t]+/, '');
    if (joinNext) value = value.replace(/[ \t]+$/, '');
    output += value;

    if (i + 1 < end) output += joinNext ? ' ' : '\n';
    else if (preserveTerminalNewline && line.fullEnd > line.end) output += '\n';
    previousJoined = joinNext;
  }
  return output;
}

function sourceSpan(lines, start, end) {
  return {
    start: lines[start].start,
    end: lines[end - 1].end,
  };
}

function collectKinds(classified, start, end) {
  const result = [];
  for (let i = start; i < end; i++) {
    for (const kind of classified.kinds[i]) addKind(result, kind);
  }
  return result;
}

function nextBlockEnd(lines, classified, start) {
  let end = start;
  while (end < lines.length) {
    if (isBlank(lines[end]) || isHeadingKinds(classified.kinds[end]) || classified.fences.has(end)) break;
    end += 1;
  }
  return end;
}

/** Build heading and body atoms before applying eligibility filters. */
function buildAtoms(lines, classified) {
  const atoms = [];
  let i = 0;

  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i += 1;
      continue;
    }

    const lineKinds = classified.kinds[i];
    if (isHeadingKinds(lineKinds)) {
      const end = lineKinds.includes('setext-heading') ? i + 2 : i + 1;
      const kinds = collectKinds(classified, i, Math.min(end, lines.length));
      atoms.push({
        startLine: i,
        endLine: Math.min(end, lines.length),
        kinds,
        isHeading: true,
        headingKind: headingKind(kinds),
      });
      i = end;
      continue;
    }

    if (classified.fences.has(i)) {
      const end = classified.fences.get(i) + 1;
      atoms.push({
        startLine: i,
        endLine: end,
        kinds: ['fenced-code'],
        isHeading: false,
        headingKind: null,
      });
      i = end;
      continue;
    }

    const start = i;
    let mergedContinuation = false;
    let sawList = false;
    let sawQuote = false;
    let sawIndented = false;
    let sawProse = false;
    while (i < lines.length) {
      if (isHeadingKinds(classified.kinds[i]) || classified.fences.has(i)) break;
      if (classified.kinds[i].includes('list')) sawList = true;
      if (classified.kinds[i].includes('blockquote')) sawQuote = true;
      if (classified.kinds[i].includes('indented-code')) sawIndented = true;
      if (classified.kinds[i].includes('prose')) sawProse = true;
      if (!isBlank(lines[i])) {
        i += 1;
        continue;
      }

      let next = i;
      while (next < lines.length && isBlank(lines[next])) next += 1;
      const oneBlankLine = next === i + 1;
      const structuralContinuation = oneBlankLine && next < lines.length && (
        (sawList && classified.kinds[next].includes('list'))
        || (sawQuote && classified.kinds[next].includes('blockquote'))
        || (sawIndented && classified.kinds[next].includes('indented-code'))
        || (sawProse && !sawList && classified.kinds[next].includes('list'))
      );
      const prospectiveEnd = structuralContinuation ? nextBlockEnd(lines, classified, next) : next;
      const mergeFits = structuralContinuation
        && wordCount(normalizedRange(lines, classified, start, prospectiveEnd)) <= MAX_WORDS;
      if (mergeFits) {
        mergedContinuation = true;
        i = next;
        continue;
      }
      break;
    }

    atoms.push({
      startLine: start,
      endLine: i,
      kinds: collectKinds(classified, start, i),
      isHeading: false,
      headingKind: null,
      mergedContinuation,
    });
  }
  return atoms;
}

function makeDecision(text, spans, kinds, attached, attachedKind, reasonOverride, mergedContinuation = false) {
  const inputWords = wordCount(text);
  let status = 'selected';
  let reason = null;

  if (reasonOverride) {
    status = 'skipped';
    reason = reasonOverride;
  } else if (inputWords < MIN_WORDS) {
    status = 'skipped';
    reason = 'below-min';
  } else if (inputWords > MAX_WORDS) {
    status = 'skipped';
    reason = 'above-max';
  }

  return {
    text,
    spans,
    kinds,
    headingAttached: attached,
    headingKind: attachedKind,
    ...(mergedContinuation ? { mergedContinuation: true } : {}),
    inputWords,
    status,
    reason,
  };
}

function shortHeadingReason(text, reason) {
  return wordCount(text) < MIN_WORDS ? reason : null;
}

function decisionsForParagraphs(input, lines, classified) {
  const atoms = buildAtoms(lines, classified);
  const decisions = [];

  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i];
    if (atom.isHeading) {
      const next = atoms[i + 1];
      if (next && !next.isHeading) {
        const headingText = normalizedRange(lines, classified, atom.startLine, atom.endLine);
        const bodyText = normalizedRange(lines, classified, next.startLine, next.endLine);
        const separator = input
          .slice(lines[atom.endLine - 1].end, lines[next.startLine].start)
          .replace(/\r\n|\r|\n/g, '\n');
        const combined = headingText + separator + bodyText;
        const combinedWords = wordCount(combined);

        if (combinedWords <= MAX_WORDS) {
          const kinds = [...atom.kinds];
          for (const kind of next.kinds) addKind(kinds, kind);
          decisions.push(makeDecision(
            combined,
            [sourceSpan(lines, atom.startLine, atom.endLine), sourceSpan(lines, next.startLine, next.endLine)],
            kinds,
            true,
            atom.headingKind,
            null,
            next.mergedContinuation,
          ));
          i += 1;
          continue;
        }

        decisions.push(makeDecision(
          headingText,
          [sourceSpan(lines, atom.startLine, atom.endLine)],
          atom.kinds,
          false,
          atom.headingKind,
          shortHeadingReason(headingText, 'heading-would-exceed-maximum'),
        ));
        continue;
      }

      const headingText = normalizedRange(lines, classified, atom.startLine, atom.endLine);
      decisions.push(makeDecision(
        headingText,
        [sourceSpan(lines, atom.startLine, atom.endLine)],
        atom.kinds,
        false,
        atom.headingKind,
        shortHeadingReason(headingText, 'unattached-heading'),
      ));
      continue;
    }

    decisions.push(makeDecision(
      normalizedRange(lines, classified, atom.startLine, atom.endLine),
      [sourceSpan(lines, atom.startLine, atom.endLine)],
      atom.kinds,
      false,
      null,
      null,
      atom.mergedContinuation,
    ));
  }

  return decisions;
}

/**
 * Normalize and select measurement units.
 *
 * Spans always refer to UTF-16 offsets in the original input. Document mode
 * has one selected decision and intentionally bypasses paragraph eligibility.
 */
function prepareUnits(text, mode = 'paragraph') {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (mode !== 'paragraph' && mode !== 'document') throw new RangeError(`unknown unit mode: ${mode}`);

  const lines = scanLines(text);
  const classified = classify(lines);
  const normalizedText = normalizedRange(lines, classified, 0, lines.length, true);

  if (mode === 'document') {
    return {
      normalizedText,
      decisions: [{
        text: normalizedText,
        spans: [{ start: 0, end: text.length }],
        kinds: collectKinds(classified, 0, lines.length),
        headingAttached: false,
        headingKind: null,
        inputWords: wordCount(normalizedText),
        status: 'selected',
        reason: null,
      }],
    };
  }

  return {
    normalizedText,
    decisions: decisionsForParagraphs(text, lines, classified),
  };
}

function normalizeUnit(text) {
  return prepareUnits(text, 'document').normalizedText;
}

function splitUnits(text) {
  return prepareUnits(text, 'paragraph').decisions
    .filter((decision) => decision.status === 'selected')
    .map((decision) => decision.text);
}

function unitsForText(text, mode = 'paragraph') {
  return prepareUnits(text, mode).decisions
    .filter((decision) => decision.status === 'selected')
    .map((decision) => decision.text);
}

module.exports = {
  MIN_WORDS,
  MAX_WORDS,
  prepareUnits,
  normalizeUnit,
  splitUnits,
  unitsForText,
};
