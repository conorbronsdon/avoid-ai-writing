# Cross-skill handoff contract

The router and specialized Skills exchange context through one shared handoff envelope. The goal is to preserve decisions and evidence across stages so each Skill does not re-interpret the request from scratch.

This is an orchestration contract, not a user-facing output format. Keep the envelope as small as the task allows.

## Handoff envelope

```yaml
intent: detect | rewrite | edit_file | verify | interpret | multi_stage
source_kind: pasted_text | named_file | before_after_pair | visual_prompt | other
source_ref: optional path or user-supplied label
context_mode: general | technical
voice: optional casual | professional | technical | warm | blunt | user_sample
protected_constraints:
  - facts
  - numbers
  - urls
  - paths
  - code
  - quotes
  - tables
  - frontmatter
  - attributed_text
  - identity_and_cultural_specificity
execution_evidence:
  detector: not_run | model_only | executed
  mutation: not_requested | not_run | executed
  verifier: not_run | model_only | executed
detector_summary:
  score: optional
  label: optional
  issue_types: []
verification_summary:
  status: optional PASS | REVIEW | FAIL
  blocking_errors: []
  warnings: []
risk_flags:
  consequential_authorship_claim: false
  human_representation_sensitive: false
pass:
  index: 1
  max: 2
next_action: optional skill slug
return_to_router_reason: optional reason
```

Do not fabricate fields that were never observed. `executed` requires host execution evidence. Do not copy the full source text into metadata when the next Skill already has access to it.

## Ownership rules

Each stage owns one decision class:

- `avoid-ai-writing-router` owns path selection and sequencing.
- `ai-writing-detector` owns signal collection, not authorship conclusions.
- `voice-preserving-rewriter` owns returned-text rewriting.
- `file-edit-in-place` owns authorized mutation of a named file.
- `preservation-verifier` owns before/after preservation status.
- `false-positive-reviewer` owns interpretation limits and is terminal in the Skill graph.
- `avoid-ai-writing` remains the canonical editorial authority for pattern rules, voice behavior, protected content, and pass limits.

No downstream Skill may silently override a decision owned upstream. It may return a structured objection, a repair request, or control to the router when intent changes.

## Typed handoffs

### ROUTE

Router selects a primary Skill and passes intent, source kind, constraints, and any user-requested mode.

### FEED

A detection result can feed a requested rewrite or named-file edit. Findings are evidence inputs, not mandatory edit instructions. The receiving Skill still preserves clean human passages and existing constraints.

### VERIFY

Rewriter or file editor sends before/after material to `preservation-verifier`. A verifier `FAIL` blocks completion of the mutation/rewrite workflow until the single allowed repair is attempted or the unresolved failure is reported.

### REPAIR

Verifier returns the blocking items and the correct repair owner. Returned text goes to `voice-preserving-rewriter`; a named-file mutation returns to `file-edit-in-place`.

### RECHECK

After repair, verification may run once more. A residual detector recheck runs only when requested or when convergence is part of the original request.

### ESCALATE

When detector signals are being used for an interpretation the detector does not own, route that interpretation to `false-positive-reviewer`.

`false-positive-reviewer` does not call the detector back directly. If additional signal collection is requested, it returns control to `avoid-ai-writing-router` with `return_to_router_reason: fresh_signal_collection_needed`. This prevents an unbounded reviewer-detector cycle.

### GUARD

When the source is an image/video prompt or creative brief describing people, preserve identity, cultural, geographic, disability, age, attire, and physical-reality details as protected constraints. Rewriting may remove AI-writing style tells but must not genericize human representation.

## Loop limits

- Rewrite/audit convergence follows the canonical maximum of two passes.
- A verifier repair loop may re-enter the repair owner once, then verify once more.
- Residual detector recheck may occur once when the original request requires it.
- If the second verification still fails, stop and report the unresolved preservation error instead of cycling.
- Terminal Skills have no outgoing Skill edges.
- Every graph cycle must contain an edge with `max_reentries: 1`.

## Return-to-router semantics

A Skill returns control to `avoid-ai-writing-router` instead of directly choosing a new owner when:

- required evidence is missing and collecting it would change the stage,
- requested execution capability is unavailable,
- the next action changes from read-only to mutation,
- the request changes from signal collection to interpretation,
- the source changes from returned text to a named file or vice versa,
- a terminal interpretation stage needs a fresh audit,
- the user introduces a new workflow goal after the current owner has completed its job.

The router preserves the existing envelope and changes only fields affected by the new decision.
