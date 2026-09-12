# Rewrite preservation regressions

`demo.json` records the quick demo's source, required facts, known forbidden
additions, allowed edits, and contrasting outputs. Run `node scripts/rewrite-demo.test.js`.
The check reads the published README pair, so fixture-only correctness cannot
hide a regression in the example readers see.

These explicit patterns catch the original investor/integration inventions and
missing dashboards. They accept more than one rewrite, but can reject an
unlisted paraphrase or accept a negated, contradictory, or newly invented claim.
They do not prove semantic fidelity. Human review remains necessary.

## Published example audit

Reviewed at main `d57265d` for issue #200:

- Quick demo: removed an unsupported investor and integration mechanism; restored
  real-time dashboards.
- Full README example: retained its supported investor list and product
  capabilities; removed invented resolution times, Datadog attribution, paying
  customer count, EMEA hiring and log-management plans. Preserved the supplied
  go-to-market plan and adoption claim. Explicitly flagged the unnamed market
  and study sources instead of silently replacing their figures.
- README catalog rows 1, 2, 4, 5 and 7: replaced example-specific inventions with
  editing guidance. Other rows describe transformations or use placeholders;
  they are illustrative directions, not verified factual source/output pairs.
- `examples/prose.json` and `examples/technical.json` are style configurations,
  not rewrite pairs. The catalog's embedded rule examples remain outside this
  published-demo audit; this review does not certify every rule in the skill.

The examples are fictional. No real-world funding or product claim is verified
by these fixtures. Wider editing evaluation is tracked in #201.

## Editing evaluation pilot (#201)

This is offline evaluation infrastructure, not a model runner or a published
benchmark result. It makes no network calls and needs no model credentials.
The case/schema tests and synthetic plumbing outputs do not establish editing
quality. The pilot contains 48 synthetic cases: 12 each for clean prose, clear
edits, contextual judgments, and preservation conflicts. The corrected demo
seeds `clear-edit-04`.

Cases record atomic claims, exact protected spans, allowed edits, expected
preserve/change decisions, provenance and review guidance. `required_phrases`
and `forbidden_phrases` are lists of literal phrases, never regular expressions:
they run against model output at report time, and no cheaply validated regex
subset bounds matching work. A rule is `{"id": ..., "any": ["phrase", ...]}` and
hits when any phrase occurs in the text, ignoring case and whitespace runs, at a
word boundary wherever the phrase starts or ends with a word character ("led by"
does not match "handled by"). List every acceptable wording under `any`. Their wording is
original and MIT-licensed; there are no private drafts. Both splits cover all
six skill profiles. There are 36 development cases and 12 held-out cases. Cases
are grouped under twelve fictional authors and twenty-four fictional documents,
several cases to each, and no author or document appears in both splits, so the
leakage check tests something real. Held-out sources reuse no Tier 1 word,
template phrase, or numeric figure from a development source. Short fixtures diagnose specific
mistakes; they do not represent the distribution of real production writing.

Every case is a rewrite-mode task, and `protocol.json` freezes that restriction
in `modes`. Detect and edit modes are out of scope. Edit mode is excluded for a
reason worth stating: `SKILL.md` defines it as editing a named prose file in
place with the Edit tool and returning a short report rather than the text, and
no condition here has a filesystem. Asking for the edited text back instead
would contradict the mode under test, and the fixed simple prompt carries no
edit contract at all, so the three conditions would return different kinds of
artifact and `final_text` could not make them comparable. Adding edit mode later
needs an identical file-editing tool environment in all three conditions and a
rule for which post-edit artifact is scored; the harness rejects an edit-mode
case until then. All conditions use the same portable, no-tools environment. The
exact skill entry and reference contents are included in the system prompt. This
does not evaluate resource-loading efficiency.

Rewrite mode still gives the skill conditions a four-section reporting format
while the simple condition may return only prose. A common user instruction
therefore requires every condition to place exactly one final artifact between
the `<<<FINAL_REWRITE>>>` and `<<<END_FINAL_REWRITE>>>` boundary lines. If the
skill's second pass changes section 2, only the corrected version in section 4
goes between the boundaries. Result validation derives the complete payload
from those markers; a reviewer cannot select a more favorable substring. This
makes the prose sent to mechanical and human review the same kind of artifact
without removing the skill's reporting behavior from the condition being tested.

### Freeze a comparison

Run local checks:

```bash
npm run eval:rewrite:validate
node scripts/rewrite-eval.test.js
```

Both need a git checkout: the harness pins and later re-reads the skill files
from the baseline and candidate commits with `git show`, so a ZIP download or a
`git archive` export cannot prepare or verify a plan. The expected case count,
group size and split sizes live in `protocol.json`, not in the code, so they are
covered by the protocol hash.

Create a configuration outside the tracked repository. For example:

```json
{
  "baseline": "d57265d81b7a8d56827bf23f5deef557fc988462",
  "candidate": "FULL_CANDIDATE_COMMIT_SHA",
  "corpus": "FULL_CORPUS_COMMIT_SHA",
  "split": "development",
  "models": [{
    "id": "editor-a",
    "provider": "PROVIDER",
    "version": "EXACT_VERSIONED_MODEL_ID",
    "family": "MODEL_FAMILY",
    "settings": {"temperature": 0, "max_output_tokens": 4096},
    "tools": []
  }]
}
```

Replace the example commit and model placeholders with real identifiers. Resolve
the desired baseline with `git rev-parse <ref>`; fetch it if absent from a shallow
checkout. `corpus` names the commit whose `evals/rewrite/cases.json` and
`protocol.json` the plan uses; it defaults to `HEAD` for development runs and must
be a full SHA for a held-out run. The case set is read from that commit, not from
the working tree, so commit case edits before preparing. Include every effective setting, including any reasoning budget and
seed supported by the provider. If a provider only exposes a moving alias,
record that limitation and do not present the run as version-reproducible.
Use the same model and settings across baseline, candidate and simple conditions.

```bash
node scripts/rewrite-eval.js prepare /tmp/config.json /tmp/plan.json
```

The plan pins full skill commits, file contents/hashes, case and protocol hashes,
exact prompts and final-text boundaries, provider/model settings, no-tool policy, task IDs and three
repetitions per case/condition/model. Preparation resolves refs before freezing.
An existing output file is never overwritten. Every later stage re-reads the
cases and protocol from the pinned corpus commit, re-derives the prompts and task
list from them, the models and the pinned skill sources, and re-reads every pinned
file from git, so a plan edited and re-hashed by hand is rejected rather than
trusted. If baseline and candidate resolve to the same
commit, `prepare` warns that the plan compares the skill against itself. Commit the case set, protocol and
candidate before comparisons; archive the plan hash with the experiment record.
Changing any metric or prompt requires a new preregistration, not rewriting the
old plan after seeing outputs.

### Execute explicitly and retain evidence

Model calls are a separate, explicit operator step. Inspect the plan, choose
providers and approve their cost before running it with your preferred client.
This repository supplies no implicit paid runner. For every task, send
`plan.prompts[task.condition]` as the system prompt and `task.user` as the user
prompt using that task's model settings. Start a fresh conversation for each
request. Do not expose case expectations or judge instructions to the editor.

Save a JSON array of result records outside the tracked repository:

```json
[{
  "task_id": "CASE/MODEL/REPETITION/CONDITION",
  "plan_hash": "FROM_PLAN",
  "prompt_hash": "FROM_TASK",
  "provider": "FROM_MODEL_CONFIG",
  "model_version": "FROM_MODEL_CONFIG",
  "raw_output": "<<<FINAL_REWRITE>>>\nRewritten prose.\n<<<END_FINAL_REWRITE>>>",
  "final_text": "Rewritten prose.",
  "final_text_offset": 20,
  "recorded_at": "2026-09-12T12:00:00Z",
  "duration_ms": 1000,
  "usage": {"kind": "actual", "input_tokens": 100, "output_tokens": 50}
}]
```

Keep the complete provider response/usage receipt alongside these records. Each
task tells the model to use the protocol's exact boundary pair once. Record the
complete unmodified response in `raw_output`, the entire text between the
boundary lines in `final_text`, and its zero-based start in
`final_text_offset`. Validation rejects a missing, repeated or malformed boundary
and rejects any narrower selection from inside the marked artifact. Do not
repair the rewrite. Preserve uncertainty/source-gap notes in the raw output for
the audit record. If a condition refuses or cannot rewrite, its complete refusal belongs
between the boundaries and is adjudicated as returned, not converted into an
empty result.
Label token estimates with `kind: "estimate"`; use `kind: "unavailable"` rather
than fabricating counts. Record latency with a monotonic timer around the call. `recorded_at` must not
predate the plan's `created_at`; a result dated before the freeze is rejected.
A failed or missing call leaves the comparison incomplete; log the error and
rerun that task explicitly. Do not silently choose the best of several outputs.

### Blind human review

```bash
node scripts/rewrite-eval.js blind /tmp/plan.json /tmp/results.json /tmp/review.json /tmp/private-key.json
```

The packet randomizes output order and assigns opaque aliases. Give the packet
to a human reviewer; keep the condition mapping private until adjudication. The
key is checked at report time as a one-to-one map between aliases and results:
an extra or duplicated alias is rejected, and adjudication is counted per task,
so a task judged twice through two aliases cannot stand in for one never judged.
Reviewers may see the source and expected constraints but not condition labels.
The packet contains the validated `final_text`, not the differently formatted
`raw_output`, so the skill's four-section report cannot disclose its condition or
prime the judgment. Keep raw responses with the experiment record for a separate
audit after judgments are frozen. The prose itself may still make a condition
inferable: this is label blinding, not a guarantee that reviewers cannot infer
the prompt. The editor model must not judge its own outputs. An optional
independent model judge may assist, but its unadjudicated verdicts do not count
as human review.

For each alias, record a human verdict and rationale:

```json
[{
  "alias": "FROM_REVIEW_PACKET",
  "reviewer_role": "human",
  "reviewer": "Reviewer identifier",
  "preservation_failure": false,
  "unnecessary_edit": false,
  "missed_justified_edit": true,
  "blind_preference": "not_rated",
  "rationale": "The source needed a stated edit, but the output is unchanged."
}]
```

A preservation failure changes/drops a material proposition, certainty, negation,
unit or protected content, or invents a claim. An unnecessary edit harms or changes
already-good wording without a justified benefit, including loss of authentic
voice. A missed justified edit leaves a case's stated problem unresolved. These
flags are independent; one output may fail more than one dimension. Optional
edits listed in a preserve case are not automatically errors. Inspect source and
output meaning rather than counting changed words.

For preference, compare the three alternatives with the same case, model and
repetition. Mark the preferred output `preferred`, tied best outputs `tie`, the
others `not_preferred`; leave all three `not_rated` if preference was not assessed.
Preference concerns usefulness and readability; it cannot erase factual errors.
A ballot is checked at any size: more than one `preferred`, `preferred` alongside
`tie`, or `not_rated` mixed with rated votes is rejected before the ballot is full,
and a full ballot must be one of the three shapes above.
Disputed/subjective judgments require human adjudication with the reason recorded.
Keep original reviewer notes alongside the final adjudicated record.

```bash
node scripts/rewrite-eval.js report /tmp/plan.json /tmp/results.json /tmp/private-key.json /tmp/judgments.json /tmp/report.json
```

The report separates all three failure counts and preference counts by editor
family, model and profile. It also reports completeness and mechanical literal
checks. Missing judgments are not passes: `complete` is true only when every
task has a result and a human judgment. Unchanged text can incur missed-edit
failures. Mechanical checks can flag missing protected text and the demo's known
regressions, but do not establish semantic fidelity or quality. No detector score
is used, and no automatic rollout approval is produced.

### Release comparison and limits

`protocol.json` freezes the policy before comparative runs. Use at least two
editor model families for a release comparison and report each separately. A
single available family is diagnostic only. Require complete human review and
three repetitions for every case/condition. The candidate must have no higher
counts of preservation failures, unnecessary edits or missed edits than either
baseline or simple within each family/profile. It must reduce missed edits in
at least one profile in each family. Reader preference is reported separately.
Ties, regressions and incomplete evidence do not justify default rollout.

Freeze the candidate's full SHA before preparing the held-out split. Never tune
against held-out outputs. Public synthetic fixtures are not secret; if these
cases informed candidate changes, obtain a fresh independently authored holdout
before release. This small pilot is diagnostic, not statistical proof of general
improvement. Report counts, sample sizes, disagreements and limitations.

No comparative model run or human adjudication has been performed by adding this
harness. Issue #201 remains open for those experiment results and release review.
