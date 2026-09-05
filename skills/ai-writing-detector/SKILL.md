---
name: ai-writing-detector
description: Use when the user asks to detect, scan, audit, score, or flag AI-writing patterns without rewriting the text, including requests for a deterministic local detector result when the host can execute Node.
---

# AI Writing Detector

Run a detect-only review using the original Avoid AI Writing rules. Never rewrite unless the user changes the request.

## Authority

The canonical rulebook is `../avoid-ai-writing/SKILL.md`. Its cautions about false positives, context, protected material, and authorship claims apply here.

For cross-Skill work, follow `../avoid-ai-writing-router/references/handoff-contract.md` and the typed edges in `../avoid-ai-writing-router/references/skill-graph.json`.

## Connection contract

### Incoming

Accept detector work from:

- `avoid-ai-writing-router` via `ROUTE` for detect-only requests, the audit stage of a multi-stage request, or fresh signal collection after another terminal stage returns control to the router.
- `preservation-verifier` via bounded `RECHECK` only when convergence or residual auditing was part of the request.

Do not accept a direct handoff from `false-positive-reviewer`. That Skill is terminal in the graph and must return control to `avoid-ai-writing-router` when fresh signal collection is needed. This prevents a reviewer-detector cycle.

Carry forward the existing `context_mode`, protected constraints, pass state, and risk flags. Do not reset them.

### Produce

Update the handoff envelope with:

- `execution_evidence.detector`: `executed` only if the bundled detector actually ran, otherwise `model_only`.
- `detector_summary.score` and `label` only when produced by executed detector code.
- `detector_summary.issue_types` from actual findings.
- any `consequential_authorship_claim` risk flag observed in the user's request.

### Outgoing

- `FEED` findings to `voice-preserving-rewriter` only when the user also requested returned-text rewriting.
- `FEED` findings to `file-edit-in-place` only when the user explicitly requested mutation of a named file.
- `ESCALATE` to `false-positive-reviewer` when the user asks what the findings can establish about authorship or another consequential conclusion.
- Otherwise stop after the detect-only result.

Detector findings are evidence inputs. They are not mandatory edit instructions and they never authorize a mutation.

## AI-engineering evidence lens

Apply the `agency-ai-engineer` lens encoded in `../avoid-ai-writing-router/references/agency-role-lenses.md`:

- keep deterministic output separate from model-only observations,
- preserve the selected context mode through downstream handoffs,
- treat score and label as signals rather than ground truth,
- consider false positives and genre/register effects,
- never convert pattern detection into an authorship classifier claim.

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

If Node or shell execution is unavailable, perform the detect-only workflow from the canonical `avoid-ai-writing` Skill and explicitly say the deterministic detector was not run.

## Stop conditions

Stop here when the request is detect-only. Do not continue into rewrite, file mutation, or interpretation merely because those Skills are available.

A residual `RECHECK` may run once. Respect the canonical two-pass limit and the graph's loop policy.

## Output

Return the overall label and score when executed, detected patterns grouped by severity, a short contextual assessment of clear issues versus plausible false positives, execution status, and no rewritten version unless control has explicitly passed to a rewrite owner.
