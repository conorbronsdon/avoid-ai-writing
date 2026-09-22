## PR295 Findings (726c8c4)

**No actionable defects.** The separation of `context_profile` from `context_mode` is internally consistent across all touched files. The handoff-contract additions (`requested_scope`, `explicit_corrections`, `context_profile`) are properly threaded through router → detector → rewriter → file-editor → verifier. Terminology shift from "findings" to "candidate matches" is applied uniformly.

## PR296 Findings (66c997f)

**Finding 1 — REPAIR edge guard is semantic, not structural**
`skill-graph.json:68-69` — The `when` field now reads `returned_text_failed_preservation_and_shared_editing_budget_remains`. The JSON schema has no compound-condition mechanism; this is a documentation label. The router must evaluate `pass.index < pass.max` at runtime before traversing the edge. If the router treats `when` as a simple string-match predicate, the budget check will be silently skipped and repairs will exceed the pass limit. **Verify the router's edge-evaluation logic actually parses this compound condition.**

**Finding 2 — pass.max type ambiguity**
`handoff-contract.md:45` — `pass.max: 1 | 2` is markdown union syntax. The actual runtime value must be a concrete integer set by the `--iterate` flag. This is not a defect in the contract, but any code serializing or reading the envelope must resolve this to `1` or `2` before use. **Confirm no code path treats the literal string `"1 | 2"` as the value.**

**Finding 3 — Repair-path budget check ordering**
`voice-preserving-rewriter/SKILL.md:90-91` (repair path step 1) and `file-edit-in-place/SKILL.md:83-84` (repair path step 1) — Both now check budget before repairing. Correct. However, the verifier's outgoing REPAIR decision (`preservation-verifier/SKILL.md:95-96`) also checks budget. If the verifier passes the envelope to the repair owner without incrementing `pass.index`, the repair owner must increment it. **Confirm exactly one site increments `pass.index` per repair cycle — not both verifier and repair owner.**

## Final SHAs

- **PR295**: `726c8c4a01a45cc126b12652a75c1c867092893c` — **PASS**
- **PR296**: `66c997f6ed400511b97777ce65340936d458a6c0` — **PASS with 3 findings** (all verification-level, not blocking)
