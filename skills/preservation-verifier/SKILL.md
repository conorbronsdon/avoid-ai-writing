---
name: preservation-verifier
description: Use when the user provides an original and rewritten version, asks whether a rewrite preserved protected content, or wants a deterministic check for code, frontmatter, quotes, tables, links, paths, numbers, headings, and residual AI-pattern regressions.
---

# Preservation Verifier

Verify that a rewrite or file edit kept the content the original `../avoid-ai-writing/SKILL.md` says to protect.

For cross-Skill work, follow `../avoid-ai-writing-router/references/handoff-contract.md` and `../avoid-ai-writing-router/references/skill-graph.json`.

## Connection contract

### Incoming

Accept before/after verification from:

- `avoid-ai-writing-router` via `ROUTE` when the user directly supplies before and after material.
- `voice-preserving-rewriter` via `VERIFY` after returned-text rewriting.
- `file-edit-in-place` via `VERIFY` after an authorized named-file mutation.

Require both original and current versions. If either is unavailable, return control to the router rather than inventing a comparison.

### Produce

Update the handoff envelope with:

- `execution_evidence.verifier`: `executed` only if the bundled validator ran, otherwise `model_only`.
- `verification_summary.status`: `PASS`, `REVIEW`, or `FAIL`.
- blocking errors and warnings.
- exact repair target when repair is possible.

A `FAIL` is a blocking workflow result. The rewrite/edit stage is not complete merely because text was produced or a file write succeeded.

### Outgoing

- `REPAIR` to `voice-preserving-rewriter` when returned text failed preservation.
- `REPAIR` to `file-edit-in-place` when a named file failed preservation.
- `RECHECK` to `ai-writing-detector` only when convergence or a residual audit was part of the user's request.
- Stop on `PASS` unless another user-requested stage remains.
- Stop and report on a second verification failure. Do not start another repair loop.

## Architecture and implementation lenses

Apply both encoded lenses from `../avoid-ai-writing-router/references/agency-role-lenses.md`:

- `agency-software-architect`: verification is a boundary gate with explicit ownership and bounded repair cycles.
- `agency-senior-developer`: execution claims require actual command evidence, errors propagate, and before/after state remains attributable to the correct target.

The verifier does not rewrite content itself.

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

If execution is unavailable, compare the original and rewrite manually using the same preservation contract and label the result as `model_only`.

## Additional protected constraints

In addition to the canonical validator's structural checks, honor protected semantic constraints carried in the handoff envelope.

When `human_representation_sensitive: true`, review identity and representation details protected by the `agency-inclusive-visuals-specialist` lens. A structurally valid rewrite may still require `REVIEW` or `FAIL` if it erased or genericized material cultural, geographic, disability, attire, skin-tone/lighting, physical-reality, or anti-stereotype constraints.

Do not claim the deterministic validator checked semantic representation details that it does not implement. Report that portion separately as model-only semantic review.

## Result handling

### PASS

No blocking preservation error was found. Continue only if another requested stage remains.

### REVIEW

Warnings or semantic changes need judgment but are not automatically blocking. Explain the exact uncertainty.

### FAIL

Protected content changed or disappeared. Identify the correct repair owner from source kind:

- returned text -> `voice-preserving-rewriter`
- named file -> `file-edit-in-place`

Pass only the blocking repair scope and existing envelope. Do not ask the repair owner to redo clean parts.

## Repair-loop limit

One repair re-entry is allowed. After repair, verify once more. If that second check still fails, stop and report the unresolved errors. Never cycle indefinitely.

## Output

Return `PASS`, `FAIL`, or `REVIEW`, verifier execution status, blocking preservation errors, warnings, any separate semantic-guard review, the suggested repair owner, and whether the bounded repair opportunity has already been used.
