#!/usr/bin/env node
/**
 * Avoid AI Writing — self-scan
 *
 * Scores this repo's own documentation with this repo's own detector. A tool
 * that flags "delve" in your writing should survive its own pass, and if it
 * doesn't, that belongs in public rather than in a drawer.
 *
 * Two numbers are reported per file, and both are printed because reporting
 * only the flattering one is the failure this project exists to criticize:
 *
 *   raw       every match, including patterns quoted as examples
 *   exempt    the same scan with SKILL.md's self-reference escape hatch
 *             applied mechanically
 *
 * The escape hatch is not a fudge; it is a rule this skill already documents:
 * "When writing *about* AI writing patterns … quoted examples are exempt from
 * flagging. Text inside quotation marks, code blocks, or explicitly marked as
 * illustrative should not be rewritten." Until now that rule existed only as
 * prose instructions to a model. `applyExemptions()` is its executable form.
 *
 * Usage:
 *   node scripts/self-scan.js              # table to stdout
 *   node scripts/self-scan.js --json       # machine-readable
 *   node scripts/self-scan.js --check      # exit 1 if a file exceeds its budget
 *   node scripts/self-scan.js --markdown   # the PROOF.md table body
 *
 * Dependency-free; runs on node >= 18.
 */

const fs = require('node:fs');
const path = require('node:path');
const AIDetector = require('../detector/patterns.js');

const ROOT = path.resolve(__dirname, '..');

/**
 * Score budgets for the exempt-applied scan. A file over budget fails --check.
 *
 * These are ceilings on measured values, not aspirations: they were set from
 * the first clean run with a few points of headroom so ordinary edits don't
 * trip CI, and they only move down. Raising one is a decision that belongs in
 * a pull request with the new number stated.
 */
const BUDGETS = {
  'README.md': 30,
  'SKILL.full.md': 25,
  'CONTRIBUTING.md': 15,
  'detector/README.md': 15,
  'detector/CATEGORIES.md': 15,
  'examples/README.md': 10,
  // Higher than the rest on purpose. A changelog enumerates the pattern names
  // it added ("bustling, intricate, ever-evolving"), unquoted, which the
  // exemption cannot reach, and Keep-a-Changelog headings carry a
  // `## [3.21.0] — 2026-07-30` separator the em-dash rule does not carve out.
  // PROOF.md itemizes both. See issue #67.
  'CHANGELOG.md': 40,
  'PROOF.md': 20,
};

const FILES = Object.keys(BUDGETS);

// ── The self-reference escape hatch, made executable ───────────────────
//
// Order matters: fenced code first (it can contain anything), then the
// inline code, line-oriented block forms, and quoted spans.
/**
 * Line scanner over fenced code blocks, mirroring fenceRanges() in
 * detector/patterns.js. A fence closes only on a line whose marker matches
 * the opener and is at least as long, so a `~~~` line inside a ``` block (the
 * normal way to document Markdown fences) is content, not a close. Replaces
 * the FENCED_CODE regex, which accepted either marker as the closer (#236).
 */
function fenceSpans(text) {
  const spans = [];
  const lines = text.split('\n');
  let cursor = 0;
  let open = null; // { marker, len, start }

  for (const line of lines) {
    const markerMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (!open) {
      // CommonMark forbids backticks in the info string of a backtick fence.
      // Without this guard a prose line that starts with an inline span such as
      // ```npm test``` opens a fence that never closes, and the rest of the
      // document is exempted from the scan.
      const isOpen =
        markerMatch &&
        !(markerMatch[1][0] === '`' && line.slice(markerMatch[0].length).includes('`'));
      if (isOpen) {
        open = { marker: markerMatch[1][0], len: markerMatch[1].length, start: cursor };
      }
    } else {
      const isClose =
        markerMatch &&
        markerMatch[1][0] === open.marker &&
        markerMatch[1].length >= open.len &&
        /^[ \t]*\r?$/.test(line.slice(markerMatch[0].length));
      if (isClose) {
        spans.push([open.start, cursor + line.length]);
        open = null;
      }
    }
    cursor += line.length + 1; // +1 for the newline
  }

  if (open) spans.push([open.start, text.length]);
  return spans;
}

const BLOCKQUOTE_BLOCK = /(?:^[ \t]*>[^\n]*(?:\n[ \t]*>[^\n]*)*)/gm;
const INLINE_CODE = /`[^`\n]+`/g;
const QUOTED_SPAN = /(?:"[^"\n]{1,300}"|“[^”\n]{1,300}”|'[^'\n]{2,300}')/g;

// Keep table-row semantics in sync with detector/validate.js. Four-space and
// tab-indented lines are top-level code, not tables. Escaped pipes remain cell
// content rather than separators.
function tableCells(line) {
  if (/^(?: {4}|\t)/.test(line)) return null;
  const trimmed = line.trim();
  const separators = [];
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] !== '|') continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && trimmed[j] === '\\'; j -= 1) slashes++;
    if (slashes % 2 === 0) separators.push(i);
  }
  if (separators.length === 0) return null;

  const cells = [];
  let start = separators[0] === 0 ? 1 : 0;
  for (const separator of separators) {
    if (separator < start) continue;
    cells.push(trimmed.slice(start, separator));
    start = separator + 1;
  }
  if (start < trimmed.length) cells.push(trimmed.slice(start));
  return cells;
}

function isTableDelimiter(line) {
  const cells = tableCells(line);
  return cells !== null && cells.length > 0
    && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

/** Blank GFM table rows while preserving every source offset. */
function maskTables(text) {
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const headerCells = tableCells(lines[i - 1]);
    const delimiterCells = tableCells(lines[i]);
    if (!headerCells || !isTableDelimiter(lines[i])
      || headerCells.length !== delimiterCells.length) continue;
    let end = i;
    while (end + 1 < lines.length && tableCells(lines[end + 1])) end++;
    for (let row = i - 1; row <= end; row++) {
      lines[row] = ' '.repeat(lines[row].length);
    }
    i = end;
  }
  return lines.join('\n');
}

/**
 * Blank out the spans SKILL.md exempts, preserving line and column offsets so
 * any reported match index still points at the right place in the source.
 */
function applyExemptions(text) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  const chars = text.split('');
  for (const [start, end] of fenceSpans(text)) {
    for (let i = start; i < end; i += 1) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  }
  const withoutFencesOrInlineCode = chars.join('').replace(INLINE_CODE, blank);
  return maskTables(withoutFencesOrInlineCode)
    .replace(BLOCKQUOTE_BLOCK, blank)
    .replace(QUOTED_SPAN, blank);
}

/**
 * The detector refuses text over ~10k words. Long documents are scored in
 * paragraph-aligned chunks and reported by their worst chunk, which is the
 * conservative reading: a document is as machine-sounding as its worst section.
 * Issue categories are counted across every accepted chunk so the over-budget
 * diagnostic can name them, the same way the single-pass path does.
 */
const CHUNK_WORDS = 4000;

function scoreLongText(text) {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let current = [];
  let words = 0;
  for (const para of paragraphs) {
    const n = (para.match(/\S+/g) || []).length;
    if (words + n > CHUNK_WORDS && current.length) {
      chunks.push(current.join('\n\n'));
      current = [];
      words = 0;
    }
    current.push(para);
    words += n;
  }
  if (current.length) chunks.push(current.join('\n\n'));

  const results = chunks
    .map((chunk) => AIDetector.analyzeText(chunk));

  // A declined (unsupported-script) chunk is not a completed scan: report
  // the document as unscannable instead of scoring it as a clean zero (#241).
  if (results.some((r) => r.unsupportedScript)) {
    return {
      declined: true,
      score: 0,
      issues: 0,
      wordCount: results.reduce((sum, r) => sum + (r.stats.wordCount || 0), 0),
      chunks: chunks.length,
      topTypes: [],
    };
  }

  const scored = results.filter((r) => !r.tooShort && r.label !== 'Text too long');

  if (!scored.length) return { score: 0, issues: 0, wordCount: 0, chunks: chunks.length, topTypes: [] };
  return {
    score: Math.max(...scored.map((r) => r.score)),
    issues: scored.reduce((sum, r) => sum + r.issues.length, 0),
    wordCount: scored.reduce((sum, r) => sum + (r.stats.wordCount || 0), 0),
    chunks: scored.length,
    topTypes: topTypes(scored.flatMap((r) => r.issues)),
  };
}

function score(text) {
  const wordCount = (text.match(/\S+/g) || []).length;
  if (wordCount > 9500) return scoreLongText(text);
  const r = AIDetector.analyzeText(text);
  if (r.unsupportedScript) {
    return { declined: true, score: 0, issues: 0, wordCount: r.stats.wordCount || wordCount, chunks: 1, topTypes: [] };
  }
  return {
    score: r.score,
    issues: r.issues.length,
    wordCount: r.stats.wordCount || wordCount,
    chunks: 1,
    topTypes: topTypes(r.issues),
  };
}

function topTypes(issues) {
  const counts = new Map();
  for (const issue of issues) counts.set(issue.type, (counts.get(issue.type) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
}

/**
 * Score one document. `budget` defaults to the tracked ceiling for `rel`;
 * tests pass an explicit one to scan a fixture that is not in BUDGETS.
 */
function scanFile(rel, budget = BUDGETS[rel]) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const raw = score(text);
  const exempt = score(applyExemptions(text));
  return {
    file: rel,
    words: raw.wordCount,
    rawScore: raw.score,
    rawIssues: raw.issues,
    exemptScore: exempt.score,
    exemptIssues: exempt.issues,
    budget,
    // Keep the two scans independent: raw deliberately includes quoted
    // examples, while the exemption-aware result is what --check gates.
    rawDeclined: Boolean(raw.declined),
    exemptDeclined: Boolean(exempt.declined),
    // Backward-compatible summary: a document is declined only when its
    // exemption-aware prose could not be scored.
    declined: Boolean(exempt.declined),
    overBudget: exempt.score > budget,
    chunked: raw.chunks > 1 ? raw.chunks : null,
    topTypes: exempt.topTypes || [],
  };
}

/** The line `--check` prints for a document over its budget. */
function overBudgetDiagnostic(r) {
  const categories = r.topTypes.map(([t, n]) => `${t}×${n}`).join(', ') || 'none';
  return `${r.file} is over budget (${r.exemptScore} > ${r.budget}). Top categories: ${categories}`;
}

function main() {
  const args = process.argv.slice(2);
  const rows = FILES.map((file) => scanFile(file));

  if (args.includes('--json')) {
    console.log(JSON.stringify({ generated_by: 'scripts/self-scan.js', rows }, null, 2));
  } else if (args.includes('--markdown')) {
    console.log('| Document | Words | Raw score | Exempt score | Budget |');
    console.log('|---|---:|---:|---:|---:|');
    for (const r of rows) {
      const rawCell = r.rawDeclined ? 'declined' : r.rawScore;
      const exemptCell = r.exemptDeclined ? 'declined' : `**${r.exemptScore}**`;
      console.log(`| \`${r.file}\` | ${r.words.toLocaleString()} | ${rawCell} | ${exemptCell} | ${r.budget} |`);
    }
  } else {
    console.log('\nself-scan — this skill\'s detector against this skill\'s docs\n');
    // Header and rows share these widths so the columns cannot drift apart.
    // The score columns are wide enough for the word `declined` (8) plus a
    // gutter, which is why they are wider than their headings.
    const W = { file: 24, words: 6, raw: 9, exempt: 10, budget: 8 };
    console.log(
      `  ${'file'.padEnd(W.file)}${'words'.padStart(W.words)}${'raw'.padStart(W.raw)}`
      + `${'exempt'.padStart(W.exempt)}${'budget'.padStart(W.budget)}`,
    );
    for (const r of rows) {
      const rawCell = r.rawDeclined ? 'declined' : String(r.rawScore);
      const exemptCell = r.exemptDeclined ? 'declined' : String(r.exemptScore);
      const flag = r.exemptDeclined ? '  DECLINED' : (r.rawDeclined ? '  RAW DECLINED' : (r.overBudget ? '  OVER' : ''));
      console.log(
        `  ${r.file.padEnd(W.file)}${String(r.words).padStart(W.words)}${rawCell.padStart(W.raw)}${exemptCell.padStart(W.exempt)}${String(r.budget).padStart(W.budget)}${flag}`,
      );
    }
    const over = rows.filter((r) => r.overBudget);
    console.log(
      `\n  raw counts every quoted example as a violation; exempt applies SKILL.md's\n`
      + `  self-reference escape hatch. Budgets gate the exempt column only.\n`,
    );
    if (over.length) {
      for (const r of over) {
        console.log(`  ${overBudgetDiagnostic(r)}`);
      }
    }
  }

  if (args.includes('--check')) {
    const declined = rows.filter((r) => r.exemptDeclined);
    if (declined.length) {
      console.error(`\nFAIL — ${declined.length} file(s) could not be scored after exemptions (unsupported script): ${declined.map((r) => r.file).join(', ')}`);
      process.exit(1);
    }
    const over = rows.filter((r) => r.overBudget);
    if (over.length) {
      console.error(`\nFAIL — ${over.length} file(s) over budget: ${over.map((r) => r.file).join(', ')}`);
      process.exit(1);
    }
    console.error('\nPASS — every scanned document is within its score budget');
  }
}

if (require.main === module) main();

module.exports = { applyExemptions, scanFile, overBudgetDiagnostic, BUDGETS };
