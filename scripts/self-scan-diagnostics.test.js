#!/usr/bin/env node
/* Chunked-document category tests for `npm test` (#264). */
'use strict';
const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');
const AIDetector = require('../detector/patterns.js');
const { execFileSync } = require('node:child_process');
const { applyExemptions, scanFile, overBudgetDiagnostic, BUDGETS } = require('./self-scan.js');

const ROOT = path.resolve(__dirname, '..');
const CHUNK_WORDS = 4000;
const LONG_DOCUMENT_WORDS = 9500;

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; process.stdout.write(`  ✓ ${name}\n`); };
const words = (text) => (text.match(/\S+/g) || []).length;

// Fixtures live in a temp directory under the repo root, so the relative
// path scanFile() joins onto ROOT stays valid on every platform (os.tmpdir()
// can sit on a different Windows drive, which path.relative() cannot bridge).
const tmpDir = fs.mkdtempSync(path.join(ROOT, '.self-scan-diagnostics-'));
const fixture = (name, text) => {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, text);
  return path.relative(ROOT, file);
};

// Two paragraph shapes with no quotes, backticks, tables, or blockquotes, so
// the exemption pass leaves them untouched. The seeded one carries known
// tier-1 vocabulary and transition tells; the plain one pads the word count.
const SEEDED = 'We delve into a tapestry of ideas here. In todays fast-paced world, it is important to note that this is a testament to innovation. Furthermore, the ever-evolving landscape underscores a paradigm shift.';
const PLAIN = 'The lake behind the mill freezes late most years. Ice forms first along the north bank where the current slows, and the fishermen wait until the surface holds a truck before they drive out. My grandfather kept a notebook of freeze dates going back to 1961. He wrote the date, the thickness at the dock, and the name of whoever tested it first.';

const longDocument = () => {
  const paragraphs = [];
  while (words(paragraphs.join('\n\n')) <= LONG_DOCUMENT_WORDS) {
    const i = paragraphs.length;
    paragraphs.push(`${i % 2 === 0 ? SEEDED : PLAIN} Entry ${i}.`);
  }
  return paragraphs.join('\n\n');
};

// Re-implements the self-scan chunker so the expectation does not come from
// the code under test: paragraph-aligned chunks of at most CHUNK_WORDS words,
// each scored on its own, issue types counted across the accepted chunks.
const independentTopTypes = (text) => {
  const chunks = [];
  let current = [];
  let count = 0;
  for (const para of text.split(/\n\s*\n/)) {
    const n = words(para);
    if (count + n > CHUNK_WORDS && current.length) {
      chunks.push(current.join('\n\n'));
      current = [];
      count = 0;
    }
    current.push(para);
    count += n;
  }
  if (current.length) chunks.push(current.join('\n\n'));
  assert.ok(chunks.length > 1, 'fixture must span more than one chunk');

  const counts = new Map();
  for (const chunk of chunks) {
    const r = AIDetector.analyzeText(chunk);
    if (r.tooShort || r.label === 'Text too long') continue;
    for (const issue of r.issues) counts.set(issue.type, (counts.get(issue.type) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
};

try {
  const text = longDocument();
  assert.ok(words(text) > LONG_DOCUMENT_WORDS, 'fixture must take the chunked path');
  assert.strictEqual(applyExemptions(text), text, 'fixture must contain no exempt spans');
  const rel = fixture('seeded.md', text);

  t('a chunked document reports nonempty top categories', () => {
    const row = scanFile(rel);
    assert.ok(row.chunked >= 2, `expected a chunked scan, got chunked=${row.chunked}`);
    assert.ok(row.exemptIssues > 0, 'fixture must produce detections');
    assert.ok(row.topTypes.length > 0, 'topTypes must not be empty for a chunked document');
    for (const entry of row.topTypes) {
      assert.strictEqual(typeof entry[0], 'string');
      assert.ok(Number.isInteger(entry[1]) && entry[1] > 0);
    }
  });

  t('top categories match an independent count across the chunks', () => {
    const expected = independentTopTypes(text);
    const actual = scanFile(rel).topTypes;
    assert.deepStrictEqual(actual, expected);
    assert.strictEqual(actual.length, 3, 'fixture must yield at least three categories');
    for (let i = 1; i < actual.length; i += 1) {
      assert.ok(actual[i - 1][1] >= actual[i][1], 'categories must be ordered by descending count');
    }
    const total = expected.reduce((sum, [, n]) => sum + n, 0);
    assert.ok(total <= scanFile(rel).exemptIssues, 'top-three counts cannot exceed the issue total');
  });

  t('a chunked document with no detections reports an empty category array', () => {
    // Every paragraph is a fenced code block, which the exemption pass blanks,
    // so no chunk carries scoreable prose and nothing is detected.
    const block = '```\n' + `${PLAIN}\n`.repeat(3) + '```';
    const paragraphs = [];
    while (words(paragraphs.join('\n\n')) <= LONG_DOCUMENT_WORDS) paragraphs.push(block);
    const row = scanFile(fixture('fenced.md', paragraphs.join('\n\n')));
    assert.ok(row.chunked >= 2, 'fixture must take the chunked path');
    assert.strictEqual(row.exemptIssues, 0);
    assert.deepStrictEqual(row.topTypes, []);
  });

  t('the over-budget diagnostic names categories for a chunked document', () => {
    // An explicit zero budget puts the fixture over budget without touching
    // BUDGETS or any tracked document.
    const row = scanFile(rel, 0);
    assert.strictEqual(row.overBudget, true);
    const line = overBudgetDiagnostic(row);
    assert.ok(line.startsWith(`${rel} is over budget (${row.exemptScore} > 0). Top categories: `));
    assert.ok(!line.endsWith('none'), `diagnostic must name categories, got: ${line}`);
    for (const [type, n] of row.topTypes) assert.ok(line.includes(`${type}×${n}`), `missing ${type}×${n} in: ${line}`);
  });

  t('the CLI scans every tracked document against its own budget', () => {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'self-scan.js'), '--json'], { encoding: 'utf8' });
    const { rows } = JSON.parse(out);
    assert.deepStrictEqual(rows.map((r) => r.file), Object.keys(BUDGETS));
    for (const r of rows) assert.strictEqual(r.budget, BUDGETS[r.file], `${r.file} scanned against budget ${r.budget}`);
  });

  t('an unsupported-script document is declined, not scored as clean', () => {
    const row = scanFile(fixture('cjk.md', '这个函数返回一个承诺，调用方不应假设句柄之后仍可重用。'.repeat(50)));
    assert.strictEqual(row.declined, true);
    assert.strictEqual(row.rawScore, 0);
    assert.strictEqual(row.exemptIssues, 0);
    assert.strictEqual(row.overBudget, false);
  });

  t('a chunked unsegmented-script document is declined, not scored as clean', () => {
    // One-word-per-paragraph Chinese paragraphs take the chunked path, and
    // every chunk is CJK-dominated: the scan must be marked declined rather
    // than aggregated as a clean zero score.
    const paragraphs = new Array(LONG_DOCUMENT_WORDS + 500).fill('这个函数返回一个承诺。');
    const row = scanFile(fixture('chunked-cjk.md', paragraphs.join('\n\n')));
    assert.ok(row.chunked >= 2, 'fixture must take the chunked path');
    assert.strictEqual(row.declined, true);
    assert.deepStrictEqual(row.topTypes, []);
  });

  t('the over-budget diagnostic still prints none when nothing was detected', () => {
    const line = overBudgetDiagnostic({ file: 'x.md', exemptScore: 1, budget: 0, topTypes: [] });
    assert.strictEqual(line, 'x.md is over budget (1 > 0). Top categories: none');
  });
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

process.stdout.write(`\n${passed} self-scan diagnostics tests passed\n`);
