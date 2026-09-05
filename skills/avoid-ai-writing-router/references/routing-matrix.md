# Routing matrix

`skill-graph.json` is the machine-readable source of truth. This table explains the same routes for human review. Cross-stage state follows `handoff-contract.md`.

<!-- BEGIN GENERATED GRAPH ROUTES -->
<!-- skill-graph-sha256: 66a3beb7883a580e56810fab5e8e2fc01147ef8f8ee21fb37d66cbd1c7e2ed0b -->
| Type | From | To | When | Max reentries |
| --- | --- | --- | --- | --- |
| ROUTE | `avoid-ai-writing-router` | `ai-writing-detector` | `detect_or_audit_only` |  |
| ROUTE | `avoid-ai-writing-router` | `voice-preserving-rewriter` | `rewrite_returned_text` |  |
| ROUTE | `avoid-ai-writing-router` | `file-edit-in-place` | `mutate_named_file` |  |
| ROUTE | `avoid-ai-writing-router` | `preservation-verifier` | `compare_before_after` |  |
| ROUTE | `avoid-ai-writing-router` | `false-positive-reviewer` | `consequential_authorship_interpretation` |  |
| FEED | `ai-writing-detector` | `voice-preserving-rewriter` | `user_requests_rewrite_after_audit` |  |
| FEED | `ai-writing-detector` | `file-edit-in-place` | `user_requests_named_file_fix_after_audit` |  |
| ESCALATE | `ai-writing-detector` | `false-positive-reviewer` | `user_asks_what_flags_prove` |  |
| VERIFY | `voice-preserving-rewriter` | `preservation-verifier` | `original_and_rewrite_available` |  |
| VERIFY | `file-edit-in-place` | `preservation-verifier` | `before_snapshot_available` |  |
| REPAIR | `preservation-verifier` | `voice-preserving-rewriter` | `returned_text_failed_preservation` | 1 |
| REPAIR | `preservation-verifier` | `file-edit-in-place` | `named_file_failed_preservation` | 1 |
| RECHECK | `preservation-verifier` | `ai-writing-detector` | `convergence_or_residual_audit_requested` | 1 |
<!-- END GENERATED GRAPH ROUTES -->

| Intent | Primary owner | Allowed follow-up | Stop condition |
| --- | --- | --- | --- |
| detect, scan, audit, score, flag only | `ai-writing-detector` | feed findings into a requested rewrite/edit stage, or escalate interpretation when needed | findings returned |
| rewrite returned text | `voice-preserving-rewriter` | `preservation-verifier` when before/after verification is part of the workflow | rewrite and required verification complete |
| modify an explicitly named file | `file-edit-in-place` | `preservation-verifier` after a real mutation when a before snapshot exists | authorized mutation and required verification complete |
| compare original with rewrite | `preservation-verifier` | one repair to the correct owner, then one verification recheck | pass, review accepted, or second failure reported |
| interpret what detector signals can establish | `false-positive-reviewer` | return control to router if fresh signal collection or a different action is requested | evidence limits explained |
| audit plus rewrite plus verify | `avoid-ai-writing-router` | detector -> rewriter/editor -> verifier -> optional one repair -> verifier | requested sequence complete |
| rewrite a visual prompt or creative brief involving people | normal rewrite/edit owner plus representation guard | verifier may review protected representation details separately | wording cleaned without erasing protected meaning |
| explicit canonical Skill invocation | `avoid-ai-writing` | remain canonical unless a specialized stage is needed | canonical workflow complete |

## Typed edges

- `ROUTE`: select the primary owner.
- `FEED`: pass evidence into another requested stage without converting evidence into an instruction.
- `VERIFY`: send before/after material to the preservation gate.
- `REPAIR`: return blocking preservation scope to the correct rewrite or mutation owner.
- `RECHECK`: run one residual audit when requested.
- `ESCALATE`: move interpretation limits to `false-positive-reviewer`.
- `GUARD`: attach protected semantic constraints without changing the primary owner.

## Tie breakers

1. A named file plus explicit mutation intent wins over general rewrite wording.
2. Flag-only intent wins over generic cleanup wording.
3. Interpretation questions use `false-positive-reviewer` even when detector evidence already exists.
4. Returned-text repair belongs to `voice-preserving-rewriter`; named-file repair belongs to `file-edit-in-place`.
5. Human representation inside a visual prompt adds a guard but does not change the rewrite/edit owner.
6. When no specialized path fits cleanly, use the canonical `avoid-ai-writing` Skill.

## Review lenses

Use `agency-software-architect` for graph boundaries, `agency-ai-engineer` for evidence semantics, `agency-senior-developer` for execution reliability, and `agency-inclusive-visuals-specialist` only for representation-sensitive visual prompts or briefs.

The encoded behavior is in `agency-role-lenses.md`. These lenses do not add public Plugin dependencies.
