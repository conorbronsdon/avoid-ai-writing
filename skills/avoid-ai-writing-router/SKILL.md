---
name: avoid-ai-writing-router
description: Use when a request combines AI-writing audit, rewrite, file editing, voice preservation, false-positive interpretation, or verification, or when the user invokes the Avoid AI Writing plugin without naming a mode.
---

# Avoid AI Writing Router

Route the request to the narrowest public skill that can do the job. This is an orchestration skill, not a replacement for the original `avoid-ai-writing` rulebook.

## Authority

`../avoid-ai-writing/SKILL.md` is the canonical editorial authority. Do not weaken, summarize away, or contradict its preservation rules, evidence caveats, voice rules, pattern tiers, or mode behavior.

Read `references/routing-matrix.md` before selecting a path. The explicit handoff graph is in `references/skill-graph.yaml`.

## Routing

1. If the user asks to scan, detect, audit, score, flag only, or asks what AI patterns are present without asking for a rewrite, hand off to `ai-writing-detector`.
2. If the user asks to rewrite, humanize, remove AI-isms, make the text sound less machine-written, or preserve a named voice while rewriting, hand off to `voice-preserving-rewriter`.
3. If the user names a file and asks for the file itself to be changed, hand off to `file-edit-in-place`.
4. If the user gives an original and a rewrite, asks whether protected content survived, or asks to validate a rewrite, hand off to `preservation-verifier`.
5. If the user asks whether a flagged text proves AI authorship, cheating, fraud, hiring suitability, academic misconduct, or another consequential conclusion, hand off to `false-positive-reviewer`.
6. If the request combines stages, run them in order rather than forcing one skill to do everything: audit, rewrite or edit, preservation verification, then residual audit when requested or when convergence is part of the request.

## Multi-stage default

For "clean this and make sure nothing important changed":

1. Use `ai-writing-detector` for the initial audit when deterministic execution is available, otherwise use the original rulebook directly.
2. Use `voice-preserving-rewriter` for returned text, or `file-edit-in-place` for an explicitly named file.
3. Use `preservation-verifier` when both before and after versions are available.
4. If the user requested convergence, re-audit once and stop at the original skill's pass cap.

## Boundaries

- Do not treat detector output as authorship proof.
- Do not edit quoted material, code blocks, tables, attributed text, or other protected regions contrary to the canonical skill.
- Do not claim a local detector or validator ran unless the current host actually executed it.
- Do not mutate a file unless the user asked for an in-place change.
- Do not route unrelated writing or coding tasks into this plugin merely because they contain the word "AI".

## Output

Return the result of the selected workflow. For multi-stage work, state which stages actually ran and distinguish executed deterministic checks from model-only editorial review.
