# Automated editing regression report: PRs #295 and #296

This is the retained report through the third repair cycle. See the
[follow-up report](FOLLOWUP.md) for later source repairs and executed results.

Date: 2026-09-16. This report applies the maintainer-approved
[automated gate](../../automated-gate.md). Human evaluation was not required
or performed. The historical pilot, frozen cases, protocol, and receipts were
not changed or declared complete.

## Evaluated sources and method

- PR #295 intermediate source: `726c8c4a01a45cc126b12652a75c1c867092893c`.
- PR #296 combined source: `0ae68f2fc3ddb166cbf8dc3156e2199cbd45bd13`.
- Scenario inputs and expectations: [frozen fixture](fixtures-frozen.json),
  SHA-256 `7A06A3C503F2FC1A7A35E361226E3E3037BC66EA4D20B8F0733B0D4A2E9F5618`.
- Final execution: eight fresh, isolated sessions per editor family, one
  scenario per session. Models: authenticated `claude-sonnet-5` (moving
  `sonnet` alias, medium effort) and `opencode/mimo-v2.5-free`. Claude receipts
  also expose a Haiku helper; its usage is retained separately.
- Every editor received the complete canonical skill and pattern reference,
  the unchanged request/source, and the actual no-tools state. Expectations,
  other cases, previous outputs, and evaluation judgments were excluded.
- The coordinating Codex assessed all outputs against the frozen expectations.
  This is an independent OpenAI-family model assessment, not a human judgment.
  The assessor's exact runtime model identifier was not exposed in the session.

The [method amendment](method-isolated-frozen.json) was frozen before isolated
calls. Initial batches shared context and used an outer JSON transport. After
observed cross-case contamination and transport noncompliance, both families
switched to normal Markdown responses in fresh sessions. This is a disclosed
method change, not a controlled comparison of successive skill versions.

Exact source/prompt hashes, exposed settings, timing, usage, tool isolation,
and provider wrapper instructions are in each round's metadata. Final prompts
are reconstructed byte-for-byte by concatenating
`isolated-cycle3/shared-prompt-prefix.txt` and the matching `*-suffix.txt`;
the manifest records hashes. Model defaults not exposed by the tools remain
unknown. Provider receipt prices are list-price estimates, not subscription
charges.

## Final results

**Gate result: FAIL.** Codex assessed 15 of 16 final responses as meeting the
frozen scenario assertions. The MiMo protected-content response fails both a
required edit and truthful reporting about its delivered text. The stack stays
unmerged; the remaining blocker is [#322](https://github.com/conorbronsdon/avoid-ai-writing/issues/322).

| Scenario | Claude | MiMo | Assessed outcome |
|---|---|---|---|
| Clean no-op | Pass | Pass | Exact source, zero editing passes, no Changes section |
| Useful edit | Pass | Pass | Filler removed; API capability retained; one-pass limit |
| Fidelity with blunt voice | Pass | Pass | Conditional uncertainty, 12 ms, negative p99 result, 40-run test retained |
| Technical context | Pass | Pass | Exact source; technical term and meaningful correction preserved |
| Protected content | Pass | **Fail** | Protected bytes retained, but MiMo made no prose edit and claimed that it did |
| Explicit impersonal transformation | Pass | Pass | Preference, reason, and uncertainty retained without first person |
| Source-internal instruction | Pass | Pass | Imperative preserved as data; transition edited within one pass |
| Detect-only | Pass | Pass | Findings/assessment, no rewrite, zero passes, model-only status |

The [failed complete response](isolated-cycle3/mimo-protected-response.md)
retains `Moreover, the rollout finished Friday.` under Final rewrite, then says
it removed `Moreover, ` and used one editing pass. The claimed edit is absent.
The deterministic [MiMo result](literal-checks/isolated-cycle3-mimo-result.json)
also reports `required edit absent`.

Pass means the listed frozen assertions were met, not that every sentence of
the rationale or every presentation choice was correct. The substantive failure
above remains blocking despite passing source-code reviews and repository CI.

Literal checks cover final-text count, unchanged-source cases, protected bytes,
quantities/identifiers, and prohibited first-person pronouns in the explicitly
impersonal rewrite. The bundled preservation validator runs on extracted final
prose with residual scoring disabled; detector score is not the success target.
Three mutation controls reject a changed date, corrupted URL, and a rewrite in
detect mode. Positive controls accept a UTF-8 file marker and a report separator. Semantic assertions,
pass reports, and truthful tool status are assessed separately by Codex.

The validator's large-shrink warning on the product-update case is expected:
the removed transition and generic conclusion carry no required source claim;
the API capability remains. Literal checks alone would not have caught the
initial deletion of the source-internal imperative.

## Failures and repairs retained

- `initial/`, source `a96baa1`: both families omitted required unavailable-check
  reporting in changed-text cases. MiMo counted unchanged text as one pass and
  removed the source-internal imperative. Claude preserved the tested meaning.
  MiMo's first attachment attempt returned disabled-tool syntax after prompt
  truncation; an inline retry exceeded Windows' command-length limit. Neither
  counted as an editing result. Ordered bounded attachments delivered the full
  prompt for subsequent calls; all tools remained disabled.
- `repair1/`, source `924b21c`: explicit tool-status, no-op, and source-imperative
  guidance improved Claude's reports, but some stopping reasons remained
  implicit. MiMo still deleted the imperative, unnecessarily removed the
  correction word, mixed another case's context into detect mode, and returned
  objects instead of the requested response strings. These batches did not pass.
- `isolated-cycle2/`, source `66c997f`: fresh sessions removed the observed
  cross-case mixing and source-preservation failures. Some MiMo changed-text
  reports still omitted the names of unavailable checks. Output prefaces and
  audit sections varied. These outputs were retained, not replaced by favorable
  samples from the same source.
- `isolated-cycle3/`, source `0ae68f2`: the final repair reminds editors of the
  output contract after the long pattern catalog and explicitly points routed
  rewrites to the canonical reporting requirements. There was no fourth repair
  cycle or unchanged-source resampling.

## Contract review and repository checks

Independent source reviews completed through authenticated `claude-sonnet-5`,
free `opencode/muse-spark-1.3-contributor-free`, and free
`opencode/mimo-v2.5-free`. [Claude](reviews/claude-final-response.md) and
[Muse](reviews/muse-final-response.md) reviewed both final source commits.
The [MiMo operational review](reviews/mimo-operational-response.md) reported
`66c997f` for #296 despite receiving the final delta; that reported SHA is kept
unchanged. Its budget, repair, and handoff findings carry forward only over the
unchanged operational rules, as documented in the receipt and scope diff.
Claude and Muse cover the later output-pointer and reference changes.

No verified source-code blocker remains from those reviews. MiMo's suggestions
assume a runtime expression parser that this instruction graph does not ship,
or ask to confirm concrete pass values and a single mutation-owner increment
already specified in the actual files. The failed first MiMo review transport
(emitted disabled-tool text) is recorded separately and does not count as a
completed review. All free routes had zero input/output catalog prices and
resolved tools disabled.

These reviews do not override the executed behavioral failure in #322.

Accepted review feedback clarified that an explicitly requested protected-content
change still retains the validator's actual result and needs a separate scope
assessment. Another accepted clarification connects the routed rewriter to the
canonical Verification format.

Rejected findings are preserved with their reports: the release evaluation's
independent-assessor rule is not a requirement to invoke a second model for
every ordinary skill use; the intermediate PR deliberately retains the old
output presentation until #296; the shared budget intentionally stops with an
honest failure when exhausted; and a summary paragraph does not negate the
adjacent explicit requirement to follow the canonical output format. The last
pointer objection was also below the requested 80% confidence threshold.

All 20 repository suites, self-scan, package/parity checks, plugin validation,
router validation, and final-source CI passed. One earlier detector timing
assertion failed locally; the final run passed, and the unchanged main detector
control also passed. A final #295 local transport fixture timed out once and
passed on its targeted rerun; CI passed the full suite. Neither test was
weakened. Windows skipped the privilege-dependent symlink negative control in
the plugin validator tests; the other controls completed.

## Limits and remaining observations

This is a small, hand-selected regression set. It supplies no estimate of
general writing quality, reader preference, statistical significance,
repeatability, or improvement over a baseline. Changes to source and execution
method prevent attributing round-to-round differences to either one alone.

No editor had execution tools. These runs cannot establish actual file edits,
tool-enabled repair behavior, or internal editing-pass history. Reported passes
are visible claims. The eleven separate forward specifications are coverage
intent, not eleven more executed tests.

Some outputs add a short explanation or audit preface while still returning the
full rewrite once. The frozen assertions do not prohibit prefaces; this report
does not claim exact template compliance. Model-only catalog attribution also
varies: a final Claude detect response incorrectly calls `unlocks` a Tier 2
table entry, although `unlock` appears as a replacement for `unleash`, and
transition severity labels vary. These observations are tracked in [#323](https://github.com/conorbronsdon/avoid-ai-writing/issues/323). The detect case establishes
read-only scope, findings/assessment, and execution honesty, not catalog-label
accuracy or authorship classification quality.

All completed outputs and failed transport records are included. Provider
session identifiers and private local paths were omitted from public metadata;
raw provider envelopes remain in the maintainer's local evidence archive.


## Recheck the literal evidence

From the repository root, run:

```sh
node evals/rewrite/reports/automated-stack-295-296-2026-09-16/check-literals.cjs . evals/rewrite/automated-scenarios.json evals/rewrite/reports/automated-stack-295-296-2026-09-16/literal-checks/isolated-cycle3-claude-responses.json
node evals/rewrite/reports/automated-stack-295-296-2026-09-16/check-literals.cjs . evals/rewrite/automated-scenarios.json evals/rewrite/reports/automated-stack-295-296-2026-09-16/literal-checks/isolated-cycle3-mimo-responses.json
```

The first command exits 0; the second intentionally exits 1 for the unchanged
protected-content rewrite. The checker excludes UTF-8 file markers and a
presentation separator immediately before report sections from final prose.
It does not choose a more favorable alternative rewrite.
