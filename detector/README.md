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
npm test          # runs detector/patterns.test.js (no deps to install)
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
| `stats` | object | `wordCount`, per-tier counts, `contextMode`, `denseAIVocab`, normalization flags, etc. |
| `document_classification` | string | trinary `HUMAN_ONLY` / `MIXED` / `AI_ONLY` (shape mirrors GPTZero for swap-in) |
| `class_probabilities` | `{human, mixed, ai}` | sums to exactly 1.0 |
| `confidence_category` | `low` / `medium` / `high` | |
| `highlight_sentence_for_ai` | region[] | sentence spans with byte offsets + per-region score, for UI highlighting |

`options.contextMode` accepts `general` (default) or `technical`; technical mode
suppresses flags that are legitimate in code-adjacent prose (e.g. Title Case
headers). Invalid modes fall back to `general` and set `stats.contextModeFallback`.

## Design notes

- **FN-biased.** False positives damage trust more than false negatives, so
  `MIXED` is wide and `AI_ONLY` requires multiple corroborating signals.
- **Scoring is non-linear.** Repeated hits of the same phrase are deduplicated;
  category weights live in the `ISSUE_WEIGHTS` table.
- **Length gates.** Under ~10 words → `Too short` (unscorable); over 10k words →
  `Text too long`.
