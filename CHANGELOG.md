# Changelog

All notable changes to this project are documented here.

---

## [3.22.1] — 2026-07-31

### Fixed

- **`title-case-header` never fired on a Markdown heading (#62).** The pattern was anchored `^[A-Z][a-z]+`, which requires the line to begin with a capital letter. A Markdown heading begins with `#`, so the anchor failed and `## Benefits And Strategic Considerations` produced no issue. The rule caught the bare-line form (`Benefits And Strategic Considerations`) while missing the commonest way a heading is actually written, which is also the form the bare line usually gets converted from. Now accepts and discards an optional `#{1,6}` prefix. Setext headings were already covered, since their text line is bare.
- Reported by a downstream that vendors `detector/patterns.js` byte-identical to a pinned commit, so they filed rather than patching locally. Worth noting as the first externally-reported detection gap.
- Two fixture groups pin it: the rule fires on `#`, `##` and `######` headings, and stays quiet on a sentence-case heading, on `##Text` with no space (not a heading), and on seven hashes (not a heading). Sentence case is the correct form, so flagging it would invert the rule.
- **The false-positive claim in the first version of this entry was wrong, and worth recording as such.** It read "no measurable false-positive cost", citing `npm run fp` being byte-identical before and after. It is: `title-case-header` does not appear in that corpus at all, because the corpus is prose with no Markdown headings. An instrument that cannot see a change returning "no change" is not evidence, and the entry stated that limitation and drew the opposite conclusion from it in adjacent sentences. Adversarial review found the regression the measurement could not.


### Fixed (follow-up, same day)

- **The heading prefix leaked into the proper-noun guard.** `matchPatterns` reports `match[0]`, so a Markdown hit arrived as `## Terms Of Service` and `##` counted as a token — silently lowering the guard from four content words to three, for headings only. `## Terms Of Service`, `## Bank Of America`, `## Table Of Contents` and `## Pride And Prejudice` all flagged: ordinary human headings, on a detector whose first priority is not firing on human writing. The filter now strips the prefix and trims before counting.
- **A `HUMAN_ONLY` → `MIXED` claim was removed from this entry rather than corrected.** It cited an unnamed README and could not be reproduced. Writing an unverifiable number into the entry that exists to retract an unverifiable number is the same mistake twice, so it is recorded rather than quietly deleted. The measured numbers below replace it.
- **Headings opening with a function word are no longer flagged, and this is the measured part.** The proper-noun guard tested `/\b(?:And|Or|Of|The|…)\b/` against the whole title with no position constraint, so a leading `The` satisfied it — while the guard's own comment has always specified a *mid-sentence* "And". Across 989 real Markdown files this rule went from 0 hits on `main` (the `^[A-Z]` anchor made it dead on `#` headings) to 35. On an 81-file subcorpus that provably predates LLMs — 2018-19 eBooks stamped `year:`, 2020 posts — it produced **13 false positives against zero on main**, every one opening with `The`: "The New Security Landscape", "The Microsoft Approach to Identity", "The Four Keys to a Successful and Secure Modern Workplace". Requiring the function word to be interior eliminates all 13 and leaves the target case firing. Those six headings are now fixtures.
- **Fence detection rewritten to track the opening delimiter instead of counting delimiters.** A parity count is wrong on the exact case the check exists for: a four-backtick fence wrapping a three-backtick example — how you document fences — inverts it. Also handles CommonMark's up-to-three-space indent and an unclosed fence running to end of document. Computed once per scan rather than re-slicing the document per candidate, which was quadratic on a heading-dense file.
- **A latent off-by-one on the bare-line form is fixed as a side effect.** The pattern's trailing `\s*` swallowed the following newline, so `Terms Of Service` split into four tokens and fired on `main` despite having three content words. The `.trim()` corrects that, which means three-word Title Case lines are now quiet in both forms. This is a behaviour change beyond headings and a strict reduction in flags.
- **Still fires, deliberately:** a four-content-word Title Case heading such as `# The Art Of War` or `## Notes On The Design`. The `>= 4` guard cannot distinguish those from `## Benefits And Strategic Considerations` — same shape. Pre-existing, identical for the bare-line form, out of scope here.
- **Ten fixtures now pin this rule**, including a value assertion on `issue.text` (a presence-only check is what let the prefix defect through), the six pre-LLM human headings above, the four fence shapes a parity count gets wrong, and an indented-line case. Six mutations were run against the result — dropping the mid-title constraint, the token floor, the prefix strip, the trim, tab support, and the word anchors — and all six fail a test. The tab-support fixture had to be rewritten to catch its mutant: on a heading whose function word is interior, an unstripped `##` only raises the token count and the verdict is unchanged, so the probe has to open with a function word.

### Note

`#67` (em-dash carve-out for changelog headings and bold-lead parentheticals) and `#69` (hedge-stack over-matching `could not possibly`) were both fixed in 3.22.0 and verified here against the shipped detector. The issues are still open and can be closed.

---

## [3.22.0] — 2026-07-31

### Added

Two pieces of enforcement. No new detection categories: the catalog stays at 61 and the engine at 46 `type`s.

- **Preservation validator** (`detector/validate.js`, `detector/validate.test.js`). Edit mode writes to files, and until now the promises it makes were prose instructions to a model with nothing checking them. `validate(original, rewritten)` errors when a rewrite modifies a fenced code block, YAML frontmatter, a blockquote, a table cell, inline code, a URL, a file path, or the heading count and nesting, and when the rewrite ends with more flagged patterns than it started with. Warnings cover reworded headings, figures that vanished, and rewrites that drop more than 40% of the words. There is a CLI (`node detector/validate.js before.md after.md`) that exits 1 on any error. 23 tests, no dependencies.
- **Two carve-outs, because a validator that fires on its own skill's instructions gets switched off.** URLs are compared with AI tracking parameters stripped from both sides, since the skill tells you to strip them; heading text changing is a warning rather than an error, since the skill tells you to sentence-case Title Case headings and cut emoji from them.
- **Self-scan and `PROOF.md`** (`scripts/self-scan.js`). Scores this repo's documentation with this repo's detector and publishes both numbers: raw, which counts every pattern quoted as an example, and exempt, which applies the self-reference escape hatch `SKILL.md` has documented in prose since v1 and never implemented. Budgets gate the exempt column in CI and only move down.
- The scan found two gaps in our own work, both recorded in `PROOF.md` rather than quietly patched: the em-dash rule carves out list-item separators but not Keep-a-Changelog version headings (`## [3.21.0] — 2026-07-30`) or a bold lead term with a parenthetical before the dash, and roughly half of `CHANGELOG.md`'s residual score is release notes enumerating the very words each new rule catches.

- **"Never inject these" guardrails** in `SKILL.md`, under Tone calibration. The instruction to put voice back on purpose has a predictable failure mode: the model installs a personality the author never had, trading one detectable register for a louder one. Seven additions are now out of bounds regardless of how the result scores: fake first person, manufactured stakes, forced contrarianism, performed candor, em-dash theatrics, staccato conversion, and invented specifics. The governing test is provenance: subtraction and sharpening are in scope, addition of stance, personality, or fact is not. These are constraints on the editor rather than detections on the text, which is why they sit with the rewrite instructions and do not change the catalog count. Adapted from `isatimur/de-slop`'s guardrails.
- **False-positive issue template** (`.github/ISSUE_TEMPLATE/false_positive.yml`). A rule firing on human writing is the defect this project most wants reported, and the form collects what makes a report measurable rather than anecdotal: the shortest text that fires, the register, how the text was actually written, and whether it can become a public fixture. Register is the field that matters most, since false-positive rates differ sharply across blog, docs, academic, and chat prose.

- **Human-control corpus and false-positive measurement** (`corpus/`, `scripts/corpus.js`, `scripts/fp-measure.js`). This repo has always asserted things about false positives — the tiering exists to reduce them, the tolerance matrix relaxes rules per register, `SKILL.md` opens with "signals, not proof" — and had never measured one. Every document in the corpus was written by a person, so every flag on it is a false positive by construction: no labelling, no judge, no model in the loop. The corpus is hash-only; text is fetched into a gitignored cache or read from wherever it already lives, and only hashes and metadata are committed. Register is the unit of analysis, following patina's finding that false-positive rates ran from 4% to 34% across registers inside one language.
- **First measurement: 0.0% false positives at every threshold across 560 paragraphs, Wilson 95% CI 0.0–0.7%, worst paragraph 11 out of 100.** The corpus is nine public-domain works (1788–1907) plus 25 of the maintainer's own blog posts from 2019 to December 2022, read from pre-2023 `web.archive.org` captures rather than the live site. At the document-score level the detector does not fire on human prose. The same measurement against the current published versions of those posts also returned 0.0% across 628 paragraphs, so the result does not depend on which copy was measured.
- **Provenance is verified, not assumed.** The old site used compressed slugs (`beveragetax`, `challengerfunnel`) that do not match current URLs, so archived candidates were found by slug similarity and then confirmed by content: a capture is accepted only at 0.45+ Jaccard similarity against the current text. Genuine matches land between 0.76 and 0.98; four slug guesses scored below 0.17 and were rejected by that check rather than silently accepted. Nine posts with no verifiable pre-2023 capture were dropped rather than included on their current-site text. Worth recording separately: the median archived capture is only 0.92 similar to its currently published counterpart, so the live site's posts have been edited since, and measuring "pre-2023 writing" against them would have measured the wrong thing.
- **The flag level says something else, and `detect` mode shows users flags rather than scores.** On the maintainer's Wayback-verified pre-2023 posts, `em-dash` fires on 18.3% of paragraphs and `tier1` on 12.5%. The Tier 1 words responsible are `embrace` (7), `leverage` and inflections (7), `when it comes to` (5), `in order to` (4), `that said` (4). Those are not AI tells in that text; they are a marketer's ordinary 2019 vocabulary, written years before the models existed. Both rates are slightly higher on the verified originals than on the current published versions, which is what later editing passes would do. Recorded in `corpus/README.md` as a decision to make rather than a defect to patch.
- Two defects surfaced and are filed rather than patched here: `hedge-stack` matches ordinary negation such as "could not possibly" (#69), and the `em-dash` flags on the public-domain leg are an artifact of era and Gutenberg transcription, so nineteenth-century text cannot test that rule at all.
- Corpus hygiene worth recording: two guest posts were excluded by byline, and three posts carrying "Looking back from 2025" retrospective inserts were dropped because their pre-LLM provenance is broken. The second was caught by reading the worst-scoring paragraphs, not by any check in the tooling.
- `scripts/corpus.test.js` covers the extraction helpers with 15 tests. A silent extraction bug would not crash anything; it would quietly change a published rate. Two tests exist purely to protect the measurement: em dashes must survive extraction, since the em-dash rule is scored against this corpus, and extraction must throw rather than return empty text, since an empty document would shrink the denominator without saying so.
- **Tier 1 split into 1A frequency markers and 1B clarity edits.** Tier 1 is defined by an empirical claim — these words "appear 5–20x more often in AI text than human text" — and several members could not plausibly meet it. `in order to`, `utilize`, `serves as`, `features`, `boasts`, `commence`, `ascertain`, and `endeavor` are wordiness and formality edits: worth making, but not evidence that a machine wrote the sentence. They now emit `tier1-clarity`, are weighted like Tier 2, and are excluded from the dense-AI-vocabulary signal, so a wordiness fix can no longer push a document toward an AI classification. The edit advice is unchanged for every word; what changed is what a flag claims. Detect mode reports the two bands separately.
- **The measurement that prompted it.** Against 257 paragraphs of the maintainer's verified pre-2023 writing, Tier 1 fired on 12.5%. Split, that is 8.9% markers and 3.5% clarity, with no paragraph triggering both. Roughly a quarter of Tier 1 hits on genuine human prose were wordiness being reported as an AI signal. `commence` and `ascertain` firing on the Federalist Papers and Faraday is the same problem from the formal-register end.
- **The 5–20x claim is now labelled as inherited rather than measured.** It traces to `brandonwise/humanizer`, which asserts the ratio in two places and publishes no method or dataset. `SKILL.md` says so plainly and commits to re-deriving the ratios once a machine-written corpus exists. The conflation of wordiness with frequency evidence is inherited too: `in order to`, `utilize`, and `serves as` are on that upstream list.
- **Machine-written corpus, and the first true-positive rate this project has ever had.** Two external datasets, neither generated by anyone with a stake in these numbers: RAID (Dugan et al. 2024, MIT — 11 model families, sampled by byte-range from an 11.8 GB CSV) and HC3 (Guo et al. 2023, CC-BY-SA-4.0 — paired human and ChatGPT answers to the same questions). Same hash-only design as the human half. `scripts/csv-lite.js` vendors a small RFC 4180 reader because the RAID generations contain commas, quotes, and newlines, and splitting on delimiters would silently corrupt the text being measured.
- **The composite score does not separate the classes.** ROC-AUC 0.501 at paragraph level pooled (HC3 0.554, RAID 0.451) and 0.623 at document level (HC3 0.654, RAID 0.599). The best operating point found costs 12.8% false positives to catch 27.7% of machine text. 0.5 is a coin flip.
- **The 0–100 scale uses about a tenth of its range.** No paragraph of either class scored above 11, so every threshold at or above 15 reports 0.0% on both sides, and `SKILL.md`'s own band puts everything at or under 15 in "Minimal AI signals". Category weights run 2–12 and `rawScore` is divided by `max(1, log2(words / 50))`. This is a calibration defect rather than a detection failure, and it is the most fixable finding on the page.
- **The discriminating signal is structural, not lexical.** At document level `uniformity` fires on 2.1% of human text and 25.1% of machine text, a lift of 11.7x — the best discriminator in the engine by an order of magnitude. `filler` is 3.4x; `chatbot`, `hedge-stack`, and `fnword-trigram-entropy` are machine-only. The 112-entry vocabulary table has a lift of **0.9**: it fires slightly more often on human writing than on machine writing. That is what `NulightJens/humanizer-stack` argues from StoryScope and what `harshaneel/humanize` reaches independently, and on this engine they look right.
- **`em-dash` is inverted as an authorship signal**, firing on 9.9% of human documents and 1.9% of machine ones (lift 0.2). It holds on both legs and is not a transcription artifact. Unchanged as writing advice; recorded because it points the wrong way as evidence.
- Sampling note worth keeping: evenly spaced byte offsets across RAID returned *fewer* model families at 40 windows than at 16, having resonated with the file's domain-then-model sort order and missed gpt4, chatgpt, and cohere entirely. Offsets now follow a golden-ratio low-discrepancy sequence, and the builder warns at build time when model, domain, or unit coverage falls short.
- **Fixed the two defects the measurement found.** `hedge-stack` allowed two words between the modal and the hedge adverb, so `could not possibly` and inverted questions like `could a savage possibly` both fired; it now allows at most one and never a negator (#69). The em-dash rule carved out list-item separators but not Keep-a-Changelog version headings (`## [3.21.0] — 2026-07-30`) or a bold lead term carrying a parenthetical (#67); both are carve-outs now. The version-heading pattern is deliberately narrow — a bracketed semver, a dash, an ISO date, nothing else — because `SKILL.md` applies the em-dash rule to headings too, and a prose dash in a heading still counts.
- **Both fixes improved discrimination, measured on the corpus.** `hedge-stack` went from firing on 0.6% of human units with a lift below 1 (it fired more on human text than machine text) to 0.2% with a lift of 2.2. `em-dash` false hits on human text dropped from 17.9% to 13.7%. Its lift stays inverted at 0.1, which is a finding about the signal rather than a bug in the rule.

### Changed

- `npm test` now runs the preservation tests as well. `npm run self-scan` and `npm run self-scan:check` are new. CI runs the self-scan check as a step in the existing `detector` job rather than a second job, since branch protection pins required checks by job name.
- Edit mode's output format in `SKILL.md` now points at the validator as an optional mechanical check.

---

## [3.21.0] — 2026-07-30

### Added

One judgment-only rule. Catalog goes from 60 to 61 detection categories; the engine stays at 46 `type`s.

- **Narrated candor** — announcing your own disclosure instead of disclosing: `"Two caveats I would rather flag than let you discover later:"`, `"I want to be upfront:"`, `"rather than bury this"`, `"I could have left this out, but"`. The content is "Two caveats:"; the rest advertises the writer's forthrightness. Completes a set with two existing rules: **chatbot artifacts** perform helpfulness and **sycophantic tone** flatters the reader, while this performs candor about oneself. Usually arrives as a matched antithesis (*flag* rather than *let you discover*), which is a tell in its own right. Added to the P1 severity tier.
- **Implemented as a detector, then reverted before release**, following the precedent set by wall-of-text replies. An adversarial review of the first implementation found it flagged idiomatic conflict-of-interest disclosure (`"In the interest of full disclosure, I own shares in the company discussed in this article"`) and the ordinary English comparative (`"I'd rather fix it than let you inherit the mess"`), and that the bounded-repeat pattern backtracked catastrophically on long `\w` runs — 36 seconds on a 4 KB input. Every regex tight enough to spare the carve-outs stopped matching the tell, so the rule ships as skill prose only. `detector/CATEGORIES.md` §C records the reasoning.
- **Two carve-outs are now explicit in the rule**, because they are the cases the failed detector proved are hard: conflict-of-interest disclosure keeps its conventional opening, and the ordinary comparative is not this pattern. The tell requires that what follows the frame is the disclosure itself.

---

## [3.20.0] — 2026-07-29

### Added

One rule with detector coverage, found while drafting a podcast teaser post. Catalog goes from 59 to 60 detection categories; the engine goes from 45 to 46 `type`s.

- **Lingering-attention claims** (`lingering-attention`) — the share-post frame that claims a thing has occupied the writer's mind rather than saying anything about the thing: `"the line I keep coming back to"`, `"I can't stop thinking about this"`, `"still thinking about this one"`, `"rattling around in my head all week"`, `"I've been chewing on this"`. Sits next to **emotional flatline** in the catalog but is a separate claim: flatline claims a *feeling* ("What surprised me most"), this claims *duration* of attention, which is unfalsifiable and self-flattering in a way a feeling isn't. It also opens a share post where **social endorsement closers** close one. Added to the P1 severity tier.
- **Precision carve-out.** The bare verb phrase `"I keep coming back to X"` deliberately does *not* fire, because it is legitimate whenever a reason follows ("I keep coming back to the exit-voice framing because it predicts which engineers quit"), and the reason clause is not reliably regex-detectable. Only the noun-anchored frame (`the line/quote/bit/idea ... I keep coming back to`) is matched — the shape that introduces a subject instead of asserting something about it. The bare form stays an LLM-judgment call in the skill prose. Fixtures cover both directions, including the must-not-fire case.

---

## [3.19.0] — 2026-07-24

### Added

Two judgment-only rules (no detector `type`) found during a real audit. Catalog goes from 57 to 59 detection categories.

- **Moral-adjective category errors** — AI glues moral adjectives (`honest`, `genuine`, `faithful`) onto non-agentic technical nouns (`shape`, `number`, `representation`) where the modifier cannot literally apply. Also covers passive-voice moral adverbs (`"described honestly"`), ontological slop on assumptions (`"stops being true"`), and gratuitous universal quantifiers (`"every first-year course"`).
- **Invented contrast-pair mirroring** — AI fabricates the second half of a contrast pair for symmetry (`"false precision rather than genuine accuracy"`, where the first term is real and the second is phantom).
- Both added to the P1 severity tier and the tolerance matrix (relaxed for `technical-blog` and `docs` profiles).

---

## [3.18.0] — 2026-07-22

### Changed
- **Em dashes** — carve-out for the definition-list separator position: an em dash after a bolded lead term or a markdown link opening a bulleted or numbered list item (`- **Term** — description`, `- [label](url) — description`) is typography, not a prose splice, and no longer counts toward the 1-per-1,000-words rate. The detector's exclusion requires the list marker — a line-initial `**Bold lead** — full sentence` outside a list is itself an AI tell and still counts, as do mid-sentence splices; the `--` substitute is never carved out. The same separator dashes no longer corroborate the `smart-punct-signature` co-occurrence check either — its em-dash leg now requires a non-separator dash. Fixtures added for all the boundaries: bulleted and numbered definition lists stay clean, markerless bold-lead splices and flowing-prose splices still fire, and a curly-quoted definition list with separator-only dashes no longer completes the smart-punct signature. This repo's own README and changelog use the separator convention throughout, which is what the strict-context false positive looks like in practice. (The same carve-out was independently proposed upstream in `blader/humanizer` PR #190.)

---

## [3.17.0] — 2026-07-20

### Added

Four categories harvested from [`blader/humanizer`](https://github.com/blader/humanizer) v2.8.2, the residue of a full cross-audit against its 33-pattern catalog (most were already covered here, several via earlier adaptations). Catalog goes from 53 to 57 detection categories. All four are LLM-judgment rules (no detector `type`): each needs reading for meaning, and the obvious regexes fail the precision-over-recall bar — "X is the Y of Z" matches "Paris is the capital of France."

- **Subjectless fragments and agentless passives** — "No configuration file needed," plus the actor-hiding passive ("Support for nested queries was added"). Docs and changelog registers carved out — the fragment is the correct form there — plus a tolerance-matrix row so `docs`/`casual` skip it entirely. Adapted from `blader/humanizer` P13.
- **Diff-anchored writing** — docs narrating the edit instead of the artifact ("This function was added to replace..."). Version-scoped documents (changelogs, release notes, migration guides, decision records) carved out. Adapted from `blader/humanizer` P30.
- **Manufactured punchlines and staccato drama** — three or more same-shape reveal-fragments in a row. Reconciled with Rhythm and uniformity: one emphatic fragment is human variation, the drumroll is the tell. Adapted from `blader/humanizer` P31.
- **Aphorism formulas** — "X is the language of Y." Quotations and established idioms carved out. Adapted from `blader/humanizer` P32.

### Changed
- **"It's not X — it's Y"** — extended with the **tailing negation**, the clipped fragment form of the same contrastive move ("The options come from the selected item, no guessing"). Spec-constraint lists ("no dependencies, no telemetry") stay clean. Adapted from `blader/humanizer` P9.
- **Excessive structure** — extended with **fragmented headers**: a heading followed by a one-line warm-up that restates it ("## Performance", then "Speed matters."). Adapted from `blader/humanizer` P29.
- **Infomercial engagement hooks** — extended with **fake-candid openers**: "Honestly?", "Look,", "Real talk:" as standalone pause-and-reveal stagers; mid-sentence "honestly" or "look" is ordinary English and stays unflagged. Adapted from `blader/humanizer` P33.
- **Tone calibration** — gains a put-voice-back note adapted from humanizer's "Personality and soul" section: a rewrite that clears every flag but reads sterile is still recognizably machine output; when the genre carries a voice, re-inject one deliberately, and leave neutral registers neutral.

### Source
- Cross-audit run 2026-07-20 against `blader/humanizer` v2.8.2, which grounds its catalog in [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (WikiProject AI Cleanup). Earlier releases had already absorbed P21, P26, and P27 directly, and P34/P35/P38/P41/P43 via `Aboudjem/humanizer-skill`; these additions are the remaining gaps that survived a false-positive review.

---

## [3.16.0] — 2026-07-15

### Added
- **"load-bearing" (metaphor) to Tier 1 word table** — LLMs, especially Claude, use "load-bearing" as a portable label for any dependency the argument rests on: "load-bearing assumption," "load-bearing claim," "load-bearing test," "load-bearing invariant." Added to both the SKILL.md Tier 1 table and the detector engine as a `TIER1_PHRASES` entry. Matches the hyphenated compound only — unhyphenated "load bearing" is ordinary English ("the load bearing down on the bridge"). Construction carve-out: literal uses before a structural noun (`wall`, `beam`, `column`, `joist`, `truss`, `member`, `footing`, `slab`, `stud`, `partition`, `masonry`, `lintel`, `pier`, `rafter`, `girder`, `capacity`) are exempt, including with one material or position adjective in between (`load-bearing structural wall`). Abstract-capable nouns (`structure`, `element`, `frame`, `foundation`) are excluded from the carve-out on purpose, so the metaphor still fires on them. Known gap: predicative use ("the wall is load-bearing") still flags — carve-out design tracked in #56. Replacement: essential, critical, necessary — or say what breaks if you remove it. Sources: [Marek Šuppa — "Load-bearing" is becoming LLM speak](https://mareksuppa.com/til/load-bearing/); [Yaniv Bernstein (LinkedIn)](https://www.linkedin.com/posts/ybernstein_opus-47-has-dropped-a-new-ai-slop-writing-activity-7452530977479774208-kbQA); [Developers Digest](https://www.developersdigest.tech/blog/stop-claude-saying-load-bearing).

---

## [3.15.0] — 2026-07-08

### Added
- **Wall-of-text replies** — reply-length text (roughly under 150 words, four or more sentences) delivered as one unbroken paragraph with no line breaks anywhere, the shape LLMs default to in conversational registers (issue/PR comments, chat, DMs, casual email) where humans instead break at thought boundaries. Catalog goes from 51 to 52 detection categories. LLM-judgment rule, not a detector `type`: a first pass implemented it as a structural gate (reply-length + sentence floor + zero newlines) and it broke the "repeated Tier 1 phrase does not inflate score linearly" fixture on review — turned out "one paragraph, no internal line break" is just what an ordinary short paragraph looks like, not an AI-specific shape, so an unconditional detector would fire on routine human prose. Reverted per the precision-over-recall principle in `CONTRIBUTING.md`; documented in `detector/CATEGORIES.md` §C with the reasoning.
- **Recap-flattery opener** — replying to a person by summarizing their own work back at them with praise before getting to the point ("Thanks for all the legwork here — the X and Y you worked through are what made Z possible"). The reader already knows what they did; the recap performs appreciation instead of conveying information. Catalog goes from 52 to 53 detection categories. LLM-judgment rule (no detector `type` — the tell is redundancy with information the reader already holds, which requires reading both sides of an exchange, not a fixed phrase).

### Changed
- **Formatting** — extended the curly-quotes weak-signal tier with **immaculate typography in casual registers**: perfect spacing, punctuation, and capitalization in a context humans type fast (comments, chat) is corroborating evidence, never conclusive alone. Also flags the inverse: when editing a human's casual text, preserve their typos — smoothing them away erases the fingerprint that marks the text as theirs. LLM-judgment rule; folded into the existing Formatting section (same tier as curly quotes), no new category.
- Cursor port (`cursor-rules/avoid-ai-writing.mdc`) caught up from v3.12.0 to v3.15.0: ported the 3.13.0 (speculative scenario openers, "deeply" conditional Tier 2, multi-negation countdown, invented concept labels, historical analogy stacking) and 3.14.0 (vague third-party validation) rule changes it had missed, plus this release's three additions.

### Source
- Observed in the wild: a maintainer on a GitHub issue flagged an assisted-sounding reply with "I prefer to talk human to human." The block-paragraph shape and the recap of the maintainer's own prior work were the tells, not any single word. Name and repo withheld.

---

## [3.14.0] — 2026-07-07

### Added
- **Vague third-party validation** — manufacturing credibility by pointing at an *unnamed* external authority, usually with a generic superlative ("an outside party measuring the same models everyone runs and putting us on top," "independent testing confirms," "analysts agree"). The authority is faceless and the claim unfalsifiable, so the reader can't tell who measured what or go check. The inverse of **Notability name-dropping** (which over-names *specific* prestigious sources); a passage can run both moves at once. Carve-out: specifically attributed, checkable validation — a named benchmark, a linked report, a dated audit — stays unflagged, since the tell is the vagueness, not the citation. Catalog goes from 50 to 51 detection categories. LLM-judgment rule (no detector `type`); listed in `detector/CATEGORIES.md` §C. Addresses #39 (the follow-up half raised by @hiSandog).

---

## [3.13.0] — 2026-07-07

### Added
- **Speculative scenario openers** — the LLM habit of opening an argument with a hypothetical that lists desirable outcomes instead of making a claim: "Imagine a world where…", "Picture a future in which…", "Envision a world where…", including the comma-interrupted "Imagine, for a moment, a world where…" cadence. The scenario does the persuading; no evidence is offered. New detection category (49 → 50) and a `speculative-opener` detector `type` (44 → 45). Gated to the world/future/reality object plus where/in-which, so instructional "imagine you have a sorted array" and analytical "consider a scenario where…" stay clean. Known accepted false positive: fiction openings and staged thought experiments also match; the skill's carve-out handles that judgment, and a lone hit cannot flip a document's classification. Source: tropes.fyi ("Imagine a World Where…").
- **"deeply" as a conditional Tier 2 word** — one of the "magic adverbs" AI uses to inflate mundane descriptions. Stricter than standard Tier 2: "deeply" only counts toward a cluster in its significance collocations ("deeply integrated," "deeply committed," "deeply rooted"), because bare "deeply" is everyday English — adversarial testing showed an unconditional entry flags clean human prose ("deeply nested JSON… crucial") and can tip an otherwise-borderline human document across a classification boundary. Literal uses never count, in any company. Source: tropes.fyi ("Quietly" and Other Magic Adverbs).

### Changed
- **"It's not X — it's Y" contrastive rule** — extended to name the **multi-negation countdown** ("It's not the price. It's not the features. It's the trust."), the same reveal move inflated across several negated options. LLM-judgment rule; no new category. Source: tropes.fyi ("Not X. Not Y. Just Z.").
- **Novelty inflation** — extended to flag **invented concept labels**: pseudo-analytical compound terms coined mid-sentence and never defined ("the supervision paradox," "a coordination tax"). Naming a concept is not explaining it. LLM-judgment rule; no new category. Source: tropes.fyi ("Invented Concept Labels").
- **Notability name-dropping** — extended with a related-pattern note on **historical analogy stacking**: rapid-fire lists of past technologies or companies to borrow their weight ("like the printing press, the telegraph, and the internet before it"). LLM-judgment rule; no new category. Source: tropes.fyi ("Historical Analogy Stacking").

Trope review sourced from [tropes.fyi/directory](https://tropes.fyi/directory) and its [tropes-md digest](https://tropes.fyi/tropes-md), with thanks to the [tropes.fyi markdown gist](https://gist.github.com/ossa-ma/f3baa9d25154c33095e22272c631f5a1) by ossa-ma. Most of the 33 catalogued tropes were already covered; this release adds the gaps that survived a false-positive review.

---

## [3.12.0] — 2026-07-06

### Added
- **"quietly" to Tier 2 word table** — AI uses "quietly" as a significance adverb to imply underdog credibility without evidence: "quietly building," "quietly reshaping," "quietly becoming." On its own in a sentence it's fine; in a paragraph already leaning on other Tier 2 words it's a cluster tell. Added to both the SKILL.md Tier 2 table and the detector engine. The detector fires when "quietly" appears alongside one other Tier 2 word in the same paragraph. Replacement: cut the adverb, or name the concrete contrast. Source: tropes.fyi/tropes ("Quietly" and Other Magic Adverbs).

---

## [3.11.0] — 2026-07-05

### Changed
- **"It's not X — it's Y" contrastive rule** — broadened to name the **split-sentence variant**, where the negation and the correction land in two separate sentences ("The headline isn't the speed. The real story is Y.") rather than pivoting on a single dash or comma. The joined form was the rule's implicit template, so the two-sentence split — which reads as two innocent declaratives — was slipping through. Same move, now flagged. LLM-judgment rule; catalog stays at 49 categories. Addresses #39.

---

## [3.10.0] — 2026-06-10

### Added
- **List-label periods** — in bulleted lists where each item leads with a short label, LLMs end the label with a period and run the gloss as a separate sentence, where a person almost always uses a colon. Strongest with bold labels (`**Intros.**` vs `**Intros:**`); the unbolded shape (`- Intros. Years of...`) is the same tell, slightly weaker. The colon reads as "here's what this label means"; the period reads as a sentence the next clause then contradicts by continuing. Fix is to swap the period for a colon and lowercase the gloss, or drop the bold label entirely. Distinct from inline-header lists (bold headers that repeat the point): this rule is about the punctuation on the label, not the redundancy. Carve-out: a bold span that is a full standalone sentence keeps its period. Catalog goes from 48 to 49 detection categories. LLM-judgment rule (no detector `type`). Closes #31.

---

## [3.9.0] — 2026-06-05

### Added
- **Social endorsement closers** — the curatorial sign-off LLMs append to LinkedIn/X share posts, usually a colon teeing up a link: "This one is worth your time:", "This one's a must-read:", "Do yourself a favor and read this," "You won't want to miss this one," "Thank me later," "Bookmark this," "Don't sleep on this one." Performs a recommendation without giving the reader a reason to click. Distinct from the bare "worth [verb]ing" word-table entry (a single weak word inside a sentence) and from infomercial engagement hooks (mid-flow teasers) — this is the whole closing line of a social post. Demonstrative-anchored ("THIS one is worth your time") so it stays off plain human endorsements ("the book is worth reading, but the middle drags"). Catalog goes from 47 to 48 detection categories; the detector engine gains a `social-cta-closer` `type` (43 → 44). Closes #29.

---

## [3.8.0] — 2026-05-29

### Added
- **Self-labeling significance** — back-pointing labels that flag which item in a list is supposed to matter ("That last move is the contrarian one," "This is the interesting part," "That third bullet is the real story") instead of writing the list so the right item carries the weight on its own. Distinct from confidence calibration (which front-loads the cue) and emotional flatline (which prefaces a single claim) — this one back-points after the fact. Catalog goes from 46 to 47 detection categories. LLM-judgment rule (no detector `type`); documented in `detector/CATEGORIES.md` §C.

---

## [3.7.2] — 2026-05-28

### Changed
- **Curly quotation marks** — recalibrated per review of #15. Reframed from a "strong" tell to a **weak, corroborating** signal meaningful mainly in plain-text contexts (code comments, commit messages, plaintext drafts), since Word/Google Docs/macOS/iOS auto-curl quotes by default. Curly apostrophes (U+2019) are no longer flagged on their own (they appear in every contraction). Fixes the German low-9 example. Keeps it consistent with the deterministic detector's co-occurrence logic (#16).

---

## [3.7.1] — 2026-05-28

### Changed
- **Curly quotation marks** — refined the 3.7.0 "mixed straight/curly punctuation" rule into a single Formatting rule: flag the unexplained presence of Unicode curly quotes (U+201C / U+201D / U+2018 / U+2019) in otherwise plain-ASCII text as a copy-paste-from-chat fingerprint, with carve-outs for deliberate publication typography and locale-correct punctuation (French guillemets, German low-9 quotes).
- Version bump to 3.7.1.

### Credit
- Contributed by [@augustasas](https://github.com/augustasas) (#15).

---
## [3.7.0] — 2026-05-28

### Added
- **Hyphenated-pair overuse** — stacked compound modifiers ("a high-quality, well-architected, future-proof solution") and the attributive/predicate error (hyphenate "a high-quality report" but not "the report is high quality").
- **Speculative gap-filling** — hedged speculation dressed as background ("maintains a low profile," "is believed to have," "likely began his career") that hides a knowledge gap rather than admitting it. Distinct from cutoff disclaimers.

### Changed
- **Formatting** — added **mixed straight/curly punctuation** (quote/apostrophe style mixed in one document — a paste-from-chat-UI tell).
- **Confidence calibration phrases** — extended with **persuasive-authority tropes** ("the real question is," "at its core," "fundamentally," "make no mistake").
- Version bump to 3.7.0.

### Credit
- Patterns adapted from `blader/humanizer` (P21, P26, P27) and Wikipedia's "Signs of AI writing," identified in the competitive research tracked in #22.

---

## [3.6.0] — 2026-05-28

### Added
- **Voice profiles** — an optional persona axis, independent of the audience context profiles. Five profiles (`casual`, `professional`, `technical`, `warm`, `blunt`), each a set of concrete targets (sentence length, contraction policy, hedging tolerance, jargon level, rhythm) drawn from writing-craft sources (Strunk, Provost, Ogilvy, Handley). Plus optional calibration to a user-supplied writing sample. Includes a composition rule: voice sets the target, context sets enforcement strictness, conflicts resolve toward the stricter.
- **Edit mode** — a third mode alongside `rewrite` and `detect`. Edits a named file in place via the Edit tool with minimal, targeted changes, preserving already-human passages, then re-reads to verify. Returns an edits-made + verification report, not the full file.
- **Iterate to convergence** — rewrite mode can repeat the audit→rewrite cycle until no patterns remain or N passes (capped at 2). Generalizes the existing built-in second pass.
- **Invocation surface** — documented optional flags (`--mode`, `--voice`, `--context`, `--file`, `--iterate N`) alongside the existing natural-language triggers.

### Changed
- Frontmatter `description` updated to advertise the new modes and voice profiles.
- Version bump to 3.6.0.

### Notes
- Designed from a competitive feature audit (Aboudjem/humanizer-skill, brandonwise/humanizer, blader/humanizer) plus detection-science and writing-craft research. The `--score` feature and four additional catalog patterns from that research are tracked separately (#21, #22).

---

## [3.5.0] — 2026-05-27

### Added
- **Infomercial engagement hooks** — punchy fragment-hooks that fake momentum around ordinary information: "The catch?", "The kicker?", "Here's the thing.", "Plot twist:", "The best part?". Distinct from rhetorical-question openers (which stall before a point) and chatbot artifacts (which perform helpfulness).
- **Paragraph-reshuffle immunity** — a writer-side structure test: if you can swap two body paragraphs without breaking the piece, you've written a list of points, not an argument that builds.
- **Treadmill effect / low information density** — a writer-side content test: each paragraph should contribute one new fact, claim, or turn rather than restate the premise in fresh words. The tell is that you could cut 40-60% and lose no information.

### Changed
- **Superficial -ing analyses** — extended to cover the declarative "meaning-telling" variant ("this represents a broader shift," "speaks to a larger trend") that glosses a mundane subject as profound without the -ing construction.
- Version bump to 3.5.0.

### Credit
- Patterns adapted from [`Aboudjem/humanizer-skill`](https://github.com/Aboudjem/humanizer-skill) (P38, P40, P41, P43), identified during a competitive catalog audit.

---

## [3.4.0] — 2026-05-16

### Added
- **Tier 3 phrases** — multi-word boilerplate that's individually unobjectionable but stacks heavily in AI-generated crypto/web3/DePIN/AI-infra content: `emerging sector`, `the integration of`, `the intersection of`, `community-driven`, `long-term sustainability`, `user engagement`, `decentralized compute`, `sustainable reward emissions`, `tokenized incentive structures`, `designed for long-term`. Flagged by per-phrase density (≥2 repetitions) *or* cluster (≥3 distinct phrases in one piece — the LLM-varies-its-own-boilerplate shape).
- **Generic future-narrative closers** — "May become one of the most important narratives of the next market cycle" template family. Modal + "become" + (one of) the most + (narrative / story / trend / theme / chapter / movement).
- **Hedge-stacked predictions** — `could potentially`, `may eventually`, `might ultimately`. Modal + hedge adverb stack where each word cancels the next.
- **"Real/actual" adjective inflation** — `real on-chain tokenomics`, `actual reward sustainability`, `genuine utility`, `true product-market fit`. The noun-modifier form distinct from the existing sentence-level hollow-intensifier rule.
- **Hashtag stuffing** — trailing blocks of 6+ hashtags on short posts, especially when mixing one project tag with broad category tags (#AI #Crypto #Web3 #Innovation #FutureTech).
- **Bullet lists of bare noun phrases** — 5+ consecutive bullets where each is a short adj+noun pair with no verb. Detector heuristic excludes genuine list content (verbs in items, ingredient lists, changelog entries).

### Changed
- **Emotional flatline** — extended to cover the bare section-header variant: "Interesting part of the project:" / "Interesting thing here:" — same role as "the most interesting part" but as a header opener.
- **Severity tiers** — all six new categories wired into P0/P1/P2 ladder (hashtag stuffing varies by profile; the rest are P1, with phrase repetition at P2).
- **Context profiles tolerance matrix** — added rows for all six new categories so the `linkedin` and `docs` profiles don't false-positive on legitimate use (e.g., bullet-NP lists relaxed on `technical-blog` and `docs` since technical option lists are correctly bare-NP).
- **"6+" hashtag threshold** — added rationale paragraph explaining the empirical floor.
- **"Real/actual" inflation** — added named-contrast carve-out so honest contrastive writing ("real on-chain settlement, not bridged IOUs") isn't flagged.
- Version bump to 3.4.0.

### Reported by
- A user of the avoid-ai-writing extension flagged two crypto-shill social posts (MineBench reviews) that the v3.3.x wordlist+regex detector scored as "Minimal AI signals" despite being obvious LLM output. Both posts avoided every Tier 1 vocabulary entry by substituting synonyms ("emerging sector," "scalable network contribution," "viability") and used structural shapes (hashtag block, bare-NP bullet lists, hedge stacks, future-narrative templates) the detector had no rule for. v3.4 adds rules for the structures, not just the words.

---

## [3.3.0] — 2026-04-01

### Added
- **"Worth [verb]ing" vague endorsement pattern**: `worth reading`, `worth paying attention to`, `worth a look`, `worth exploring`, `worth checking out`, `worth your time` — broadens existing "it's worth noting that" to the full family
- **Reader-steering frames**: `Here's what's interesting`, `Here's what caught my eye`, `Here's what stood out` — added to both transition phrases and confidence calibration sections with context on when the pattern is a genuine problem vs. when data-backed usage is acceptable

### Changed
- Version bump to 3.3.0

---

## [3.2.0] — 2026-03-31

### Added
- **Detect mode**: flag-only mode that identifies AI patterns without rewriting. Trigger with "detect," "flag only," "audit only," "just flag," "scan," or similar. Returns issues grouped by severity (P0/P1/P2) plus an assessment of which flags are clear problems vs. judgment calls. Useful when flagged patterns are intentional, when auditing published or third-party content, or when you want a quick scan without a full rewrite.

### Changed
- Output format section now documents both rewrite (default) and detect mode outputs
- Version bump to 3.2.0

---

## [3.1.0] — 2026-03-25

### Added
- 3 new Tier 1 words from Pangram AI detection research: `keen` (as intensifier), `symphony` (metaphor), `embrace` (metaphor)
- 2 new template phrases: "Whether you're X or Y" (false-breadth), "I recently had the pleasure of" (review/social AI pattern)
- "In summary" added to transition phrases (alongside existing "In conclusion" / "To summarize")
- Structure-priority note in Rhythm section: structural regularity is the #1 signal AI detectors weight, above vocabulary
- Over-polishing warning: aggressive editing can push writing toward AI statistical profiles by removing natural disfluency

### Changed
- Total vocabulary: 106 → 109 entries (60 Tier 1 + 38 Tier 2 + 11 Tier 3)
- Template phrases: 2 → 4 entries

### Source
- Pangram Labs AI detection research (pangram.com) — decoder-only classifier trained on 28M human documents. Key insight: structural uniformity and pacing consistency are weighted higher than individual word choices.

---

## [3.0.0] — 2026-03-20

### Added
- Novelty inflation pattern (AI treats established concepts as speaker inventions)
- False concession structure pattern
- Rhetorical question openers pattern
- Parenthetical hedging pattern
- Numbered list inflation pattern
- Severity tiers (P0/P1/P2) for prioritized auditing
- Self-reference escape hatch (exempts quoted examples from flagging)
- Context profiles with tolerance matrix (linkedin, blog, technical-blog, investor-email, docs, casual)
- Auto-detection cues for context inference
- Extended frontmatter: license, compatibility, author, tags, agentskills_spec

### Changed
- Pattern count: 30 → 35 categories

---

## [2.2.0] — 2026-03-18

### Added
- OpenClaw compatibility — added `version` and `metadata.openclaw` to SKILL.md frontmatter
- OpenClaw installation instructions in README (ClawHub and manual)
- Skill now works with both Claude Code and OpenClaw from a single `SKILL.md`

### Changed
- `README.md` — broadened description to reference both platforms, reorganized installation into Claude Code and OpenClaw sections

---

## [2.1.0] — 2026-03-18

### Added
- 5 new pattern categories: reasoning chain artifacts, sycophantic tone, acknowledgment loops, confidence calibration phrases, excessive structure
- New "Rhythm and uniformity" section — checks for sentence length uniformity, paragraph length uniformity, missing first-person perspective, and read-aloud test guidance
- New "When to rewrite from scratch vs. patch" threshold — advises full rewrites when AI density is too high for patching
- 5 rewrite principles in tone calibration section (vary length, be concrete, have a voice, cut neutrality, earn emphasis)
- New "Meta Patterns" group in README pattern table
- Expanded credits: OpenClaw humanizer ecosystem (community patterns)

### Changed
- Pattern count: 23 → 30 categories
- `README.md` — updated pattern count, added Meta Patterns table, expanded credits with source descriptions
- Communication Patterns table in README now includes all communication patterns

---

## [2.0.0] — 2026-03-18

### Added
- **Tiered vocabulary system** — words are now organized into three tiers based on AI-signal strength:
  - Tier 1 (always flag): 53 entries — dead giveaways that appear 5–20x more often in AI text
  - Tier 2 (flag in clusters): 38 entries — legitimate words that signal AI when 2+ appear in the same paragraph
  - Tier 3 (flag by density): 11 entries — common words that only flag when the text is saturated with them
- 39 new vocabulary entries across all tiers, including: bustling, intricate, complexities, ever-evolving, daunting, holistic, actionable, impactful, learnings, thought leadership, best practices, synergy, interplay, encompass, catalyze, reimagine, galvanize, augment, cultivate, illuminate, elucidate, juxtapose, paradigm-shifting, transformative, cornerstone, paramount, poised, burgeoning, nascent, quintessential, overarching, underpinning, significant, innovative, dynamic, scalable, compelling, unprecedented, sophisticated, instrumental, world-class
- Credit to [brandonwise/humanizer](https://github.com/brandonwise/humanizer) for tiered vocabulary research

### Changed
- Word/phrase table reorganized from flat list to tiered structure with usage guidance
- Total vocabulary: 58 → 102 entries (53 Tier 1 + 38 Tier 2 + 11 Tier 3)
- `README.md` — updated replacement table description, pattern table, and credits

---

## [1.4.0] — 2026-03-17

### Added
- 15 new word/phrase replacements: nuanced, crucial, multifaceted, ecosystem, myriad, plethora, deep dive/dive into, unpack, bolster, spearhead, resonate, revolutionize, facilitate, underpin
- New pattern category: "let's" constructions (false-collaborative openers like "let's explore," "let's break this down")
- Skill now covers 23 pattern categories with 58 word/phrase replacements

### Changed
- Deduplicated filler phrases that appeared in both the word table and the filler section
- `README.md` — updated pattern count (22 → 23), replacement table count (43 → 58), added "let's" constructions row to pattern table

---

## [1.3.0] — 2026-03-17

### Changed
- Em dash detection now catches double-hyphen (`--`) in addition to Unicode em dash (`—`)
- `README.md` — updated formatting pattern description to mention `--`

---

## [1.2.0] — 2026-03-06

### Added
- New pattern category: emotional flatline (AI claims emotions as structural crutch without conveying them; also flags lazy human writing)
- Skill now covers 22 pattern categories with 43 word/phrase replacements

---

## [1.1.0] — 2026-03-06

### Added
- 8 new pattern categories: notability name-dropping, superficial -ing analyses, promotional language, formulaic challenges, false ranges, inline-header lists, title case headings, cutoff disclaimers
- 5 new word table entries (nestled, vibrant, thriving, despite challenges, showcasing)
- Skill now covers 21 pattern categories with 43 word/phrase replacements

### Changed
- `README.md` — expanded full example (6 paragraphs → 4 clean sentences, 40+ tells flagged); added per-pattern before/after table organized into Content, Language, Structure, Communication groups; updated pattern count and replacement table count throughout

---

## [1.0.0] — 2026-03-05

### Added
- `SKILL.md` — Claude Code skill with 13 pattern categories: formatting, sentence structure, word/phrase replacements (38 entries), template phrases, transition phrases, structural issues, significance inflation, copula avoidance, synonym cycling, vague attributions, filler phrases, generic conclusions, chatbot artifacts
- Four-section output format: issues found, rewritten version, what changed, second-pass audit
- `README.md` — installation guide (3 methods), full pattern reference, usage examples
- `LICENSE` — MIT
- `.gitignore` — OS/editor exclusions
