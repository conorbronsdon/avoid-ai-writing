#!/usr/bin/env node
/**
 * Generate the Vale style in `vale/AvoidAIWriting/` from detector/patterns.js.
 *
 * The style is a port of the regex-detectable subset of the detector. It is
 * generated, not hand-written, so the two cannot drift: every token in a rule
 * file comes from PATTERN_TABLES, and the counts in the style's README come from
 * the same manifest.json this script writes. Run `node scripts/build-vale.js`
 * after changing patterns.js and commit the output.
 *
 * Every detector type has a status in STATUS: `verified` (an ungated table,
 * ported token for token), `approximation` (ported, but the detector gates or
 * filters it in ways Vale cannot), `unsupported` (not ported, with the reason),
 * or `unassessed`.
 *
 * Usage: node scripts/build-vale.js [--check]   (--check: fail if output differs)
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const AIDetector = require('../detector/patterns.js');

const ROOT = path.join(__dirname, '..');
const STYLE = 'AvoidAIWriting';
const OUT = path.join(ROOT, 'vale', STYLE);
const CATALOG = 'https://github.com/conorbronsdon/avoid-ai-writing/blob/main/references/patterns.md';
const TABLES = AIDetector.PATTERN_TABLES;
const T = TABLES.types;
const LABELS = AIDetector.TYPE_LABELS;

// Detector severity -> Vale level. Only `error` fails a Vale run, so the
// P0 fingerprints are errors and everything a human might write on purpose
// is a warning or a suggestion that the user can raise in .vale.ini.
const LEVEL = { critical: 'error', high: 'warning', medium: 'suggestion', low: 'suggestion' };

// One existence rule per detector type. Patterns carrying a `gate` are left out.
const EXISTENCE_RULES = [
  { file: 'Transitions', type: 'transition', severity: 'medium' },
  { file: 'ChatbotArtifacts', type: 'chatbot', severity: 'critical' },
  { file: 'Sycophancy', type: 'sycophantic', severity: 'critical' },
  { file: 'Fillers', type: 'filler', severity: 'medium' },
  { file: 'GenericConclusions', type: 'generic-conclusion', severity: 'medium' },
  { file: 'LetsOpeners', type: 'lets-construction', severity: 'medium' },
  { file: 'ReasoningArtifacts', type: 'reasoning-artifact', severity: 'critical' },
  { file: 'SignificanceInflation', type: 'significance-inflation', severity: 'high' },
  { file: 'VagueAttribution', type: 'vague-attribution', severity: 'critical' },
  { file: 'HollowIntensifiers', type: 'hollow-intensifier', severity: 'medium' },
  { file: 'StockReactions', type: 'emotional-flatline', severity: 'low' },
  { file: 'LingeringAttention', type: 'lingering-attention', severity: 'medium' },
  { file: 'NoveltyInflation', type: 'novelty-inflation', severity: 'medium' },
  { file: 'CutoffDisclaimers', type: 'cutoff-disclaimer', severity: 'critical' },
  { file: 'Placeholders', type: 'ai-placeholder', severity: 'critical' },
  { file: 'CitationMarkup', type: 'ai-citation-markup', severity: 'critical' },
  // Vale does not lint URLs in Markdown prose, so this one reads the raw file.
  { file: 'UTMSource', type: 'ai-utm-source', severity: 'critical', scope: 'raw' },
  { file: 'TemplatePhrases', type: 'template-phrase', severity: 'high' },
  { file: 'FalseConcession', type: 'false-concession', severity: 'medium' },
  { file: 'RhetoricalQuestions', type: 'rhetorical-question', severity: 'medium' },
  { file: 'HedgeStack', type: 'hedge-stack', severity: 'high' },
  { file: 'FutureNarrative', type: 'future-narrative', severity: 'high' },
  { file: 'RealActualInflation', type: 'real-actual-inflation', severity: 'medium' },
  { file: 'EngagementBait', type: 'social-cta-closer', severity: 'high' },
  { file: 'PerformedInsight', type: 'performed-insight', severity: 'medium' },
  { file: 'NegationChain', type: 'negation-chain', severity: 'high' },
  { file: 'NegativeParallelism', type: 'negative-parallelism', severity: 'high' },
  { file: 'DevBlogBoilerplate', type: 'dev-blog-boilerplate', severity: 'medium' },
  { file: 'FormulaicOpeners', type: 'formulaic-opener', severity: 'high' },
  { file: 'SpeculativeOpeners', type: 'speculative-opener', severity: 'high' },
  { file: 'LaunchIntros', type: 'launch-intro', severity: 'high' },
  { file: 'CrowdContrast', type: 'crowd-contrast', severity: 'medium' },
  { file: 'FakeCasualProps', type: 'fake-casual-prop', severity: 'high' },
  { file: 'ParentheticalHedges', type: 'parenthetical-hedge', severity: 'medium' },
  { file: 'UnnecessaryHyphenation', type: 'unnecessary-hyphenation', severity: 'medium' },
];

// Status of every detector type. Types with an existence rule above and no
// entry here are `verified`; the test fails if any type is missing.
const STATUS = {
  'tier1': ['approximation', "Vale matches a listed word inside hyphenated and possessive forms (\"non-robust\"). The detector splits tokens on [\\w'-]+ and does not."],
  'tier1-clarity': ['approximation', '`features` is left out: it needs the noun/verb check in `featuresIsNoun`.'],
  'tier2': ['approximation', 'Vale has no per-paragraph distinct-word count. Shipped as `Tier2Vocabulary` at suggestion level, which fires on one word where the detector needs two in a paragraph.'],
  'tier3': ['approximation', 'The detector threshold is max(3, 3% of words). Shipped as `overuse/*` occurrence rules with a fixed max of 2 per document.'],
  'tier3-phrase': ['approximation', 'Density-gated at two uses. Shipped as `boilerplate/*` occurrence rules with max 1 per document.'],
  'negative-parallelism': ['approximation', 'Reveal frames only. A contrast frame counts only when another frame starts within two sentences in the same paragraph, which Vale cannot check.'],
  'unnecessary-hyphenation': ['approximation', 'The detector masks file paths, package names and code identifiers before matching; Vale does not. Computed fixes are not carried.'],
  'confidence-calibration': ['approximation', 'The detector reports each phrase once three or more stack in one text. Shipped as `ConfidenceStacking`, an occurrence rule with the same threshold that gives one alert per file.'],
  'tier3-phrase-cluster': ['unsupported', 'Cluster count over distinct boilerplate phrases.'],
  'em-dash': ['unsupported', 'Per-document density with separator-position exclusions.'],
  'formatting': ['unsupported', 'Composite structural check.'],
  'uniformity': ['unsupported', 'Sentence and paragraph length variance.'],
  'bullet-np-list': ['unsupported', 'Structural check over list items.'],
  'title-case-header': ['unsupported', 'Context-mode dependent.'],
  'hashtag-stuff': ['unsupported', 'Count-based.'],
  'smart-punct-signature': ['unsupported', 'Multi-signal composite, style-only.'],
  'low-ttr': ['unsupported', 'Stylometric.'],
  'punct-distribution': ['unsupported', 'Stylometric.'],
  'fnword-trigram-entropy': ['unsupported', 'Stylometric.'],
  'cross-para-burstiness': ['unsupported', 'Stylometric.'],
  'normalization-flag': ['unsupported', 'Pre-pass over invisible and homoglyph characters, not a prose pattern.'],
};
const STATUSES = ['verified', 'approximation', 'unsupported', 'unassessed'];

// ─── helpers ──────────────────────────────────────────────────────────
function yq(s) { return `'${String(s).replace(/'/g, "''")}'`; }

/**
 * JS RegExp source (a RegExp or a `{ source, flags }` entry) -> source for Vale's
 * regex engine (regexp2: lookarounds and backreferences work; \\u escapes do not).
 * Only `i` carries over, as `ignorecase` or `(?i:...)`; `g` and `m` match the
 * same spans in Vale (see vale/fixtures/cases.json). Any other flag changes
 * what a pattern means, so it stops the build instead of porting silently.
 */
function toGo(re) {
  if (/[^gim]/.test(re.flags)) throw new Error(`cannot port flags '${re.flags}' of /${re.source}/`);
  let src = re.source;
  src = src.replace(/\\u\{([0-9a-fA-F]+)\}/g, '\\x{$1}').replace(/\\u([0-9a-fA-F]{4})/g, '\\x{$1}');
  src = src.replace(/\\\//g, '/');
  return src;
}

/** For rules that set `ignorecase: true` for every token. */
function toGoCaseless(re) {
  if (!re.flags.includes('i')) throw new Error(`case-sensitive /${re.source}/ in a rule that ignores case`);
  return toGo(re);
}

/** The ungated patterns of a type, as RegExps. */
function ruleRegexes(type) {
  const patterns = T[type] && T[type].patterns;
  if (!Array.isArray(patterns)) throw new Error(`${type} has no patterns in PATTERN_TABLES`);
  return patterns.filter((p) => !p.gate).map((p) => new RegExp(p.source, p.flags));
}

function existenceRule(rule) {
  const regs = ruleRegexes(rule.type);
  const allCI = regs.every((r) => r.flags.includes('i'));
  const tokens = [];
  for (const r of regs) {
    const go = toGo(r);
    // Patterns carry their own \b, so no Vale word-boundary wrapping.
    // Mixed case sensitivity inside one rule: scope the flag per token.
    tokens.push(allCI || !r.flags.includes('i') ? go : `(?i:${go})`);
  }
  const level = LEVEL[rule.severity];
  const label = LABELS[rule.type];
  const lines = [
    `# Generated from detector/patterns.js (PATTERN_TABLES.types['${rule.type}']). Do not edit; run scripts/build-vale.js.`,
    `extends: existence`,
    `message: ${yq(`${label}: '%s'.`)}`,
    `link: ${CATALOG}`,
    `level: ${level}`,
    `ignorecase: ${allCI}`,
    `nonword: true`,
    ...(rule.scope ? [`scope: ${rule.scope}`] : []),
    `tokens:`,
    ...tokens.map((t) => `  - ${yq(t)}`),
  ];
  return { yaml: lines.join('\n') + '\n', count: tokens.length };
}

/** Tier 1: a single word table plus phrase regexes, both carrying replacements. */
function tier1Rules() {
  const words = T.tier1.words.map((e) => [e.word, e.replace]);
  const toSwap = (replacement) => {
    // "explore, dig into" -> "explore|dig into" when every part is a real
    // replacement; advice strings ("cut or say something specific") stay whole.
    const parts = replacement.split(/,\s*/);
    const isAdvice = /\[|\bcut\b|\brewrite\b|\bsay\b|\bname\b|\bjust\b/i.test(replacement);
    return isAdvice || parts.some((p) => p.split(' ').length > 3) ? replacement : parts.join('|');
  };
  const wordLines = [
    `# Generated from detector/patterns.js (PATTERN_TABLES.types.tier1.words). Do not edit; run scripts/build-vale.js.`,
    `extends: substitution`,
    `message: ${yq("AI vocabulary: try %s instead of '%s'.")}`,
    `link: ${CATALOG}`,
    `level: ${LEVEL.high}`,
    `ignorecase: true`,
    `swap:`,
    ...words.map(([w, r]) => `  ${yq(w)}: ${yq(toSwap(r))}`),
  ];
  const phrases = [], clarity = [], skipped = [];
  for (const [type, rows] of [['tier1', phrases], ['tier1-clarity', clarity]]) {
    for (const e of T[type].patterns) {
      if (e.gate) { skipped.push([type, e.source]); continue; }
      const go = toGo(e);
      rows.push([e.flags.includes('i') ? go : `(?-i:${go})`, toSwap(e.replace)]);
    }
  }
  const phraseYaml = (name, rows, level, msg) => [
    `# Generated from detector/patterns.js (PATTERN_TABLES.types['${name === 'Tier1Clarity' ? 'tier1-clarity' : 'tier1'}'].patterns). Do not edit; run scripts/build-vale.js.`,
    `extends: substitution`,
    `message: ${yq(msg)}`,
    `link: ${CATALOG}`,
    `level: ${level}`,
    `ignorecase: true`,
    `nonword: true`,
    `swap:`,
    ...rows.map(([k, v]) => `  ${yq(k)}: ${yq(v)}`),
  ].join('\n') + '\n';
  return {
    files: {
      'Tier1Vocabulary.yml': wordLines.join('\n') + '\n',
      'Tier1Phrases.yml': phraseYaml('Tier1Phrases', phrases, LEVEL.high, "AI vocabulary: try %s instead of '%s'."),
      'Tier1Clarity.yml': phraseYaml('Tier1Clarity', clarity, LEVEL.medium, "Wordiness: try %s instead of '%s'."),
    },
    counts: { words: words.length, phrases: phrases.length, clarity: clarity.length },
    skipped,
  };
}

/** Tier 2: approximation. The detector needs two distinct words in one paragraph. */
function tier2Rule() {
  const tokens = T.tier2.words.map((e) => `\\b${e.word}\\b`);
  for (const c of T.tier2.patterns) tokens.push(toGoCaseless(c));
  return [
    `# Generated from detector/patterns.js (PATTERN_TABLES.types.tier2). Do not edit; run scripts/build-vale.js.`,
    `# Approximation: the detector flags these only when two or more distinct`,
    `# Tier 2 words share a paragraph. Vale has no such check, so this fires per word`,
    `# at the lowest level. Raise or disable it in .vale.ini to taste.`,
    `extends: existence`,
    `message: ${yq("Word cluster vocabulary: '%s'. The detector flags this only alongside another Tier 2 word in the same paragraph.")}`,
    `link: ${CATALOG}`,
    `level: suggestion`,
    `ignorecase: true`,
    `nonword: true`,
    `tokens:`,
    ...tokens.map((t) => `  - ${yq(t)}`),
  ].join('\n') + '\n';
}

/** Tier 3 words: one occurrence rule per word, max 2 (the detector flags the third use). */
function occurrenceRules(dir, entries, max, header, msg) {
  const files = {};
  for (const { name, token, source } of entries) {
    files[`${dir}/${name}.yml`] = [
      `# Generated from detector/patterns.js (${source}). Do not edit; run scripts/build-vale.js.`,
      header,
      `extends: occurrence`,
      `message: ${yq(msg)}`,
      `link: ${CATALOG}`,
      `level: suggestion`,
      `ignorecase: true`,
      `scope: summary`,  // whole-document prose; the default `text` scope counts per block
      `max: ${max}`,
      `token: ${yq(token)}`,
    ].join('\n') + '\n';
  }
  return files;
}

function pascal(s) {
  return s.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}

// ─── build ────────────────────────────────────────────────────────────
function build() {
  const files = {};
  const coverage = [];
  const dropped = [];

  for (const rule of EXISTENCE_RULES) {
    const r = existenceRule(rule);
    files[`${rule.file}.yml`] = r.yaml;
    coverage.push({ type: rule.type, rule: `${STYLE}.${rule.file}`, check: 'existence', level: LEVEL[rule.severity], tokens: r.count, note: '' });
  }

  const t1 = tier1Rules();
  Object.assign(files, t1.files);
  coverage.push({ type: 'tier1', rule: `${STYLE}.Tier1Vocabulary`, check: 'substitution', level: LEVEL.high, tokens: t1.counts.words, note: 'single words, with the catalog replacement as the fix' });
  coverage.push({ type: 'tier1', rule: `${STYLE}.Tier1Phrases`, check: 'substitution', level: LEVEL.high, tokens: t1.counts.phrases, note: 'phrase forms' });
  coverage.push({ type: 'tier1-clarity', rule: `${STYLE}.Tier1Clarity`, check: 'substitution', level: LEVEL.medium, tokens: t1.counts.clarity, note: 'wordiness phrases; `features` omitted (needs the noun/verb check)' });
  dropped.push(...t1.skipped);

  files['Tier2Vocabulary.yml'] = tier2Rule();
  coverage.push({ type: 'tier2', rule: `${STYLE}.Tier2Vocabulary`, check: 'existence', level: 'suggestion', tokens: T.tier2.words.length + T.tier2.patterns.length, note: '' });

  const t3 = T.tier3.words.map((w) => ({ name: pascal(w), source: 'PATTERN_TABLES.types.tier3.words', token: `(?<![\\w'-])(?:${w}${w.includes('-') ? `|${w.replace(/-/g, '')}` : ''})(?![\\w'-])` }));
  Object.assign(files, occurrenceRules('overuse', t3, 2,
    `# Approximation: the detector flags a Tier 3 word at max(3, 3% of words) uses. This fires at the third use across the file (headings and code excluded).`,
    "Overused word: this Tier 3 term appears %d times in the file. The detector flags it at three or more uses in a short text."));
  coverage.push({ type: 'tier3', rule: `${STYLE}.overuse.*`, check: 'occurrence', level: 'suggestion', tokens: t3.length, note: 'one rule per word, max 2 per file' });

  const t3p = T['tier3-phrase'].patterns.map((r, i) => ({ name: `Phrase${String(i + 1).padStart(2, '0')}`, source: "PATTERN_TABLES.types['tier3-phrase']", token: toGoCaseless(r) }));
  Object.assign(files, occurrenceRules('boilerplate', t3p, 1,
    `# Approximation: the detector flags a boilerplate phrase at its second use. This does the same across the file (headings and code excluded).`,
    "Boilerplate phrase repeated %d times in the file."));
  coverage.push({ type: 'tier3-phrase', rule: `${STYLE}.boilerplate.*`, check: 'occurrence', level: 'suggestion', tokens: t3p.length, note: 'one rule per phrase, max 1 per file' });

  const conf = T['confidence-calibration'].patterns.map((p) => toGoCaseless(p));
  files['ConfidenceStacking.yml'] = [
    `# Generated from detector/patterns.js (PATTERN_TABLES.types['confidence-calibration']). Do not edit; run scripts/build-vale.js.`,
    `# Approximation: the detector reports each phrase once three or more stack in one text. This fires once at the third.`,
    `extends: occurrence`,
    `message: ${yq('Confidence stacking: %d calibration phrases in the file. The detector flags three or more.')}`,
    `link: ${CATALOG}`,
    `level: ${LEVEL.low}`,
    `ignorecase: true`,
    `scope: summary`,
    `max: 2`,
    `token: ${yq(conf.map((t) => `(?:${t})`).join('|'))}`,
  ].join('\n') + '\n';
  coverage.push({ type: 'confidence-calibration', rule: `${STYLE}.ConfidenceStacking`, check: 'occurrence', level: LEVEL.low, tokens: conf.length, note: 'max 2 per file' });

  // meta + license
  files['meta.json'] = JSON.stringify({
    feed: 'https://github.com/conorbronsdon/avoid-ai-writing/releases.atom',
    vale_version: '>=3.24.0',
    license_files: ['LICENSE'],
  }, null, 2) + '\n';
  files['LICENSE'] = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');

  // Manifest: one entry per detector type. The README counts come from here.
  const rulesOf = (type) => coverage.filter((c) => c.type === type).map((c) => c.rule);
  const types = Object.keys(LABELS).map((type) => {
    const [status, reason] = STATUS[type] || (rulesOf(type).length ? ['verified', ''] : ['unassessed', '']);
    return { type, label: LABELS[type], status, rules: rulesOf(type), reason };
  });
  const counts = Object.fromEntries(STATUSES.map((st) => [st, types.filter((x) => x.status === st).length]));
  const manifest = {
    schemaVersion: TABLES.schemaVersion,
    source: {
      path: 'detector/patterns.js',
      export: 'PATTERN_TABLES',
      // Hash of the exported data, not the file: edits outside the tables
      // leave it, and this style, unchanged.
      sha256: crypto.createHash('sha256').update(JSON.stringify(TABLES)).digest('hex'),
    },
    counts,
    types,
  };
  files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
  for (const c of coverage) {
    if (STATUS[c.type] && STATUS[c.type][0] === 'approximation') c.note = c.note ? `approximation; ${c.note}` : 'approximation';
  }

  // README with the computed coverage table
  const totalTypes = types.length;
  const totalTokens = coverage.reduce((a, c) => a + c.tokens, 0);
  const readme = [
    `# ${STYLE} for Vale`,
    ``,
    `A [Vale](https://vale.sh) style generated from the regex-detectable rules in`,
    `[avoid-ai-writing](https://github.com/conorbronsdon/avoid-ai-writing). It is built by`,
    `\`scripts/build-vale.js\` from \`detector/patterns.js\`, so the tokens here are the detector's`,
    `tokens. Do not edit these files by hand.`,
    ``,
    `## What this is and is not`,
    ``,
    `The detector exposes ${totalTypes} issue types. \`manifest.json\` gives each one a status, and these`,
    `counts come from it: ${counts.verified} verified, ${counts.approximation} approximation, ${counts.unsupported} unsupported, ${counts.unassessed} unassessed.`,
    ``,
    `- **verified**: the detector reports every match of the type's table, with no gating beyond`,
    `  the document-wide masking and de-duplication listed under "How alerts differ", and the rule`,
    `  carries the table's patterns unchanged.`,
    `- **approximation**: ported, but the detector gates or filters the type in a way Vale cannot.`,
    `  The reasons are listed below.`,
    `- **unsupported**: not ported. Structural, stylometric, or gated on counts no built-in Vale`,
    `  check computes; listed below so the gap is visible.`,
    ``,
    `Ported types ship as ${totalTokens} patterns across ${Object.keys(files).filter((f) => f.endsWith('.yml')).length} rule files. \`manifest.json\` also records`,
    `the schema version and a SHA-256 of the exported pattern data this style was built from.`,
    ``,
    `The false-positive rates published for the JS detector were measured on the JS`,
    `detector. They do not transfer to this style until measured on it. See`,
    `\`vale/README.md\` in the repository for the measurement that was run.`,
    ``,
    `## Use`,
    ``,
    `Place the ${STYLE} directory at \`styles/${STYLE}/\` in your project.`,
    `Get it from the [repository](https://github.com/conorbronsdon/avoid-ai-writing/tree/main/vale/${STYLE}).`,
    `This style requires Vale 3.24.0 or newer. Then configure Vale:` ,
    ``,
    '```ini',
    `StylesPath = styles`,
    `MinAlertLevel = suggestion`,
    ``,
    `[*.md]`,
    `BasedOnStyles = ${STYLE}`,
    `# The approximations are suggestions. Turn them off, or raise the ones you want:`,
    `# ${STYLE}.Tier2Vocabulary = NO`,
    `# ${STYLE}.Transitions = warning`,
    '```',
    ``,
    `Levels follow the detector's severity: P0 fingerprints (chatbot artifacts, cutoff`,
    `disclaimers, placeholders) are errors, P1 is a warning, P2 and P3 are suggestions.`,
    ``,
    `## How alerts differ from detector issues`,
    ``,
    `- Overlapping patterns of one type produce one alert. Vale compiles a rule's tokens into a`,
    `  single alternation and reports a region once; the detector lists each matching pattern.`,
    `  This lowers alert counts on stacked tells and never adds an alert.`,
    `- The detector masks blockquotes and double-quoted spans before matching, so quoted`,
    `  examples do not count against a document. Vale skips code and front matter by format,`,
    `  but it does lint quoted prose. The detector reads code, so a tell inside a code block`,
    `  counts there and not here.`,
    `- The detector reports each distinct (type, text) pair once; Vale reports every occurrence.`,
    `- Inside a staged-discovery phrase the detector keeps one finding; Vale also reports any`,
    `  \`StockReactions\` or \`PerformedInsight\` match that the phrase contains.`,
    `- \`UTMSource\` reads the raw file, because Vale skips URLs in Markdown prose. It therefore`,
    `  also fires on a tagged URL inside a code block, as the detector does in its default plain mode.`,
    `- Vale skips HTML comments in Markdown, so a \`<!-- TODO -->\` placeholder does not alert.`,
    `- In Markdown, \`*checks notes*\` is emphasis, so the asterisk forms of \`FakeCasualProps\` only`,
    `  fire in plain text.`,
    `- The detector removes zero-width characters before matching; Vale does not. JavaScript \`\\s\``,
    `  matches a no-break space; Vale's \`\\s\` does not.`,
    `- The detector's context modes (for example \`technical\`, which exempts terms such as \"robust\" and \"leverage\") and its`,
    `  homoglyph normalization pre-pass have no counterpart here.`,
    ``,
    `## Coverage`,
    ``,
    `| Detector type | Rule | Check | Level | Patterns | Note |`,
    `|---|---|---|---|---:|---|`,
    ...coverage.map((c) => `| \`${c.type}\` | \`${c.rule}\` | ${c.check} | ${c.level} | ${c.tokens} | ${c.note} |`),
    ``,
    `## Approximations`,
    ``,
    ...types.filter((x) => x.status === 'approximation').map((x) => `- \`${x.type}\`: ${x.reason}`),
    ``,
    `## Not ported, and why`,
    ``,
    ...types.filter((x) => x.status === 'unsupported').map((x) => `- \`${x.type}\`: ${x.reason}`),
    ...(dropped.length ? [``, `Patterns dropped from otherwise ported types:`, ``, ...dropped.map(([t, s]) => `- \`${t}\`: \`${s.slice(0, 80)}\``)] : []),
    ``,
    `Judgment-only rules (the skill's section C in \`detector/CATEGORIES.md\`) have no`,
    `detector type and are out of scope for any regex port.`,
    ``,
  ].join('\n');
  files['README.md'] = readme;
  return files;
}

function main() {
  const check = process.argv.includes('--check');
  const files = build();
  if (check) {
    let diff = 0;
    for (const [name, content] of Object.entries(files)) {
      const p = path.join(OUT, name);
      if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== content) { console.error(`stale: vale/${STYLE}/${name}`); diff++; }
    }
    if (diff) { console.error(`\n${diff} file(s) out of date. Run: node scripts/build-vale.js`); process.exit(1); }
    console.log('vale style is up to date');
    return;
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(OUT, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  console.log(`wrote ${Object.keys(files).length} files to vale/${STYLE}/`);
}

if (require.main === module) main();
module.exports = { build, toGo, ruleRegexes, EXISTENCE_RULES, STATUS, STATUSES };
