# Detector engine

`patterns.js` is the executable expression of this skill's pattern rules — a
zero-dependency, build-step-free detection engine that scores text for
AI-writing tells. It runs identically in Node (`>=18`) and in the browser.

The skill's `SKILL.md` is the human-readable catalog of rules; this engine is
the deterministic, testable implementation of the regex-detectable subset, plus
stylometric and AI-tool-fingerprint detectors that don't make sense as prose.
See [`CATEGORIES.md`](./CATEGORIES.md) for the rule ↔ category mapping that keeps
the two in sync.

## Run it

```bash
npm test          # pattern, category-contract, and preservation tests (no deps)
# or directly:
node detector/patterns.test.js
```

```js
const AIDetector = require("./detector/patterns.js");
const result = AIDetector.analyzeText("Your text here…");
console.log(result.score, result.label, result.issues.length);
```

In the browser, load `patterns.js` as a plain script — it self-registers as a
global `AIDetector` (the `module.exports` block is guarded and only runs under
CommonJS).

## `analyzeText(text, options?)` → result

| Field | Type | Meaning |
|---|---|---|
| `score` | `0–100` | 0 = clean, 100 = heavy AI |
| `label` | string | `Minimal` / `Some` / `Strong` / `Heavy` (or `Empty` / `Too short` / `Text too long`) |
| `issues[]` | `{type, text, severity, …}` | one entry per detected pattern; `type` keys map to [`CATEGORIES.md`](./CATEGORIES.md) |
| `stats` | object | `wordCount`, per-tier counts, `contextMode`, `sourceMode`, masked-span counts, `denseAIVocab`, normalization flags, etc. |
| `document_classification` | string | trinary `HUMAN_ONLY` / `MIXED` / `AI_ONLY` (shape mirrors GPTZero for swap-in) |
| `class_probabilities` | `{human, mixed, ai}` | sums to exactly 1.0 |
| `confidence_category` | `low` / `medium` / `high` | |
| `highlight_sentence_for_ai` | region[] | sentence spans with source offsets + per-region score, for UI highlighting |

`options.contextMode` accepts `general` (default) or `technical`; technical mode
suppresses flags that are legitimate in code-adjacent prose (e.g. Title Case
headers). Invalid modes fall back to `general` and set `stats.contextModeFallback`.

`options.sourceMode` accepts `plain` (default) or `rendered-markdown`. Rendered
Markdown mode masks initial YAML frontmatter and HTML comments before pattern
matching and document metrics run. Frontmatter may use LF, CRLF, or CR line
endings and must begin with a YAML mapping entry after any leading blank or
comment lines; this keeps ordinary prose between thematic breaks visible.
Comment markers inside fenced or inline code remain visible code, while an
actual unclosed comment is masked through end of file.

Masking preserves the input length and line endings so issue and
sentence-highlight offsets still address the original source. The result
reports `sourceMode`, `sourceModeFallback`, `maskedFrontmatter`, and
`maskedHtmlComments` in `stats`. When an explicit invalid source mode falls
back to `plain`, `sourceModeFallback` retains the requested value, including
falsy values; without a fallback it is `undefined`.

Comment contents are fully excluded in rendered mode. Use plain mode or a
source-hygiene linter when TODO placeholders inside comments should still be
reported.

## `validate(original, rewritten, options?)` → result

`validate.js` checks that a rewrite kept its hands off the things `SKILL.md`
says not to touch. Edit mode writes to files, so a violation there is silent
and destructive.

```js
const { validate, formatResult } = require("./detector/validate.js");
const result = validate(originalText, rewrittenText);
if (!result.ok) console.error(formatResult(result));
```

```bash
node detector/validate.js before.md after.md   # exits 1 on a preservation error
```

**Errors** (the rewrite altered content it had no business touching): fenced
code modified or dropped, YAML frontmatter changed, blockquote reworded, table
cell changed, inline code removed, URL or file path lost, heading count or
nesting changed, and `residual-grew` when the rewrite introduces more flagged
patterns than it removes.

**Warnings** (usually legitimate, occasionally a mistake): heading reworded,
a figure from the original missing, more than 40% of the words dropped.

Two edits this skill documents as correct are carved out so the validator never
fires on its own instructions: stripping AI tracking parameters from URLs
(`utm_source=chatgpt.com`), and rewording a heading to fix Title Case or remove
an emoji. Indented code blocks are counted but not enforced, since four-space
indentation is also how markdown continues a list item.

## Scoring our own docs

```bash
npm run self-scan          # table
npm run self-scan:check    # exits 1 if a document is over budget (runs in CI)
```

Results and the findings it surfaced are in [`../PROOF.md`](../PROOF.md).

## Design notes

- **FN-biased.** False positives damage trust more than false negatives, so
  `MIXED` is wide and `AI_ONLY` requires multiple corroborating signals.
- **Scoring is non-linear.** Repeated hits of the same phrase are deduplicated;
  category weights live in the `ISSUE_WEIGHTS` table.
- **Length gates.** Under ~10 words → `Too short` (unscorable); over 10k words →
  `Text too long`.
