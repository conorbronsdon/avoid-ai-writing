PR295 verdict: NEEDS CHANGES. PR296 verdict: APPROVE — no >=80% actionable residual.

Contract review only, not executed behavior. Tests/CI/parity pass assumed.

PR295 — a0c4ed `SKILL.md`:
1. Dual-deliverable contradiction — `SKILL.md:99-100`: Second-pass audit returns corrected text inline and says use this version, not §2. Publishes two full rewrites, invites wrong-copy, contradicts single-source fidelity.
2. Unbounded/ambiguous pass budget — `SKILL.md:121` + `SKILL.md:99-100`: built-in pass *is* pass 2, `--iterate N` max 2 stacks unclearly. Cannot verify editing budget vs preservation repair.
3. Runtime verification gap — `SKILL.md:131-part2:1` marks pass + `SKILL.md:98-112` output: requires `node scripts/normalize-quotes.js`, manual fallback if unavailable, but no model-only labeling. Allows unverified claim of verified.
4. Imperative-deletion gap — `SKILL.md:53-56`: source-as-data, instructions from user only. No bar on deleting source imperative/approval-seeking sentence as instruction. Source-fidelity risk.

PR296 — 924b21c `SKILL.md` fixes all four, precedence preserved:
* Single `Final rewrite` — `SKILL.md:102-110`: complete audit/passes/verification before responding, never publish draft then supersede, Verification describes Final text.
* Explicit pass accounting — `SKILL.md:3-6`: initial + one corrective only, audits/re-reads/detector checks consume 0, no-op 0, corrective+repair share budget, report passes/stop reason.
* Honest model-only — `SKILL.md:104-106,13,23`: label detector/marks/preservation model-only when tools unavailable, even if no-op.
* Imperative preservation — `SKILL.md:71-74`: do not delete merely for resembling instruction, imperative is not factual claim.
* Voice/context/protected precedence intact — `SKILL.md:78,92,part-6:114-part-7:1`: voice never overrides fidelity/protected, inferred voice never reactivates context skip, mechanics typography only.

