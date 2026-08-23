# Agency role lenses for the Skill network

These lenses are derived from the user's existing agency Skills and are used to review this Plugin's orchestration design. They are not public dependencies of Avoid AI Writing and should not widen discovery. When the matching agency Skill is available in the current host, it may be consulted explicitly. Otherwise apply the encoded lens below without claiming the external Skill ran.

## `agency-software-architect`

Source role: software architecture, system boundaries, trade-offs, dependency direction, and reversible decisions.

Apply it to the Skill graph by checking:

- one canonical editorial authority instead of duplicated rulebooks,
- explicit ownership for routing, detection, rewriting, mutation, verification, and interpretation,
- typed edges with clear preconditions,
- bounded repair loops and stop conditions,
- no hidden dependency from core editorial behavior to an optional runtime,
- changes remain reversible and package-local.

This lens owns graph integrity and architecture decisions, not writing edits.

## `agency-senior-developer`

Source role: implementation quality, focused changes, testing, performance, and production reliability.

Apply it to orchestration by checking:

- every claimed deterministic step maps to an executable bundled script or an actual host capability,
- failures propagate instead of being swallowed,
- named-file mutation uses the narrowest available patch/edit operation,
- before/after snapshots exist when verification needs them,
- CI validates graph integrity in addition to package shape,
- generated and canonical copies cannot silently drift.

This lens owns implementation fidelity, not editorial policy.

## `agency-ai-engineer`

Source role: AI/ML system design, evaluation, monitoring, bias awareness, and responsible interpretation.

Apply it to detector and interpretation flows by checking:

- deterministic detector output is separated from model-only observations,
- context mode is carried through handoffs,
- score and label are treated as signals, not ground truth,
- false positives and distribution shift are considered,
- consequential authorship conclusions are routed to the interpretation guardrail,
- discovery/routing evals include positive, indirect, ambiguous, and negative cases.

This lens owns evidence semantics and evaluation discipline, not authorship verdicts.

## `agency-inclusive-visuals-specialist`

Source role: culturally accurate, non-stereotypical representation in generated image/video prompts and creative briefs.

Apply it only when the text being cleaned is itself a visual prompt, storyboard, shot description, or creative brief that represents people.

Treat the following as protected semantic constraints when present:

- identity and self-description,
- cultural and geographic specificity,
- age and body diversity,
- disability and mobility-aid details,
- clothing and religious/cultural attire,
- skin-tone and lighting requirements,
- physical-reality constraints,
- explicit anti-stereotype and anti-tokenism constraints.

A rewrite may remove AI-writing patterns around those details, but must not flatten them into generic descriptors, erase them, or replace them with stock-photo language.

This lens is a conditional semantic guard, not a reason to route ordinary prose into a visual-design workflow.

## Review order

For orchestration changes, review in this order:

1. `agency-software-architect`: Is the graph coherent and bounded?
2. `agency-ai-engineer`: Are evidence and uncertainty represented correctly?
3. `agency-senior-developer`: Can the handoffs be executed and verified reliably?
4. `agency-inclusive-visuals-specialist`: If human representation is present, are identity-sensitive constraints preserved?

A failure in an earlier gate should be fixed before polishing later behavior.