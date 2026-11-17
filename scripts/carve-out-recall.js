#!/usr/bin/env node
'use strict';

// Recall-cost audit for the rhetorical-tic precision carve-outs (#140).
//
// Deterministic only: no model calls and no network. It scans the repository's
// own fixtures, eval reports, and docs for every surface form a carve-out
// suppresses, attaches the hand labels in evals/carve-out-recall/labels.json,
// and loosens one boundary at a time against the detector's exported
// PATTERN_TABLES. For each carve-out it reports how many labeled tics the
// boundary suppresses (recall cost) and how many literal uses or mentions it
// keeps clean (false positives prevented). It changes no detector rule.
//
//   node scripts/carve-out-recall.js            # table
//   node scripts/carve-out-recall.js --json     # full per-candidate rows
//
// Exits 1 when a candidate has no label, or when a loosened variant can no
// longer be derived from the current pattern source (the detector drifted).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const AIDetector = require(path.join(ROOT, 'detector/patterns.js'));
const LABELS_PATH = path.join(ROOT, 'evals/carve-out-recall/labels.json');

// Generated copies, vendored bundles, and binary-ish assets are excluded so a
// sentence is not counted once per bundle.
const EXCLUDE = /^(?:SKILL\.full\.md|dist\/|plugins\/|skills\/|cursor-rules\/|vale\/|submission\/|assets\/|\.github\/|evals\/carve-out-recall\/|scripts\/carve-out-recall)|(?:^|\/)package(?:-lock)?\.json$/;

// Loose finders: a superset of every form a carve-out suppresses. Finding a
// candidate is not a judgment; the label is.
const FINDERS = {
  'no-chain': /\bno\s+[a-z'’-]+(?:\s+[a-z'’-]+)?(?:\s*,\s*(?:and\s+|or\s+|just\s+)?no\s+[a-z'’-]+(?:\s+[a-z'’-]+)?)+/gi,
  'did-not-chain': /\b(?:did\s+not|didn['’]t)\s+[a-z]+[^.!?\n]{0,40}[,.;]\s+(?:\w+\s+)?(?:did\s+not|didn['’]t)\s+[a-z]+/gi,
  'the-punchline': /\bthe\s+punchline\b/gi,
  'worth-naming': /\bworth\s+naming\b/gi,
  'batteries-included': /\bbatteries[-\s‐-―]+included\b/gi,
  'it-just-works': /\bit\s+just\s+works\b/gi,
  'turns-out': /\bturns\s+out\b/gi,
};

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter((f) => /\.(?:md|json|js)$/.test(f) && !EXCLUDE.test(f)).sort();
}

// Split a file into scoring units: JSON string values, test-file string
// literals, or Markdown/JS paragraphs.
function unitsOf(file) {
  const raw = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/^﻿/, '');
  if (file.endsWith('.json')) {
    const out = [];
    const walk = (v, p) => {
      if (typeof v === 'string') out.push({ ptr: p, text: v });
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}/${i}`));
      else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${p}/${k}`);
    };
    walk(JSON.parse(raw), '');
    return out;
  }
  if (file.endsWith('.test.js')) {
    const out = [];
    const re = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$\n]|\\.)*`/g;
    let m;
    while ((m = re.exec(raw))) {
      let value;
      // The match is a single string literal with no interpolation, so
      // evaluating it only decodes its escapes.
      try { value = new Function(`return ${m[0]}`)(); } catch { continue; }
      out.push({ ptr: `L${raw.slice(0, m.index).split('\n').length}`, text: value });
    }
    return out;
  }
  const out = [];
  let offset = 0;
  for (const para of raw.split(/\n[ \t]*\n/)) {
    out.push({ ptr: `L${raw.slice(0, offset).split('\n').length}`, text: para });
    offset += para.length + 2;
  }
  return out;
}

// Mirrors the detector's documented quote handling closely enough to sort
// candidates: one-line straight or curly double-quoted spans up to 300
// characters, inline code, and blockquote lines.
function isQuoted(text, index, length) {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  let lineEnd = text.indexOf('\n', index);
  if (lineEnd < 0) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  if (/^\s*>/.test(line)) return true;
  const at = index - lineStart;
  const spanRe = /"[^"\n]{1,300}"|“[^”\n]{1,300}”|`[^`\n]+`/g;
  let m;
  while ((m = spanRe.exec(line))) {
    if (m.index < at && m.index + m[0].length >= at + Math.min(length, 1)) return true;
  }
  return false;
}

function contextOf(text, index) {
  const ls = text.lastIndexOf('\n', index - 1) + 1;
  let le = text.indexOf('\n', index);
  if (le < 0) le = text.length;
  const line = text.slice(ls, le).trim();
  if (line.length <= 260) return line;
  const at = index - ls;
  return text.slice(ls, le).slice(Math.max(0, at - 120), at + 140).trim();
}

const keyOf = (form, context, match) => `${form}:${crypto.createHash("sha256").update(`${context}\0${match}`).digest("hex").slice(0, 12)}`;

function collectCandidates() {
  const byKey = new Map();
  for (const file of trackedFiles()) {
    for (const unit of unitsOf(file)) {
      for (const [form, finder] of Object.entries(FINDERS)) {
        finder.lastIndex = 0;
        let m;
        while ((m = finder.exec(unit.text))) {
          const context = contextOf(unit.text, m.index);
          const key = keyOf(form, context, m[0]);
          if (!byKey.has(key)) {
            byKey.set(key, {
              key, form, match: m[0], context, unit: unit.text, index: m.index,
              quoted: isQuoted(unit.text, m.index, m[0].length), where: [],
            });
          }
          byKey.get(key).where.push(unit.ptr ? `${file}#${unit.ptr}` : file);
        }
      }
    }
  }
  return [...byKey.values()];
}

// ── Baseline patterns and one-boundary variants ────────────────────────
const TYPES = AIDetector.PATTERN_TABLES.types;
const src = (type, i) => TYPES[type].patterns[i].source;

function derive(base, from, to, label) {
  if (!base.includes(from)) throw new Error(`cannot derive ${label}: pattern source changed`);
  return base.split(from).join(to);
}

const NO_CHAIN = src('negation-chain', 0);
const NO_LOOKBEHIND = '(?<=^|[.!?]\\s|\\n|[:\\u2013\\u2014]\\s)No\\s+';
const NO_STOP = "(?!matter\\b|one\\b|doubt\\b|longer\\b|way\\b|less\\b|more\\b|such\\b|other\\b|means\\b)";
const DID_NOT = src('negation-chain', 1);
const JUST_WORKS = src('dev-blog-boilerplate', 0);
const TURNS_OUT = TYPES['performed-insight'].patterns.find((p) => p.source.includes('Turns')).source;

const CARVE_OUTS = [
  {
    id: 'no-chain-three-items', form: 'no-chain', type: 'negation-chain',
    boundary: 'Sentence-initial "No …" chain needs 3+ items; allow 2',
    base: new RegExp(NO_CHAIN, 'gm'),
    loose: new RegExp(derive(NO_CHAIN, '){2,}', '){1,}', 'two-item chain'), 'gm'),
  },
  {
    id: 'no-chain-lowercase-after-colon-dash', form: 'no-chain', type: 'negation-chain',
    boundary: 'Lowercase "no …" chain after a colon or dash is not matched; allow it',
    base: new RegExp(NO_CHAIN, 'gm'),
    loose: new RegExp(`${NO_CHAIN}|${derive(NO_CHAIN, NO_LOOKBEHIND, '(?<=[:\\u2013\\u2014]\\s)no\\s+', 'lowercase after colon/dash')}`, 'gm'),
  },
  {
    id: 'no-chain-sentence-initial', form: 'no-chain', type: 'negation-chain',
    boundary: '"No …" chain must open its sentence; allow mid-sentence (any case)',
    base: new RegExp(NO_CHAIN, 'gm'),
    loose: new RegExp(derive(NO_CHAIN, NO_LOOKBEHIND, '\\b[Nn]o\\s+', 'mid-sentence'), 'gm'),
  },
  {
    id: 'no-chain-idiom-stop-list', form: 'no-chain', type: 'negation-chain',
    boundary: 'Idiom stop-list ("no more", "no matter", …); remove it',
    base: new RegExp(NO_CHAIN, 'gm'),
    loose: new RegExp(derive(NO_CHAIN, NO_STOP, '', 'stop-list'), 'gm'),
  },
  {
    id: 'did-not-restated-subject', form: 'did-not-chain', type: 'negation-chain',
    boundary: '"did not" chain must be comma-joined with the subject elided; allow restated subject or sentence break',
    base: new RegExp(DID_NOT, 'gi'),
    loose: new RegExp(derive(DID_NOT, ',\\s*(?:did', '[,.;]\\s*(?:(?:I|we|he|she|they|it|you)\\s+)?(?:did', 'restated subject'), 'gi'),
  },
  {
    id: 'the-punchline-omitted', form: 'the-punchline', type: 'performed-insight',
    boundary: '"the punchline (is|was)" is catalog-only; add it',
    base: null,
    loose: /\bthe\s+punchline\b/gi,
  },
  {
    id: 'worth-naming-omitted', form: 'worth-naming', type: 'performed-insight',
    boundary: '"worth naming" is catalog-only; add it',
    base: null,
    loose: /\bworth\s+naming\b/gi,
  },
  {
    id: 'batteries-included-omitted', form: 'batteries-included', type: 'dev-blog-boilerplate',
    boundary: '"batteries included" is catalog-only; add it',
    base: null,
    loose: /\bbatteries[-\s‐-―]+included\b/gi,
  },
  {
    id: 'just-works-out-idiom', form: 'it-just-works', type: 'dev-blog-boilerplate',
    boundary: '"it just works out" (idiom) is excluded; drop the exclusion',
    base: new RegExp(JUST_WORKS, 'gi'),
    loose: /\bit\s+just\s+works\b/gi,
  },
  {
    id: 'just-works-unicode-hyphen', form: 'it-just-works', type: 'dev-blog-boilerplate',
    boundary: '"out‑of‑the‑box" with Unicode hyphens/dashes is not matched; accept U+2010–U+2015',
    base: new RegExp(JUST_WORKS, 'gi'),
    loose: new RegExp(derive(JUST_WORKS, '[-\\s]+of[-\\s]+the[-\\s]+box', '[-\\s\\u2010-\\u2015]+of[-\\s\\u2010-\\u2015]+the[-\\s\\u2010-\\u2015]+box', 'unicode hyphen'), 'gi'),
  },
  {
    id: 'turns-out-sentence-initial', form: 'turns-out', type: 'performed-insight',
    boundary: '"Turns out" must open a sentence, capitalized; allow any position',
    base: new RegExp(TURNS_OUT, 'g'),
    loose: /\bturns\s+out\b/gi,
  },
];

function hitsAt(re, text, index, length) {
  if (!re) return false;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index < index + length && index < m.index + m[0].length) return true;
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return false;
}

// Does the real engine report an issue of this type overlapping the candidate?
// Returns null when the engine declines to score the unit (under its word
// minimum), so a refusal is not counted as disagreement.
function engineHit(candidate, type) {
  const { issues, label } = AIDetector.analyzeText(candidate.unit);
  if (label === 'Too short') return null;
  return issues.some((i) => i.type === type && typeof i.index === 'number'
    && i.index < candidate.index + candidate.match.length && candidate.index < i.index + i.text.length);
}

function measure() {
  const labels = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf8'));
  const labelByKey = new Map(labels.candidates.map((c) => [c.key, c]));
  const candidates = collectCandidates();
  const unlabeled = candidates.filter((c) => !labelByKey.has(c.key));
  const stale = labels.candidates.filter((l) => !candidates.some((c) => c.key === l.key));
  for (const c of candidates) {
    const l = labelByKey.get(c.key);
    if (l) Object.assign(c, { stratum: l.stratum, label: l.label, note: l.note });
  }

  const rows = [];
  const quoteRows = [];
  for (const co of CARVE_OUTS) {
    const row = { id: co.id, boundary: co.boundary, candidates: 0, baseline: 0, added: 0, tic: 0, literal: 0, mention: 0, ambiguous: 0, engineMismatch: 0, engineUnscored: 0, addedKeys: [] };
    for (const c of candidates.filter((x) => x.form === co.form && x.label)) {
      const base = hitsAt(co.base, c.unit, c.index, c.match.length);
      const loose = hitsAt(co.loose, c.unit, c.index, c.match.length);
      if (c.quoted) {
        // Quote masking blanks these before any rule runs; tallied separately.
        if (loose) quoteRows.push({ carveOut: co.id, key: c.key, label: c.label, stratum: c.stratum });
        continue;
      }
      row.candidates += 1;
      if (base) {
        row.baseline += 1;
        const engine = engineHit(c, co.type);
        if (engine === null) row.engineUnscored += 1;
        else if (!engine) row.engineMismatch += 1;
      }
      if (loose && !base) {
        row.added += 1;
        row[c.label] += 1;
        row.addedKeys.push(c.key);
      }
    }
    rows.push(row);
  }
  const quote = { id: 'quote-masking', boundary: 'Quoted spans, inline code, and blockquotes are masked; score them', candidates: 0, added: 0, tic: 0, literal: 0, mention: 0, ambiguous: 0 };
  const seenQuoted = new Set();
  for (const q of quoteRows) {
    if (seenQuoted.has(q.key)) continue;
    seenQuoted.add(q.key);
    quote.added += 1;
    quote[q.label] += 1;
  }
  quote.candidates = candidates.filter((c) => c.quoted && c.label).length;

  let head = 'unknown';
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const detectorSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'detector/patterns.js'))).digest('hex');
  return { head, detectorSha256, candidates, unlabeled, stale, rows, quote };
}

function main() {
  const result = measure();
  if (process.argv.includes('--json')) {
    const { candidates, ...rest } = result;
    const slim = candidates.map(({ unit, ...c }) => c);
    process.stdout.write(`${JSON.stringify({ ...rest, candidates: slim }, null, 2)}\n`);
  } else {
    console.log(`head ${result.head}`);
    console.log(`detector/patterns.js sha256 ${result.detectorSha256}`);
    const strata = {};
    for (const c of result.candidates) strata[`${c.stratum}/${c.quoted ? 'quoted' : 'unquoted'}`] = (strata[`${c.stratum}/${c.quoted ? 'quoted' : 'unquoted'}`] || 0) + 1;
    console.log(`candidates ${result.candidates.length} ${JSON.stringify(strata)}`);
    console.log('');
    console.log('| Carve-out | Unquoted candidates | Baseline hits | Added by loosening | Tic (TP suppressed) | Literal (FP prevented) | Mention (FP prevented) | Ambiguous | Engine disagrees (unscored) |');
    console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const r of result.rows) {
      console.log(`| \`${r.id}\` | ${r.candidates} | ${r.baseline} | ${r.added} | ${r.tic} | ${r.literal} | ${r.mention} | ${r.ambiguous} | ${r.engineMismatch} (${r.engineUnscored}) |`);
    }
    const q = result.quote;
    console.log(`| \`${q.id}\` | ${q.candidates} quoted | — | ${q.added} | ${q.tic} | ${q.literal} | ${q.mention} | ${q.ambiguous} | — |`);
  }
  if (result.unlabeled.length) {
    console.error(`\n${result.unlabeled.length} unlabeled candidate(s):`);
    for (const c of result.unlabeled) console.error(`  ${c.key} ${JSON.stringify(c.match)} @ ${c.where[0]}\n    ${c.context}`);
    process.exitCode = 1;
  }
  if (result.stale.length) console.error(`\nnote: ${result.stale.length} label(s) no longer match a candidate (text moved or changed).`);
}

if (require.main === module) main();

module.exports = { measure, collectCandidates, CARVE_OUTS, FINDERS, isQuoted };
