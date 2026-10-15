# Editorial decision-card development pilot (#206)

**Decision: keep this change draft.** The code and packaging checks pass, but
these writing runs do not satisfy a cross-family acceptance gate. No general
editing-quality or authorship claim follows from this report.

A later [repair follow-up](followup/README.md) retains 32 additional responses
on twelve independently authored inputs and four known repair cases, after
integrating v3.38.0 and #406. It tightens judgment preservation and gap reporting.
That single-family development run still does not satisfy the cross-family gate;
the initial and revised runs below remain unchanged historical records.

The pilot adds thirteen readable decision cards to existing catalog entries.
They carry stable editorial IDs, partial detector mappings, applicability
conditions and edit/keep/gap examples. The mandatory reference, full audit and
portable artifacts retain the whole catalog. No detector API, category count,
loading default, or language scope changes. Cards are hand-authored Markdown;
the consistency test is not an editing engine or a full-catalog migration.

## Frozen sources and execution

- [Initial method](method-frozen.json), [development fixtures](../../editorial-cards-206.json), and [revision method](revision-method-frozen.json) were committed before their respective writing runs.
- [Exact source snapshots](source-snapshots.json) retain the shared entrypoint and the baseline, initial-candidate and revised-candidate references, with SHA-256 hashes. Local source commit IDs identify the development checkout; the saved text and hashes make the evaluated sources available without relying on those local commit objects.
- Baseline: `3a609fe05da9dcf2709ca7207a68860173b6449e`. The initial and revised source checkouts were `60e776c` and `e7f8697`. The final branch subsequently incorporates merged #403's title fix; those writing outputs are not relabeled as final-tree evaluation.
- Thirty-two independent requests per writing batch: an edit and keep pair per card, plus six existing development cases. The latter retain their original input text; no frozen historical cases or held-out inputs were rewritten.
- Three fresh writing agents ran the baseline, initial candidate, and revised candidate. Two other fresh agents reviewed shuffled A/B alternatives without source instructions, condition labels, keys, expected answers or the other review. All inherited the same session default model; the surface exposes no exact model ID, and no second editor family was available.
- Source-task tools were unavailable by design. Complete responses explicitly report model-only checks. Saving response artifacts is separate from executing a source rewrite in a real file editor.

## Results and retained failures

Every batch returned all 32 tasks, and all 16 designated keep inputs remained
byte-for-byte unchanged. Exact preservation of those short inputs does not
establish semantic fidelity on edited cases.

Raw counts below come from the independent model reviews. Flags can overlap;
they are not a quality score or a statistically meaningful comparison.

| Review | Condition | Preservation | Unnecessary edit | Missed edit | Reporting |
|---|---|---:|---:|---:|---:|
| initial | baseline | 1 | 0 | 1 | 1 |
| initial | candidate | 3 | 2 | 0 | 2 |
| revised | baseline | 2 | 1 | 2 | 3 |
| revised | revised | 1 | 1 | 2 | 2 |

The first candidate deleted a trust proposition and a positive assessment.
Both baseline and first candidate also discarded the claimed breadth of
preparation in an all-but-one reversal. The revised cards retain both
propositions, both sides of an assessment, and coverage quantifiers. The
revised output preserves those three claims in the exercised cases.

A preservation risk remains: both baseline and revised output remove a
subjective “most interesting” ranking, and the second reviewer treats that as
lost stance. The first reviewer treated the same source as ambiguous. The
revised concession also retains a vague challenges claim without reporting
its missing scope. Other reviewer differences concern attribution redundancy
and a source comma splice. Retain the raw flags and reasons; do not choose the
more favorable reviewer as ground truth.

- Initial: [baseline responses](initial-baseline-responses.json), [candidate responses](initial-candidate-responses.json), [review](initial-blind-review.json), [condition key](initial-blind-key.json).
- Revision: [responses](revised-responses.json), [review](revised-blind-review.json), [condition key](revised-blind-key.json).
- [Machine-readable summary](summary.json) records completeness, exact keep results, raw review counts, validation and limitations.

These are development examples, many copied or adapted from the cards. The
rerun is a repair check on known tasks, not a fresh holdout or evidence that
the cards generalize. One inherited family, one repetition and model-only
adjudication do not meet the two-family automated gate. Reviewer variation on
the identical baseline further limits aggregate comparisons.

## Validation and next steps

All 23 npm suites pass on the combined branch, including card ID/mapping,
paired-task, lossless-portability and mutation controls. Pattern and word
counts agree. Self-scan passes without raising budgets. Plugin and connection
validation pass; two plugin builds are identical, and clean extraction passes
validation and canonical-command smoke tests. The archive validator emits its
expected missing-root-SKILL warning because the root development file is not
part of the packaged archive.

Before acceptance:

1. Resolve preservation of subjective ranking and honest reporting of vague
   residual claims, with contrasting cases and independently authored inputs.
2. Run at least two editor families against the final combined source, retain
   full receipts and failures, and adjudicate source fidelity and authorized
   edits. Do not equate a lower detector score or a matching example sentence
   with a successful edit.
3. Keep #322's historical 14/16 result and original failures separate. These
   new development probes do not supersede that two-family report.
4. Only after the pilot settles, package the full-catalog mapping follow-up
   described in #206/#247 as a separately claimable task. The current format
   catches stale pilot type references but does not establish reduced duplicate
   maintenance or justify generating the entire catalog from metadata.
5. Evaluate selective loading in #205 separately. Adding cards increases the
   already mandatory reference; this pilot makes no token-efficiency claim.
