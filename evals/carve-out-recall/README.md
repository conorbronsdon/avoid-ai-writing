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
   `skills/`, `cursor-rules/`, `vale/`). JSON is read as string values,
   `detector/patterns.test.js` as string literals, and other files as
   paragraphs. Identical lines are counted once, so prompt copies of
   `references/patterns.md` do not inflate the counts. The scan finds 70
   distinct candidates.
2. **Labels** (`labels.json`, by hand). `tic` is an authored use of the
   targeted form; `literal` is an ordinary use; `mention` is the phrase
   quoted, named, or asserted as an example; `ambiguous` needs reading.
   Fixture literals follow the test's stated intent (must-fire → `tic`,
   must-not-fire → `literal`).
3. **Strata.** `fixture` (26, all unquoted): synthetic test strings.
   `machine-output` (6): recorded model responses under `evals/rewrite/reports`.
   `repo-prose` (38, 32 of them quoted): docs, changelog, prompts, and comments.
   Quoted candidates (double or curly quotes, inline code, blockquote lines)
   are measured only under quote masking. The rest are measured per boundary.
4. **Variants.** Each variant is derived from the detector's exported
   `PATTERN_TABLES` by changing one boundary. Omitted forms get a plain
   phrase regex. "Added by loosening" counts candidates the variant hits and
   the baseline does not. The baseline regex agreed with `analyzeText()` on
   every unit the engine scored. Units under the engine's 10-word minimum are
   shown in parentheses.

## Results

| Carve-out | Unquoted candidates | Baseline hits | Added by loosening | Tic (TP suppressed) | Literal (FP prevented) | Mention (FP prevented) | Ambiguous | Engine disagrees (unscored) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `no-chain-three-items` | 18 | 4 | 2 | 0 | 2 | 0 | 0 | 0 (2) |
| `no-chain-lowercase-after-colon-dash` | 18 | 4 | 1 | 0 | 0 | 0 | 1 | 0 (2) |
| `no-chain-sentence-initial` | 18 | 4 | 7 | 0 | 5 | 0 | 2 | 0 (2) |
| `no-chain-idiom-stop-list` | 18 | 4 | 1 | 0 | 1 | 0 | 0 | 0 (2) |
| `did-not-restated-subject` | 3 | 1 | 1 | 0 | 1 | 0 | 0 | 0 (0) |
| `the-punchline-omitted` | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 (0) |
| `worth-naming-omitted` | 2 | 0 | 2 | 0 | 2 | 0 | 0 | 0 (0) |
| `batteries-included-omitted` | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 (0) |
| `just-works-out-idiom` | 5 | 4 | 1 | 0 | 1 | 0 | 0 | 0 (3) |
| `just-works-unicode-hyphen` | 5 | 4 | 0 | 0 | 0 | 0 | 0 | 0 (3) |
| `turns-out-sentence-initial` | 8 | 4 | 4 | 0 | 0 | 4 | 0 | 0 (1) |
| `quote-masking` | 32 quoted | — | 28 | 0 | 0 | 28 | 0 | — |

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
- `quote-masking`: every hit is a quoted example in the catalog, changelog,
  category map, or eval prompts.

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
| Quote masking | Keep | 28 quoted mentions kept clean, 0 tics suppressed. |
| Span includes a following verb (`No trains, no buses, no ferries run`) | No decision; not measurable here | No baseline hit in the corpus ends in a one-word item followed by a verb. This is span accuracy, not recall. |

## Limitations

- **No positive evidence for the omitted forms.** Across 70 candidates, the
  only `tic` labels (9) are must-fire fixtures for forms the detector already
  catches. No machine-output or repo-prose candidate is a tic. "0 TPs
  suppressed" therefore means no measured recall cost on this corpus. It does
  not show that the cost is zero.
- **Circular fixtures.** The fixtures were written while setting these
  boundaries, so the must-not-fire strings are the evidence the carve-outs
  came from. They confirm the FP side; they cannot estimate recall.
- **Small, single-register corpus.** The machine output is six eval responses
  in one register (rewrite audit reports). There are no essays or marketing
  copy, which #140 asks for.
- **Single labeler, no adjudication.** The labels are one reviewer's. The
  three `ambiguous` rows need a second read.
- **Approximate quote detection.** The script mirrors the detector's
  documented quote rules. A quote that opens on an earlier line, as in one
  code comment, reads as unquoted.

The next step is the one #140 names: human and machine samples for each
omitted form, with provenance, across technical prose, essays, and marketing
copy. Rerun this script against them with the boundaries unchanged.
