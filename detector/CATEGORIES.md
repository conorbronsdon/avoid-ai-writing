# Category map: SKILL.md ↔ detector

This table is the anti-drift contract between the human-readable rules in
`../SKILL.md` and the executable engine in `patterns.js`. When you add a rule to
the skill, decide here whether it's regex-detectable (give it a detector `type`)
or LLM-only judgment (mark it so). When you add a detector `type`, point it back
at the skill section it enforces.

The engine exposes 45 issue `type`s (see `TYPE_LABELS` in `patterns.js`). The
skill has more `###` sections than that — the gap is **not** missing coverage,
it's rules that are judgment calls a regex can't make. The three groups below
account for every entry on both sides.

Three counts coexist on purpose and should not be forced to match: the README's
**pattern-category count** (the human-facing prose catalog, derived from SKILL.md
and guarded in CI), the engine's **45 `type`s** (which split the vocabulary tiers
and add stylometric signals), and SKILL.md's `###` sections (which also include
writer-side tests with no detectable form). The
`categories.test.js` check enforces only the engine ↔ this-file mapping.

## A. Direct mapping (skill rule → detector `type`)

| Detector `type` | Label | SKILL.md section |
|---|---|---|
| `tier1` / `tier2` / `tier3` | AI vocabulary / Word cluster / Overused word | Words and phrases to replace |
| `transition` | AI transition | Transition phrases to remove or rewrite |
| `template-phrase` | Template phrase | Template phrases (avoid) |
| `tier3-phrase` / `tier3-phrase-cluster` | Boilerplate phrase / cluster | Template phrases (avoid) |
| `chatbot` | Chatbot artifact | Chatbot artifacts |
| `sycophantic` | Sycophantic tone | Sycophantic tone |
| `acknowledgment-loop` | Acknowledgment loop | Acknowledgment loops |
| `filler` | Filler phrase | Filler phrases |
| `hollow-intensifier` | Hollow intensifier | Filler phrases (intensifiers) |
| `generic-conclusion` | Generic conclusion | Generic conclusions |
| `social-cta-closer` | Engagement-bait closer | Social endorsement closers |
| `future-narrative` | Generic future narrative | Generic future-narrative closers |
| `lets-construction` | "Let's" opener | "Let's" constructions |
| `reasoning-artifact` | Reasoning artifact | Reasoning chain artifacts |
| `significance-inflation` | Significance inflation | Significance inflation |
| `novelty-inflation` | Novelty inflation | Novelty inflation *(the invented-concept-labels sub-rule is LLM-judgment only — open-ended coinages aren't regex-matchable)* |
| `real-actual-inflation` | "Real/actual" inflation | "Real/actual" adjective inflation |
| `vague-attribution` | Vague attribution | Vague attributions |
| `emotional-flatline` | Emotional flatline | Emotional flatline / Superficial -ing analyses |
| `cutoff-disclaimer` | Cutoff disclaimer | Cutoff disclaimers |
| `false-concession` | False concession | False concession structure |
| `rhetorical-question` | Rhetorical question | Rhetorical question openers |
| `formulaic-opener` | Formulaic opener | Formulaic challenges |
| `speculative-opener` | Speculative scenario opener | Speculative scenario openers |
| `confidence-calibration` | Confidence stacking | Confidence calibration phrases |
| `hedge-stack` | Hedge-stacked prediction | Hedge-stacked predictions |
| `parenthetical-hedge` | Parenthetical hedge | Parenthetical hedging |
| `hashtag-stuff` | Hashtag stuffing | Hashtag stuffing |
| `bullet-np-list` | Bullet-NP list | Bullet lists of bare noun phrases |
| `title-case-header` | Title Case header | Title case headings |
| `em-dash` / `formatting` | Em dash overuse / Formatting | Formatting |
| `uniformity` | Rhythm uniformity | Rhythm and uniformity |
| `low-ttr` | Low vocabulary diversity | Vocabulary diversity (stylometric) |
| `ai-placeholder` | Unfilled placeholder | Unfilled placeholders |
| `ai-citation-markup` | Chatbot citation markup leak | Chatbot citation markup leaks |
| `ai-utm-source` | AI-tool URL parameter | AI-tool URL parameters |
| `smart-punct-signature` | Smart-punct signature | Formatting (curly quotation marks) — *partial* |

> **Partial map:** `smart-punct-signature` fires only when curly quotes co-occur
> with an em-dash, an Oxford comma, and clean typing (≥80 words) — never on curly
> punctuation alone. The SKILL.md Formatting rule treats curly quotes as a weak,
> corroborating signal in plain-text contexts and excludes apostrophes. The two
> agree in spirit (curly punctuation is never conclusive on its own) but differ in
> mechanism — so this is a partial map, not 1:1.

## B. Detector-only (stylometric / fingerprint — no skill prose)

These extend the skill with signals that work as math over the whole document,
not as a phrase a human editor would look up:

| Detector `type` | Label | Why it's engine-only |
|---|---|---|
| `punct-distribution` | Punctuation distribution | Per-paragraph punctuation uniformity |
| `fnword-trigram-entropy` | Grammar repetition | Function-word trigram entropy |
| `cross-para-burstiness` | Cross-paragraph rhythm | Sentence-length variance across paragraphs |
| `normalization-flag` | Bypass-trick chars | Zero-width / homoglyph humanizer-bypass detection |

## C. Skill-only (LLM judgment — no detector `type`)

Rules that require reading for meaning, so they live in the skill prose and are
applied by the model, not the regex engine. Listed so future contributors don't
mistake their absence for a coverage gap:

- Synonym cycling
- Copula avoidance
- Promotional language
- Sentence structure: "It's not X — it's Y" / split-sentence form / multi-negation countdown / tailing negation
- Structural issues / Excessive structure / Inline-header lists / Numbered list inflation
- False ranges
- Notability name-dropping
- Vague third-party validation
- Self-labeling significance
- Wall-of-text replies (missing line breaks) *(tried as a detector — "reply-length, >=4 sentences, zero newlines" — and reverted; it fires on any ordinary short paragraph, not just conversational-reply register, so it stayed judgment-only. See the NOTE in `patterns.js` near the bullet-NP-list block)*
- Recap-flattery opener
- Immaculate typography in casual registers *(folded into the Formatting section — same weak-signal tier as curly quotes, not a standalone category)*
- Subjectless fragments and agentless passives *(docs and changelog registers are carve-outs — the fragment is the correct form there)*
- Diff-anchored writing *(changelogs, release notes, and migration guides are carve-outs)*
- Manufactured punchlines / staccato drama
- Aphorism formulas *(a regex for "X is the Y of Z" would flag ordinary genitive copulas — "Paris is the capital of France")*
- When to rewrite from scratch vs. patch
- Severity tiers (P0 / P1 / P2)
- Self-reference escape hatch
- Output format

> **Partial:** the skill's **Context profiles / Tolerance matrix / Auto-detection
> cues** are partly realized by the engine's `options.contextMode`
> (`general` / `technical`), which suppresses context-inappropriate flags. Full
> profile-based tolerance remains an LLM-side judgment.
