# AvoidAIWriting for Vale

A [Vale](https://vale.sh) style generated from the regex-detectable rules in
[avoid-ai-writing](https://github.com/conorbronsdon/avoid-ai-writing). It is built by
`scripts/build-vale.js` from `detector/patterns.js`, so the tokens here are the detector's
tokens. Do not edit these files by hand.

## What this is and is not

The detector exposes 54 issue types. `manifest.json` gives each one a status, and these
counts come from it: 33 verified, 8 approximation, 13 unsupported, 0 unassessed.

- **verified**: the detector reports every match of the type's table, with no gating beyond
  the document-wide masking and de-duplication listed under "How alerts differ", and the rule
  carries the table's patterns unchanged.
- **approximation**: ported, but the detector gates or filters the type in a way Vale cannot.
  The reasons are listed below.
- **unsupported**: not ported. Structural, stylometric, or gated on counts no built-in Vale
  check computes; listed below so the gap is visible.

Ported types ship as 314 patterns across 72 rule files. `manifest.json` also records
the schema version and a SHA-256 of the exported pattern data this style was built from.

The false-positive rates published for the JS detector were measured on the JS
detector. They do not transfer to this style until measured on it. See
`vale/README.md` in the repository for the measurement that was run.

## Use

Place the AvoidAIWriting directory at `styles/AvoidAIWriting/` in your project.
Get it from the [repository](https://github.com/conorbronsdon/avoid-ai-writing/tree/main/vale/AvoidAIWriting).
This style requires Vale 3.24.0 or newer. Then configure Vale:

```ini
StylesPath = styles
MinAlertLevel = suggestion

[*.md]
BasedOnStyles = AvoidAIWriting
# The approximations are suggestions. Turn them off, or raise the ones you want:
# AvoidAIWriting.Tier2Vocabulary = NO
# AvoidAIWriting.Transitions = warning
```

Levels follow the detector's severity: P0 fingerprints (chatbot artifacts, cutoff
disclaimers, placeholders) are errors, P1 is a warning, P2 and P3 are suggestions.

## How alerts differ from detector issues

- Overlapping patterns of one type produce one alert. Vale compiles a rule's tokens into a
  single alternation and reports a region once; the detector lists each matching pattern.
  This lowers alert counts on stacked tells and never adds an alert.
- The detector masks blockquotes and double-quoted spans before matching, so quoted
  examples do not count against a document. Vale skips code and front matter by format,
  but it does lint quoted prose. The detector reads code, so a tell inside a code block
  counts there and not here.
- The detector reports each distinct (type, text) pair once; Vale reports every occurrence.
- Inside a staged-discovery phrase the detector keeps one finding; Vale also reports any
  `StockReactions` or `PerformedInsight` match that the phrase contains.
- `UTMSource` reads the raw file, because Vale skips URLs in Markdown prose. It therefore
  also fires on a tagged URL inside a code block, as the detector does in its default plain mode.
- Vale skips HTML comments in Markdown, so a `<!-- TODO -->` placeholder does not alert.
- In Markdown, `*checks notes*` is emphasis, so the asterisk forms of `FakeCasualProps` only
  fire in plain text.
- The detector removes zero-width characters before matching; Vale does not. JavaScript `\s`
  matches a no-break space; Vale's `\s` does not.
- The detector's context modes (for example `technical`, which exempts terms such as "robust" and "leverage") and its
  homoglyph normalization pre-pass have no counterpart here.

## Coverage

| Detector type | Rule | Check | Level | Patterns | Note |
|---|---|---|---|---:|---|
| `transition` | `AvoidAIWriting.Transitions` | existence | suggestion | 13 |  |
| `chatbot` | `AvoidAIWriting.ChatbotArtifacts` | existence | error | 9 |  |
| `sycophantic` | `AvoidAIWriting.Sycophancy` | existence | error | 4 |  |
| `filler` | `AvoidAIWriting.Fillers` | existence | suggestion | 4 |  |
| `generic-conclusion` | `AvoidAIWriting.GenericConclusions` | existence | suggestion | 4 |  |
| `lets-construction` | `AvoidAIWriting.LetsOpeners` | existence | suggestion | 5 |  |
| `reasoning-artifact` | `AvoidAIWriting.ReasoningArtifacts` | existence | error | 6 |  |
| `significance-inflation` | `AvoidAIWriting.SignificanceInflation` | existence | warning | 4 |  |
| `vague-attribution` | `AvoidAIWriting.VagueAttribution` | existence | error | 4 |  |
| `hollow-intensifier` | `AvoidAIWriting.HollowIntensifiers` | existence | suggestion | 5 |  |
| `emotional-flatline` | `AvoidAIWriting.StockReactions` | existence | suggestion | 6 |  |
| `lingering-attention` | `AvoidAIWriting.LingeringAttention` | existence | suggestion | 5 |  |
| `novelty-inflation` | `AvoidAIWriting.NoveltyInflation` | existence | suggestion | 4 |  |
| `cutoff-disclaimer` | `AvoidAIWriting.CutoffDisclaimers` | existence | error | 8 |  |
| `ai-placeholder` | `AvoidAIWriting.Placeholders` | existence | error | 6 |  |
| `ai-citation-markup` | `AvoidAIWriting.CitationMarkup` | existence | error | 5 |  |
| `ai-utm-source` | `AvoidAIWriting.UTMSource` | existence | error | 2 |  |
| `template-phrase` | `AvoidAIWriting.TemplatePhrases` | existence | warning | 3 |  |
| `false-concession` | `AvoidAIWriting.FalseConcession` | existence | suggestion | 2 |  |
| `rhetorical-question` | `AvoidAIWriting.RhetoricalQuestions` | existence | suggestion | 3 |  |
| `hedge-stack` | `AvoidAIWriting.HedgeStack` | existence | warning | 2 |  |
| `future-narrative` | `AvoidAIWriting.FutureNarrative` | existence | warning | 2 |  |
| `real-actual-inflation` | `AvoidAIWriting.RealActualInflation` | existence | suggestion | 1 |  |
| `social-cta-closer` | `AvoidAIWriting.EngagementBait` | existence | warning | 10 |  |
| `performed-insight` | `AvoidAIWriting.PerformedInsight` | existence | suggestion | 12 |  |
| `negation-chain` | `AvoidAIWriting.NegationChain` | existence | warning | 3 |  |
| `negative-parallelism` | `AvoidAIWriting.NegativeParallelism` | existence | warning | 1 | approximation |
| `dev-blog-boilerplate` | `AvoidAIWriting.DevBlogBoilerplate` | existence | suggestion | 4 |  |
| `formulaic-opener` | `AvoidAIWriting.FormulaicOpeners` | existence | warning | 5 |  |
| `speculative-opener` | `AvoidAIWriting.SpeculativeOpeners` | existence | warning | 1 |  |
| `launch-intro` | `AvoidAIWriting.LaunchIntros` | existence | warning | 2 |  |
| `crowd-contrast` | `AvoidAIWriting.CrowdContrast` | existence | suggestion | 3 |  |
| `fake-casual-prop` | `AvoidAIWriting.FakeCasualProps` | existence | warning | 2 |  |
| `parenthetical-hedge` | `AvoidAIWriting.ParentheticalHedges` | existence | suggestion | 4 |  |
| `unnecessary-hyphenation` | `AvoidAIWriting.UnnecessaryHyphenation` | existence | suggestion | 14 | approximation |
| `tier1` | `AvoidAIWriting.Tier1Vocabulary` | substitution | warning | 33 | approximation; single words, with the catalog replacement as the fix |
| `tier1` | `AvoidAIWriting.Tier1Phrases` | substitution | warning | 21 | approximation; phrase forms |
| `tier1-clarity` | `AvoidAIWriting.Tier1Clarity` | substitution | suggestion | 8 | approximation; wordiness phrases; `features` omitted (needs the noun/verb check) |
| `tier2` | `AvoidAIWriting.Tier2Vocabulary` | existence | suggestion | 45 | approximation |
| `tier3` | `AvoidAIWriting.overuse.*` | occurrence | suggestion | 22 | approximation; one rule per word, max 2 per file |
| `tier3-phrase` | `AvoidAIWriting.boilerplate.*` | occurrence | suggestion | 10 | approximation; one rule per phrase, max 1 per file |
| `confidence-calibration` | `AvoidAIWriting.ConfidenceStacking` | occurrence | suggestion | 7 | approximation; max 2 per file |

## Approximations

- `tier1`: Vale matches a listed word inside hyphenated and possessive forms ("non-robust"). The detector splits tokens on [\w'-]+ and does not.
- `tier1-clarity`: `features` is left out: it needs the noun/verb check in `featuresIsNoun`.
- `tier2`: Vale has no per-paragraph distinct-word count. Shipped as `Tier2Vocabulary` at suggestion level, which fires on one word where the detector needs two in a paragraph.
- `tier3`: The detector threshold is max(3, 3% of words). Shipped as `overuse/*` occurrence rules with a fixed max of 2 per document.
- `confidence-calibration`: The detector reports each phrase once three or more stack in one text. Shipped as `ConfidenceStacking`, an occurrence rule with the same threshold that gives one alert per file.
- `tier3-phrase`: Density-gated at two uses. Shipped as `boilerplate/*` occurrence rules with max 1 per document.
- `unnecessary-hyphenation`: The detector masks file paths, package names and code identifiers before matching; Vale does not. Computed fixes are not carried.
- `negative-parallelism`: Reveal frames only. A contrast frame counts only when another frame starts within two sentences in the same paragraph, which Vale cannot check.

## Not ported, and why

- `em-dash`: Per-document density with separator-position exclusions.
- `uniformity`: Sentence and paragraph length variance.
- `formatting`: Composite structural check.
- `tier3-phrase-cluster`: Cluster count over distinct boilerplate phrases.
- `hashtag-stuff`: Count-based.
- `bullet-np-list`: Structural check over list items.
- `title-case-header`: Context-mode dependent.
- `smart-punct-signature`: Multi-signal composite, style-only.
- `punct-distribution`: Stylometric.
- `fnword-trigram-entropy`: Stylometric.
- `cross-para-burstiness`: Stylometric.
- `normalization-flag`: Pre-pass over invisible and homoglyph characters, not a prose pattern.
- `low-ttr`: Stylometric.

Patterns dropped from otherwise ported types:

- `tier1-clarity`: `\bfeatures\b`

Judgment-only rules (the skill's section C in `detector/CATEGORIES.md`) have no
detector type and are out of scope for any regex port.
