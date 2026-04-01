# Changelog

All notable changes to this project are documented here.

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
