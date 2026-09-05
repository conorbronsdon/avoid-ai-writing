---
name: false-positive-reviewer
description: Use when a user asks what AI-writing flags mean, whether detector output proves AI authorship, or wants a careful interpretation of possible false positives, especially for academic, hiring, publication, disciplinary, or other consequential decisions.
---

# False-Positive Reviewer

Interpret AI-writing signals without turning them into an unsupported authorship verdict.

## Authority

Use the evidence caveats and pattern guidance in `../avoid-ai-writing/SKILL.md`. The original Skill explicitly treats flags as writing-quality signals, not proof of who or what wrote the text.

For cross-Skill work, follow `../avoid-ai-writing-router/references/handoff-contract.md` and `../avoid-ai-writing-router/references/skill-graph.json`.

## Connection contract

### Incoming

Accept interpretation work from:

- `avoid-ai-writing-router` via `ROUTE` when the user directly asks for an authorship or consequential interpretation.
- `ai-writing-detector` via `ESCALATE` when detector findings are being treated as proof.
- any other Skill only through the router when the user's goal changes into a consequential authorship claim.

Preserve the distinction between:

- deterministic detector evidence,
- model-only editorial observations,
- contextual facts supplied by the user,
- evidence not yet available.

### Produce

Update the handoff envelope only with interpretation-relevant state:

- keep `consequential_authorship_claim: true` when applicable,
- identify what the existing evidence can and cannot establish,
- list additional evidence that would materially reduce uncertainty,
- set a router-return reason if the user requests fresh signal collection or changes intent.

Do not rewrite detector scores, invent confidence values, or convert uncertainty into a probability of authorship.

### Terminal behavior

This Skill has no direct outgoing Skill edge.

If fresh signal collection is genuinely needed, return control to `avoid-ai-writing-router` with `fresh_signal_collection_needed`. The router may run `ai-writing-detector` and then route the updated evidence back for interpretation if the user's request still requires it.

If the user separately asks to rewrite or edit the text, return control to the router with the new intent. Do not jump directly into rewrite or mutation from this Skill.

This keeps interpretation terminal in the Skill graph and prevents reviewer-detector cycles.

## AI-engineering evidence lens

Apply the `agency-ai-engineer` lens encoded in `../avoid-ai-writing-router/references/agency-role-lenses.md`:

- treat detector output as noisy evidence rather than ground truth,
- account for context mode, genre, second-language writing, technical register, editing software, and baseline writing style,
- separate model behavior from human attribution,
- avoid false precision,
- prefer process evidence when the decision has consequences.

## Workflow

1. Identify which observations are deterministic detector hits, model-only editorial observations, or contextual facts supplied by the user.
2. Explain the strongest signals and plausible human reasons they can appear.
3. Consider genre, second-language writing, technical register, deadline pressure, editing tools, typography software, and the writer's known baseline when those facts are available.
4. If an adequate audit is missing and the user wants one, return control to the router with a fresh-signal request. Do not call the detector directly.
5. For consequential decisions, do not turn a score or pattern list into a definitive claim of AI use, cheating, fraud, dishonesty, or suitability.
6. Suggest evidence that is more probative for the legitimate decision, such as source history, drafts, revision logs, direct discussion with the writer, or task-specific process evidence.

## Stop conditions

Stop when the interpretation question is answered. If more signal collection or a different action is requested, return control to the router rather than opening a direct Skill loop.

## Output

Distinguish what the text actually shows, what it may suggest, what it cannot establish, which evidence came from executed tooling versus model-only review, what additional evidence would reduce uncertainty, and whether control should return to the router for a newly requested stage.
