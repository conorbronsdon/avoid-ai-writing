# Automated editing regression gate

Adopted on 2026-09-16 for the editing-contract and single-final-rewrite stack
(PRs #295 and #296), following the maintainer's decision to use automated
verification without requiring human evaluation. This replaces the merge gate
previously attached to issue #201. It does not certify the old experiment as
complete or change its frozen `cases.json`, `protocol.json`, or receipts.

## Required evidence

1. Freeze the candidate commit, scenario inputs, expectations, and execution
   method before model calls. Retain the exact skill sources and their hashes.
   Evaluate the final combined stack; review and mechanically test each PR's
   intermediate commit before landing them in dependency order.
2. Pass the repository test suite, demo preservation regressions, self-scan,
   generated-copy parity, plugin/package validation, and CI. Mutation controls
   must still reject known source-preservation and packaging regressions.
3. Execute targeted scenarios with at least two different editor model
   families. Cover useful edits, clean no-op behavior, facts and uncertainty,
   technical-context exceptions, protected content, explicit transformations,
   source-internal instructions, and single-final output with honest reporting
   of the editing budget and unavailable tools. Include detect-mode scope.
4. Preserve complete prompts and responses, source commit and hashes, model
   identifiers, exposed settings, tool availability, usage when reported, and
   every failed attempt. Report moving aliases and unavailable metadata.
   Missing, empty, truncated, or tool-failed responses do not count as passes.
   Retries must be explicit and retain the rejected attempt.
5. Apply deterministic checks to literal invariants and inspect the resulting
   text against the stated expectations using an independent model family.
   An editor must not provide its own independent sign-off. Label semantic
   judgments as model assessments. Investigate failures against actual source
   and outputs; a low detector score alone cannot establish a pass.
6. Complete independent contract/code reviews of the final commits. Resolve
   verified preservation, scope, useful-edit, output-contract, or false
   verification claims before merging. If a source change affects evaluated
   behavior, rerun affected scenarios on both families and affected reviews.

## Interpretation and limits

This is an automated regression check, not a comparative writing-quality
benchmark. Passing requires completed scenarios for both families, passing
mechanical checks, and no unresolved verified failures within the tested scope.
Review disagreements and rejected findings must be recorded with evidence.

Batched scenarios are allowed when disclosed. They share context and are not
independent samples or evidence of repeatability. A batch format must not
change the editing request within each case or present expected answers to
the editor. One completed response per case/family is the minimum; failures
cannot be hidden by selecting a favorable retry.

No-tools cases test rewriting and truthful reporting when tools are unavailable.
Supplied intermediate states test the reported response to those states; they
do not prove that a file mutation or tool invocation occurred. Self-reported
editing passes are not an instrumentation trace of internal model reasoning.
Actual file-edit behavior remains subject to its packaging checks and contract
review unless a tool-enabled execution is separately recorded.

Human review and a full held-out comparison are optional future work. Do not
claim human validation, reader preference, improved general writing quality,
statistical significance, or successful completion of the historical pilot
from this gate. Reports must state tested scenarios, observed failures,
coverage gaps, and evidence locations. The historical human-review harness
remains available under its original rules for anyone choosing to run it.
