---
name: avoid-ai-writing-router
description: Use when a request combines AI-writing audit, rewrite, file editing, voice preservation, false-positive interpretation, verification, or when the user invokes Avoid AI Writing without naming a mode.
---

# Avoid AI Writing Router

Coordinate the public Skills as a bounded workflow. Route to the narrowest owner, preserve context between stages, and stop when the requested job is complete. This Skill does not replace the original `avoid-ai-writing` rulebook.

## Authority chain

1. `../avoid-ai-writing/SKILL.md` is the canonical editorial authority.
2. `references/handoff-contract.md` defines what context and evidence can cross Skill boundaries.
3. `references/skill-graph.json` is the machine-readable source for nodes, typed edges, guards, and loop limits.
4. `references/routing-matrix.md` is the human-readable routing table.
5. `references/agency-role-lenses.md` defines the architecture, AI-evidence, implementation, and representation review lenses used to inspect the network.

Do not weaken, duplicate, or contradict the canonical Skill's preservation rules, evidence caveats, voice rules, pattern tiers, or pass behavior.

## Orchestration model

Classify the request once, create the smallest useful handoff envelope, then pass that envelope forward rather than asking every downstream Skill to infer the same context again.

The envelope should carry only observed or user-provided facts such as:

- intent and source kind
- general vs technical context
- requested voice or supplied style sample
- protected semantic constraints
- whether detector, mutation, or verifier execution actually ran
- detector summary when available
- preservation status when available
- risk flags
- current pass index and stop limit

Never mark an execution field as `executed` without host evidence.

## Primary routing

1. Scan, detect, audit, score, or flag-only requests go to `ai-writing-detector`.
2. Returned-text rewrite, humanize, clean-up, or remove-AI-isms requests go to `voice-preserving-rewriter`.
3. A named file plus an explicit request to change that file goes to `file-edit-in-place`.
4. Original plus rewrite, before/after comparison, or preservation validation goes to `preservation-verifier`.
5. Claims about proving AI use, cheating, fraud, dishonesty, hiring suitability, or similar consequential conclusions go to `false-positive-reviewer`.
6. Explicit invocation of the original Skill may remain in `avoid-ai-writing` unless the request clearly needs a specialized stage.

## Multi-stage sequencing

For requests such as "scan this, rewrite it, and make sure nothing important changed":

1. `ai-writing-detector` collects signals when deterministic execution is available, otherwise it performs a model-only audit under the canonical rulebook.
2. `voice-preserving-rewriter` rewrites returned text, or `file-edit-in-place` mutates an explicitly named file.
3. `preservation-verifier` checks before/after material.
4. A verifier `FAIL` returns to the correct repair owner once.
5. Verification runs once more after repair when possible.
6. Residual detection runs only when the user requested convergence or a residual audit.
7. Stop after the canonical pass cap. Do not cycle indefinitely.

## Typed edges

Use the edge semantics in `references/handoff-contract.md`:

- `ROUTE`: choose the owner.
- `FEED`: pass evidence without turning it into a command.
- `VERIFY`: require a before/after preservation check.
- `REPAIR`: return a failed preservation result to the correct mutation owner.
- `RECHECK`: run one bounded residual check when requested.
- `ESCALATE`: move uncertain or consequential authorship interpretation to `false-positive-reviewer`.
- `GUARD`: add conditional protected constraints without changing the primary owner.

## Conditional human-representation guard

If the source itself is an image prompt, video prompt, storyboard, shot description, or creative brief that describes people, set `human_representation_sensitive: true` and preserve identity-sensitive details as protected constraints.

Use the `agency-inclusive-visuals-specialist` lens from `references/agency-role-lenses.md` to protect cultural, geographic, age, disability, attire, skin-tone/lighting, and physical-reality details. Do not route ordinary prose to a visual workflow just because it mentions a person.

## Review lenses

Apply these design checks when the network changes or when a complex request exposes a boundary problem:

- `agency-software-architect`: ownership, dependency direction, bounded loops, fallback, reversibility.
- `agency-ai-engineer`: detector semantics, uncertainty, false-positive handling, context propagation, evaluation.
- `agency-senior-developer`: executable paths, error propagation, file mutation evidence, CI and drift checks.
- `agency-inclusive-visuals-specialist`: representation preservation only for visual prompts and briefs involving people.

These are review lenses, not hidden public dependencies. If an external agency Skill is not available in the current host, apply the encoded lens without claiming it ran.

## Boundary changes

Return control to the router instead of continuing locally when:

- the job changes from read-only to mutation,
- the target changes from returned text to a named file or the reverse,
- required before/after evidence is missing,
- deterministic execution requested by the workflow is unavailable,
- the user moves from pattern analysis to a consequential authorship claim,
- a verifier fails and identifies a different repair owner.

Preserve the existing handoff envelope and change only fields affected by the new decision.

## Stop conditions

Stop when the user's requested stage is complete and any required verification gate has passed or been explicitly reported as unavailable.

Do not:

- infer authorship from detector output,
- mutate a file without user authorization,
- hide a verifier failure,
- re-run stages simply because another Skill exists,
- exceed the canonical rewrite pass cap,
- route unrelated writing or coding requests into this Plugin merely because they mention AI.

## Output

Return the selected workflow result. For multi-stage work, state which stages actually ran, which were model-only, which deterministic checks executed, whether any repair loop occurred, and the final preservation status when available.
