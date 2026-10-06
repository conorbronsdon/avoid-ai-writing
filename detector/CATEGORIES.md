# Category map: references/patterns.md ↔ detector

This table is the anti-drift contract between the human-readable rules in
`../references/patterns.md` and the executable engine in `patterns.js`. When you add a rule to
the skill, decide here whether it's regex-detectable (give it a detector `type`)
or LLM-only judgment (mark it so). When you add a detector `type`, point it back
at the skill section it enforces.

The engine exposes 54 issue `type`s (see `TYPE_LABELS` in `patterns.js`). The
skill has more `###` sections than that — the gap is **not** missing coverage,
it's rules that are judgment calls a regex can't make. The three groups below
account for every entry on both sides.

Three counts coexist on purpose and should not be forced to match: the README's
**pattern-category count** (the human-facing prose catalog, derived from references/patterns.md
and guarded in CI), the engine's **54 `type`s** (which split the vocabulary tiers
and add stylometric signals), and references/patterns.md's `###` sections (which also include
writer-side tests with no detectable form). The
`categories.test.js` enforces the engine ↔ this-file mapping, and checks every
prose statement of the engine `type` total against `TYPE_LABELS`.

## A. Direct mapping (skill rule → detector `type`)

| Detector `type` | Label | references/patterns.md section |
|---|---|---|
| `tier1` / `tier2` / `tier3` | AI vocabulary / Word cluster / Overused word | Words and phrases to replace (`tier3` fires per word at `max(3, floor(wordCount × 0.03))` uses of one listed form, so spread Tier 3 vocabulary stays clean; `load-bearing`: immediate abstract-noun allowlist only; literal, predicative, and unlisted forms pass; `technical` context mode suppresses eight technical-legitimate terms: `robust`, `comprehensive`, `seamless`, `ecosystem`, `leverage`, `facilitate`, `underpin`, `streamline`) |
| `tier1-clarity` | Wordiness | Words and phrases to replace (Tier 1B) |
| `transition` | AI transition | Transition phrases to remove or rewrite |
| `template-phrase` | Template phrase | Template phrases (avoid) — *partial; in the step-towards/forward shape, only the listed vague-praise adjectives (such as "major", "crucial", "significant") before "step" flag; neutral adjectives ("first", "small") stay clean regardless of the following goal; see references/patterns.md* |
| `tier3-phrase` / `tier3-phrase-cluster` | Boilerplate phrase / cluster | Template phrases (avoid) |
| `chatbot` | Chatbot artifact | Chatbot artifacts |
| `sycophantic` | Sycophantic tone | Sycophantic tone |
| `filler` | Filler phrase | Filler phrases |
| `hollow-intensifier` | Hollow intensifier | Filler phrases (intensifiers), except context-dependent `actually` (see §C) |
| `generic-conclusion` | Generic conclusion | Generic conclusions |
| `social-cta-closer` | Engagement-bait closer | Social endorsement closers |
| `future-narrative` | Generic future narrative | Generic future-narrative closers |
| `lets-construction` | "Let's" opener | "Let's" constructions |
| `reasoning-artifact` | Reasoning artifact | Reasoning chain artifacts |
| `significance-inflation` | Significance inflation | Significance inflation — *partial; the evolution-of shape requires an immediately preceding inflating word (such as "chapter", "milestone", "role", "turning point"); bare and neutral uses stay clean regardless of the following object; see references/patterns.md* |
| `novelty-inflation` | Novelty inflation | Novelty inflation *(the invented-concept-labels sub-rule is LLM-judgment only — open-ended coinages aren't regex-matchable)* |
| `real-actual-inflation` | "Real/actual" inflation | "Real/actual" adjective inflation |
| `vague-attribution` | Vague attribution | Vague attributions |
| `emotional-flatline` | Stock reaction framing | Stock reaction framing / Superficial -ing analyses *(stable API type; style-only for authorship scoring under the precision-first evidence policy)* |
| `lingering-attention` | Lingering-attention claim | Lingering-attention claims *(noun-anchored frames only — the bare "I keep coming back to X" stays LLM-judgment, since a following reason clause makes it legitimate and isn't regex-detectable)* |
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
| `unnecessary-hyphenation` | Unnecessary hyphenation | Unnecessary hyphenation *(curated open, closed, and position-dependent subclasses only)* |
| `launch-intro` | Launch-copy introduction | Launch-copy dramatic introductions *("Meet X," plus one of "your new favorite", "your new go-to", "the new home of", "the new way to", "the new standard in/for", or a bare home/way/standard at end of clause; and "Think X meets Y". X is ONE capitalized 2-30 character token, so two-token names miss. Bare "Enter X.", bare "Meet X, your new [role]" and "Say hello to X" stay LLM-judgment; person-name variants are disclosed residue — see the entry)* |
| `crowd-contrast` | Dramatized crowd contrast | Dramatized contrast against the crowd *(three branches: "was\|were\|is\|are" + "still" + a dismissive verb in **-ing**, plus the stereotyped "writing\|wrote think-pieces" and "play\|plays\|played\|playing catch-up" wordings, which need no marker; the crowd is the closed list "everyone else\|others\|the industry\|the market\|the competition", so "every competitor" and "our rivals" miss — ordinary simultaneity without those verbs stays clean; every literal progressive use of them is accepted, disclosed residue, and so are literal "wrote think-pieces" / "played catch-up" contrasts — see the entry)* |
| `fake-casual-prop` | Fake-casual prop | Fake-casual register *(six asterisk stage directions and the four (yes\|no) x (really\|seriously) parentheticals, nothing else. "chef's kiss" requires its apostrophe, and neighbours like "*checks calendar*" and "(yes, honestly)" are disclosed misses. Verdict closers, label-prefix openers, the self-QA volley and "because of course it does" stay LLM-judgment)* |
| `performed-insight` | Performed-insight phrase | Performed-insight phrases — *partial; literal-sense exclusions documented in references/patterns.md* |
| `negation-chain` | Negation chain | Negation chains — *partial; three-item deterministic threshold documented in references/patterns.md* |
| `negative-parallelism` | Negative parallelism | Sentence structure: "It's not X — it's Y" — *partial: the joined frame needs a restated "it / this / that / they" + be after a comma, semicolon, colon, or dash. "isn't just / merely / simply X, it's Y" flags alone; the plain "isn't X, it's Y", "isn't about X, it's about Y", and "isn't only X, it's Y" frames and the split-sentence "isn't just X. It's Y." flag only when another frame starts within three sentences (the same sentence, the next, or the one after) in the same paragraph, so one correction per piece passes and unrelated corrections far apart stay clean. "not only X but Y" and "not X but Y" are ordinary correlatives and stay LLM-judgment, as do the multi-negation countdown and the tailing negation* |
| `dev-blog-boilerplate` | Dev-blog boilerplate | Dev-blog boilerplate — *partial; literal-sense exclusion documented in references/patterns.md* |

> **Partial map:** `smart-punct-signature` fires only when curly quotes co-occur
> with an em-dash, an Oxford comma, and clean typing (≥80 words) — never on curly
> punctuation alone. The references/patterns.md Formatting rule treats curly quotes as a weak,
> corroborating signal in plain-text contexts and excludes apostrophes. The two
> agree in spirit (curly punctuation is never conclusive on its own) but differ in
> mechanism — so this is a partial map, not 1:1.
> `performed-insight` omits literal "the punchline" and "worth naming" senses;
> `dev-blog-boilerplate` omits literal "batteries included." Those ambiguous
> surface forms remain judgment rules rather than deterministic matches.
> `negation-chain` requires three short sentence-initial "no …" items; two-item
> chains remain judgment calls.
> `negative-parallelism` flags a plain contrast only with a second frame within
> three sentences; a single "It isn't raining, it's snowing." stays clean.

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

- Transformation crutch (P2 unexplained relabeling, evaluated across the passage; literal and explained changes pass)
- False agency (P2 obscured accountable decision-makers; conventional personification, collective actors, emergent change, and causal dependence pass)
- Audience-fit domain-term collision (ambiguous generic proof/proof point in cryptography; separate from vocabulary tiers)
- Consequence-free "This matters because" / "here's why that matters" restatements (concrete consequences pass)
- Repeated empty concession pairs under Manufactured punchlines (P2; meaningful concessions and isolated intentional pairs pass)
- Synonym cycling
- Copula avoidance
- Promotional language
- Context-dependent `actually` as a hollow intensifier *(delete it when it only adds emphasis; keep it when it carries a named correction or expectation gap). The same token performs both jobs, so matching it unconditionally would flag ordinary corrective prose.*
- Sentence structure: split-sentence negation without a minimizer ("The headline isn't the speed. The real story is Y.") / multi-negation countdown / tailing negation / "not only X but Y" and "not X but Y" correlatives *(the joined "It's not X, it's Y" frame is `negative-parallelism` in §A)*
- Structural issues / Excessive structure / Inline-header lists / Numbered list inflation
- Moral-adjective category errors (including ontological slop on assumptions, gratuitous universal quantifiers)
- Invented contrast-pair mirroring
- Hyphenated modifier stacking
- Unnecessary hyphenation outside the detector's curated subclasses
- False ranges
- Notability name-dropping
- Vague third-party validation
- Self-labeling significance
- Wall-of-text replies (missing line breaks) *(tried as a detector — "reply-length, >=4 sentences, zero newlines" — and reverted; it fires on any ordinary short paragraph, not just conversational-reply register, so it stayed judgment-only. See the NOTE in `patterns.js` near the bullet-NP-list block)*
- Recap-flattery opener
- Acknowledgment loops *(tried as a detector — "you're asking about", "the question of whether", "to answer your question" — and retired (#239): the first opens ordinary replies and support answers ("You're asking about the retry limit. It is five by default..."), the third opens replies to a named earlier question ("To answer your question from Tuesday: the invoice went out on the 3rd..."), and the second is standard academic and analytical English. Both reply openers are document-initial in those examples, so position cannot separate them from the tell. Judging it needs reading whether the restatement adds anything before the answer arrives)*
- Narrated candor *(tried as a detector and reverted: the phrasings are shared with idiomatic conflict-of-interest disclosure ("in the interest of full disclosure, I own shares in...") and with the ordinary English comparative ("I'd rather die than let you drive"), so any regex tight enough to avoid those stopped matching the tell. Judging it needs reading whether the clause carries information or only announces that information is coming)*
- Immaculate typography in casual registers *(folded into the Formatting section — same weak-signal tier as curly quotes, not a standalone category)*
- Subjectless fragments and agentless passives *(docs and changelog registers are carve-outs — the fragment is the correct form there)*
- Diff-anchored writing *(changelogs, release notes, and migration guides are carve-outs)*
- List-label periods *(the period is correct when the label is itself a full sentence; telling a noun-phrase label from a short sentence needs reading)*
- Speculative gap-filling *(the same hedges are correct when the source itself is uncertain; the tell is a guess standing in for a missing fact, which a regex can't see)*
- Infomercial engagement hooks *(the tell is a staged setup-and-reveal, not the words: "honestly" or "look" mid-sentence is ordinary English)*
- Manufactured punchlines and staccato drama (including repeated setup/reversal punchlines: P2 only when repetition replaces concrete claims; supported reversals and intentional comedy, fiction, speeches, and quotations pass)
- Aphorism formulas *(a regex for "X is the Y of Z" would flag ordinary genitive copulas — "Paris is the capital of France")*
- Stacked rhetorical questions *(interviews, FAQs, and dialogue stack questions legitimately; a regex can't read register)*
- Same-opener sentence runs *(whether the anaphora is earned is the whole judgment; pronoun-opener runs are ordinary narration)*
- Stranded auxiliary contrast *(a single instance is legitimate style; only density across a piece distinguishes voice from tic)*
- Colon into a triple *(three-item lists are often simply true, especially in technical writing — weigh by genre, not per hit)*
- When to rewrite from scratch vs. patch
- Severity tiers (P0 / P1 / P2) *(the engine has a fourth severity, `low` (P3), with no counterpart in the writing rules, and its labels can differ from the skill's tier for the same rule; see the severity table in [`README.md`](./README.md#severity-and-p-tiers))*
- Self-reference escape hatch *(the engine applies the quoted-material half: blockquote lines and double-quoted spans are masked before scoring, see [`README.md`](./README.md). Single-quoted spans and text marked as illustrative stay judgment-only)*
- Paragraph-reshuffle immunity (structure test) and Treadmill effect / low information density (content test) *(writer-side tests, not text patterns; out of scope for the detector)*
- Output format

> **Partial:** the skill's six context profiles map to the engine's broader
> `options.contextMode` values as documented in
> `references/patterns.md#detector-mode-mapping`. Only `technical` currently
> changes flagging behavior (skips title-case headers and suppresses eight
> technical-legitimate terms: `robust`, `comprehensive`, `seamless`, `ecosystem`,
> `leverage`, `facilitate`, `underpin`, `streamline`); `marketing` and `personal`
> are accepted and reported in stats but score like `general`. Full profile-based
> tolerance remains an LLM-side judgment.
