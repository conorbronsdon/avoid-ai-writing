/**
 * Avoid AI Writing — detector fixtures
 *
 * Node-runnable smoke tests for the detection engine. Intentionally small and
 * dependency-free so they run on any `node >= 18` without installing
 * anything. Invoked via `npm run test:detector` and in CI.
 *
 * Failure modes worth catching:
 *   - AI-heavy text scoring as human (regression in pattern coverage)
 *   - Plain prose scoring above "minimal" (false-positive drift)
 *   - Length gates (too-short / too-long) not firing
 *   - Stats failing to sum to issue count (dedup math drift)
 */

const assert = require('node:assert/strict');
const AIDetector = require('./patterns.js');

let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log('Detector fixtures');

test('empty text returns Empty label', () => {
  const r = AIDetector.analyzeText('');
  assert.equal(r.label, 'Empty');
  assert.equal(r.issues.length, 0);
});

test('text under 10 words returns tooShort flag', () => {
  const r = AIDetector.analyzeText('Short unscorable text snippet.');
  assert.equal(r.tooShort, true);
  assert.equal(r.label, 'Too short');
});

test('text over 10k words returns tooLong flag', () => {
  const r = AIDetector.analyzeText('word '.repeat(10001));
  assert.equal(r.tooLong, true);
  assert.equal(r.label, 'Text too long');
});

test('AI-heavy paragraph scores in Strong/Heavy range', () => {
  const text = [
    "In today's ever-evolving landscape, we delve into the intricate",
    'tapestry of innovation. This seamless, robust paradigm showcases a',
    'comprehensive framework. Moreover, it truly is a game-changer.',
    'Furthermore, this pivotal moment underscores how we navigate the',
    'complexities of modern AI.',
  ].join(' ');
  const r = AIDetector.analyzeText(text);
  assert.ok(r.score >= 60, `expected score ≥60, got ${r.score}`);
  assert.ok(['Strong AI signals', 'Heavy AI patterns'].includes(r.label), `got label: ${r.label}`);
});

test('plain human bug-report prose stays in Minimal range', () => {
  const text = [
    'The build broke again this morning. Rolled back the auth refactor',
    'and tests pass now. Still need to figure out why the token refresh',
    'path hits a 401 for users on Safari but not Firefox — probably a',
    'cookie scope issue but I want to confirm before shipping a fix.',
  ].join(' ');
  const r = AIDetector.analyzeText(text);
  assert.ok(r.score <= 20, `expected score ≤20, got ${r.score}`);
});

test('stats fields sum to issues length', () => {
  const text = [
    "In today's landscape of innovation, we leverage seamless paradigms",
    'to harness the power of transformation. It is important to note',
    'that experts believe this is pivotal. Let me think step by step.',
  ].join(' ');
  const r = AIDetector.analyzeText(text);
  const sum = r.stats.tier1Count + r.stats.tier2Count + r.stats.tier3Count + r.stats.patternCount;
  assert.equal(sum, r.issues.length, `stats sum (${sum}) != issues (${r.issues.length})`);
});

test('#123: rendered Markdown ignores frontmatter and multiline HTML comments', () => {
  const prose = [
    'A clerk opened the file before sunrise. The names filled three pages.',
    'He read them twice, signed the order, and passed it down the corridor.',
  ].join(' ');
  const comment = [
    '<!-- ARCHITECTURE',
    'Furthermore, this is a load-bearing transition. Add comprehensive and pivotal context here.',
    '-->',
    prose,
  ].join('\n');
  const frontmatter = [
    '---',
    'title: Draft',
    'description: A comprehensive and pivotal exploration of a robust ecosystem',
    '---',
    prose,
  ].join('\n');
  const baseline = AIDetector.analyzeText(prose);

  for (const [name, text, expected] of [
    ['comment', comment, { maskedFrontmatter: 0, maskedHtmlComments: 1 }],
    ['frontmatter', frontmatter, { maskedFrontmatter: 1, maskedHtmlComments: 0 }],
  ]) {
    const plain = AIDetector.analyzeText(text);
    const rendered = AIDetector.analyzeText(text, { sourceMode: 'rendered-markdown' });

    assert.ok(plain.score > baseline.score, `${name}: plain mode must keep inspecting source text`);
    assert.equal(rendered.score, baseline.score, `${name}: rendered score must match visible prose`);
    assert.deepEqual(
      rendered.issues.map((issue) => [issue.type, issue.text]),
      baseline.issues.map((issue) => [issue.type, issue.text]),
      `${name}: rendered findings must match visible prose`,
    );
    assert.equal(rendered.stats.sourceMode, 'rendered-markdown');
    assert.equal(rendered.stats.maskedFrontmatter, expected.maskedFrontmatter);
    assert.equal(rendered.stats.maskedHtmlComments, expected.maskedHtmlComments);
  }
});

test('#123: same-line and unclosed HTML comments are source-only', () => {
  const prose = [
    'The carpenter measured the door twice before cutting the oak board.',
    'He shaved one edge, reset the hinges, and checked the latch again.',
  ].join(' ');
  const hidden = 'Moreover, this seamless and robust paradigm is a testament to progress.';
  const baseline = AIDetector.analyzeText(prose);

  for (const [name, text] of [
    ['same-line', `${prose}\n<!-- ${hidden} -->`],
    ['unclosed', `${prose}\n<!-- ${hidden}`],
  ]) {
    const rendered = AIDetector.analyzeText(text, { sourceMode: 'rendered-markdown' });
    assert.equal(rendered.score, baseline.score, `${name}: hidden text must not affect the score`);
    assert.equal(rendered.stats.maskedHtmlComments, 1);
    assert.equal(rendered.issues.some((issue) => /seamless|robust|testament/i.test(issue.text || '')), false);
  }
});

test('#123: comment markers inside fenced and inline code remain visible', () => {
  const prose = 'Moreover, the editor checked the original document before changing the published account for the morning edition.';
  const cases = [
    ['fenced-unclosed', ['```html', '<!-- example marker stays open', '```', prose].join('\n')],
    ['inline-unclosed', `The guide shows \`<!-- example marker\` in code before the sample. ${prose}`],
    ['inline-closed', `The guide shows \`<!-- example -->\` in code before the sample. ${prose}`],
  ];

  for (const [name, text] of cases) {
    const result = AIDetector.analyzeText(text, { sourceMode: 'rendered-markdown' });
    assert.notEqual(result.label, 'Too short', `${name}: code must not hide later prose`);
    assert.equal(result.stats.maskedHtmlComments, 0, `${name}: code markers are not comments`);
    assert.ok(result.issues.some((issue) => issue.type === 'transition'), `${name}: later prose must be analyzed`);
  }
});

test('#123: comment markers in top-level indented code remain visible', () => {
  const text = [
    '    <!-- seamless robust pivotal -->',
    '',
    'Moreover, the editor checked the original document before changing the published account for the morning edition.',
  ].join('\n');
  const result = AIDetector.analyzeText(text, { sourceMode: 'rendered-markdown' });

  assert.equal(result.stats.maskedHtmlComments, 0, 'an indented code marker is not an HTML comment');
  assert.deepEqual(
    result.issues.filter((issue) => issue.type === 'tier1').map((issue) => issue.text),
    ['seamless', 'robust', 'pivotal'],
    'reader-visible indented code must still be analyzed',
  );
  assert.ok(result.issues.some((issue) => issue.type === 'transition' && issue.text === 'Moreover'));
});

test('#123: an indented HTML comment under a list item stays hidden', () => {
  const text = [
    '- Keep this item.',
    '',
    '    <!-- seamless robust pivotal -->',
    '',
    'Moreover, the editor checked the original document before changing the published account for the morning edition.',
  ].join('\n');
  const result = AIDetector.analyzeText(text, { sourceMode: 'rendered-markdown' });

  assert.equal(result.stats.maskedHtmlComments, 1);
  assert.equal(result.issues.some((issue) => /seamless|robust|pivotal/i.test(issue.text || '')), false);
  assert.ok(result.issues.some((issue) => issue.type === 'transition' && issue.text === 'Moreover'));
});

test('#123: list syntax inside a comment cannot hide later indented code', () => {
  const text = [
    '<!--',
    '- hidden list item',
    '  hidden continuation -->',
    '',
    '    <!-- seamless robust pivotal -->',
    '',
    'Moreover, the editor checked the original document before changing the published account for the morning edition.',
  ].join('\n');
  const result = AIDetector.analyzeText(text, { sourceMode: 'rendered-markdown' });

  assert.equal(result.stats.maskedHtmlComments, 1, 'the indented code marker is not a real comment');
  assert.deepEqual(
    result.issues.filter((issue) => issue.type === 'tier1').map((issue) => issue.text),
    ['seamless', 'robust', 'pivotal'],
  );
  assert.ok(result.issues.some((issue) => issue.type === 'transition' && issue.text === 'Moreover'));
});

test('#123: backticks inside an HTML comment do not protect its closing delimiter', () => {
  const commentPrefix = '<!-- plan `-->';
  const prose = 'Moreover, the editor checked the original document before changing the published account for the morning edition.';
  const visibleText = `\` Furthermore, seamless robust and pivotal notes stay hidden -->\n${prose}`;
  const baseline = AIDetector.analyzeText(visibleText);
  const source = commentPrefix + visibleText;
  const result = AIDetector.analyzeText(source, { sourceMode: 'rendered-markdown' });

  assert.equal(result.stats.maskedHtmlComments, 1);
  assert.equal(result.score, 19, 'all reader-visible findings must contribute to the rendered score');
  assert.equal(result.score, baseline.score, 'the first literal --> must close the comment');
  assert.ok(result.issues.some((issue) => issue.type === 'transition' && issue.text === 'Furthermore'));
  assert.deepEqual(
    result.issues.filter((issue) => issue.type === 'tier1').map((issue) => issue.text),
    ['seamless', 'robust', 'pivotal'],
  );
  assert.deepEqual(
    result.issues.map((issue) => [issue.type, issue.text]),
    baseline.issues.map((issue) => [issue.type, issue.text]),
  );
  assert.deepEqual(
    result.issues.filter((issue) => Number.isInteger(issue.index)).map((issue) => issue.index),
    baseline.issues
      .filter((issue) => Number.isInteger(issue.index))
      .map((issue) => issue.index + commentPrefix.length),
  );
  for (const issue of result.issues.filter((candidate) => Number.isInteger(candidate.index))) {
    assert.equal(issue.index, source.indexOf(issue.text), `${issue.text}: source offset must survive masking`);
  }
});

test('#123: code delimiters in one comment cannot hide a later comment', () => {
  const prose = 'Moreover, the editor checked the original document before changing the published account for the morning edition.';
  const hidden = 'Furthermore, this seamless robust paradigm is a testament to progress.';
  const text = ['<!--', '```', '-->', prose, `<!-- ${hidden} -->`].join('\n');
  const result = AIDetector.analyzeText(text, { sourceMode: 'rendered-markdown' });

  assert.equal(result.stats.maskedHtmlComments, 2);
  assert.equal(result.issues.some((issue) => /seamless|robust|paradigm|testament/i.test(issue.text || '')), false);
  assert.ok(result.issues.some((issue) => issue.type === 'transition'), 'visible prose must still fire');
});

test('#123: short HTML comments close at an overlapping delimiter', () => {
  const prose = 'Moreover, the editor checked the original document before changing the published account for the morning edition.';

  for (const comment of ['<!-->', '<!--->']) {
    const result = AIDetector.analyzeText(`${comment}\n${prose}`, { sourceMode: 'rendered-markdown' });
    assert.equal(result.stats.maskedHtmlComments, 1);
    assert.notEqual(result.label, 'Too short', `${comment}: later prose must remain visible`);
    assert.equal(result.issues.find((issue) => issue.type === 'transition').index, comment.length + 1);
  }
});

test('#123: rendered Markdown preserves issue offsets after masked source', () => {
  const sourceOnly = '<!-- This seamless, robust paradigm should stay hidden. -->\r\n';
  const prose = 'Moreover, the editor checked the original document before changing the published account for the morning edition.';
  const result = AIDetector.analyzeText(sourceOnly + prose, { sourceMode: 'rendered-markdown' });
  const transition = result.issues.find((issue) => issue.type === 'transition');

  assert.ok(transition, 'reader-facing prose should still be analyzed');
  assert.equal(transition.index, sourceOnly.length);
  assert.equal(result.highlight_sentence_for_ai[0].start, sourceOnly.length);
  assert.equal(result.highlight_sentence_for_ai[0].end, sourceOnly.length + prose.length);
});

test('#123: multiline blockquote masking preserves later source offsets', () => {
  const quote = '> This seamless landscape is a testament to progress.\r\n> Moreover, it is a robust paradigm.\r\n';
  const prose = 'Moreover, the editor checked the original document before changing the published account for the morning edition.';
  const result = AIDetector.analyzeText(quote + prose, { sourceMode: 'rendered-markdown' });
  const transition = result.issues.find((issue) => issue.type === 'transition');

  assert.ok(transition, 'reader-facing prose after the quote should still be analyzed');
  assert.equal(transition.index, quote.length);
  assert.equal(result.highlight_sentence_for_ai[0].start, quote.length);
  assert.equal(result.highlight_sentence_for_ai[0].end, quote.length + prose.length);
  assert.equal(result.stats.quotedLines, 2);
});

test('#123: plain mode preserves legacy blockquote paragraph scoring', () => {
  const text = [
    'We harness practical tools for ordinary work each morning.',
    '> This quoted material should not count against the author.',
    '> It contains another quoted line for the detector.',
    'We navigate routine problems with care before the daily review.',
  ].join('\n');
  const result = AIDetector.analyzeText(text);

  assert.equal(result.score, 6);
  assert.deepEqual(
    result.issues.filter((issue) => issue.type === 'tier2').map((issue) => issue.text),
    ['harness', 'navigate'],
  );
  assert.equal(result.stats.quotedLines, 2);

  const leadingWhitespace = '\n\nMoreover, the editor checked the original document before changing the published account for the morning edition.';
  assert.equal(
    AIDetector.analyzeText(leadingWhitespace).highlight_sentence_for_ai[0].start,
    0,
    'plain-mode highlight boundaries must retain their legacy shape',
  );
});

test('#123: rendered Markdown recognizes blank-first-line and CR-only frontmatter', () => {
  const prose = 'Moreover, the editor checked the original document before changing the published account for the morning edition.';
  const baseline = AIDetector.analyzeText(prose);
  const cases = [
    ['blank-first-line', ['---', '', 'title: Draft', 'description: A comprehensive and pivotal exploration', '---', ''].join('\n')],
    ['CR-only', ['---', '', 'title: Draft', 'description: A comprehensive and pivotal exploration', '---', ''].join('\r')],
  ];

  for (const [name, sourceOnly] of cases) {
    const result = AIDetector.analyzeText(sourceOnly + prose, { sourceMode: 'rendered-markdown' });
    assert.equal(result.stats.maskedFrontmatter, 1, `${name}: frontmatter must be masked`);
    assert.equal(result.score, baseline.score, `${name}: metadata must not affect the score`);
    const transition = result.issues.find((issue) => issue.type === 'transition');
    assert.ok(transition, `${name}: visible prose must still be analyzed`);
    assert.equal(transition.index, sourceOnly.length);
    assert.equal(result.highlight_sentence_for_ai[0].start, sourceOnly.length);
  }
});

test('#123: rendered Markdown does not mistake a thematic break for frontmatter', () => {
  for (const text of [
    ['---', '', 'Moreover, the team described a seamless and robust landscape in the final report.', '', '---'].join('\n'),
    ['---', 'Moreover, the team described a seamless and robust landscape in the final report.', '---'].join('\n'),
  ]) {
    const result = AIDetector.analyzeText(text, { sourceMode: 'rendered-markdown' });
    assert.equal(result.stats.maskedFrontmatter, 0);
    assert.ok(result.issues.length > 0, 'prose between thematic breaks should remain visible');
  }
});

test('#123: unknown source modes fall back visibly to plain', () => {
  const text = '<!-- Moreover, this seamless and robust paradigm is hidden. -->\nVisible prose has enough words for the detector to score this input normally.';
  const result = AIDetector.analyzeText(text, { sourceMode: 'rendered-markdonw' });

  assert.equal(result.stats.sourceMode, 'plain');
  assert.equal(result.stats.sourceModeFallback, 'rendered-markdonw');
  assert.equal(result.stats.maskedHtmlComments, 0);
  assert.ok(result.issues.length > 0, 'fallback must retain plain-mode behavior');

  for (const requested of ['', false, 0, null]) {
    const fallback = AIDetector.analyzeText(text, { sourceMode: requested });
    assert.equal(fallback.stats.sourceMode, 'plain');
    assert.equal(fallback.stats.sourceModeFallback, requested);
  }

  const omitted = AIDetector.analyzeText(text);
  assert.equal(omitted.stats.sourceModeFallback, undefined);
});

test('repeated Tier 1 phrase does not inflate score linearly', () => {
  const single = AIDetector.analyzeText('We delve into the landscape of many things today.');
  const fivefold = AIDetector.analyzeText(
    'We delve into the landscape. We delve into the landscape. We delve into the landscape. We delve into the landscape. We delve into the landscape of things.'
  );
  assert.ok(
    fivefold.score <= single.score + 20,
    `repeated phrase should not 5× the score (single=${single.score}, fivefold=${fivefold.score})`
  );
});

test('em-dash detector skips definition-list separators (bold term / link + dash)', () => {
  const text = [
    '- **Detect mode** — flag patterns without rewriting anything in the file.',
    '- **Edit mode** — rewrite the file in place and report what changed.',
    '- [agentskills.io](https://agentskills.io) — the SKILL.md format this repo follows.',
    'The catalog lives in one file and a CI check keeps the README count honest.',
  ].join('\n');
  const r = AIDetector.analyzeText(text);
  const emDashIssues = r.issues.filter((i) => i.type === 'em-dash');
  assert.equal(emDashIssues.length, 0, 'separator-position dashes should not count toward the rate');
});

test('em-dash carve-out covers numbered-list separators too', () => {
  const text = [
    '1. **Install** — run the setup script from the repo root.',
    '2. **Configure** — copy the sample config and set the API token.',
    '3. **Verify** — the status command reports green when everything works.',
    '4) **Cleanup** — remove the temp files once the run finishes.',
    'The whole flow takes about two minutes on a fresh machine.',
  ].join('\n');
  const r = AIDetector.analyzeText(text);
  const emDashIssues = r.issues.filter((i) => i.type === 'em-dash');
  assert.equal(emDashIssues.length, 0, 'numbered-list separators should not count toward the rate');
});

test('em-dash carve-out covers a bold lead term with a parenthetical (#67)', () => {
  // Found by the self-scan: the bare `- **Term** —` form was carved out but
  // `- **Term** (`slug`) —` was not, though it is the same definition
  // typography. 1 of the 84 counted dashes in CHANGELOG.md was this shape.
  const text = [
    '- **Lingering-attention claims** (`lingering-attention`) — the share-post frame.',
    '- **Narrated candor** (judgment-only) — announcing your disclosure instead of disclosing.',
    'Both rules landed in the same release and share a severity tier.',
  ].join('\n');
  const r = AIDetector.analyzeText(text);
  assert.equal(r.issues.filter((i) => i.type === 'em-dash').length, 0);
});

test('em-dash carve-out covers Keep-a-Changelog version headings (#67)', () => {
  // `## [3.21.0] — 2026-07-30` joins a label to a value exactly as a list
  // separator does. 32 of the 84 counted dashes in CHANGELOG.md were these.
  const body = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ') + '.';
  const text = `## [3.21.0] — 2026-07-30\n\n${body}\n\n## [3.20.0] — 2026-07-29\n\n${body}`;
  const r = AIDetector.analyzeText(text);
  assert.equal(r.issues.filter((i) => i.type === 'em-dash').length, 0);
});

test('em-dash carve-out stays narrow — prose dashes in a heading still fire (#67)', () => {
  const text = [
    '## Why this matters — and why it did not before now',
    'Short text — with several — prose dashes — packed into it here today.',
  ].join('\n');
  const r = AIDetector.analyzeText(text);
  assert.ok(r.issues.filter((i) => i.type === 'em-dash').length >= 1);
});

test('hedge-stack does not fire on ordinary negation or inverted questions (#69)', () => {
  // Measured on the human-control corpus: 3 of 4 hedge-stack flags were this
  // over-match. The old pattern allowed two words between modal and adverb.
  const frame = (s) => `The committee reviewed the proposal at length and concluded that it ${s} work as designed, given every constraint documented during the previous quarter.`;
  for (const phrase of ['could not possibly', 'could never possibly', 'could a savage possibly', 'might a person conceivably']) {
    const r = AIDetector.analyzeText(frame(phrase));
    assert.equal(r.issues.filter((i) => i.type === 'hedge-stack').length, 0, `"${phrase}" should not fire`);
  }
  for (const phrase of ['could potentially', 'may eventually unlock', 'might ultimately transform']) {
    const r = AIDetector.analyzeText(frame(phrase));
    assert.ok(r.issues.filter((i) => i.type === 'hedge-stack').length >= 1, `"${phrase}" should still fire`);
  }
});

test('em-dash carve-out requires a list marker — line-initial bold splices still fire', () => {
  const text = [
    '**The architecture** — it scales horizontally without coordination.',
    '**The cache layer** — it absorbs the read traffic before it hits disk.',
    '**The result** — latency drops and throughput climbs on every node.',
  ].join('\n');
  const r = AIDetector.analyzeText(text);
  const emDashIssues = r.issues.filter((i) => i.type === 'em-dash');
  assert.ok(emDashIssues.length >= 1, 'bold-lead splices outside a list should still count');
});

test('smart-punct signature is not corroborated by separator-only em dashes', () => {
  // Curly quotes + Oxford commas + zero typos + ≥80 words, but every em
  // dash is a list-item separator. Before the carve-out this fired on
  // the dash-as-typography; now the em-dash leg of the co-occurrence
  // requires a non-separator dash.
  const text = [
    '- **Detect mode** — flags “possible issues” without rewriting, so you can review, compare, and decide.',
    '- **Edit mode** — rewrites the file in place and keeps the original wording where it already reads fine.',
    '- **Voice profiles** — casual, professional, and technical presets tune how hard each rule is enforced.',
    'The catalog lives in one file, the CI check keeps the README count honest, and the plugin copy is generated from the root skill so the two can never drift apart in a release.',
  ].join('\n');
  const r = AIDetector.analyzeText(text);
  const hits = r.issues.filter((i) => i.type === 'smart-punct-signature');
  assert.equal(hits.length, 0, 'separator-only dashes should not complete the co-occurrence signature');
});

test('em-dash detector still fires on mid-sentence splices at the same density', () => {
  const text =
    'The build is fast — under a second — on most machines. The cache helps — especially on cold starts. Deploys run on push — no manual step — and roll back automatically.';
  const r = AIDetector.analyzeText(text);
  const emDashIssues = r.issues.filter((i) => i.type === 'em-dash');
  assert.ok(emDashIssues.length >= 1, 'prose splices should still flag');
});

test('em-dash detector ignores CLI flags like --save-dev', () => {
  const text = 'Run npm install --save-dev and then npm run build --no-verify --silent. Takes about ten seconds on this machine. The package is installed into node_modules directly after the install command completes successfully.';
  const r = AIDetector.analyzeText(text);
  const emDashIssues = r.issues.filter((i) => i.type === 'em-dash');
  assert.equal(emDashIssues.length, 0, 'CLI flags should not count as em dashes');
});

test('chatbot artifacts score as P0 critical', () => {
  const text = "I hope this helps! Let me know if you need anything else. Great question! Feel free to reach out.";
  const r = AIDetector.analyzeText(text);
  const chatbotIssues = r.issues.filter((i) => i.type === 'chatbot');
  assert.ok(chatbotIssues.length >= 2, `expected chatbot detections, got ${chatbotIssues.length}`);
  assert.equal(AIDetector.SEVERITY_LABELS[chatbotIssues[0].severity], 'P0');
});

test('crypto-shill social post with hashtag block + bullet-NP lists flags', () => {
  // Reported 2026-05-16 as a "skipped" detection. Avoids every Tier 1
  // word ("delve", "robust", "leverage") and substitutes synonyms the
  // wordlist misses, but stacks structural signals: 6-item bullet-NP
  // list, 15-tag hashtag block, "may become one of the most important
  // narratives" future-narrative template, "could potentially" hedge
  // stack, and ten distinct crypto-shill boilerplate phrases.
  const text = `The future of decentralized computational infrastructure is evolving rapidly as blockchain-integrated mining ecosystems continue to merge with artificial intelligence, distributed compute, and tokenized incentive structures.

MineBench represents an interesting example of this emerging sector by combining benchmark-based mining participation, token rewards, and scalable network contribution models into a unified ecosystem designed for long-term sustainability and user engagement.

After several hours of testing, the platform demonstrated:

* Stable mining efficiency
* Reliable pool connectivity
* Optimized RandomX computational performance
* Low failed share rates
* Effective hardware utilization
* Consistent thermal stability

The integration of reward-based participation mechanisms alongside decentralized infrastructure concepts could potentially create new opportunities for community-driven computational networks.

The intersection of AI, DePIN, mining infrastructure, and decentralized compute may become one of the most important narratives of the next market cycle.

#AI #Crypto #Blockchain #DePIN #Mining #Web3 #Solana #RandomX #DecentralizedAI #PassiveIncome #Infrastructure #Innovation #Technology #FutureTech #Tokenomics`;
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('bullet-np-list'), 'expected bullet-np-list flag');
  assert.ok(types.has('hashtag-stuff'), 'expected hashtag-stuff flag');
  assert.ok(types.has('future-narrative'), 'expected future-narrative flag');
  assert.ok(types.has('hedge-stack'), 'expected hedge-stack flag');
  assert.ok(types.has('tier3-phrase-cluster'), 'expected tier3-phrase-cluster flag');
  assert.ok(r.score >= 25, `expected score ≥25 (Some/Moderate), got ${r.score}`);
});

test('"Interesting part of the project:" header opener flags emotional-flatline', () => {
  // The canonical AI list-intro pattern matched "the most interesting
  // part" but missed the bare "Interesting part of X:" section-header
  // form. v3.4 covers both shapes.
  const text = '\nInteresting part of the project:\nSome content follows that talks about the real on-chain tokenomics of the system at length.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('emotional-flatline'), 'expected emotional-flatline flag');
});

test('"the line I keep coming back to" flags lingering-attention', () => {
  const text = 'Recorded with a guest yesterday. The line I keep coming back to is that agents behave like teenagers on an unbounded goal.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('lingering-attention'), 'expected lingering-attention flag');
});

test('"I cannot stop thinking about" flags lingering-attention', () => {
  const text = "I can't stop thinking about the runtime guardrail argument he made near the end of our conversation about agent drift.";
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('lingering-attention'), 'expected lingering-attention flag');
});

test('bare "I keep coming back to X because ..." does NOT flag lingering-attention', () => {
  // Precision carve-out: the bare verb phrase with a reason attached is
  // legitimate analytical writing, so only the noun-anchored frame fires.
  const text = 'I keep coming back to the exit-voice framing because it predicts which engineers quit and which ones file the RFC instead.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(!types.has('lingering-attention'), 'bare reasoned form must not flag');
});

test('"real on-chain tokenomics" flags real-actual-inflation', () => {
  const text = 'The team is researching real on-chain tokenomics and actual reward sustainability versus electricity cost across the network deployment phase.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('real-actual-inflation'), 'expected real-actual-inflation flag');
});

test('hashtag-stuff does not fire on prose with 2-3 hashtags', () => {
  const text = 'Shipped the new build last night. Catching bugs faster with the new instrumentation. Notes are in the doc, and the next push lands tomorrow. #buildinpublic #devlog';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(!types.has('hashtag-stuff'), 'should not flag 2 hashtags as hashtag-stuff');
});

test('"load-bearing" (metaphor) flags tier1; construction nouns exempt', () => {
  // Every fixture is padded past the wordCount < 10 gate in analyzeText, which
  // returns zero issues before any pattern runs. A shorter fixture asserts
  // nothing: it would pass with the carve-out deleted entirely.
  const lbHits = (text) => {
    const r = AIDetector.analyzeText(text);
    assert.ok(!r.tooShort, `fixture must clear the length gate (wordCount >= 10): ${text}`);
    return { hits: r.issues.filter((i) => /load[- ]bearing/i.test(i.text)), types: new Set(r.issues.map((i) => i.type)) };
  };

  const metaphors = [
    'The load-bearing assumption here is that users will migrate to the platform voluntarily.',
    'That load-bearing claim never gets defended anywhere in the entire twelve page document.',
    'The whole load-bearing invariant rests on a cache that nobody has actually measured.',
    // Abstract-capable nouns are deliberately absent from the carve-out so the
    // metaphor still fires on them.
    'The load-bearing structure of his argument collapses once you check the second citation.',
  ];
  for (const text of metaphors) {
    const { hits, types } = lbHits(text);
    assert.ok(types.has('tier1'), `expected tier1 flag for metaphor: ${text}`);
    assert.ok(hits.length > 0, `expected a load-bearing tier1 hit: ${text}`);
  }

  // One fixture per carve-out noun: dropping any single noun from the lookahead
  // must fail this test. Previously only `wall` was pinned.
  const literals = [
    'Install a load-bearing wall between the kitchen and the garage today.',
    'The steel load-bearing beam spans twelve feet across the finished basement ceiling.',
    'The concrete load-bearing column in the parking garage was inspected last week.',
    'Every load-bearing joist under the second floor was replaced during the remodel.',
    'The roof load-bearing truss was engineered to handle heavy snow load safely.',
    'These load-bearing trusses were installed by the framing crew earlier this spring.',
    'Each load-bearing member of the frame must meet the local building code.',
    'The load-bearing footing was poured before the inspector arrived on site Monday.',
    'The load-bearing slab under the garage cracked during the cold winter months.',
    'The load-bearing stud spacing must comply with local residential building code requirements.',
    'The old load-bearing partition was replaced with a steel beam last summer.',
    'The load-bearing masonry needs repair before the inspector will sign off here.',
    'The load-bearing lintel above the window was cracked and needed full replacement.',
    'Each load-bearing pier under the deck was set below the frost line.',
    'The load-bearing rafter was replaced after the storm damaged the roof badly.',
    'The load-bearing girder running under the floor was inspected and approved today.',
    'The engineer calculated the load-bearing capacity of the floor before approving the plan.',
    // Optional adjective between `load-bearing` and the structural noun.
    'The crew removed a load-bearing structural wall during the kitchen renovation project.',
    'They reinforced the load-bearing exterior wall before pouring the new concrete footing.',
    // Unhyphenated "load bearing" is ordinary English: `bearing` as a
    // participle, not a compound modifier. The tell is always hyphenated.
    'The heavy load bearing down on the old bridge finally cracked the concrete support.',
    'Engineers reduced the load bearing on the rear axle by shifting the cargo forward.',
    'You could feel the load bearing down on the whole team that entire quarter.',
  ];
  for (const text of literals) {
    const { hits } = lbHits(text);
    assert.equal(hits.length, 0, `literal construction use should not fire tier1: ${text}`);
  }
});

test('#107: deterministic unnecessary hyphenation subclasses fire with fixes', () => {
  const cases = [
    ['The team built a research-impact aggregator for the annual reporting workflow.', 'research-impact aggregator', 'research impact aggregator'],
    ['The report summarizes two research-impact aggregations from the external evaluation teams.', 'research-impact aggregations', 'research impact aggregations'],
    ['We agreed on a data-source strategy before rebuilding the ingestion pipeline.', 'data-source strategy', 'data source strategy'],
    ['The guide compares Python-package usage across the supported deployment environments.', 'Python-package usage', 'Python package usage'],
    ['The guide also compares Rust-crate usage across the supported deployment environments.', 'Rust-crate usage', 'Rust crate usage'],
    ['The repository keeps a single-Project Manifest for every supported deployment environment.', 'single-Project Manifest', 'single Project Manifest'],
    ['The audit records a total-downloads figure for every published package each month.', 'total-downloads figure', 'total downloads figure'],
    ['The dashboard reports a life-sciences-native citation count beside each indexed article.', 'life-sciences-native citation count', 'citation count from a life sciences source'],
    ['The old code-base still powers the internal dashboard used by the support team.', 'code-base', 'codebase'],
    ['- Migration note\n    The old code-base remains available while customers finish moving their applications.', 'code-base', 'codebase'],
    ['The old data-set still feeds the internal dashboard used by the support team.', 'data-set', 'dataset'],
    ['The published time-frame leaves enough room for another review before launch.', 'time-frame', 'timeframe'],
    ['The product road-map lists every migration milestone planned for the next quarter.', 'road-map', 'roadmap'],
    ['The service refreshes the dashboard in real-time, even during the nightly import.', 'in real-time', 'in real time'],
    ['The service refreshes the dashboard in real-time every day during the nightly import.', 'in real-time', 'in real time'],
    ['The service refreshes the dashboard in real-time continuously during the nightly import.', 'in real-time', 'in real time'],
    ['The service refreshes the dashboard in real-time as new records arrive for processing.', 'in real-time', 'in real time'],
    ['The service refreshes the dashboard in real-time via the existing event stream.', 'in real-time', 'in real time'],
    ['The current release works out-of-the-box on every operating system we support.', 'works out-of-the-box', 'works out of the box'],
    ['That shortcut creates maintenance problems over the long-term, despite its early convenience.', 'over the long-term', 'over the long term'],
    ['That shortcut creates maintenance problems over the long-term across every department.', 'over the long-term', 'over the long term'],
    ['That shortcut creates maintenance problems over the long-term through deferred upgrades.', 'over the long-term', 'over the long term'],
    ['The team plans to keep this compatibility layer for the long-term by design.', 'for the long-term', 'for the long term'],
  ];

  for (const [text, matched, suggestion] of cases) {
    const result = AIDetector.analyzeText(text);
    const hits = result.issues.filter((issue) => issue.type === 'unnecessary-hyphenation');
    assert.equal(hits.length, 1, `expected one unnecessary-hyphenation hit: ${text}`);
    assert.equal(hits[0].text, matched, `unexpected matched text: ${text}`);
    assert.equal(hits[0].suggestion, suggestion, `unexpected suggestion: ${text}`);
    assert.equal(hits[0].severity, 'medium', `hyphenation cleanup should be P2: ${text}`);
  }
});

test('#107: standard compound modifiers and open forms do not fire', () => {
  const clean = [
    'The team ships high-quality reports through a well-tested release process every week.',
    'The highly-skilled editor reviewed the draft before the scheduled publication date.',
    'A family-owned consultancy maintains the third-party integration for our regional offices.',
    'The real-time dashboard shows a field-normalized score from the open-access dataset.',
    'The service publishes changes in real-time monthly reports for each customer account.',
    'The service publishes changes in real-time supply chain analytics for each customer.',
    'The long-term plan includes out-of-the-box support for server-side rendering.',
    'The system improved over the long-term planning horizon measured by the research team.',
    'The report compares results in real-time and historical dashboards for each customer.',
    'The report compares performance over the long-term and short-term planning horizons.',
    'The codebase stores each dataset and roadmap in the same project workspace.',
    'We agreed on a data source strategy before rebuilding the ingestion pipeline.',
  ];

  for (const text of clean) {
    const result = AIDetector.analyzeText(text);
    const hits = result.issues.filter((issue) => issue.type === 'unnecessary-hyphenation');
    assert.equal(hits.length, 0, `legitimate compound should stay clean: ${text}`);
  }
});

test('#107: protected spans are excluded from unnecessary-hyphenation detection', () => {
  const text = [
    'The docs mention `data-source strategy` only as a literal compatibility key.',
    'The file lives at docs/code-base/notes.md beside the archived code-base.md document.',
    'The Windows copy lives at C:\\docs\\code-base\\notes.md for legacy users.',
    'The Windows fixture directory is C:\\fixtures\\code-base for legacy users.',
    'Run the command with --code-base before starting the local service.',
    'Run the command with -code-base before starting the local service.',
    'The migration guide says "the old code-base remains available" for legacy users.',
    "The migration guide calls this 'the old code-base' for legacy users.",
    "The migration guide calls this 'the user's old code-base remains available' for legacy users.",
    'The migration guide calls this ‘the old code-base’ for legacy users.',
    `The migration guide says "${'word '.repeat(120)}the old code-base remains available" for legacy users.`,
    'See https://example.com/guides/code-base for the archived implementation notes.',
    'The archived exports are named code-base.csv and code-base.go for legacy users.',
    '> The old code-base remains available to teams migrating legacy applications.',
    '```text',
    'Python-package usage and works out-of-the-box are fixture strings here.',
    '```',
    '',
    '    The old code-base remains in this top-level indented code block.',
  ].join('\n');

  const result = AIDetector.analyzeText(text);
  const hits = result.issues.filter((issue) => issue.type === 'unnecessary-hyphenation');
  assert.equal(hits.length, 0, `protected text should not fire: ${JSON.stringify(hits)}`);
});

test('#107: proper nouns, identifiers, and version strings stay protected', () => {
  const protectedForms = [
    'Code-Base Enterprise publishes its quarterly release notes for customers today.',
    'Road-Map Analytics shared its annual report with the engineering group today.',
    'Research-Impact Aggregator Enterprise shared its annual report with customers today.',
    'Data-Source Strategy Analytics shared its annual report with customers today.',
    'The CODE-BASE heading is a product label used by the documentation team.',
    'Install the code-base package before running the local development server today.',
    'Use the .code-base selector when styling the legacy navigation component today.',
    'The code-base config key remains supported for older deployment manifests today.',
    'The current package release is code-base@2.4.1 for supported production systems.',
    'The migration still targets code-base-v2 across all supported production systems.',
    'The deployment identifier code-base remains supported across production systems today.',
    'The filename is code-base, which the migration script still recognizes for compatibility.',
    'The folder named road-map remains available to older deployment scripts today.',
    'The release notes quote "the old\ncode-base remains available" for compatibility.',
    "The release notes quote 'the old\ncode-base remains available' for compatibility.",
    'See https://example.com/guides/(code-base) for the archived implementation notes today.',
  ];

  for (const text of protectedForms) {
    const hits = AIDetector.analyzeText(text).issues.filter((issue) => issue.type === 'unnecessary-hyphenation');
    assert.equal(hits.length, 0, `proper noun or identifier should stay protected: ${text}`);
  }

  const prose = AIDetector.analyzeText(
    'The old code-base still powers the internal dashboard used by the support team.'
  );
  assert.equal(
    prose.issues.filter((issue) => issue.type === 'unnecessary-hyphenation').length,
    1,
    'ordinary lowercase prose must still fire'
  );

  const keyAsAdjective = AIDetector.analyzeText(
    'The key code-base migration remains unfinished while the support team reviews it.'
  );
  assert.equal(
    keyAsAdjective.issues.filter((issue) => issue.type === 'unnecessary-hyphenation').length,
    1,
    'an adjectival "key" must not be mistaken for an identifier cue'
  );
});

test('#107: punctuation-adjacent flags and single-component paths stay protected', () => {
  const protectedForms = [
    'Use (--code-base) when starting the local compatibility service for older clients.',
    'Pass ,--code-base when starting the local compatibility service for older clients.',
    'Use [--code-base] when documenting the local compatibility service for older clients.',
    'Set mode=--code-base when starting the local compatibility service for older clients.',
    'The Windows file lives at C:\\code-base for users of the legacy client.',
    'The portable file lives at C:/code-base for users of the legacy client.',
    'The home-directory file lives at ~/code-base for users of the legacy client.',
    'The root-level file lives at /code-base for users of the legacy client.',
    'The generated output is copied into code-base/ during every local release build.',
    'The relative file lives at ./code-base for users of the legacy client.',
    'The parent-relative file lives at ../code-base for users of the legacy client.',
    `The generated file lives at /${'a'.repeat(65)}-code-base for users of the legacy client.`,
    `The generated Windows file lives at C:\\${'a'.repeat(65)}-code-base for legacy users.`,
  ];

  for (const text of protectedForms) {
    const hits = AIDetector.analyzeText(text).issues.filter((issue) => issue.type === 'unnecessary-hyphenation');
    assert.equal(hits.length, 0, `flag or path should stay protected: ${text}`);
  }

  const prose = AIDetector.analyzeText(
    'Outside those literal paths, the old code-base remains ordinary prose and needs editing.'
  );
  assert.equal(
    prose.issues.filter((issue) => issue.type === 'unnecessary-hyphenation').length,
    1,
    'nearby prose must still fire'
  );
});

test('#107: frontmatter, YAML, Markdown tables, and HTML attributes stay protected', () => {
  const text = [
    '---',
    'title: Code-base migration notes',
    'tags:',
    '  - code-base',
    '---',
    '',
    'release-name: code-base',
    'legacy-tags:',
    '  - road-map',
    '',
    '| Setting | Legacy value |',
    '| --- | --- |',
    '| package | code-base |',
    '',
    '<div data-package=code-base class=road-map>Rendered content remains ordinary prose here.</div>',
  ].join('\n');

  const hits = AIDetector.analyzeText(text).issues.filter((issue) => issue.type === 'unnecessary-hyphenation');
  assert.equal(hits.length, 0, `metadata should stay protected: ${JSON.stringify(hits)}`);

  const prose = AIDetector.analyzeText(
    'After the metadata, the old code-base remains ordinary prose and needs editing today.'
  );
  assert.equal(
    prose.issues.filter((issue) => issue.type === 'unnecessary-hyphenation').length,
    1,
    'ordinary prose outside metadata must still fire'
  );

  const labelledProse = AIDetector.analyzeText(
    'Note: the old code-base remains ordinary prose and still needs editing before publication.'
  );
  assert.equal(
    labelledProse.issues.filter((issue) => issue.type === 'unnecessary-hyphenation').length,
    1,
    'a capitalized prose label must not be mistaken for unfenced YAML'
  );
});

test('#107: adversarial filename masking remains within a linear-time budget', () => {
  const attacks = [
    `${'a-'.repeat(3000)}a`,
    `${'segment/'.repeat(1000)}`,
  ];
  for (const attack of attacks) {
    const text = `The generated identifier below has no filename extension and must remain safe to scan. ${attack}`;
    const started = performance.now();
    AIDetector.analyzeText(text);
    const elapsedMs = performance.now() - started;
    assert.ok(elapsedMs < 1000, `adversarial mask scan took ${elapsedMs.toFixed(1)}ms`);
  }
});

test('#107: long closed quotations are masked without a length cutoff', () => {
  const text = `The release notes quote "${'word '.repeat(3600)}the old code-base remains available" for compatibility.`;
  const hits = AIDetector.analyzeText(text).issues.filter((issue) => issue.type === 'unnecessary-hyphenation');
  assert.equal(hits.length, 0, 'quoted material must stay protected below the analyzer word limit');
});

test('#107: copyedit-only findings do not affect score or trinary classification', () => {
  const clean = 'The team reviewed the release notes before publishing them to customers. Everyone checked the examples, links, headings, and migration steps before the final approval meeting.';
  const copyedits = 'The code-base and data-set updates follow the time-frame in the road-map. The service runs in real-time, works out-of-the-box, and remains supported over the long-term for every customer.';
  const baseline = AIDetector.analyzeText(clean);
  const result = AIDetector.analyzeText(copyedits);

  assert.ok(
    result.issues.filter((issue) => issue.type === 'unnecessary-hyphenation').length >= 7,
    'fixture must contain enough distinct copyedits to exercise the short-document threshold'
  );
  assert.equal(result.score, baseline.score, 'copyedit-only issues must not change the AI score');
  assert.equal(result.label, baseline.label, 'copyedit-only issues must not change the AI label');
  assert.equal(result.document_classification, baseline.document_classification);
  assert.deepEqual(result.class_probabilities, baseline.class_probabilities);
  assert.deepEqual(
    result.highlight_sentence_for_ai,
    [],
    'copyedit-only issues must not create AI-highlight regions'
  );
});

test('"verbatim" is Tier 3: single use stays clean, overuse flags by density', () => {
  // Tier 3 words fire only at density (max(3, 3% of words)), so a lone
  // "verbatim" — including the legal/QA term-of-art use — never flags, and the
  // word only surfaces when the writer leans on it.
  const single = AIDetector.analyzeText(
    'The packaging step copies the in-app resource verbatim into the extension bundle today.'
  );
  assert.ok(!single.tooShort, 'single-use fixture must clear the length gate');
  assert.equal(
    single.issues.filter((i) => i.type === 'tier3' && /verbatim/i.test(i.text)).length,
    0,
    'one "verbatim" is below the density floor and should not flag'
  );

  // The term of art repeated once in a normal sentence also stays clean.
  const termOfArt = AIDetector.analyzeText(
    'The verbatim transcript was entered into evidence during the second day of the hearing.'
  );
  assert.equal(
    termOfArt.issues.filter((i) => i.type === 'tier3' && /verbatim/i.test(i.text)).length,
    0,
    'a single term-of-art use should not flag'
  );

  // Repeated uses in a short piece clear max(3, floor(wordCount * 0.03)).
  const overused = AIDetector.analyzeText(
    'He copied the file verbatim, read the note verbatim, typed the line verbatim, and repeated it verbatim to the room.'
  );
  const hits = overused.issues.filter((i) => i.type === 'tier3' && /verbatim/i.test(i.text));
  assert.ok(hits.length > 0, 'repeated "verbatim" uses in a short piece should flag tier3 density');
});

test('"quietly" clusters with another Tier 2 word flags tier2', () => {
  // "quietly" alone in a paragraph should not fire; paired with another
  // Tier 2 word in the same paragraph it should produce a tier2 issue.
  const single = AIDetector.analyzeText('The team quietly shipped the update last week without any announcement.');
  const singleTypes = new Set(single.issues.map((i) => i.type));
  assert.ok(!singleTypes.has('tier2'), 'single "quietly" should not fire tier2 on its own');

  const clustered = AIDetector.analyzeText('The team quietly worked to harness new opportunities, building the platform without any announcement.');
  const clusteredTypes = new Set(clustered.issues.map((i) => i.type));
  assert.ok(clusteredTypes.has('tier2'), 'expected tier2 flag when "quietly" clusters with another Tier 2 word');
});

test('"deeply" joins a tier2 cluster only in significance collocations', () => {
  // "deeply" is conditional Tier 2: bare uses never count toward a cluster,
  // even next to another Tier 2 word — the base rate of literal "deeply"
  // in human prose is too high for an unconditional entry.
  const literal = [
    'The parser handles deeply nested JSON, and getting the indentation right is crucial for readability.',
    'I care deeply about this work, and the reality is more nuanced than the headline suggests.',
    'This helper is deeply coupled to the session object; could we facilitate testing by injecting it?',
  ];
  for (const text of literal) {
    const r = AIDetector.analyzeText(text);
    const types = new Set(r.issues.map((i) => i.type));
    assert.ok(!types.has('tier2'), `literal "deeply" must not cluster: ${text}`);
  }

  // The significance collocation DOES count when a second Tier 2 word
  // shares the paragraph...
  const clustered = AIDetector.analyzeText('The team is deeply committed to helping partners harness the new platform across every region.');
  const clusteredTypes = new Set(clustered.issues.map((i) => i.type));
  assert.ok(clusteredTypes.has('tier2'), 'expected tier2 when "deeply committed" clusters with another Tier 2 word');

  // ...but the collocation alone, with no second Tier 2 word, stays clean.
  const lone = AIDetector.analyzeText('The billing module is deeply integrated with the ledger, so invoice edits show up in both places.');
  const loneTypes = new Set(lone.issues.map((i) => i.type));
  assert.ok(!loneTypes.has('tier2'), 'lone "deeply integrated" must not fire tier2 by itself');
});

test('bullet-np-list does not fire on prose containing short verb-form bullets', () => {
  // Genuine list items with finite verbs should not trip the bare-NP
  // detector. The verb-token guard is what keeps todo lists, changelog
  // entries, and step-by-step instructions out of the false-positive
  // bucket.
  const text = `Today's changelog:

* fixed the auth bug that was hitting Safari users
* removed the legacy webhook handler that nobody calls anymore
* added a retry on the token refresh path
* shipped the new build to staging this morning
* will deploy to prod after the smoke tests pass

That's the full list for this push.`;
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(!types.has('bullet-np-list'), 'verb-form bullets should not trip bare-NP detector');
});

test('tier3-phrase fires on per-phrase repetition (>=2 hits)', () => {
  // The same boilerplate phrase used twice in one piece. Isolates the
  // per-phrase density rule from the cluster rule — cluster needs >=3
  // distinct phrases, this one needs >=2 hits of one phrase.
  const text = 'The integration of payments matters for adoption. The integration of identity is the next step. Both unlock material flows.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('tier3-phrase'), 'expected tier3-phrase flag for 2x repetition');
});

test('tier3-phrase-cluster fires on 3 distinct phrases at density 1 each', () => {
  // The cluster-rule boundary: each phrase appears only once, but three
  // distinct phrases stacked is the LLM-self-varies-boilerplate shape.
  // Per-phrase rule should NOT fire here; cluster rule should.
  const text = 'The team works on decentralized compute. Their thesis is community-driven and the long-term sustainability of the network matters most. Adoption is improving.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('tier3-phrase-cluster'), 'expected tier3-phrase-cluster flag at 3 distinct phrases');
  assert.ok(!types.has('tier3-phrase'), 'per-phrase rule should NOT fire when each phrase appears once');
});

test('tier3-phrase span dedup: overlapping regex matches count as one phrase', () => {
  // "designed for long-term sustainability" matches both
  // "designed for long-term" AND "long-term sustainability" — the second
  // is contained in the first. Span-dedup keeps this as one distinct hit.
  const text = 'This protocol is designed for long-term sustainability and nothing else.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(!types.has('tier3-phrase-cluster'), 'overlapping matches should not stack toward cluster threshold');
});

test('emotional-flatline opener fires at position 0 (no leading newline)', () => {
  // Earlier (^|\n) form silently missed bare openers at true start of
  // input. /m flag fixes it.
  const text = 'Interesting part of the project:\nThey shipped in two weeks.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('emotional-flatline'), 'expected emotional-flatline at position 0');
});

test('bullet-np-list ignores bullets inside fenced code blocks', () => {
  // CLI flag docs / option dumps inside ``` fences are not prose AI
  // scaffolding. False-positive that would fire on most READMEs.
  const text = "Run with one of these modes via `--mode`:\n\n```\n- unit\n- smoke\n- integration\n- e2e\n- perf\n- stress\n```\n\nDefaults to `unit` if omitted.";
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(!types.has('bullet-np-list'), 'bullets inside code fences should not flag');
});

test('bullet-np-list flushes on 2+ blank lines between bullet sections', () => {
  // A single blank line is normal Markdown spacing inside one list.
  // Two or more blank lines separate visually-disjoint sections — those
  // should not merge into one long run.
  const text = '* alpha\n* beta\n\n\nA paragraph of prose.\n\n\n* gamma\n* delta\n* epsilon';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(!types.has('bullet-np-list'), 'sections separated by 2+ blank lines should not merge');
});

test('hashtag-stuff matches tags after sentence punctuation', () => {
  // Hashtags immediately following sentence punctuation — common in
  // LinkedIn/X trailing blocks. The prior regex char class `[\s\\]`
  // had a literal backslash and silently missed any tag not preceded
  // by whitespace.
  const text = "Built a thing this week.\n#startup #crypto #web3 #ai #devlog #shipping #foundermode";
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('hashtag-stuff'), 'expected hashtag-stuff on 7-tag trailing block');
});

test('hashtag-stuff excludes URL fragments from the count', () => {
  // URL anchors like example.com/page#section must not count toward
  // the hashtag threshold or every doc post with a fragment link
  // would false-positive.
  const text = 'See the spec at example.com/api#auth and the deploy guide at example.com/ops#rollback and the troubleshooting notes at example.com/help#errors and the changelog at example.com/log#latest. Also kb.example.com/faq#section1 and forum.example.com/t/123#post-4 round out the references.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(!types.has('hashtag-stuff'), 'URL fragments should not count as hashtags');
});

test('hashtag-stuff excludes issue and PR references from the count', () => {
  // `#88` in prose is a GitHub issue reference, not a tag. A changelog
  // paragraph routinely cites six of them, and every such paragraph scored
  // as a stuffed hashtag block. Found when this repo's own README linked an
  // issue and the detector flagged the README.
  const text = 'The regression came in through #88 and stayed hidden until #91 landed. I reverted #92, reopened #93, and then #94 turned out to be the same bug in a different file. #95 is the follow up that fixes it, and #96 tracks the test we still owe.';
  const types = new Set(AIDetector.analyzeText(text).issues.map((i) => i.type));
  assert.ok(!types.has('hashtag-stuff'), 'issue references should not count as hashtags');
});

test('hashtag-stuff excludes hex colours and preprocessor directives', () => {
  // `#fff` is a colour and `#include` is a directive. Both appear in
  // technical prose well past six per post.
  const css = 'Background is #fff in light mode and #eee in dark. Body text sits at #1a2b3c, muted text at #6b7280, the link colour is #2563eb, hover is #1d4ed8, and the one accent is #f59e0b on the button.';
  // 8-character RGBA values, so dropping the {8} alternative is caught.
  const rgba = 'Palette is #1a2b3cff for body and #6b7280ee muted and #2563ebdd links and #1d4ed8cc hover and #f59e0bbb accent and #0a1b2cdd border today.';
  const c = 'Put #include <stdio.h> first, then #include <stdlib.h>, then #include <string.h>. Add #include <unistd.h> and #include <fcntl.h> after those, and guard the block with #ifndef and #endif so it stays idempotent.';
  for (const [label, text] of [['hex colours', css], ['rgba colours', rgba], ['directives', c]]) {
    const types = new Set(AIDetector.analyzeText(text).issues.map((i) => i.type));
    assert.ok(!types.has('hashtag-stuff'), `${label} should not count as hashtags`);
  }
});

test('hashtag-stuff ignores hashes inside code spans and fences', () => {
  // A tag in backticks is the author documenting the syntax, not using it.
  // Every span here is a tag isSocialTag would otherwise KEEP, so the count is
  // 6 without masking and 0 with it. An earlier version of this fixture quoted
  // #88 and #fff, which the carve-outs already removed, so it passed with
  // inline masking deleted and tested nothing.
  const inline = 'The escape rules trip people up. Write `#AI` for the tag, `#Innovation` for the category, `#Startups` for the vertical, `#Leadership` for the theme, `#Growth` for the metric, and `#FutureOfWork` when you mean the movement.';
  const fenced = 'Here is the config we ship by default, and it has not changed in a year:\n\n```\n#alpha\n#beta\n#gamma\n#delta\n#epsilon\n#zeta\n```\n\nEverything below that line is user overridable and nothing above it is.';
  for (const [label, text] of [['inline code', inline], ['fenced code', fenced]]) {
    const types = new Set(AIDetector.analyzeText(text).issues.map((i) => i.type));
    assert.ok(!types.has('hashtag-stuff'), `${label} should not count as hashtags`);
  }
});

test('hashtag-stuff still counts short hex-shaped words, which are real tags', () => {
  // #b2b, #e2e, #dad, #cafe, #ace and #face are ordinary tags. Carving out
  // 3- and 4-digit hex to catch CSS palettes silently deleted true positives on
  // the stuffed-block shape, so only 6- and 8-char forms CONTAINING A DIGIT are
  // subtracted: #decade and #facade are a-f words, not colours.
  const gtm = 'Great conversation on the go-to-market motion this week with the whole revenue team here.\n#b2b #e2e #saas #growth #ace #fade';
  const family = 'Weekend was good and the whole family got outside for once this month together.\n#dad #cafe #beef #face #travel #weekend';
  const decade = 'Reflecting on the last ten years of shipping developer tools to teams everywhere here.\n#decade #facade #deface #beaded #effaced #growth';
  // Four spaces under a list marker is a paragraph continuation, not a code
  // block, which is why indented runs are not masked.
  const listed = '- We shipped the detector and the whole team is happy with how it landed today.\n\n    #AI #Innovation #FutureOfWork #MachineLearning #Leadership #Growth';
  for (const [label, text] of [['b2b/e2e block', gtm], ['dad/cafe block', family], ['a-f word tags', decade], ['tags under a list item', listed]]) {
    const types = new Set(AIDetector.analyzeText(text).issues.map((i) => i.type));
    assert.ok(types.has('hashtag-stuff'), `${label} should still flag as hashtag stuffing`);
  }
});

test('hashtag-stuff still fires on a tag block that also cites an issue', () => {
  // The carve-outs subtract non-tag forms; they must not let a real block
  // through because a `#88` sits beside it.
  const text = 'Closed out #88 today and the release is live for everyone.\n#AI #Innovation #FutureOfWork #MachineLearning #Leadership #Growth #Startups';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('hashtag-stuff'), 'expected hashtag-stuff on a 7-tag block');
  assert.equal(
    r.issues.find((i) => i.type === 'hashtag-stuff').text,
    '7 hashtags',
    'the issue reference must not be counted as a tag'
  );
});

test('hashtag-stuff still fires on tags spread inline through a post', () => {
  // Masking code and subtracting non-tag forms must not weaken the inline
  // shape, which is the one a trailing-block-only rule would miss.
  const text = 'Loving the #AI space right now, especially #MachineLearning and #DeepLearning, plus #Startups and #Innovation and #FutureOfWork keep me busy every single day of the week.';
  const types = new Set(AIDetector.analyzeText(text).issues.map((i) => i.type));
  assert.ok(types.has('hashtag-stuff'), 'expected hashtag-stuff on 6 inline tags');
});

test('low-ttr fires on a 200+ token text with narrow vocabulary', () => {
  // Vocabulary-poor synthetic sample: same 11-word sentence repeated.
  // ~200 tokens, ~11 unique = ~5% TTR. Well under the 40% threshold.
  // Stylometric signal from the May 2026 detection-research review
  // (docs/competitive/detection-research.md).
  const sentence = 'The system shows the system improves the system every iteration. ';
  const text = sentence.repeat(20);
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('low-ttr'), `expected low-ttr flag, got types: ${[...types].join(', ')}`);
});

test('low-ttr does not fire on natural human prose at 200+ tokens', () => {
  // 200+ tokens of varied human-style prose. TTR should comfortably
  // exceed the 0.40 threshold even with some natural repetition.
  const text = `When the build broke this morning, I rolled back the recent auth refactor and
ran the integration tests again. Most of them passed cleanly, but a handful
of edge cases around token refresh still tripped the staging environment.
Safari users hit a 401 on the second request of any session that crossed
the hour mark, while Firefox sessions stayed authenticated as expected.
Digging through the logs, the culprit looked like a cookie scope issue
introduced during the migration to the new domain. I patched the path
parameter, redeployed to staging, and watched the metrics dashboard for
twenty minutes before pushing to production. Memory usage stayed flat,
latency held steady around forty milliseconds, and the error rate dropped
back below baseline once the rollout completed. Closing the incident
ticket now and writing up notes for the team retrospective tomorrow.`;
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(!types.has('low-ttr'), `low-ttr should not fire on natural prose, got types: ${[...types].join(', ')}`);
});

test('low-ttr does not fire on short texts (<200 tokens)', () => {
  // Same vocab-poor pattern but only ~50 tokens — below the sample-size
  // threshold. Avoids drowning short social posts in a stylometric flag
  // that needs more data to be reliable.
  const text = ('The system shows the system improves the system. '.repeat(5));
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(!types.has('low-ttr'), 'low-ttr should not fire below 200 tokens');
});

test('ai-placeholder fires on common slot-fill bracket patterns', () => {
  // The canonical AI-generated boilerplate that users paste without
  // filling in. Each shape is enough on its own. Catches the "[Your
  // Name]" family, dated stubs, and HTML comment placeholders.
  for (const text of [
    'Dear [Recipient], I am writing regarding [Topic of Discussion].',
    'Last updated 2025-XX-XX. Authors: [INSERT TEAM NAMES HERE].',
    'See the report from XX/XX/2024 for context.',
    '<!-- TODO: add citation when paper publishes -->',
    '<!-- fill in the missing section before shipping -->',
  ]) {
    const r = AIDetector.analyzeText(text + ' Additional padding text to clear the word-count gate. '.repeat(2));
    const types = new Set(r.issues.map((i) => i.type));
    assert.ok(types.has('ai-placeholder'), `expected ai-placeholder for: ${text}`);
  }
});

test('ai-placeholder does not fire on legitimate bracketed content', () => {
  // Real bracketed content — citations, optional matches, code
  // references — should NOT trip the placeholder regex. The pattern
  // is gated on placeholder VERBS (Your/Insert/Add/Describe/etc.).
  const text = 'The release notes for [v1.2.3] cover the [auth.refresh] path and reference [@example/user]. We saw it on commit [a3f7b21]. Padding text to clear the word-count gate so the analyzer runs the full pass cleanly.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(!types.has('ai-placeholder'), `expected no ai-placeholder, got: ${[...types].join(', ')}`);
});

test('ai-citation-markup fires on chatbot-internal tokens', () => {
  // Each of these is a near-definitive fingerprint of a specific
  // chat tool. Their presence is proof of copy-paste origin.
  for (const text of [
    'The school has been recognized as an international centre. citeturn0search1 More details below.',
    'See the appendix contentReference[oaicite:3]{index=3} for the data.',
    'According to the source oai_citation provided by the model, the figure is 12.',
    'The user uploaded [attached_file:1] for review.',
    'The grok_card here links to the relevant policy. ' + 'Padding text to clear the gate. '.repeat(3),
  ]) {
    const r = AIDetector.analyzeText(text + ' '.repeat(0) + 'Padding text to clear the word-count gate. '.repeat(2));
    const types = new Set(r.issues.map((i) => i.type));
    assert.ok(types.has('ai-citation-markup'), `expected ai-citation-markup for: ${text.slice(0, 50)}...`);
  }
});

test('ai-utm-source fires on AI-tool tracking parameters', () => {
  // utm_source values that AI tools auto-append to URLs they generate.
  // Each one is essentially proof the URL came out of a chatbot.
  for (const text of [
    'See https://example.com/article?utm_source=chatgpt.com for the source.',
    'Link: https://example.com/?utm_source=copilot.com&utm_medium=referral',
    'https://docs.example.com/page?utm_source=claude.ai is the canonical reference.',
    'Reference URL: https://example.com/post?utm_source=perplexity.ai found via search.',
    'Article: https://example.com/blog?referrer=grok.com via the link.',
  ]) {
    const r = AIDetector.analyzeText(text + ' Padding text to clear the word-count gate so the analyzer runs cleanly across all categories.');
    const types = new Set(r.issues.map((i) => i.type));
    assert.ok(types.has('ai-utm-source'), `expected ai-utm-source for: ${text.slice(0, 60)}...`);
  }
});

test('ai-utm-source does not fire on benign utm_source values', () => {
  // Real marketing UTMs from non-AI sources should not flag.
  const text = 'See https://example.com/article?utm_source=newsletter for the source. Padding text to clear the word-count gate so the analyzer runs the full pass cleanly across all categories without surprises.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(!types.has('ai-utm-source'), 'newsletter UTM should not flag as AI source');
});

test('severity labels are distinct across all four tiers', () => {
  const labels = new Set(Object.values(AIDetector.SEVERITY_LABELS));
  assert.equal(labels.size, 4, 'expected P0/P1/P2/P3 as four distinct labels');
});

// ─── v2: Tier 1 stylometric + bypass-trick detection ────────────────

test('v2: zero-width chars trigger normalization-flag', () => {
  // ZWSP between "del" and "ve" defeats naive "delve" exact-match. Pre-
  // pass strips it, then Tier 1 fires AND normalization-flag fires.
  const zwsp = '​';
  const text = `In today's landscape, we del${zwsp}ve into the intricate tapestry of innovation. This robust paradigm showcases comprehensive frameworks. The framework underscores how organizations harness cutting-edge tools.`;
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('normalization-flag'), 'expected normalization-flag on ZWSP injection');
  assert.ok(r.stats.normalization.zeroWidth > 0, 'norm.zeroWidth should count strip');
});

test('v2: Cyrillic homoglyph swap restores Tier 1 hit', () => {
  // "dеlve" uses Cyrillic 'е' (U+0435). Without normalization the token
  // 'dеlve' would not equal 'delve' and Tier 1 misses it. After
  // normalization, the Latin form fires Tier 1 AND triggers normalization-flag.
  const text = 'In tоday’s landscape we dеlve intо the intricate tapestry оf the rоbust ecоsystem and dеep dive intо each layer with comprehensive depth.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('normalization-flag'), 'expected normalization-flag on homoglyph cluster');
  assert.ok(r.stats.normalization.homoglyph >= 2, `expected >=2 homoglyph swaps, got ${r.stats.normalization.homoglyph}`);
});

test('v2: formulaic opener fires', () => {
  const text = 'In the rapidly evolving world of decentralized finance, new protocols have emerged as critical infrastructure. The market continues to expand at an unprecedented pace each quarter without fail.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('formulaic-opener'), 'expected formulaic-opener flag');
});

test('v2: speculative scenario opener fires', () => {
  const text = 'Imagine a world where every developer ships bug-free code on the first try. That is the promise this framework keeps making in its docs, and it deserves a much harder look before anyone commits a roadmap to it.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('speculative-opener'), 'expected speculative-opener flag');

  // The comma-interrupted cadence is the same tell and must also fire.
  const interrupted = AIDetector.analyzeText('Imagine, for a moment, a world where every deploy is instant. That is the pitch, and the pricing page leans on it hard enough that the claim deserves scrutiny before anyone signs.');
  const interruptedTypes = new Set(interrupted.issues.map((i) => i.type));
  assert.ok(interruptedTypes.has('speculative-opener'), 'expected speculative-opener on "Imagine, for a moment, a world where"');
});

test('v2: speculative opener leaves instructional "imagine you have" alone', () => {
  // The gate keys on the world/future/reality/scenario object plus
  // where/in-which, so a teaching device that points at a concrete
  // example must stay clean.
  const clean = [
    'Imagine you have a sorted array of one million integers and you want to find one value fast.',
    'Picture the request as it moves through the load balancer, the cache, and finally the database.',
    'Consider a scenario where the token expires mid-request; the client has to retry with a fresh one.',
  ];
  for (const text of clean) {
    const r = AIDetector.analyzeText(text);
    const types = new Set(r.issues.map((i) => i.type));
    assert.ok(!types.has('speculative-opener'), `false positive on instructional prose: ${text}`);
  }
});

test('v2: parenthetical hedge fires', () => {
  const text = 'The protocol works as intended (and increasingly, with better latency than competitors). The team has shipped consistently for six months without missing a single release cadence target.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('parenthetical-hedge'), 'expected parenthetical-hedge flag');
});

test('v2: social endorsement closer fires on LinkedIn-style share post', () => {
  const text = 'Just finished Sarah\'s deep dive on why context windows leak in long agent runs. She walks through the eviction policy line by line and shows where the tokens actually go. This one is worth your time:';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('social-cta-closer'), 'expected social-cta-closer flag');
});

test('v2: social endorsement closer covers every regex branch', () => {
  // One positive per branch so a typo in any single pattern fails loudly
  // instead of shipping green. Each string is padded to clear the 10-word
  // floor and sit amid normal prose, the shape analyzeText actually sees.
  const variants = [
    'Sarah broke down the whole eviction policy in plain terms. This one is worth your time:',          // worth-endorsement
    'New deep dive on agent memory just dropped today. This one is a must-read for the whole team.',     // must-read
    'I read the entire thing twice this weekend. I highly recommend giving this a read soon.',           // recommend-a-read
    'The setup is fiddly but the payoff is huge here. Do yourself a favor and read this tonight.',       // do-yourself-a-favor
    'The agenda is packed and the speakers are all sharp. You won\'t want to miss this one.',             // won't-want-to-miss
    'It saved me an entire afternoon of painful debugging. Thank me later, seriously, you will.',        // thank-me-later
    'It is the cleanest reference I have found all year. Save this one for later when you ship.',        // save-for-later
    'Everything you need for the whole migration is in this one. Bookmark this post.',                   // bookmark-this
    'The benchmarks completely flip the usual assumptions. Don\'t sleep on this one, honestly.',         // don't-sleep-on
    'The framing reframed the entire debate for me cleanly. Trust me, you\'ll want to read this.',       // trust-me-you'll
  ];
  for (const text of variants) {
    const r = AIDetector.analyzeText(text);
    const types = new Set(r.issues.map((i) => i.type));
    assert.ok(types.has('social-cta-closer'), `expected social-cta-closer on: ${text}`);
  }
});

test('v2: social endorsement closer matches curly-apostrophe forms', () => {
  // LinkedIn / Word / macOS auto-curl apostrophes, so the canonical
  // "you won't" / "don't" / "you'll" closers ship with U+2019, not ASCII.
  // A straight-only class would miss the dominant real-world input.
  const curly = [
    'The agenda is packed and the speakers are all sharp. You won’t want to miss this one.',
    'The benchmarks completely flip the usual assumptions. Don’t sleep on this one, honestly.',
    'The framing reframed the entire debate for me cleanly. Trust me, you’ll want to read this.',
  ];
  for (const text of curly) {
    const r = AIDetector.analyzeText(text);
    const types = new Set(r.issues.map((i) => i.type));
    assert.ok(types.has('social-cta-closer'), `expected social-cta-closer on curly form: ${text}`);
  }
});

test('v2: social endorsement closer leaves literal-verb human prose alone', () => {
  // The anchors (demonstrative object, terminal lookahead, sentence-initial
  // lookbehind) exist to keep the detector off ordinary instructional and
  // conversational text. Each of these uses a trigger word in its literal
  // sense and must stay clean.
  const clean = [
    'The book is worth reading if you have the time, but the middle third drags and I almost put it down.',
    'Bookmark this page so you can find the API reference later when you are wiring up the client.',
    'I usually save this for later in the sprint when the review queue has finally cleared out a bit.',
    'Do yourself a favor and read the runbook before you ever go on call for this service again.',
    'You will not want to miss this design review tomorrow because the API contract is changing under us.',
    'She will thank me later for the heads up once the deploy window actually closes without incident.',
    'Trust me, this one took an entire afternoon to track down and it was a single off-by-one in the loop.',
  ];
  for (const text of clean) {
    const r = AIDetector.analyzeText(text);
    const types = new Set(r.issues.map((i) => i.type));
    assert.ok(!types.has('social-cta-closer'), `false positive on literal prose: ${text}`);
  }
});

test('v2: trinary output present + FN-biased for ambiguous text', () => {
  // A plain human bug-report should not get AI_ONLY even if score lifts.
  const text = 'The build broke again this morning. Rolled back the auth refactor and tests pass now. Still need to figure out why the token refresh path hits a 401 for users on Safari but not Firefox — probably a cookie scope issue but I want to confirm before shipping a fix.';
  const r = AIDetector.analyzeText(text);
  assert.ok(r.document_classification, 'expected document_classification field');
  assert.ok(['HUMAN_ONLY', 'MIXED'].includes(r.document_classification), `human prose got ${r.document_classification}`);
  assert.ok(r.class_probabilities, 'expected class_probabilities');
  const sum = r.class_probabilities.human + r.class_probabilities.mixed + r.class_probabilities.ai;
  assert.ok(Math.abs(sum - 1) < 0.02, `probabilities should sum to ~1, got ${sum}`);
  assert.ok(['high', 'medium', 'low'].includes(r.confidence_category), 'expected confidence_category');
});

test('v2: highly AI-marked text reaches AI_ONLY with corroborators', () => {
  // High score + cutoff disclaimer (corroborator) → AI_ONLY at high confidence.
  const text = [
    "As of my last update, I don't have access to real-time data. In the rapidly evolving world of decentralized finance, we delve into the intricate tapestry of innovation.",
    'This seamless, robust paradigm showcases a comprehensive framework. Moreover, it truly is a game-changer that underscores how we navigate the complexities of modern AI.',
    'Furthermore, this pivotal moment marks a watershed for the industry. Let me think step by step about how to approach this systematically. I hope this helps!',
  ].join(' ');
  const r = AIDetector.analyzeText(text);
  assert.equal(r.document_classification, 'AI_ONLY', `expected AI_ONLY, got ${r.document_classification} (score=${r.score})`);
  assert.ok(['medium', 'high'].includes(r.confidence_category), `expected medium/high confidence, got ${r.confidence_category}`);
});

test('v2: highlight_sentence_for_ai returns regions with start/end offsets', () => {
  const text = 'In the rapidly evolving world of AI, we delve into the intricate tapestry. This is a robust, comprehensive paradigm. Plain second paragraph here is just normal prose without any of the tells. The team shipped a fix on Monday afternoon after the rollback completed successfully.';
  const r = AIDetector.analyzeText(text);
  assert.ok(Array.isArray(r.highlight_sentence_for_ai), 'expected highlight array');
  if (r.highlight_sentence_for_ai.length > 0) {
    const region = r.highlight_sentence_for_ai[0];
    assert.ok(typeof region.start === 'number', 'region has start offset');
    assert.ok(typeof region.end === 'number', 'region has end offset');
    assert.ok(region.end > region.start, 'end > start');
    assert.ok(typeof region.score === 'number' && region.score >= 0 && region.score <= 1, 'region.score 0-1');
  }
});

test('v2: context mode "technical" suppresses Title Case header flag', () => {
  const text = 'Strategic Negotiations And Key Partnerships\n\nThe team closed three deals this quarter. Each agreement included revenue-share terms and dispute-resolution clauses. The legal review took two weeks per contract on average.';
  const general = AIDetector.analyzeText(text, { contextMode: 'general' });
  const technical = AIDetector.analyzeText(text, { contextMode: 'technical' });
  const generalHas = general.issues.some((i) => i.type === 'title-case-header');
  const technicalHas = technical.issues.some((i) => i.type === 'title-case-header');
  assert.ok(generalHas, 'general mode should flag title-case header');
  assert.ok(!technicalHas, 'technical mode should suppress title-case header');
});

test('#62: Title Case flagged on a Markdown heading, not just a bare line', () => {
  // The `^[A-Z]` anchor required the line to START with a capital, so a
  // `## Heading` never matched — the first character is `#`. The rule missed
  // the commonest way a heading is actually written while catching the bare
  // form it gets converted from. Reported by a downstream vendoring the file.
  const body =
    '\n\nThe team closed three deals this quarter. Each agreement included revenue-share terms and dispute-resolution clauses. The legal review took two weeks per contract on average.';
  for (const prefix of ['#', '##', '######']) {
    const r = AIDetector.analyzeText(`${prefix} Strategic Negotiations And Key Partnerships${body}`, {
      contextMode: 'general',
    });
    assert.ok(
      r.issues.some((i) => i.type === 'title-case-header'),
      `expected title-case-header on a "${prefix}" heading`,
    );
  }
});

test('#62: the heading fix does not flag sentence-case or non-headings', () => {
  const body =
    '\n\nThe team closed three deals this quarter. Each agreement included revenue-share terms and dispute-resolution clauses. The legal review took two weeks per contract on average.';
  const cases = [
    ['## Strategic negotiations and key partnerships', 'sentence-case heading is correct, not a tell'],
    ['##Strategic Negotiations And Key Partnerships', 'no space after # is not a Markdown heading'],
    ['####### Strategic Negotiations And Key Partnerships', 'seven hashes is not a heading'],
  ];
  for (const [line, why] of cases) {
    const r = AIDetector.analyzeText(line + body, { contextMode: 'general' });
    assert.ok(!r.issues.some((i) => i.type === 'title-case-header'), why);
  }
});

// Prose long enough to clear the ten-word gate, appended to single-line fixtures.
const HEADING_BODY =
  '\n\nThe team closed three deals this quarter. Each agreement included revenue-share terms and dispute-resolution clauses. The legal review took two weeks per contract on average.';

function titleCaseHits(text) {
  const r = AIDetector.analyzeText(text, { contextMode: 'general' });
  return r.issues.filter((i) => i.type === 'title-case-header');
}

// NOT covered, and deliberately so: a four-content-word Title Case heading such
// as '# The Art Of War' or '## Notes On The Design' still fires. The >= 4 guard
// cannot tell those from '## Benefits And Strategic Considerations' -- they are
// the same shape. That is pre-existing behaviour, identical for the bare-line
// form on main, and out of scope here.
test('#62: legitimate three-word Title Case headings are not flagged', () => {
  // The regression the first version of this fix shipped. matchPatterns reports
  // match[0], so '## Terms Of Service' arrived with '##' as a token, silently
  // lowering the proper-noun guard from four content words to three for
  // headings only. These are ordinary human headings, on a detector whose
  // stated first priority is not firing on human writing.
  for (const heading of [
    '## Terms Of Service',
    '## Table Of Contents',
    '## Bank Of America',
    '## Pride And Prejudice',
    '## Statement Of Work',
  ]) {
    assert.equal(titleCaseHits(heading + HEADING_BODY).length, 0, `must not flag: ${heading}`);
  }
});

test('#62: a heading inside a fenced block is illustration, not a section header', () => {
  // A document that documents Markdown is the normal case for this rule.
  // Without the fence check, every docs page flags itself.
  const fence = '```';
  const text = [
    'How to write documentation, briefly, with a worked example that follows.',
    '',
    fence + 'markdown',
    '## Benefits And Strategic Considerations',
    fence,
    '',
    'That is the shape to avoid in your own prose, not in a code sample.',
  ].join('\n');
  assert.equal(titleCaseHits(text).length, 0, 'a fenced example must not flag');
});

test('#62: headings opening with a function word are not the tell', () => {
  // Measured on 81 files that provably predate LLMs (2018-19 eBooks stamped
  // year: 2018/2019, 2020 posts): these fired 13 times on the branch and zero
  // times on main. Every one opens with "The". The rule's own comment has
  // always said the function word marks a MID-sentence "And"; the test never
  // enforced it. Verbatim headings from that corpus.
  for (const heading of [
    '## The New Security Landscape',
    '## The Microsoft Approach to Identity',
    '### The Four Keys to a Successful and Secure Modern Workplace',
    '## The Changing Face of Manufacturing',
    '## The Key to Winning Georgia',
    '## The Chain of Thought Podcast',
  ]) {
    assert.equal(titleCaseHits(heading + HEADING_BODY).length, 0, `must not flag: ${heading}`);
  }
});

test('#62: an interior function word still flags, in both forms', () => {
  // The other side of the guard above. If this ever goes quiet the rule is dead.
  for (const heading of [
    '## Benefits And Strategic Considerations',
    'Benefits And Strategic Considerations',
    '## Strategic Negotiations And Key Partnerships',
  ]) {
    assert.equal(titleCaseHits(heading + HEADING_BODY).length, 1, `must flag: ${heading}`);
  }
});

test('#62: fences that a parity count gets wrong', () => {
  const f3 = '```';
  const f4 = '````';
  const intro = 'Documentation about writing Markdown, long enough to clear the word gate.';
  const title = '## Benefits And Strategic Considerations';

  // A four-backtick fence wrapping a three-backtick example is how you document
  // fences — the motivating case. Counting delimiters inverts on it.
  assert.equal(
    titleCaseHits([intro, f4, f3 + 'markdown', title, f3, f4].join('\n') + HEADING_BODY).length,
    0,
    'four-backtick outer fence',
  );
  // CommonMark allows up to three spaces of indent.
  assert.equal(
    titleCaseHits([intro, '   ' + f3, title, '   ' + f3].join('\n') + HEADING_BODY).length,
    0,
    'indented fence',
  );
  // An unclosed fence runs to end of document, as renderers treat it.
  assert.equal(
    titleCaseHits([intro, f3, title].join('\n') + HEADING_BODY).length,
    0,
    'unclosed fence',
  );
  // ...and a correctly closed one must not swallow what follows.
  assert.equal(
    titleCaseHits([intro, f3, 'code', f3, title].join('\n') + HEADING_BODY).length,
    1,
    'heading after a closed fence must still flag',
  );
});

test('#77: only spaces and tabs may follow a closing fence', () => {
  const intro = 'Documentation about writing Markdown, long enough to clear the word gate.';
  const title = '## Benefits And Strategic Considerations';

  for (const fence of ['```', '~~~']) {
    assert.equal(
      titleCaseHits([intro, fence, fence + 'js', title, fence].join('\n') + HEADING_BODY).length,
      0,
      'trailing text cannot close the outer fence',
    );
    assert.equal(
      titleCaseHits([intro, fence, 'code', fence + ' \t', title].join('\n') + HEADING_BODY).length,
      1,
      'spaces and tabs may follow a closing fence',
    );
    assert.equal(
      titleCaseHits([intro, fence, 'code', fence + '\u00a0', title].join('\n') + HEADING_BODY).length,
      0,
      'non-breaking space is fence content, not an allowed closing-fence suffix',
    );
    assert.equal(
      titleCaseHits([intro, fence, 'code', fence, title].join('\r\n') + HEADING_BODY).length,
      1,
      'CRLF line endings still allow a closing fence',
    );
  }
});

test('#62: MD_HEADING_PREFIX accepts what the pattern accepts', () => {
  // The two must stay coupled: TITLE_CASE_HEADER matches `#{1,6}[ \t]+`, so if
  // the prefix strip stops accepting a tab, `##` survives into the token list
  // and reintroduces the ##-as-token bug this fix exists for.
  //
  // The probe has to open with a function word. On a heading whose function
  // word is interior, an unstripped `##` only pushes the token COUNT up and the
  // result is unchanged — mutation testing caught that a firing fixture here
  // passes either way. Here the unstripped `##` shifts what slice(1) sees onto
  // the leading "The", which flips the verdict.
  assert.equal(
    titleCaseHits('##\tThe New Security Landscape' + HEADING_BODY).length,
    0,
    'a tab-separated heading must strip like a space-separated one',
  );
  assert.equal(
    titleCaseHits('##\tBenefits And Strategic Considerations' + HEADING_BODY).length,
    1,
    'and must still flag the real tell',
  );
});

test('#62: an indented line is not a Markdown heading', () => {
  // Kills the `#{0,6}` mutant: making the hash count optional turns any indented
  // line into a heading, so four-space code blocks would flag.
  assert.equal(
    titleCaseHits('    Benefits And Strategic Considerations' + HEADING_BODY).length,
    0,
    'an indented line must not flag',
  );
});

test('#62: the reported text is value-asserted, not merely present', () => {
  // The whole change alters what match[0] contains, so assert the value. A
  // presence-only check is what let the `##`-as-token defect through.
  const hits = titleCaseHits('## Benefits And Strategic Considerations' + HEADING_BODY);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text.trim(), '## Benefits And Strategic Considerations');
});

test('v2: markdown **bold** is preserved by normalize pre-pass', () => {
  // Regression: lookbehind/lookahead added in review fix. The pre-fix
  // regex stripped the inner half of `**bold**` and counted each as
  // a roleplay marker, false-positiving normalization-flag on any
  // README / Substack post with bold runs.
  const text = '**First bold** and **another bold** plus **a third one**.';
  const norm = AIDetector.normalizeText(text);
  assert.equal(norm.flags.roleplay, 0, `expected roleplay=0 on markdown bold, got ${norm.flags.roleplay}`);
  assert.ok(norm.text.includes('**First bold**'), 'bold marker preserved');
});

test('v2: punct-distribution fires on uniform per-paragraph density', () => {
  // Four paragraphs, each ~30 words, each with the same number of
  // commas. Uniform punctuation density across paragraphs is the AI
  // signature this rule catches.
  const text = [
    'The protocol design centers on three core principles, including modularity, composability, and forward compatibility, which together enable predictable behavior across many environments and deployment topologies.',
    'Implementation choices reflect a deliberate preference for simplicity, including small interfaces, narrow contracts, and explicit invariants, which together make the codebase tractable for new contributors and reviewers.',
    'Testing strategy emphasizes property-based coverage, including invariants, contract tests, and regression fixtures, which together guard against silent behavior changes in performance-critical paths across releases.',
    'Documentation follows a layered approach, including conceptual overviews, narrative guides, and reference material, which together orient readers without forcing them through any single rigid sequence of pages.',
  ].join('\n\n');
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('punct-distribution'), 'expected punct-distribution flag on uniform density');
});

test('v2: cross-para-burstiness fires on uniform sentence rhythm', () => {
  // Four paragraphs, each with three sentences of similar length.
  // Std-of-CV across paragraphs is low → flag fires.
  const text = [
    'The system processes events synchronously. Each event triggers a downstream handler. The handler updates state immediately.',
    'The database uses optimistic locking. Concurrent writes retry transparently. The retry budget allows three attempts.',
    'Authentication relies on signed tokens. Tokens expire after fifteen minutes. Refresh requests issue new tokens.',
    'Logging captures every state change. The pipeline routes logs centrally. Storage retains entries for ninety days.',
  ].join('\n\n');
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('cross-para-burstiness'), 'expected cross-para-burstiness on uniform rhythm');
});

test('v2: invalid contextMode falls back to general with stats.contextModeFallback set', () => {
  const text = 'Strategic Negotiations And Key Partnerships\n\nThe team closed three deals. Each agreement included revenue-share terms. Legal review took two weeks per contract.';
  const r = AIDetector.analyzeText(text, { contextMode: 'tecnical' });
  assert.equal(r.stats.contextMode, 'general', 'invalid mode coerced to general');
  assert.equal(r.stats.contextModeFallback, 'tecnical', 'fallback echoes original');
});

test('v2: trinary fields present on tooShort / tooLong / empty as UNSCORED', () => {
  // Early-exit paths return UNSCORED (not HUMAN_ONLY) so a caller can't
  // mistake a refused scan for a confident human verdict. A 50k-word
  // LLM-generated document falling into tooLong is not "human."
  const empty = AIDetector.analyzeText('');
  const tooShort = AIDetector.analyzeText('Short text.');
  const tooLong = AIDetector.analyzeText('word '.repeat(10001));
  for (const [name, r] of [['empty', empty], ['tooShort', tooShort], ['tooLong', tooLong]]) {
    assert.equal(r.document_classification, 'UNSCORED', `${name}: expected UNSCORED, got ${r.document_classification}`);
    assert.equal(r.confidence_category, 'low', `${name}: expected low confidence`);
    assert.ok(r.class_probabilities, `${name}: missing class_probabilities`);
    assert.ok(Array.isArray(r.highlight_sentence_for_ai), `${name}: missing highlight array`);
  }
  // Empty case has empty stats so contextMode field absent is fine;
  // tooShort/tooLong should surface contextMode for traceability.
  assert.equal(tooShort.stats.contextMode, 'general', 'tooShort stats includes contextMode');
  assert.equal(tooLong.stats.contextMode, 'general', 'tooLong stats includes contextMode');
});

test('v2: probability fields sum to exactly 1.000 (no float drift)', () => {
  const texts = [
    'In the rapidly evolving world of decentralized finance, we delve into the intricate tapestry of innovation. This seamless, robust paradigm showcases a comprehensive framework that catalyzes transformative change across the ecosystem.',
    'The build broke. Rolled back. Tests pass. Will investigate the root cause tomorrow afternoon after the standup with the on-call engineer.',
    'A neutral middle paragraph that mixes some flagged words like robust and comprehensive but in normal context, leveraging some technical terms in the way a real engineer might describe their implementation choices over coffee.',
  ];
  for (const t of texts) {
    const r = AIDetector.analyzeText(t);
    const sum = r.class_probabilities.human + r.class_probabilities.mixed + r.class_probabilities.ai;
    assert.ok(Math.abs(sum - 1) < 0.0005, `probabilities should sum to exactly 1.000, got ${sum} for: ${t.slice(0, 40)}...`);
  }
});

test('v2: mid-score isolated stylometric hits do not reach AI_ONLY', () => {
  // Pins the FN-bias contract with fail-loud preconditions. If the corpus
  // drifts and the preconditions break, the test fails on the precondition
  // assertion (not silently passes). Text designed to have NO strong
  // corroborators: no cutoff disclaimer, no chatbot artifact, no homoglyph,
  // no dense-vocab trifecta. Should classify HUMAN_ONLY or MIXED.
  const text = 'The team continues making progress on the platform. The framework supports many needs. Building collaboration across teams stays important. Improving the deployment path is a goal. The setup gives everyone a foundation.';
  const r = AIDetector.analyzeText(text);
  const hasCutoff = r.issues.some((i) => i.type === 'cutoff-disclaimer');
  const hasReasonChat = r.issues.some((i) => i.type === 'reasoning-artifact') && r.issues.some((i) => i.type === 'chatbot');
  const hasNorm = r.issues.some((i) => i.type === 'normalization-flag');
  // Preconditions: assert the test corpus matches the no-strong-corroborator
  // shape. If these fail, the corpus drifted and the test is meaningless.
  assert.ok(!hasCutoff, 'precondition: corpus should not trigger cutoff-disclaimer');
  assert.ok(!hasReasonChat, 'precondition: corpus should not trigger reasoning+chatbot');
  assert.ok(!hasNorm, 'precondition: corpus should not trigger normalization-flag');
  assert.ok(r.score < 70, `precondition: corpus score should be < 70, got ${r.score}`);
  // Contract: without strong corroborators and below the score-only threshold,
  // never AI_ONLY.
  assert.notEqual(r.document_classification, 'AI_ONLY', `no-strong-corroborator below score 70 should not be AI_ONLY, got ${r.document_classification} at score ${r.score}`);
});

test('v2: humanizer bypass escalates to AI_ONLY (normalization-flag corroborator)', () => {
  const zwsp = '​';
  const text = `In tоday's landscape we del${zwsp}ve into the intricate tap${zwsp}estry of innovátion. This seamless, robust paradigm showcases comprehensive frameworks. The framework underscores how organizations harness cutting-edge tools to navigate complexities across the ecosystem.`;
  const r = AIDetector.analyzeText(text);
  assert.equal(r.document_classification, 'AI_ONLY', `bypass should reach AI_ONLY, got ${r.document_classification}`);
  assert.ok(['medium', 'high'].includes(r.confidence_category), `bypass should not be low-confidence, got ${r.confidence_category}`);
});

test('v2: canonical saturated-AI essay reaches AI_ONLY (calibration regression)', () => {
  // Regression for review finding: pre-recalibration this text scored
  // ~47/MIXED. AI_ONLY was effectively dead code. Threshold now lets
  // a saturated essay actually fire.
  const text = 'In today\'s rapidly evolving landscape, we delve into the intricate tapestry of decentralized finance. It is important to note that this seamless, robust paradigm showcases a comprehensive framework. Moreover, this transformative ecosystem leverages cutting-edge protocols to navigate the complex multifaceted challenges of modern finance. Furthermore, the integration of innovative solutions underscores how pivotal this moment is. The future looks bright for those who embrace these emerging opportunities. By harnessing the power of blockchain technology, organizations can foster unprecedented growth and catalyze meaningful change across the ecosystem.';
  const r = AIDetector.analyzeText(text);
  assert.equal(r.document_classification, 'AI_ONLY', `saturated essay should AI_ONLY, got ${r.document_classification} at score ${r.score}`);
});

test('v2: legitimate *italic phrase* is NOT stripped by roleplay rule', () => {
  // Round-2 fix: roleplay regex now requires an action-verb prefix
  // (nods/sighs/laughs/etc.). Markdown italic with arbitrary multi-word
  // content like *italic phrase here* should survive untouched.
  const text = 'We use *italic phrase here* for emphasis and *another phrase too* in some places.';
  const norm = AIDetector.normalizeText(text);
  assert.equal(norm.flags.roleplay, 0, `expected roleplay=0 on plain italic, got ${norm.flags.roleplay}`);
  assert.ok(norm.text.includes('*italic phrase here*'), 'italic preserved');
});

test('v2: *roleplay action verb* IS stripped', () => {
  // The actual chat-model artifact — verb-led action description.
  const text = 'I think about the problem *nods thoughtfully* and consider the options *sighs deeply* before answering.';
  const norm = AIDetector.normalizeText(text);
  assert.ok(norm.flags.roleplay >= 2, `expected ≥2 roleplay strips, got ${norm.flags.roleplay}`);
});

test('v2: single ZWSP does not flip to AI_ONLY (hair-trigger fix)', () => {
  // Common in copy-paste from Word/Notion/Slack-rendered text. Round-1
  // made single ZWSP a strong corroborator → AI_ONLY at score 0. Round-2
  // raised the threshold to ≥2 for parity with homoglyph.
  const zwsp = '​';
  const text = `Our team shipped a fix on Monday${zwsp} afternoon. Tests pass and the deploy is green. Everything looks good. Plain human text with one accidental zero-width character pasted from a Notion doc.`;
  const r = AIDetector.analyzeText(text);
  assert.notEqual(r.document_classification, 'AI_ONLY', `single ZWSP should not flip to AI_ONLY, got ${r.document_classification}`);
});

test('v2: dense-AI-vocab trifecta reaches AI_ONLY (calibration regression)', () => {
  // Saturated ChatGPT prose without cutoff/chatbot/normalization should
  // still reach AI_ONLY via the dense-AI-vocab strong corroborator
  // (≥4 tier1 distinct + tier2 cluster + transition). Round-1 left this
  // class of essay stuck at MIXED.
  const text = 'In the rapidly evolving world of decentralized finance, organizations leverage robust and comprehensive frameworks. Moreover, this seamless paradigm enables them to navigate the intricate tapestry of modern challenges. Furthermore, they harness cutting-edge tools to foster sustainable growth and catalyze transformative change. Additionally, the platform showcases meticulous attention to user experience across the ecosystem.';
  const r = AIDetector.analyzeText(text);
  assert.equal(r.document_classification, 'AI_ONLY', `dense AI vocab should AI_ONLY, got ${r.document_classification} at score ${r.score}`);
});

test('v2: blockquoted AI text does not penalize the human wrapper', () => {
  // A human reacting to AI text by quoting it shouldn't have the quoted
  // block scored against their own prose. The `> ` lines get stripped
  // in a pre-pass and the count surfaces in stats.quotedLines.
  const text = [
    'I asked ChatGPT to describe my project and got this response:',
    '',
    '> In the rapidly evolving world of decentralized finance, we delve into the intricate tapestry of innovation.',
    '> This seamless, robust paradigm showcases a comprehensive framework that catalyzes transformative change.',
    '> Moreover, this represents a pivotal moment in the ecosystem.',
    '',
    'The response was pretty bad. I rewrote it as a normal sentence about what we actually do.',
  ].join('\n');
  const r = AIDetector.analyzeText(text);
  assert.ok(r.stats.quotedLines >= 3, `expected quotedLines >= 3, got ${r.stats.quotedLines}`);
  assert.notEqual(r.document_classification, 'AI_ONLY', `human wrapping AI quote should not classify AI_ONLY, got ${r.document_classification}`);
});

test('v2: probability sum is exactly 1 with no negative components', () => {
  // Round-2 fix: clamp p.ai to >= 0 after the remainder calculation
  // since toFixed(3) rounding can push human+mixed slightly above 1.
  const texts = [
    'In the rapidly evolving world of decentralized finance, we delve into the intricate tapestry of innovation. This seamless, robust paradigm showcases a comprehensive framework that catalyzes transformative change across the ecosystem. Furthermore, this pivotal moment marks a fundamental shift.',
    'The build broke. Rolled back. Tests pass.',
    'A neutral middle paragraph that mixes some words like robust and comprehensive in normal context, leveraging technical terms the way a real engineer might describe their implementation choices over coffee with a teammate.',
    '',
    'word '.repeat(11000),
  ];
  for (const t of texts) {
    const r = AIDetector.analyzeText(t);
    const { human, mixed, ai } = r.class_probabilities;
    assert.ok(human >= 0, `human prob negative: ${human}`);
    assert.ok(mixed >= 0, `mixed prob negative: ${mixed}`);
    assert.ok(ai >= 0, `ai prob negative: ${ai}`);
    const sum = human + mixed + ai;
    assert.ok(Math.abs(sum - 1) < 0.002, `sum should be ~1, got ${sum} for: ${(t || '<empty>').slice(0, 40)}`);
  }
});

test('v2: unmappedHighlights counter surfaced in stats', () => {
  const r = AIDetector.analyzeText('We delve into the landscape of innovation and continue to navigate the comprehensive transformation.');
  assert.equal(typeof r.stats.unmappedHighlights, 'number', 'unmappedHighlights should be numeric');
});

test('v2: real Rust technical post does NOT classify AI_ONLY (denseAIVocab FP fix)', () => {
  // Round-3 regression: pre-fix this scored AI_ONLY at 30 because
  // denseAIVocab required only 4 tier1 + 1 tier2 cluster + transition,
  // which legitimate dense-jargon technical writing trips. Threshold
  // raised to 5 tier1 + 2 tier2 clusters + 150-word gate.
  const text = 'Rust offers a robust and comprehensive approach to systems programming. Engineers leverage zero-cost abstractions to navigate intricate memory hierarchies without runtime overhead. The borrow checker provides meticulous compile-time guarantees that catch entire categories of bugs. Furthermore, the type system encourages a holistic approach to API design where contracts are explicit. The ecosystem around cargo, crates.io, and the Rust toolchain has matured significantly over the past five years, with libraries spanning embedded systems, web servers, and game engines.';
  const r = AIDetector.analyzeText(text);
  assert.notEqual(r.document_classification, 'AI_ONLY', `Rust tech post should not classify AI_ONLY, got ${r.document_classification} at score ${r.score}`);
});

test('v2: canonical "As an AI language model" disclaimer fires cutoff-disclaimer + AI_ONLY', () => {
  // Round-3 finding: this canonical LLM self-id phrase was missing
  // entirely from CUTOFF_DISCLAIMERS.
  const text = 'As an AI language model, I cannot provide legal advice on this matter. However, I can suggest you consult a licensed attorney. The general principle is that contract law varies by jurisdiction and specific facts matter.';
  const r = AIDetector.analyzeText(text);
  const types = new Set(r.issues.map((i) => i.type));
  assert.ok(types.has('cutoff-disclaimer'), 'expected cutoff-disclaimer flag on AI language model self-id');
  assert.equal(r.document_classification, 'AI_ONLY', `expected AI_ONLY on canonical disclaimer, got ${r.document_classification}`);
  assert.equal(r.confidence_category, 'high', `expected high confidence on canonical disclaimer, got ${r.confidence_category}`);
});

test('v2: single-line shell prompt > is NOT stripped as blockquote', () => {
  // Blockquote strip now requires ≥2 consecutive lines.
  const text = 'To check the directory:\n\n> ls -la\n\nThen review the output and look for any unexpected files. The team uses this command frequently when debugging deployment issues that involve filesystem permissions.';
  const r = AIDetector.analyzeText(text);
  assert.equal(r.stats.quotedLines, 0, `single > line should not strip, got quotedLines=${r.stats.quotedLines}`);
});

test('v2: stats.denseAIVocab and stats.tier1Distinct surface for observability', () => {
  const r = AIDetector.analyzeText('We delve into the landscape with robust comprehensive seamless innovative cutting-edge solutions.');
  assert.equal(typeof r.stats.denseAIVocab, 'boolean', 'denseAIVocab should be boolean');
  assert.equal(typeof r.stats.tier1Distinct, 'number', 'tier1Distinct should be number');
});

test('v2: backward compat — score, label, issues, stats still present', () => {
  const r = AIDetector.analyzeText('We delve into the landscape of leveraging robust paradigms. The team continues to navigate this comprehensive transformation.');
  assert.ok(typeof r.score === 'number', 'score still numeric');
  assert.ok(typeof r.label === 'string', 'label still string');
  assert.ok(Array.isArray(r.issues), 'issues still array');
  assert.ok(r.stats && typeof r.stats === 'object', 'stats still object');
});

test('#109: Object.prototype names in prose do not fire tier lookups', () => {
  // Plain-object membership tests made TIER1['constructor'] resolve to
  // Object.prototype.constructor (truthy), flagging ordinary prose.
  const text =
    'The class constructor takes nine arguments in this codebase. Review the constructor before calling it, and check that its prototype chain and toString output match what the documentation describes for each valueOf call.';
  const r = AIDetector.analyzeText(text);
  const protoHits = r.issues.filter(
    (i) => ['constructor', 'prototype', 'tostring', 'valueof', 'hasownproperty'].includes(String(i.text).toLowerCase())
  );
  assert.equal(protoHits.length, 0, `prototype-name tokens flagged: ${JSON.stringify(protoHits)}`);
});

test('#109 complement: real tier1 vocabulary still fires after the hasOwn guard', () => {
  const r = AIDetector.analyzeText(
    'We delve into the constructor design of this system. The team continues to navigate this comprehensive transformation across every module boundary.'
  );
  const tier1Texts = r.issues.filter((i) => i.type === 'tier1').map((i) => String(i.text).toLowerCase());
  assert.ok(tier1Texts.includes('delve'), `expected 'delve' to still fire, got tier1=${JSON.stringify(tier1Texts)}`);
  assert.ok(!tier1Texts.includes('constructor'), 'constructor must not ride along in tier1');
});

test('performed-insight: essayist tics fire', () => {
  const r = AIDetector.analyzeText(
    "Turns out the pricing was never the obstacle for any of the customers. That's not nothing. Sit with that for a moment before the next planning meeting, and remember that distribution is the whole game."
  );
  const hits = r.issues.filter((i) => i.type === 'performed-insight').map((i) => i.text);
  assert.ok(hits.length >= 3, `expected >=3 performed-insight hits, got ${JSON.stringify(hits)}`);
});

test('performed-insight: ordinary uses do not fire', () => {
  const r = AIDetector.analyzeText(
    "She sat with him through the appointment and the long drive home afterward. The whole family gathered for the reunion photos on Saturday. Naming names in the report was the part of the job he liked least of all."
  );
  const hits = r.issues.filter((i) => i.type === 'performed-insight');
  assert.equal(hits.length, 0, `false positives: ${JSON.stringify(hits.map((i) => i.text))}`);
});

test('performed-insight: determiner "sit with that <noun>" and literal "only X I trust" stay clean', () => {
  const r = AIDetector.analyzeText(
    "Please sit with that decision overnight before you call the attorney tomorrow morning. This is the only doctor I trust with a procedure this complicated, and the referral took months to arrange."
  );
  const hits = r.issues.filter((i) => i.type === 'performed-insight');
  assert.equal(hits.length, 0, `false positives: ${JSON.stringify(hits.map((i) => i.text))}`);
});

test('performed-insight: literal punchline and naming senses stay clean', () => {
  const r = AIDetector.analyzeText(
    "The comedian rewrote the punchline: the timing was off and the audience missed the joke completely. The storm was worth naming, the meteorologists agreed after reviewing damage reports from every coastal town."
  );
  const hits = r.issues.filter((i) => i.type === 'performed-insight');
  assert.equal(hits.length, 0, `false positives: ${JSON.stringify(hits.map((i) => i.text))}`);
});

test('performed-insight: sentence-initial Turns out keeps a clean text and index', () => {
  const r = AIDetector.analyzeText(
    "A stable introduction goes here. Turns out the service was already running on the host, so the whole incident closed within about fifteen minutes."
  );
  const hits = r.issues.filter((i) => i.type === 'performed-insight');
  assert.equal(hits.length, 1, `expected 1 hit, got ${JSON.stringify(hits.map((i) => i.text))}`);
  assert.equal(hits[0].text, 'Turns out', 'boundary punctuation must not be consumed into the issue text');
  assert.equal(hits[0].index, 33, 'index must point at the phrase, not the preceding sentence boundary');
});

test('negation-chain: no-chains, didn\'t-chains, and don\'t-verb-it fire', () => {
  const r = AIDetector.analyzeText(
    "No fluff, no filler, no jargon. No padding, no throat-clearing, no detours will survive this editing pass. They did not ask for permission, did not wait for the committee. Don't call it a pivot. Call it a correction, plain and simple, colleagues."
  );
  const hits = r.issues.filter((i) => i.type === 'negation-chain');
  assert.equal(hits.length, 4, `expected 4 negation-chain hits, got ${JSON.stringify(hits.map((i) => i.text))}`);
  assert.equal(hits[0].text, 'No fluff, no filler, no jargon', 'no-chain must stop before trailing prose');
  assert.equal(hits[1].text, 'No padding, no throat-clearing, no detours', 'no-chain must not consume a trailing auxiliary');
});

test('negation-chain: idiomatic pairs stay clean', () => {
  const r = AIDetector.analyzeText(
    "No more, no less, no matter what the final contract required from the vendor after the audit."
  );
  const hits = r.issues.filter((i) => i.type === 'negation-chain');
  assert.equal(hits.length, 0, `false positives: ${JSON.stringify(hits.map((i) => i.text))}`);
});

test('negation-chain: ordinary narration with restated subjects stays clean', () => {
  const r = AIDetector.analyzeText(
    "I did not sleep well last night. I did not eat breakfast either, so I left home early and caught the first train into the city before sunrise."
  );
  const hits = r.issues.filter((i) => i.type === 'negation-chain');
  assert.equal(hits.length, 0, `false positives: ${JSON.stringify(hits.map((i) => i.text))}`);
});

test('negation-chain: mid-sentence technical inventories stay clean', () => {
  const r = AIDetector.analyzeText(
    "The endpoint takes no arguments, no headers, and no body when called in health-check mode. The parser accepts no flags, no options, and no positional parameters in its default configuration."
  );
  const hits = r.issues.filter((i) => i.type === 'negation-chain');
  assert.equal(hits.length, 0, `false positives: ${JSON.stringify(hits.map((i) => i.text))}`);
});

test('negation-chain: two-item sentence-initial factual inventories stay clean', () => {
  const r = AIDetector.analyzeText(
    "No tickets, no badges will be issued at the door for the conference this year. No maps, no lists were handed to the interns before the long field exercise began."
  );
  const hits = r.issues.filter((i) => i.type === 'negation-chain');
  assert.equal(hits.length, 0, `false positives: ${JSON.stringify(hits.map((i) => i.text))}`);
});

test('dev-blog-boilerplate: simplicity slogans fire', () => {
  const r = AIDetector.analyzeText(
    "The framework ships with sane defaults, and honestly it just works out of the box from the first install. The whole API is small enough to fit in your head after one afternoon of reading."
  );
  const hits = r.issues.filter((i) => i.type === 'dev-blog-boilerplate').map((i) => i.text);
  assert.ok(hits.length >= 3, `expected >=3 dev-blog-boilerplate hits, got ${JSON.stringify(hits)}`);
  assert.ok(hits.includes('it just works'), `out-of-the-box slogan must fire: ${JSON.stringify(hits)}`);
});

test('dev-blog-boilerplate: spaced and hyphenated out-of-the-box slogans fire', () => {
  for (const phrase of ['it just works out of the box', 'it just works out-of-the-box']) {
    const r = AIDetector.analyzeText(
      `The framework claims ${phrase} for every developer who follows the documented installation steps today.`
    );
    const hits = r.issues.filter((i) => i.type === 'dev-blog-boilerplate').map((i) => i.text);
    assert.deepEqual(hits, ['it just works'], `${phrase} must fire with an exact issue span`);
  }
});

test('dev-blog-boilerplate: ordinary prose stays clean', () => {
  const r = AIDetector.analyzeText(
    "The configuration file documents every default value we chose and why we chose it. The batteries included with the flashlight were already dead when we opened the sealed package at camp. It just works out to two queries after the optimizer merges identical branches."
  );
  const hits = r.issues.filter((i) => i.type === 'dev-blog-boilerplate');
  assert.equal(hits.length, 0, `false positives: ${JSON.stringify(hits.map((i) => i.text))}`);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll detector fixtures passed.');
