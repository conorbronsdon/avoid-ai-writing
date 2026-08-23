---
name: ai-writing-detector
description: Use when the user asks to detect, scan, audit, score, or flag AI-writing patterns without rewriting the text, including requests for a deterministic local detector result when the host can execute Node.
---

# AI Writing Detector

Run a detect-only review using the original Avoid AI Writing rules. Never rewrite unless the user changes the request.

## Authority

The canonical rulebook is `../avoid-ai-writing/SKILL.md`. Its cautions about false positives, context, protected material, and authorship claims apply here.

## Preferred path

When the current host can execute Node safely:

1. Pass the supplied text to `scripts/detect.js`.
2. Use `--context technical` for code-adjacent or technical prose when appropriate. Otherwise use `general`.
3. Report the detector's score, label, issue types, severity, matched text, and suggestions.
4. Separate deterministic findings from editorial observations that only exist in the full rulebook.
5. Never claim execution unless the command actually ran.

Example:

```bash
printf '%s' "$TEXT" | node scripts/detect.js --context general
```

For a file:

```bash
node scripts/detect.js --file path/to/draft.md --context general
```

If Node or shell execution is unavailable, perform the detect-only workflow from the canonical `avoid-ai-writing` skill and explicitly say the deterministic detector was not run.

## Interpretation

Detector output is a writing-quality signal. It is not proof that a person used AI. If the user asks for a consequential authorship conclusion, hand off to `false-positive-reviewer`.

## Output

Return the overall label and score when executed, detected patterns grouped by severity, a short contextual assessment of clear issues versus plausible false positives, and no rewritten version.
