## PR295 (base 9561a75 → a0c4ed4)

**Verdict: Approve with one fixable gap.** The editing contract is internally consistent (scope, fidelity, protected-content, context/voice precedence all cross-reference cleanly across SKILL.md, patterns.md, and the five downstream skills).

**Finding — Mechanical check doc not updated for user-authorized protected edits (P1, scope/fidelity conflict)**
`SKILL.md`, "### Edit mode" → "**Mechanical check (optional, recommended for edit mode)**" paragraph (unchanged by this PR).

The new Protected content clause (`SKILL.md`, Editing contract) legitimizes editing quoted/table/code/attributed spans "when the user specifically identifies it as part of the requested editing scope." But the Mechanical check paragraph still says the validator "exits non-zero when a rewrite altered a fenced code block, YAML frontmatter, a blockquote, a table cell, inline code, a URL, a file path, or the heading structure" with no carve-out for a legitimate, user-authorized change to one of those regions. `skills/preservation-verifier/SKILL.md` gets this nuance ("If the user specifically placed a normally protected span in scope, verify that requested change... do not infer permission from a general cleanup"), but the base single-file skill's own edit-mode documentation was not updated to match. Example: user says "update the numbers in this table to match the new pricing" — a legitimate authorized table edit — and the base skill's mechanical check will report a non-zero exit with no instruction to distinguish that from a real corruption regression, risking a false "verification failed" report.

Fix: add the same authorized-protected-edit carve-out to the Mechanical check paragraph in `SKILL.md`.

Everything else reviewed (shared context_profile vs context_mode plumbing, voice/context precedence, source-fidelity/never-inject guardrails, self-referential instruction handling) is coherent.

---

## PR296 (base a0c4ed4 → a96baa1, superseded final 924b21c)

**Verdict: Approve.** Single-final-output contract, honest verification/model-only labeling, and the shared editing-pass budget are specified consistently across `SKILL.md`, `voice-preserving-rewriter`, `file-edit-in-place`, `preservation-verifier`, and `handoff-contract.md`. Test/fixture parity (`rewrite-demo.test.js`, `reviewer-tests.json`) was updated to match the new "Final rewrite" heading.

**Finding — Budget priority: self-review corrective pass can starve a preservation repair (P2, shared pass budget)**
`skills/voice-preserving-rewriter/SKILL.md`, Workflow steps 9–10.

Step 9 runs the self-review corrective pass (consuming pass 2 of 2 if it finds another justified in-scope edit) *before* step 10 sends the result to `preservation-verifier`. If the corrective pass spends the last budget slot on an ordinary AI-ism fix, a subsequent preservation `FAIL` (e.g., a quote/number/attribution dropped) has no budget left for repair — `pass.index` is already at `pass.max`, so `preservation-verifier`'s REPAIR edge (`skill-graph.json`) is blocked regardless of severity. No rule in `handoff-contract.md` or the two skills prioritizes a preservation failure over a stylistic corrective edit when both compete for the same last slot; the budget is spent strictly in workflow order, not by severity.

Example: with `--iterate 2` (default), initial rewrite = pass 1; self-review finds a lingering "delve" and fixes it = pass 2 (budget exhausted); verifier then finds a dropped quote attribution → `FAIL` with no repair capacity, reported as an unresolved failure even though it's the more serious problem.

This is a design gap worth a severity-aware tiebreak (e.g., reserve the last pass for preservation repair, or let a preservation `FAIL` preempt a pending stylistic corrective pass), not a correctness bug — the honest-failure reporting itself works as specified.
