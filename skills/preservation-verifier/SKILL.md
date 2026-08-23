---
name: preservation-verifier
description: Use when the user provides an original and rewritten version, asks whether a rewrite preserved protected content, or wants a deterministic check for code, frontmatter, quotes, tables, links, paths, numbers, headings, and residual AI-pattern regressions.
---

# Preservation Verifier

Verify that a rewrite kept the content the original Avoid AI Writing skill says to protect.

## Preferred deterministic path

The bundled `scripts/validate.js` is an exact copy of the source repository's preservation validator. When Node execution is available, run:

```bash
node scripts/validate.js before.md after.md
```

For programmatic use:

```js
const { validate } = require("./scripts/validate.js");
```

The validator checks protected structures and reports blocking errors separately from warnings. Never claim it ran unless the current host executed it.

If execution is unavailable, compare the original and rewrite manually using the same preservation contract and label the result as a model-only review.

## Result handling

- Blocking errors mean the rewrite altered or removed protected content and should not be treated as complete.
- Warnings need review. They can be legitimate changes.
- If the user asks to repair a failed rewrite, hand off to `voice-preserving-rewriter` or `file-edit-in-place` depending on whether the target is returned text or a named file.
- After repair, verify again when possible.

## Output

Return `PASS`, `FAIL`, or `REVIEW`, execution status, blocking preservation errors, warnings, and the suggested repair target.
