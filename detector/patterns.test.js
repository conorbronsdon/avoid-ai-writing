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

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll detector fixtures passed.');
