**finalSHA: 0fdaf07920d0406998e2fa4f64e3f99a07bd5c7b**

**Verdict: 2 actionable findings**

---

**Finding 1 — Undefined term "planned edit" creates ambiguity across both changed files**
Severity: medium | File: references/patterns.md:723 and SKILL.md:225

The new instruction at patterns.md:723 says "planned or reverted edits must not be reported as completed changes" and "A justified edit missing from the final text remains unresolved." SKILL.md:225 uses the same term: "A planned edit that is absent from the delivered text is not a completed change." Neither file defines "planned edit." The skill has three candidate referents: (a) a finding from the audit, (b) an edit explicitly planned in a pass-by-pass sequence, or (c) a candidate change the editor intends to make. The distinction matters because an audit finding that was correctly identified but never attempted (budget exhausted before that pass) differs from an edit that was attempted and reverted. The new text treats both as "planned edits" that "remain unresolved," but does not tell the editor which bucket a given item falls into or how to track the boundary. The "sharedbudget" reference at patterns.md:725 assumes the editor can query remaining budget, but no mechanism is specified for counting remaining passes against the ceiling. **Suggested fix:** Add a parenthetical or gloss on first use in both locations, e.g., "A planned edit (an edit the audit identified as justified but that was never applied or was reverted)." This makes the tracking obligation explicit.

---

**Finding 2 — "Reverted pass still counts" underdefined relative to pass-counting rules**
Severity: low-medium | File: SKILL.md:226, referencing SKILL.md:126

Line 226 states: "Keep actual pass history, including reverted passes, separate from the differences that survive in the final text." Line 126 states: "A no-op uses none" (zero passes consumed). The new text implies a reverted pass is a pass that was *used* (counted toward the budget) but whose change was undone. Line 126 does not address this case. The interaction is: if the editor uses pass 1 on an edit that is later reverted, is that 1 pass used or 0? The answer (1 pass used, change reverted, budget decremented) is inferable but not stated, and the phrase "reverted real pass still counts" could be read as "counts toward pass count" or "counts as a finding resolved." The former is the intent; the latter would contradict "Do not say a phrase was removed… while it remains." **Suggested fix:** Clarify in the new SKILL.md paragraph: "A pass whose edits were later reverted still counts as a used pass toward the editing budget; it does not count as a completed change in the summary." This eliminates the read-direction ambiguity.