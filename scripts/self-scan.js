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
  'SKILL.md': 25,
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
// line-oriented block forms, then inline spans.
const FENCED_CODE = /^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$/gm;
const TABLE_BLOCK = /(?:^[ \t]*\|[^\n]*\|[ \t]*(?:\n[ \t]*\|[^\n]*\|[ \t]*)+)/gm;
const BLOCKQUOTE_BLOCK = /(?:^[ \t]*>[^\n]*(?:\n[ \t]*>[^\n]*)*)/gm;
const INLINE_CODE = /`[^`\n]+`/g;
const QUOTED_SPAN = /(?:"[^"\n]{1,300}"|“[^”\n]{1,300}”|'[^'\n]{2,300}')/g;

/**
 * Blank out the spans SKILL.md exempts, preserving line and column offsets so
 * any reported match index still points at the right place in the source.
 */
function applyExemptions(text) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  return text
    .replace(FENCED_CODE, blank)
    .replace(TABLE_BLOCK, blank)
    .replace(BLOCKQUOTE_BLOCK, blank)
    .replace(INLINE_CODE, blank)
    .replace(QUOTED_SPAN, blank);
}

/**
 * The detector refuses text over ~10k words. Long documents are scored in
 * paragraph-aligned chunks and reported by their worst chunk, which is the
 * conservative reading: a document is as machine-sounding as its worst section.
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
    .map((chunk) => AIDetector.analyzeText(chunk))
    .filter((r) => !r.tooShort && r.label !== 'Text too long');

  if (!results.length) return { score: 0, issues: 0, wordCount: 0, chunks: chunks.length };
  return {
    score: Math.max(...results.map((r) => r.score)),
    issues: results.reduce((sum, r) => sum + r.issues.length, 0),
    wordCount: results.reduce((sum, r) => sum + (r.stats.wordCount || 0), 0),
    chunks: results.length,
  };
}

function score(text) {
  const wordCount = (text.match(/\S+/g) || []).length;
  if (wordCount > 9500) return scoreLongText(text);
  const r = AIDetector.analyzeText(text);
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

function scanFile(rel) {
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
    budget: BUDGETS[rel],
    overBudget: exempt.score > BUDGETS[rel],
    chunked: raw.chunks > 1 ? raw.chunks : null,
    topTypes: exempt.topTypes || [],
  };
}

function main() {
  const args = process.argv.slice(2);
  const rows = FILES.map(scanFile);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ generated_by: 'scripts/self-scan.js', rows }, null, 2));
  } else if (args.includes('--markdown')) {
    console.log('| Document | Words | Raw score | Exempt score | Budget |');
    console.log('|---|---:|---:|---:|---:|');
    for (const r of rows) {
      console.log(`| \`${r.file}\` | ${r.words.toLocaleString()} | ${r.rawScore} | **${r.exemptScore}** | ${r.budget} |`);
    }
  } else {
    console.log('\nself-scan — this skill\'s detector against this skill\'s docs\n');
    console.log('  file                      words    raw  exempt  budget');
    for (const r of rows) {
      const flag = r.overBudget ? '  OVER' : '';
      console.log(
        `  ${r.file.padEnd(24)}${String(r.words).padStart(6)}${String(r.rawScore).padStart(7)}${String(r.exemptScore).padStart(8)}${String(r.budget).padStart(8)}${flag}`,
      );
    }
    const over = rows.filter((r) => r.overBudget);
    console.log(
      `\n  raw counts every quoted example as a violation; exempt applies SKILL.md's\n`
      + `  self-reference escape hatch. Budgets gate the exempt column only.\n`,
    );
    if (over.length) {
      for (const r of over) {
        console.log(`  ${r.file} is over budget (${r.exemptScore} > ${r.budget}). Top categories: ${r.topTypes.map(([t, n]) => `${t}×${n}`).join(', ') || 'none'}`);
      }
    }
  }

  if (args.includes('--check')) {
    const over = rows.filter((r) => r.overBudget);
    if (over.length) {
      console.error(`\nFAIL — ${over.length} file(s) over budget: ${over.map((r) => r.file).join(', ')}`);
      process.exit(1);
    }
    console.error('\nPASS — every scanned document is within its score budget');
  }
}

if (require.main === module) main();

module.exports = { applyExemptions, scanFile, BUDGETS };
