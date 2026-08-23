---
name: voice-preserving-rewriter
description: Use when the user asks to rewrite, humanize, clean up, or remove AI-isms from text while preserving the writer's voice, facts, intent, structure, register, and protected material.
---

# Voice-Preserving Rewriter

Rewrite text using the complete rules in `../avoid-ai-writing/SKILL.md`. The original Skill is the authority for pattern tiers, formatting rules, sentence-shape rules, voice profiles, context modes, exclusions, and convergence behavior.

For cross-Skill work, follow `../avoid-ai-writing-router/references/handoff-contract.md` and `../avoid-ai-writing-router/references/skill-graph.json`.

## Connection contract

### Incoming

Accept rewrite work from:

- `avoid-ai-writing-router` via `ROUTE` for returned-text rewriting.
- `ai-writing-detector` via `FEED` when the user requested audit plus rewrite.
- `preservation-verifier` via bounded `REPAIR` when a returned-text rewrite failed a preservation check.

Treat detector findings as evidence, not a command to rewrite every flagged span. Preserve passages that already sound human.

Carry forward the handoff envelope's voice, context mode, protected constraints, risk flags, and pass state.

### Produce

Preserve or update:

- user voice and destination constraints,
- protected semantic constraints,
- original text needed for verification,
- rewritten text,
- pass index,
- representation-sensitive guard state when applicable.

Do not mark verifier execution here. Verification belongs to `preservation-verifier`.

### Outgoing

- `VERIFY` to `preservation-verifier` whenever both original and rewritten content are available and the workflow requires preservation confidence.
- Return to the router if the user changes the target from returned text to a named file.
- Do not hand off to `file-edit-in-place` unless the user explicitly requests file mutation.
- Do not make consequential authorship claims. If that becomes the user's question, return control to the router for `false-positive-reviewer`.

## Conditional representation guard

If the source is an image/video prompt, storyboard, shot description, or creative brief describing people, apply the `agency-inclusive-visuals-specialist` lens in `../avoid-ai-writing-router/references/agency-role-lenses.md`.

Treat identity and representation details as protected semantics, including when present:

- cultural and geographic specificity,
- age and body diversity,
- disability and mobility aids,
- clothing and religious/cultural attire,
- skin-tone and lighting requirements,
- physical-reality constraints,
- anti-stereotype or anti-tokenism instructions.

Remove AI-writing style around those details without genericizing, erasing, stereotyping, or replacing them with stock-photo language.

This guard does not make the visual agency Skill a runtime dependency. It protects semantics while the rewrite remains owned here.

## Workflow

1. Read the user request and any incoming handoff envelope.
2. Identify the requested voice, audience, destination, and register.
3. Audit the text for AI-writing patterns before changing it. Reuse incoming detector evidence instead of duplicating an executed detector run unless a fresh audit is needed.
4. Preserve content that already sounds human.
5. Rewrite only the spans that need work. Keep names, figures, claims, technical details, URLs, file paths, and intended argument intact.
6. Preserve source rough edges when they are part of the writer's fingerprint, especially in casual writing.
7. Do not rewrite quoted material, code blocks, tables, attributed text, or other protected regions.
8. Apply any conditional representation constraints.
9. Run the canonical corrective second pass within the canonical pass limit.
10. Send before/after content to `preservation-verifier` when required.

## Repair path

When entered from `preservation-verifier` after a `FAIL`:

1. Change only the spans implicated by the blocking preservation errors.
2. Do not perform a broad second rewrite.
3. Preserve the existing handoff envelope and increment only the repair/pass state that actually changed.
4. Return to `preservation-verifier` once.
5. If the second verification still fails, stop and report the unresolved issue. Do not cycle again.

## Voice handling

When a voice is named, use the canonical profiles: casual, professional, technical, warm, or blunt. When the user supplies a style guide or prior sample, prefer those concrete cues over generic polishing.

Do not make every sentence perfectly grammatical if that would erase the user's register. Do not replace one AI cliché with another.

## Stop conditions

Stop after the requested rewrite and any required bounded verification/repair cycle. Do not run detector or verifier stages merely because they exist when the user did not request or need them.

## Output

Unless the user requested only the finished rewrite, return a concise audit, the rewritten text, a concise change summary, and preservation verification status when it actually ran. If a representation guard applied, mention only materially relevant preserved constraints rather than adding a separate visual-design report.
