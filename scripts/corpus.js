#!/usr/bin/env node
/**
 * Avoid AI Writing — human-control corpus manager
 *
 * The problem this exists to solve: this repo makes claims about false
 * positives (tiering "reduces false positives on words that are fine in
 * isolation", a tolerance matrix that relaxes rules per register) and has never
 * measured one. You cannot measure a false-positive rate without a body of text
 * known to be written by a person.
 *
 * The corpus is **hash-only**. `corpus/manifest.json` records what a document
 * is, where it came from, its license, its register, and the sha256 of the text
 * that was measured. The text itself is never committed: public-domain sources
 * are fetched on demand into a gitignored cache, and private sources stay on
 * whatever machine they already live on. That keeps the measurement auditable
 * without redistributing anyone's writing, including its author's.
 *
 * Borrowed from devswha/patina, which uses the same pattern for Korean human
 * controls.
 *
 * Usage:
 *   node scripts/corpus.js list                    # what's in the manifest
 *   node scripts/corpus.js fetch [--force]         # populate corpus/cache/
 *   node scripts/corpus.js verify                  # cache matches recorded hashes
 *   node scripts/corpus.js add-local <id> <path> --register R --author A --year Y
 *
 * Dependency-free; runs on node >= 18 (uses global fetch).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const CORPUS_DIR = path.join(ROOT, 'corpus');
const MANIFEST = path.join(CORPUS_DIR, 'manifest.json');
const CACHE = path.join(CORPUS_DIR, 'cache');

/**
 * Registers are the unit of analysis, not a label of convenience.
 *
 * Patina's Korean human-control pilot measured false positives from 4.0% on
 * chat updates to 34.0% on technical how-to prose within a single language. A
 * single aggregate rate would have been tuned entirely by the worst register
 * and would have hidden the finding. This repo's own tolerance matrix already
 * asserts that registers differ; these are the buckets that let the assertion
 * be checked.
 */
const REGISTERS = [
  'blog',              // personal or company blog prose
  'technical-blog',    // architecture, code-adjacent long form
  'docs',              // README, reference, how-to
  'essay-literary',    // long-form literary essay
  'academic',          // papers, lectures, scholarly argument
  'social',            // LinkedIn, X, short form
  'email',             // newsletters, correspondence
  'conversational',    // issue and PR comments, chat, DMs
];

const AUTHORSHIP = [
  'human-pre-llm',     // written before generative models were available
  'human-attested',    // author states no AI assistance
];

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function readManifest() {
  if (!fs.existsSync(MANIFEST)) return { version: 1, documents: [] };
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

function writeManifest(m) {
  fs.mkdirSync(CORPUS_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
}

/**
 * Project Gutenberg wraps every work in a license header and footer. Scoring
 * those would measure Gutenberg's boilerplate rather than the author's prose.
 */
function stripGutenberg(raw) {
  const start = raw.search(/^\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*\s*$/m);
  const end = raw.search(/^\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*\s*$/m);
  let text = raw;
  if (start !== -1) text = text.slice(text.indexOf('\n', start) + 1);
  if (end !== -1) {
    const endInSlice = text.search(/^\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*\s*$/m);
    if (endInSlice !== -1) text = text.slice(0, endInSlice);
  }
  return text.trim();
}

/**
 * Pull readable prose out of an HTML page.
 *
 * Deliberately crude: take the named container, drop scripts and styles, turn
 * block-level closers into paragraph breaks, strip the rest of the tags, and
 * decode the handful of entities that actually appear. No parser, no
 * dependency. The container selector is what excludes page chrome: a source
 * that wants its header, nav, or footer dropped chooses a selector that wraps
 * only the body (the W3C seed uses `main` for exactly that). Semantic elements
 * that are part of the authored content survive extraction, and the
 * measurement's 50-word paragraph floor discards short lines like navigation
 * and datelines, so they never reach a score.
 */
function htmlToText(html, opts = {}) {
  const config = typeof opts === 'string' ? { selector: opts } : opts;
  const selector = config.selector || 'article';

  let source;
  if (config.mode === 'paragraphs') {
    // Archived pages predate the current site and carry no <article> element.
    // Collecting the body paragraphs directly is more robust across platforms
    // than guessing at a wrapper div, and `match` filters out navigation and
    // footer paragraphs by an attribute the body paragraphs share.
    const paras = [...html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)]
      .filter(([, attrs]) => (config.match ? attrs.includes(config.match) : true))
      .map(([, , body]) => body);
    if (!paras.length) throw new Error(`no <p> elements matched ${JSON.stringify(config.match || 'any')}`);
    source = paras.join('\n\n');
  } else {
    const container = new RegExp(`<${selector}[\\s\\S]*?<\\/${selector}>`, 'i');
    const m = html.match(container);
    if (!m) throw new Error(`no <${selector}> element found`);
    source = m[0];
  }

  return source
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|section|tr)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#8212;/g, '—')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Take a bounded slice so the cache stays small and one long book cannot
 * dominate the sample. `slice.after` is a literal string; measurement starts at
 * the first paragraph following it.
 */
function applySlice(text, slice) {
  if (!slice) return text;
  let out = text;
  if (slice.after) {
    const idx = out.indexOf(slice.after);
    if (idx === -1) throw new Error(`slice.after marker not found: ${JSON.stringify(slice.after)}`);
    out = out.slice(idx + slice.after.length);
  }
  if (slice.maxWords) {
    const words = out.split(/(\s+)/);
    let count = 0;
    let i = 0;
    for (; i < words.length && count < slice.maxWords; i++) {
      if (words[i].trim()) count++;
    }
    out = words.slice(0, i).join('');
  }
  return out.trim();
}

/**
 * Rows of a dataset document. Human-authored documents are a single row so
 * callers can treat both kinds uniformly.
 */
function loadRows(doc) {
  const text = loadText(doc);
  if (text === null) return null;
  if (doc.source.type !== 'dataset') {
    return [{ id: doc.id, text, register: doc.register, class: doc.class || 'human', model: null, domain: null }];
  }
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function cachePath(doc) {
  return path.join(CACHE, `${doc.id}.txt`);
}

/** Resolve a document's measured text, from cache or from its local path. */
function loadText(doc) {
  if (doc.source.type === 'local') {
    if (!fs.existsSync(doc.source.path)) return null;
    return applySlice(fs.readFileSync(doc.source.path, 'utf8'), doc.slice);
  }
  const p = cachePath(doc);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

async function fetchDoc(doc, force) {
  if (doc.source.type === 'local') return { id: doc.id, status: 'local' };
  const p = cachePath(doc);
  if (fs.existsSync(p) && !force) return { id: doc.id, status: 'cached' };

  // A dataset entry is a whole sampled collection rather than one document.
  // The sampler is deterministic, so the cached JSONL and its hash are
  // reproducible from the spec recorded in the manifest.
  if (doc.source.type === 'dataset') {
    const builders = { raid: './dataset-raid.js', hc3: './dataset-hc3.js' };
    if (!builders[doc.source.dataset]) throw new Error(`unknown dataset: ${doc.source.dataset}`);
    const { build } = require(builders[doc.source.dataset]);
    const { jsonl, stats } = await build(doc.source.select, (m) => console.error(m));
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(p, jsonl);
    return { id: doc.id, status: 'fetched', sha256: sha256(jsonl), words: null, stats };
  }

  const res = await fetch(doc.source.url, { redirect: 'follow' });
  if (!res.ok) return { id: doc.id, status: `HTTP ${res.status}` };
  let text = await res.text();
  if (doc.source.gutenberg) text = stripGutenberg(text);
  if (doc.source.html) text = htmlToText(text, doc.source.html);
  text = applySlice(text, doc.slice);

  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(p, text);
  return { id: doc.id, status: 'fetched', sha256: sha256(text), words: (text.match(/\S+/g) || []).length };
}

async function cmdFetch(force) {
  const m = readManifest();
  const results = [];
  for (const doc of m.documents) {
    try {
      results.push(await fetchDoc(doc, force));
    } catch (err) {
      results.push({ id: doc.id, status: `error: ${err.message}` });
    }
  }

  // Record hashes for anything newly fetched that has none yet. A recorded
  // hash never changes silently: a mismatch is reported by `verify`, not
  // overwritten here.
  let updated = 0;
  for (const r of results) {
    if (r.status !== 'fetched') continue;
    const doc = m.documents.find((d) => d.id === r.id);
    if (!doc.sha256) {
      doc.sha256 = r.sha256;
      if (r.words != null) doc.words = r.words;
      if (r.stats) doc.stats = r.stats;
      updated++;
    }
  }
  if (updated) writeManifest(m);

  for (const r of results) console.log(`  ${r.status.padEnd(10)} ${r.id}`);
  if (updated) console.log(`\n  recorded ${updated} new hash(es) in corpus/manifest.json`);
  const bad = results.filter((r) => !['cached', 'fetched', 'local'].includes(r.status));
  return bad.length ? 1 : 0;
}

function cmdVerify() {
  const m = readManifest();
  let missing = 0;
  let drift = 0;
  for (const doc of m.documents) {
    const text = loadText(doc);
    if (text === null) {
      console.log(`  MISSING   ${doc.id}${doc.source.type === 'local' ? ` (expected at ${doc.source.path})` : ' (run: node scripts/corpus.js fetch)'}`);
      missing++;
      continue;
    }
    const h = sha256(text);
    if (!doc.sha256) {
      console.log(`  UNHASHED  ${doc.id} → ${h.slice(0, 16)}`);
      continue;
    }
    if (h !== doc.sha256) {
      console.log(`  DRIFT     ${doc.id} recorded ${doc.sha256.slice(0, 16)}, got ${h.slice(0, 16)}`);
      drift++;
    } else {
      console.log(`  ok        ${doc.id}`);
    }
  }
  if (drift) {
    console.error(`\nFAIL — ${drift} document(s) no longer match their recorded hash. The measurement they`);
    console.error('back is not reproducible until this is explained. Do not silently re-record.');
    return 1;
  }
  if (missing) {
    console.error(`\n${missing} document(s) unavailable locally. Measurement will skip them and say so.`);
  }
  return 0;
}

function cmdList() {
  const m = readManifest();
  const byRegister = new Map();
  for (const doc of m.documents) {
    if (!byRegister.has(doc.register)) byRegister.set(doc.register, []);
    byRegister.get(doc.register).push(doc);
  }
  console.log(`\n${m.documents.length} document(s) across ${byRegister.size} register(s)\n`);
  for (const reg of REGISTERS) {
    const docs = byRegister.get(reg);
    if (!docs) continue;
    const words = docs.reduce((s, d) => s + (d.words || 0), 0);
    console.log(`  ${reg}  (${docs.length} docs, ${words.toLocaleString()} words)`);
    for (const d of docs) {
      const avail = loadText(d) === null ? ' [unavailable]' : '';
      console.log(`    ${d.id.padEnd(34)} ${String(d.year || '').padEnd(6)} ${d.source.license}${avail}`);
    }
  }
  const absent = REGISTERS.filter((r) => !byRegister.has(r));
  if (absent.length) console.log(`\n  registers with no coverage yet: ${absent.join(', ')}`);
  console.log('');
  return 0;
}

function cmdAddLocal(args) {
  const [id, filePath] = args;
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? null : args[i + 1];
  };
  if (!id || !filePath) {
    console.error('usage: node scripts/corpus.js add-local <id> <path> --register R --author A --year Y [--title T]');
    return 2;
  }
  const register = opt('register');
  if (!REGISTERS.includes(register)) {
    console.error(`--register must be one of: ${REGISTERS.join(', ')}`);
    return 2;
  }
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.error(`no such file: ${abs}`);
    return 2;
  }
  const text = fs.readFileSync(abs, 'utf8');
  const m = readManifest();
  if (m.documents.some((d) => d.id === id)) {
    console.error(`id already in manifest: ${id}`);
    return 2;
  }
  m.documents.push({
    id,
    title: opt('title') || id,
    author: opt('author') || 'unknown',
    year: opt('year') ? Number(opt('year')) : null,
    register,
    authorship: opt('authorship') || 'human-pre-llm',
    source: { type: 'local', path: abs, license: 'not-redistributed' },
    sha256: sha256(text),
    words: (text.match(/\S+/g) || []).length,
    added: new Date().toISOString().slice(0, 10),
  });
  writeManifest(m);
  console.log(`added ${id} (${(text.match(/\S+/g) || []).length} words). Text stays at ${abs}; only its hash is committed.`);
  return 0;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'fetch': process.exit(await cmdFetch(rest.includes('--force')));
      break;
    case 'verify': process.exit(cmdVerify());
      break;
    case 'list': process.exit(cmdList());
      break;
    case 'add-local': process.exit(cmdAddLocal(rest));
      break;
    default:
      console.error('usage: node scripts/corpus.js <list|fetch|verify|add-local>');
      process.exit(2);
  }
}

if (require.main === module) main();

module.exports = { readManifest, loadText, loadRows, sha256, REGISTERS, AUTHORSHIP, stripGutenberg, htmlToText, applySlice };
