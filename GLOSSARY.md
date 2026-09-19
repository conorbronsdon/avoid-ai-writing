# Glossary

One-line definitions of the terms used across this repo's docs and issue templates. Each entry links to the canonical definition; when the two disagree, the linked source wins.

## Word tiers

| Term | Meaning |
|---|---|
| [Tier 1](references/patterns.md#tier-1--default-replacements) | Words to review on every match. Split into two bands, 1A and 1B, that use the same replacements but mean different things. |
| [Tier 1A](references/patterns.md#tier-1a--ai-frequency-markers) | AI frequency markers: words claimed to appear far more often in machine text. A cluster is evidence about how a passage was produced. |
| [Tier 1B](references/patterns.md#tier-1b--clarity-edits) | Clarity edits: wordiness and inflated formality. Not evidence of machine authorship. The detector emits them as `tier1-clarity`. |
| [Tier 2](references/patterns.md#tier-2--flag-when-2-appear-in-the-same-paragraph) | Words that are fine alone. Flagged when two or more appear in the same paragraph. |
| [Tier 3](references/patterns.md#tier-3--flag-only-at-high-density) | Common words flagged only at high density, roughly 3% or more of the text. |
| [Tier 3 phrases](references/patterns.md#tier-3-phrases--flag-at-density-or-in-clusters) | Multi-word boilerplate. Flagged when one phrase appears two or more times, or when three or more distinct phrases appear in one piece. |

## Severity

| Term | Meaning |
|---|---|
| [P0](SKILL.md#p0--credibility-killers-fix-immediately) | Credibility killers. Fix immediately. |
| [P1](SKILL.md#p1--obvious-ai-smell-fix-before-publishing) | Obvious AI smell. Fix before publishing. |
| [P2](SKILL.md#p2--stylistic-polish-fix-when-time-allows) | Stylistic polish. Fix when time allows. A quick pass covers P0 and P1; a full audit covers all three. |

## Modes and profiles

| Term | Meaning |
|---|---|
| [`rewrite` mode](SKILL.md#modes) | The default. Flags AI-isms and rewrites the text to fix them. |
| [`detect` mode](SKILL.md#modes) | Flags AI-isms only, with no rewriting. |
| [`edit` mode](SKILL.md#modes) | Edits a prose file in place with minimal, targeted changes. |
| [Context profile](references/patterns.md#context-profiles) | The audience hint (`linkedin`, `blog`, `technical-blog`, `investor-email`, `docs`, `casual`) that sets how strict each rule is. |
| [Voice profile](references/patterns.md#voice-profiles) | The optional persona (`casual`, `professional`, `technical`, `warm`, `blunt`) that sets how the prose should sound. Independent of the context profile. |
| [Register](.github/ISSUE_TEMPLATE/false_positive.yml) | The kind of writing: blog, docs, email, social post, and so on. Both issue templates ask for it because a rule that holds in one register can misfire in another. |
| [Self-reference escape hatch](SKILL.md#self-reference-escape-hatch) | Quoted examples, code blocks, and text marked as illustrative are exempt from flagging, so writing *about* AI patterns is not scored for them. |

## Detector options

| Term | Meaning |
|---|---|
| [`contextMode`](detector/README.md#analyzetexttext-options--result) | The detector's context: `general` (default), `technical`, `marketing`, or `personal`. Each context profile maps to one; see [the mapping](references/patterns.md#detector-mode-mapping). |
| [`sourceMode`](detector/README.md#analyzetexttext-options--result) | How the detector reads input: `plain` (default) or `rendered-markdown`, which masks YAML frontmatter and HTML comments before scoring. |
