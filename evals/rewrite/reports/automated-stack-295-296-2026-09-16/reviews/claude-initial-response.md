# Independent Findings-Only Review

## PR295 Verdict: Conditional pass — one unresolved contract conflict, one internally-superseded defect

**1. [Medium-High] Preservation-verifier self-grading on authorized protected-content edits**
`skills/preservation-verifier/SKILL.md`, "Additional protected constraints" section (added in PR295):
> "If the user specifically placed a normally protected span in scope, verify that requested change and continue protecting its data and attribution; do not infer permission from a general cleanup, style, or voice request."

The mechanical validator (`validate.js`) cannot know whether a protected-region diff was user-authorized — it only detects structural change. This clause therefore requires the *model* to decide, after the fact, whether its own (or a sibling skill's) protected-content edit was in-scope, and to clear a preservation check on that basis. That is the editor certifying its own edit, which is exactly the self-sign-off pattern the project's own gate later forbids (see `evals/rewrite/automated-gate.md` §5: "An editor must not provide its own independent sign-off"). Concretely: a rewrite that alters a quoted attribution under a claimed "user asked for it" scope will pass verification with no independent check that the scope claim was accurate.

**2. [Low, self-resolving] Dual full-text output contract in rewrite mode**
`SKILL.md`, Output format → Rewrite mode: section 2 ("Rewritten version") and section 4 ("Second-pass audit," which says "the corrected text here is the deliverable") can both contain a complete rewrite, contradicting the single-deliverable principle the editing contract otherwise implies. This is fixed by PR296's "Final rewrite exactly once" rule, so it is not an outstanding defect once both PRs land, but it is a real bug in PR295 taken alone.

---

## PR296 Verdict: Conditional pass — core self-grading issue persists

**1. [Medium-High] REVIEW override for protected-content diffs does not eliminate self-grading**
`skills/preservation-verifier/SKILL.md`, REVIEW section:
> "This includes a literal validator difference that corresponds to a specifically requested edit of normally protected content: review it against that scope ... instead of automatically repairing it back to the original."

This is an attempted fix for the PR295 issue above, but it relocates rather than resolves it: the deterministic tool still reports a blocking structural diff, and the *model* now has explicit license to downgrade that FAIL to REVIEW based on its own judgment that the edit was "specifically requested." Nothing in the diff adds an independent, non-editor check of that authorization claim. A rewriter that mis-scopes an edit (e.g., treats a general voice request as license to touch a quoted passage) can self-certify the resulting validator FAIL as an intentional REVIEW, silently defeating the protected-content guarantee the contract advertises. Given `automated-gate.md`'s explicit requirement for independent semantic review, this remains an actionable gap: the contract needs a check performed by a party other than the mutation owner before a protected-region structural diff is downgraded from FAIL.

No other high-confidence scope/fidelity/pass-budget defects were found; the shared editing-pass accounting (`pass.index`/`pass.max`, RECHECK non-consumption, repair-uses-next-pass) is internally consistent across `SKILL.md`, `file-edit-in-place`, `voice-preserving-rewriter`, and the handoff contract.
