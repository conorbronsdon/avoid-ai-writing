# Follow-up verification of PRs #295 and #296

Date: 2026-09-16. This supplements the [original report](README.md), retaining
all earlier failures. Human evaluation remains optional. No historical pilot
results or acceptance criteria were changed.

The maintainer requested landing the stack and authorized a fourth repair.
That run exposed additional failures. A further source repair and complete
fifth run followed; it is recorded separately, not presented as a retry of the
fourth source or a passing replacement for it.

## Sources and execution

- PR #295 intermediate source remains `726c8c4a01a45cc126b12652a75c1c867092893c`.
- Fourth source: `0fdaf07920d0406998e2fa4f64e3f99a07bd5c7b`.
- Fifth source: `91b5cbebd66dab5df1b3c8a469720e7fb9c43256`.
- Both rounds use the same frozen eight scenarios, expectations, and isolated
  method as the original report. Editors receive the complete skill and
  reference, one request, and its source, without expected answers.
- Editors: authenticated `claude-sonnet-5` and `opencode/mimo-v2.5-free`.
  Each case starts a fresh session with tools disabled. Moving aliases and
  unexposed generation settings limit reproducibility.
- Root Codex independently reads and assesses outputs. These are model
  assessments, not human judgments or instrumented pass traces.

Each round's directory retains complete responses, reconstructable prompts,
source hashes, usage and execution receipts, independent reviews, and literal
check results. Public responses are byte-identical to the saved editor text.
Provider envelopes containing local session identifiers remain local.

## Fourth run

The repair ties Changes and Verification to the delivered artifact, including
edits that were planned but never applied and passes that were reverted.
Both protected-content responses remove the transition they claim to remove.
The round nevertheless fails:

- Claude's technical-context response joins sentences and adds a contraction
  while acknowledging no applicable AI-ism. It fails the exact no-op assertion
  and reports an unnecessary editing pass.
- MiMo's protected-content response preserves the quote but does not identify
  its retained pattern findings. It calls residuals absent in editable prose.
- MiMo's explicit impersonal transformation leaves two first-person plural
  references in the final text.
- MiMo's detect response omits zero-pass and model-only/tool-status reporting.
- MiMo's fidelity report says both one of two passes used and that the requested
  limit was reached. Its substantive final text preserves the tested evidence.

MiMo's technical-context no-op names no checks individually, but the frozen
cross-case requirement names unavailable marks/preservation checks specifically
for rewritten cases. This is a reporting limitation, not a newly added failure
criterion. Catalog-label and presentation variance remain outside the frozen
assertions and are tracked in issue #323.

## Fifth run

The next repair adds a no-op decision before drafting, checks every changed
span against authorized scope, checks explicit transformations across the
whole passage, and requires identification of findings retained in protected
content. The full sixteen responses are re-executed on the new source.

**The gate still fails.** Claude deletes the source-internal imperative despite
the explicit instruction to treat every source sentence as content. It argues
that an imperative has no factual content and may therefore be removed, directly
contradicting the source-preservation contract. MiMo's technical-context no-op
omits the source and Final rewrite altogether. These are observable failures,
not subjective writing-preference judgments.

Root Codex assessed **14 of 16** responses as meeting the frozen assertions:

| Scenario | Claude | MiMo |
|---|---|---|
| Clean no-op | Pass | Pass |
| Useful edit | Pass | Pass |
| Fidelity with blunt voice | Pass | Pass |
| Technical context | Pass | **Fail: final source omitted** |
| Protected content | Pass | Pass |
| Impersonal transformation | Pass | Pass |
| Source-internal instruction | **Fail: source sentence deleted** | Pass |
| Detect-only | Pass | Pass |

The complete failed responses are
[Claude source instruction](isolated-cycle5/claude-source_instruction-response.md)
and [MiMo technical context](isolated-cycle5/mimo-technical_context-response.md).
Neither earlier passing samples nor green repository tests replace them.

The literal checker rejects MiMo's absent Final rewrite. It does not reject
Claude's deletion: preserving the meaning of a source-internal instruction is
a semantic assertion assessed separately by the independent Codex reader.
This demonstrates why literal checks alone do not establish a pass.

Recheck each round with the original `check-literals.cjs`, the unchanged
`fixtures-frozen.json`, and `isolated-cycle4/claude-responses.json` (or the
corresponding model/round). Cycle four's literal results both fail; cycle five's
Claude literal result passes while MiMo's fails. Three mutation controls still
reject a changed date, a corrupted URL, and a Final rewrite in detect mode.

## Verification and limits

Authenticated Claude Sonnet 5, free Muse Spark 1.3 contributor, and free MiMo
2.5 completed affected-source reviews at each new exact SHA. The previous
reviews carry forward only for unchanged PR #295 and unchanged PR #296 scope.
Each round's `reviews/` directory contains the reports, packet, and receipts.
Both free routes had zero input/output prices and all tools disabled.

Root verified the final review claims against the actual files. Muse reports
no actionable defect. Claude's three reservations explicitly describe no
contradiction: the no-op condition already excludes requested transformations,
the footer reminder is consistent with the entry, and explicitly authorized
protected edits are editable scope under the existing contract. MiMo's future
duplication concern is a maintenance risk, not a present inconsistency. Its
audit/pass objection conflicts with the explicit definition of a pass as a
stage that changes text and the required no-op Verification. Its request to
replace "unauthorized removal" with "unauthorized change" is already satisfied
in the reviewed source. No verified introduced instruction defect remains from
these reviews; that does not override the observed behavioral failures.

The fourth-round MiMo objections similarly overlook the existing pass-budget
definition and explicit statement that reverted editing passes still count.
The complete objections remain in the evidence rather than being suppressed.

On `91b5cbe`, all 20 repository test suites passed, self-scan passed, generated
copies were synchronized, plugin validation returned OK, and CI passed. The
tests include the existing preservation and packaging mutation controls.
No test or scenario expectation was weakened to obtain those results.

This small diagnostic set cannot establish general editing quality or a failure
rate. Successive source changes are informed by these public development cases;
this is not a held-out comparison. No tools were available to the editors, so
the calls do not validate actual file edits or execution-tool behavior.

The required automated gate remains unsatisfied. Landing with these known
failures would be a maintainer exception to that gate, not a passing evaluation.
