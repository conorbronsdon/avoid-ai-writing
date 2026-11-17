# Recall cost of the rhetorical-tic carve-outs (#140)

This audit measures what each precision carve-out in the `negation-chain`,
`performed-insight`, and `dev-blog-boilerplate` rules costs in recall. It
loosens one boundary at a time and labels every extra hit. It uses only the
deterministic detector: no model calls, no network, no fetched corpus. It
changes no carve-out.

- Base revision: `aecf2680a56b9b19835a3e362af4ebdd2e8e92f1` (v3.39.0)
- `detector/patterns.js` sha256: `bc876f020502dd8aaae17486c849ec4c384bd884fa9b21c5029c6970994799f3`
- Reproduce: `node scripts/carve-out-recall.js` (table) or `--json` (every
  candidate with its label). The script exits 1 if a candidate has no label
  or a variant can no longer be derived from the current pattern source.

## Method

1. **Candidates.** Loose finders scan every tracked `.md`, `.json`, and `.js`
   file, excluding generated copies (`SKILL.full.md`, `dist/`, `plugins/`,
   `skills/`, `cursor-rules/`, and the generated `vale/AvoidAIWriting/`
   rules; `vale/fixtures/cases.json` is scanned). JSON is read as string values,
   `detector/patterns.test.js` as string literals, and other files as
   paragraphs. Identical lines are counted once, so prompt copies of
   `references/patterns.md` do not inflate the counts. The scan finds 73
   distinct candidates.
2. **Labels** (`labels.json`, by hand). `tic` is an authored use of the
   targeted form; `literal` is an ordinary use; `mention` is the phrase
   quoted, named, or asserted as an example; `ambiguous` needs reading.
   Fixture literals follow the test's stated intent (must-fire → `tic`,
   must-not-fire → `literal`).
3. **Strata.** `fixture` (28, all unquoted): synthetic strings from the
   detector tests and the Vale parity fixtures. `machine-output` (7): recorded
   model responses under `evals/rewrite/reports`.
   `repo-prose` (38, 32 of them quoted): docs, changelog, prompts, and comments.
   Quoted candidates (double or curly quotes, inline code, blockquote lines)
   are measured only under quote masking, and only where an active baseline
   rule would hit them unmasked. The rest are measured per boundary.
4. **Variants.** Each variant is derived from the detector's exported
   `PATTERN_TABLES` by changing one boundary. Omitted forms get a plain
   phrase regex. "Added by loosening" counts candidates the variant hits and
   the baseline does not. The baseline regex agreed with `analyzeText()` on
   every unit the engine scored. Units under the engine's 10-word minimum are
   shown in parentheses.

## Results

| Carve-out | Unquoted candidates | Baseline hits | Added by loosening | Tic (TP suppressed) | Literal (FP prevented) | Mention (FP prevented) | Ambiguous | Engine disagrees (unscored) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `no-chain-three-items` | 19 | 5 | 2 | 0 | 2 | 0 | 0 | 0 (2) |
| `no-chain-lowercase-after-colon-dash` | 19 | 5 | 1 | 0 | 0 | 0 | 1 | 0 (2) |
| `no-chain-sentence-initial` | 19 | 5 | 7 | 0 | 5 | 0 | 2 | 0 (2) |
| `no-chain-idiom-stop-list` | 19 | 5 | 1 | 0 | 1 | 0 | 0 | 0 (2) |
| `did-not-restated-subject` | 4 | 1 | 1 | 0 | 1 | 0 | 0 | 0 (0) |
| `the-punchline-omitted` | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 (0) |
| `worth-naming-omitted` | 2 | 0 | 2 | 0 | 2 | 0 | 0 | 0 (0) |
| `batteries-included-omitted` | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 (0) |
| `just-works-out-idiom` | 6 | 5 | 1 | 0 | 1 | 0 | 0 | 0 (3) |
| `just-works-unicode-hyphen` | 6 | 5 | 0 | 0 | 0 | 0 | 0 | 0 (3) |
| `turns-out-sentence-initial` | 8 | 4 | 4 | 0 | 0 | 4 | 0 | 0 (1) |
| `quote-masking` | 32 quoted | — | 4 | 0 | 0 | 4 | 0 | — |

A further 24 quoted candidates match only a loosened variant: an omitted
form such as "the punchline", or a shape the baseline skips. Quote masking is
not what keeps them clean today, so they are not credited to it.

Where the added hits came from:

- `no-chain-sentence-initial`: 3 machine-output audit reports ("no hedging, no
  vague attribution, no filler"), 2 fixture inventories ("takes no arguments,
  no headers, and no body"), and 2 repo-prose lines. Two of the seven are
  ambiguous. The machine-written hits are inventories of checks the model ran,
  so even text a model wrote is not the rhetorical tic here.
- `no-chain-three-items`: both are the must-not-fire "No tickets, no badges
  will be issued" fixture.
- `turns-out-sentence-initial`: test names, assertion strings, and a code
  comment. None is prose.
- `quote-masking`: the 4 hits are quoted examples of active rules (a "No …"
  chain and sentence-initial "Turns out") in comments, the catalog, and the
  eval prompts.

## Recommendations

| Carve-out | Recommendation | Basis |
|---|---|---|
| Three-item minimum for `No …` chains | Keep | 2 FPs prevented, 0 tics suppressed. |
| Lowercase chain after colon or dash | Keep; revisit with a labeled corpus | 1 ambiguous hit, no tic. The lowercase form after a colon is where model audit reports list their checks. |
| Sentence-initial requirement | Keep | 5 literal and 2 ambiguous hits, 0 tics. This is the boundary with the most evidence, and it includes machine-written text. |
| Idiom stop-list | Keep | 1 FP prevented ("No more, no less, no matter what"). |
| `did not` chain: comma-joined, subject elided | Keep | 1 FP prevented (restated-subject narration). |
| `the punchline` stays judgment-only | Keep | 1 literal use, no tic. |
| `worth naming` stays judgment-only | Keep | 2 literal uses (PROOF.md and a fixture), no tic. |
| `batteries included` stays judgment-only | Keep | 1 literal use, no tic. |
| `it just works out` exclusion | Keep | 1 FP prevented ("works out to two queries"). |
| Unicode hyphens in `out‑of‑the‑box` | Candidate for a narrow deterministic branch in its own PR | 0 occurrences of either kind. Confirmed gap: `analyzeText()` reports the slogan with ASCII hyphens but not with U+2010, U+2011, or U+2013. The change only touches separators inside a phrase that already matches, so the FP risk is small. It still needs a must-fire and a must-not-fire fixture. |
| `Turns out` sentence-initial only | Keep | 4 hits, all mentions, no tic. |
| Quote masking | Keep | 4 quoted mentions of active rules kept clean, 0 tics suppressed. It also keeps quoted mentions of the omitted forms clean if those forms are ever added. |
| Span includes a following verb (`No trains, no buses, no ferries run`) | No decision; not measurable here | No baseline hit in the corpus ends in a one-word item followed by a verb. This is span accuracy, not recall. |

## Limitations

- **Genre scope not met.** #140 asks for technical prose, essays, and
  marketing copy with provenance. This corpus has none of the last two, so
  its conclusions apply to technical and repository text only. Meeting that
  requirement needs new sourced samples, not more of this repository.
- **No positive evidence for the omitted forms.** Across 73 candidates, the
  only `tic` labels (11) are must-fire fixtures for forms the detector already
  catches. No machine-output or repo-prose candidate is a tic. "0 TPs
  suppressed" therefore means no measured recall cost on this corpus. It does
  not show that the cost is zero.
- **Circular fixtures.** The fixtures were written while setting these
  boundaries, so the must-not-fire strings are the evidence the carve-outs
  came from. They confirm the FP side; they cannot estimate recall.
- **Small, single-register corpus.** The machine output is seven eval
  responses in one register (rewrite audit reports).
- **Single labeler, no adjudication.** The labels are one reviewer's. The
  three `ambiguous` rows need a second read.
- **Approximate quote detection.** The script mirrors the detector's
  documented quote rules. A quote that opens on an earlier line, as in one
  code comment, reads as unquoted.

The next step is the one #140 names: human and machine samples for each
omitted form, with provenance, across technical prose, essays, and marketing
copy. Rerun this script against them with the boundaries unchanged.
