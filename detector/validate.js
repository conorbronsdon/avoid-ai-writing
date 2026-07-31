/**
 * Avoid AI Writing — preservation validator
 *
 * SKILL.md promises that a rewrite leaves certain things alone: "Don't edit
 * quoted material, code blocks, or text attributed to someone else" (edit
 * mode), "Preserve the original structure, intent, and all specific technical
 * details" (rewrite mode). Nothing enforced those promises. This does.
 *
 * Usage:
 *   const { validate } = require('./validate.js');
 *   const result = validate(originalText, rewrittenText);
 *   if (!result.ok) { console.error(result.errors); }
 *
 * Errors block: they mean the rewrite destroyed or altered content it had no
 * business touching. Warnings inform: they mean something changed that is
 * usually legitimate but occasionally a mistake.
 *
 * Two carve-outs exist because this skill *documents* the edit in question,
 * and a validator that fires on its own skill's instructions is worse than no
 * validator:
 *
 *   1. AI-tool URL parameters (`utm_source=chatgpt.com` and friends). SKILL.md
 *      says "strip the parameter from every URL." So URLs are compared with
 *      those parameters removed from both sides.
 *   2. Heading text. SKILL.md says to convert Title Case headings to sentence
 *      case, and to cut emoji from headings. So heading *text* changing is a
 *      warning; heading count and nesting sequence changing is an error.
 *
 * Dependency-free. Runs on node >= 18. Mirrors the IIFE + module.exports shape
 * of patterns.js so it can be loaded in a browser too.
 */

const AIDetectorValidate = (() => {
  // ═══ Block extractors ══════════════════════════════════════════════
  const FENCED_CODE = /^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$/gm;
  const INLINE_CODE = /`[^`\n]+`/g;
  const YAML_FRONTMATTER = /^---\n[\s\S]*?\n---(?=\n|$)/;
  const BLOCKQUOTE_BLOCK = /(?:^[ \t]*>[^\n]*(?:\n[ \t]*>[^\n]*)*)/gm;
  const TABLE_BLOCK = /(?:^[ \t]*\|[^\n]*\|[ \t]*(?:\n[ \t]*\|[^\n]*\|[ \t]*)+)/gm;
  const MD_HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gm;
  const URL = /https?:\/\/[^\s)>\]"'`]+/g;
  const MD_LINK_TARGET = /\[[^\]\n]*\]\(([^)\s]+)[^)]*\)/g;
  const PATH = /(?:^|[\s(])((?:\.{0,2}\/)[A-Za-z0-9._~\-]+(?:\/[A-Za-z0-9._~\-]+)*|[A-Za-z]:\\[A-Za-z0-9._\\~\-]+)/g;
  const NUMBER = /\b\d[\d,]*(?:\.\d+)?%?\b/g;

  // Tracking parameters this skill is documented to strip (SKILL.md,
  // "AI-tool URL parameters"). Kept in sync with the `ai-utm-source`
  // detector category in patterns.js.
  const AI_URL_PARAMS = /[?&](?:utm_source=(?:chatgpt\.com|openai(?:\.com)?|copilot\.com|claude\.ai|perplexity\.ai|gemini\.google\.com|grok\.com)|referrer=grok\.com)\b/gi;

  function extractAll(re, text) {
    const out = [];
    const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = rx.exec(text)) !== null) {
      out.push(m[1] !== undefined ? m[1] : m[0]);
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
    return out;
  }

  /**
   * Blank out fenced code and inline code before scanning prose-level
   * constructs. Without this, a URL inside a code sample counts twice and a
   * `|` in a code block reads as a table row.
   */
  function maskCode(text) {
    return text
      .replace(FENCED_CODE, (block) => block.replace(/[^\n]/g, ' '))
      .replace(INLINE_CODE, (span) => ' '.repeat(span.length));
  }

  function normalizeUrl(u) {
    return u.replace(AI_URL_PARAMS, '').replace(/[?&]$/, '');
  }

  /** Collapse cell padding so a re-aligned table isn't reported as edited. */
  function normalizeTable(block) {
    return block
      .split('\n')
      .map((row) => row.trim().replace(/\s*\|\s*/g, '|').replace(/-{2,}/g, '-'))
      .join('\n');
  }

  function normalizeQuote(block) {
    return block
      .split('\n')
      .map((line) => line.replace(/^[ \t]*>[ \t]?/, '').trimEnd())
      .join('\n')
      .trimEnd();
  }

  /**
   * Indented code blocks are deliberately warning-level, not error-level.
   * Four-space indentation is also how markdown continues a list item, and a
   * validator that blocks a legitimate rewrite is worse than one that reports
   * a soft signal. Only blocks that follow a blank line and are not inside a
   * list are counted.
   */
  function extractIndentedBlocks(text) {
    const lines = text.split('\n');
    const blocks = [];
    let current = null;
    let inList = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isIndented = /^(?: {4}|\t)\S/.test(line);
      const isBlank = /^\s*$/.test(line);
      if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) inList = true;
      else if (!isBlank && !isIndented) inList = false;

      if (isIndented && !inList) {
        if (current === null) current = [];
        current.push(line);
      } else if (!isBlank && current !== null) {
        blocks.push(current.join('\n'));
        current = null;
      }
    }
    if (current !== null) blocks.push(current.join('\n'));
    return blocks;
  }

  function counts(list) {
    const map = new Map();
    for (const item of list) map.set(item, (map.get(item) || 0) + 1);
    return map;
  }

  /** Items present in `a` more often than in `b`. */
  function missingFrom(a, b) {
    const have = counts(b);
    const out = [];
    for (const item of a) {
      const n = have.get(item) || 0;
      if (n === 0) out.push(item);
      else have.set(item, n - 1);
    }
    return out;
  }

  function sample(list, n = 5) {
    const shown = list.slice(0, n);
    return shown.join(', ') + (list.length > n ? ` (+${list.length - n} more)` : '');
  }

  function wordCount(text) {
    const words = maskCode(text).trim().match(/\S+/g);
    return words ? words.length : 0;
  }

  /**
   * @param {string} original   text as the writer supplied it
   * @param {string} rewritten  text the skill produced
   * @param {object} [options]
   * @param {object} [options.detector]   AIDetector instance; defaults to
   *                                      requiring ./patterns.js when available
   * @param {boolean} [options.skipResidual]  skip the "patterns must not grow"
   *                                      check (used by structure-only tests)
   * @param {number} [options.maxShrinkRatio]  warn when the rewrite drops more
   *                                      than this fraction of words (default 0.4)
   * @returns {{ok: boolean, errors: Array, warnings: Array, stats: object}}
   */
  function validate(original, rewritten, options = {}) {
    const errors = [];
    const warnings = [];
    const err = (code, message) => errors.push({ code, message });
    const warn = (code, message) => warnings.push({ code, message });

    if (typeof original !== 'string' || typeof rewritten !== 'string') {
      throw new TypeError('validate(original, rewritten): both arguments must be strings');
    }

    // ── Fenced code: exact, in order. Code is never the skill's business. ──
    const origFenced = extractAll(FENCED_CODE, original);
    const newFenced = extractAll(FENCED_CODE, rewritten);
    if (origFenced.length !== newFenced.length) {
      err('code-block-count', `Fenced code blocks changed in number: ${origFenced.length} → ${newFenced.length}.`);
    } else if (origFenced.some((block, i) => block !== newFenced[i])) {
      const changed = origFenced.findIndex((block, i) => block !== newFenced[i]);
      err('code-block-modified', `Fenced code block #${changed + 1} was modified.`);
    }

    // ── YAML frontmatter: exact. ──
    const origYaml = original.match(YAML_FRONTMATTER);
    const newYaml = rewritten.match(YAML_FRONTMATTER);
    if ((origYaml ? origYaml[0] : null) !== (newYaml ? newYaml[0] : null)) {
      err('frontmatter-modified', 'YAML frontmatter was modified, added, or removed.');
    }

    const origProse = maskCode(original);
    const newProse = maskCode(rewritten);

    // ── Blockquotes: someone else's words. ──
    const origQuotes = extractAll(BLOCKQUOTE_BLOCK, origProse).map(normalizeQuote);
    const newQuotes = extractAll(BLOCKQUOTE_BLOCK, newProse).map(normalizeQuote);
    const lostQuotes = missingFrom(origQuotes, newQuotes);
    if (lostQuotes.length) {
      err('blockquote-modified', `Blockquote content was modified or removed (${lostQuotes.length} block(s)). Quoted material is attributed to someone else.`);
    }

    // ── Tables: reference content, not prose. ──
    const origTables = extractAll(TABLE_BLOCK, origProse).map(normalizeTable);
    const newTables = extractAll(TABLE_BLOCK, newProse).map(normalizeTable);
    const lostTables = missingFrom(origTables, newTables);
    if (lostTables.length) {
      err('table-modified', `Markdown table content was modified or removed (${lostTables.length} table(s)).`);
    }

    // ── Inline code: identifiers, flags, filenames. ──
    const lostInline = missingFrom(extractAll(INLINE_CODE, original), extractAll(INLINE_CODE, rewritten));
    if (lostInline.length) {
      err('inline-code-missing', `Inline code removed: ${sample(lostInline)}`);
    }

    // ── URLs, compared with AI tracking parameters stripped from both sides. ──
    const origUrls = [
      ...extractAll(URL, origProse),
      ...extractAll(MD_LINK_TARGET, origProse),
    ].map(normalizeUrl);
    const newUrls = [
      ...extractAll(URL, newProse),
      ...extractAll(MD_LINK_TARGET, newProse),
    ].map(normalizeUrl);
    const lostUrls = missingFrom(origUrls, newUrls);
    if (lostUrls.length) {
      err('url-missing', `URL removed or altered: ${sample(lostUrls)}`);
    }

    // ── Filesystem paths. ──
    const lostPaths = missingFrom(extractAll(PATH, origProse), extractAll(PATH, newProse));
    if (lostPaths.length) {
      err('path-missing', `File path removed or altered: ${sample(lostPaths)}`);
    }

    // ── Headings: structure is an error, wording is a warning. ──
    const origHeadings = [];
    const newHeadings = [];
    for (const [, hashes, text] of original.matchAll(MD_HEADING)) origHeadings.push({ level: hashes.length, text });
    for (const [, hashes, text] of rewritten.matchAll(MD_HEADING)) newHeadings.push({ level: hashes.length, text });
    if (origHeadings.length !== newHeadings.length) {
      err('heading-count', `Heading count changed: ${origHeadings.length} → ${newHeadings.length}. Restructuring the document is out of scope for a rewrite.`);
    } else {
      const levelDrift = origHeadings.findIndex((h, i) => h.level !== newHeadings[i].level);
      if (levelDrift !== -1) {
        err('heading-level', `Heading nesting changed at heading #${levelDrift + 1}: h${origHeadings[levelDrift].level} → h${newHeadings[levelDrift].level}.`);
      }
      const reworded = origHeadings.filter((h, i) => h.text !== newHeadings[i].text);
      if (reworded.length) {
        warn('heading-text', `${reworded.length} heading(s) reworded. Expected when fixing Title Case or removing emoji; check nothing else moved.`);
      }
    }

    // ── Numbers: SKILL.md says preserve specific technical details. ──
    const lostNumbers = missingFrom(extractAll(NUMBER, origProse), extractAll(NUMBER, newProse));
    if (lostNumbers.length) {
      warn('number-missing', `Figures present in the original are absent from the rewrite: ${sample(lostNumbers)}. Legitimate when a numeral was spelled out; a fabrication risk otherwise.`);
    }

    // ── Volume: a rewrite that halves the text probably dropped content. ──
    const origWords = wordCount(original);
    const newWords = wordCount(rewritten);
    const maxShrink = options.maxShrinkRatio == null ? 0.4 : options.maxShrinkRatio;
    if (origWords > 0 && newWords / origWords < 1 - maxShrink) {
      warn('large-shrink', `Rewrite dropped ${Math.round((1 - newWords / origWords) * 100)}% of the words (${origWords} → ${newWords}). Check for lost content.`);
    }

    // ── Residual patterns: the rewrite must not introduce new tells. ──
    let residual = null;
    if (!options.skipResidual) {
      let detector = options.detector;
      if (!detector && typeof require === 'function') {
        try {
          detector = require('./patterns.js');
        } catch (_) {
          detector = null;
        }
      }
      if (detector && typeof detector.analyzeText === 'function') {
        const before = detector.analyzeText(original);
        const after = detector.analyzeText(rewritten);
        residual = {
          issuesBefore: before.issues.length,
          issuesAfter: after.issues.length,
          scoreBefore: before.score,
          scoreAfter: after.score,
        };
        if (after.issues.length > before.issues.length) {
          err('residual-grew', `Rewrite introduced AI patterns: ${before.issues.length} → ${after.issues.length} flagged issues. A rewrite may leave patterns behind; it may not add them.`);
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      stats: {
        wordsBefore: origWords,
        wordsAfter: newWords,
        fencedBlocks: origFenced.length,
        headings: origHeadings.length,
        indentedBlocks: extractIndentedBlocks(original).length,
        residual,
      },
    };
  }

  /** Human-readable one-liner per finding, for CLI and skill output. */
  function formatResult(result) {
    const lines = [];
    lines.push(result.ok ? 'PASS — preservation checks clear' : `FAIL — ${result.errors.length} preservation error(s)`);
    for (const e of result.errors) lines.push(`  error   [${e.code}] ${e.message}`);
    for (const w of result.warnings) lines.push(`  warning [${w.code}] ${w.message}`);
    return lines.join('\n');
  }

  return { validate, formatResult, maskCode, extractIndentedBlocks };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIDetectorValidate;
}

// CLI: node detector/validate.js <original> <rewritten>
// Exits 1 on a preservation error so it can gate an edit-mode run in CI.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const fs = require('node:fs');
  const [origPath, newPath] = process.argv.slice(2);
  if (!origPath || !newPath) {
    console.error('usage: node detector/validate.js <original-file> <rewritten-file>');
    process.exit(2);
  }
  const result = AIDetectorValidate.validate(
    fs.readFileSync(origPath, 'utf8'),
    fs.readFileSync(newPath, 'utf8'),
  );
  console.log(AIDetectorValidate.formatResult(result));
  process.exit(result.ok ? 0 : 1);
}
