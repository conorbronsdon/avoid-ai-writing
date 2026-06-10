# Changelog

All notable changes to this project are documented here.

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
