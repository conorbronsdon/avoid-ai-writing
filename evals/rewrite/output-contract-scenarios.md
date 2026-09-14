# Output contract forward scenarios

These manual scenarios supplement the frozen rewrite comparison in `cases.json`
and `protocol.json`. They exercise presentation, pass accounting, stopping, and
execution-status behavior. They do not change the frozen corpus or its scoring
rules.

For each scenario, save the complete response and record the observed final-text
count, `pass.index`, `pass.max`, stop reason, and tool execution status. Judge the
behavioral outcomes below rather than requiring a canned rewrite.

## 1. First pass needs no correction

**Request:** Rewrite this product update to remove AI-writing patterns.

**Source:** `Moreover, the release marks a pivotal moment for the team. The API now supports batch requests.`

**Tool state:** Marks and preservation tools are available.

**Expected outcomes:** The initial rewrite changes the justified phrases and
preserves the API claim. Review finds no further justified in-scope edit, so
`pass.index` is 1 and `pass.max` is 2. The response contains one complete Final
rewrite, a useful change summary, and verification status for checks that
actually ran. It does not expose the first-pass text anywhere else.

## 2. Corrective pass changes the candidate

**Request:** Rewrite this launch note and iterate twice.

**Source:** `We're thrilled to unveil the dashboard. It serves as a seamless hub for billing, usage, and alerts. In conclusion, the future looks bright.`

**Intermediate state to test:** After pass 1, review finds one justified,
authorized phrase left in the candidate.

**Tool state:** Marks and preservation tools are available.

**Expected outcomes:** The correction consumes pass 2. Only the post-correction
text appears as the complete Final rewrite, and verification describes that
text. The response reports two editing passes and stops even if another
low-confidence suggestion is possible.

## 3. Intentional residual

**Request:** Clean up this technical note without weakening the correction.

**Source:** `The old guide says retries are disabled. They are actually enabled when retryLimit is above zero.`

**Tool state:** Deterministic tools are available.

**Expected outcomes:** `actually` remains because it marks a concrete expectation
gap. The workflow does not spend a pass merely to remove the token. The final
report identifies the intentional residual and does not claim every catalog
match disappeared.

## 4. Protected finding

**Request:** Remove AI-isms from the prose. Keep the attributed customer quote unchanged.

**Source:** `The rollout finished Friday. Mina said, "This seamless platform marks a pivotal moment for our team." Support volume fell from 42 tickets to 31.`

**Tool state:** Deterministic preservation is available.

**Expected outcomes:** The attributed quote, numbers, and attribution remain
unchanged. Any editable prose change fits the requested pass budget. The full
result appears once, and the protected residual is reported without treating it
as a failed cleanup.

## 5. Clean no-op

**Request:** Remove AI-writing patterns from this note.

**Source:** `The migration starts Tuesday. Back up the database before you run it.`

**Tool state:** Deterministic tools are available.

**Expected outcomes:** The source is returned byte-for-byte once under Final
rewrite. There is no Changes section, `pass.index` remains 0, and Verification
says no justified in-scope edit was found. No wording is changed to demonstrate
activity.

## 6. `--iterate 1` blocks a repair

**Request:** Rewrite this with `--iterate 1` and verify the result.

**Source:** `Moreover, the job writes 25 records to /var/tmp/report.json.`

**Intermediate state to test:** The first rewrite changes the protected number or
path, and preservation verification returns `FAIL`.

**Tool state:** The preservation validator executes.

**Expected outcomes:** The first mutation sets `pass.index` to 1 and `pass.max`
to 1. The failure is reported and no repair runs. The response contains only the
current complete text, labels the unresolved verification failure, and does not
call the result verified.

## 7. `--iterate 2` permits one repair

**Request:** Rewrite this with `--iterate 2` and verify the result.

**Source:** `Additionally, the worker waits 250 ms before retrying https://status.example.test/v2.`

**Intermediate state to test:** Pass 1 alters the wait time or URL and the
verifier returns `FAIL`.

**Tool state:** The preservation validator executes before and after repair.

**Expected outcomes:** A focused preservation repair consumes pass 2, followed
by a read-only verification. The response contains only the repaired complete
text, reports two editing passes and both executed checks, and stops after the
second verification. If the focused repair restores the source text exactly,
`pass.index` still remains 2 because both mutation stages ran; final byte
equality does not reset the history.

## 8. Correction exhausts the repair budget

**Request:** Audit, rewrite, iterate twice, and verify this note.

**Source:** `We're excited to announce a robust export. Moreover, it writes 12 files to /srv/exports.`

**Intermediate state to test:** Pass 2 corrects a justified residual but
accidentally changes the number or path; verification then returns `FAIL`.

**Tool state:** The preservation validator executes.

**Expected outcomes:** The workflow reports the failed preservation check and
stops at `pass.index: 2`. It does not take a third editing pass under the name of
repair, and it does not publish an earlier candidate as an alternative.

## 9. Required tool unavailable

**Request:** Rewrite this note, preserve its Markdown, and verify it.

**Source:** `## Release notes\n\nFurthermore, the CLI supports --dry-run.`

**Tool state:** Node and shell execution are unavailable.

**Expected outcomes:** The model applies only the checks it can perform, labels
them model-only, and names the deterministic marks or preservation checks that
did not run. It emits one complete Final rewrite and makes no executed or
mechanically verified claim.

## 10. Detect mode remains read-only

**Request:** Scan this and flag only: `Moreover, this robust platform unlocks efficiency.`

**Tool state:** The detector is unavailable.

**Expected outcomes:** The response contains findings and an assessment, clearly
labels the audit model-only, performs no writing normalization, leaves
`pass.index` at 0, and contains no Final rewrite.

## 11. Edit mode does not duplicate the file

**Request:** Clean `draft.md` in place with `--iterate 2`, then verify it.

**Fixture:** A prose file with one editable AI-writing phrase, a URL, and a
blockquote.

**Tool state:** File mutation and preservation validation are available.

**Expected outcomes:** The tool makes a focused file edit, preserves the URL and
blockquote, and reports changed spans, pass count, mutation evidence, and final
verification. The response does not include a complete copy of `draft.md`.
