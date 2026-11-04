# Vale package

This directory holds a [Vale](https://vale.sh) style, `AvoidAIWriting`, generated from
`detector/patterns.js`. It answers #94. The style's own `README.md` (inside
`AvoidAIWriting/`) is the user-facing file and ships in the package. This file is
for maintainers.

## How it fits

```
detector/patterns.js        exports PATTERN_TABLES (frozen plain data, keyed by issue type)
scripts/build-vale.js       reads PATTERN_TABLES, writes vale/AvoidAIWriting/ and its manifest.json
scripts/build-vale.test.js  fails `npm test` when the committed style is stale
scripts/vale-cases.test.js  runs vale/fixtures/cases.json through pinned Vale and the detector
scripts/vale-measure.js     parity and rates against corpus/cache
scripts/package-vale.py     builds a deterministic AvoidAIWriting.zip for a release
vale/.vale.ini              local test configuration
vale/fixtures/              cases.json, plus one file that should fire and one that should not
```

The rules are not written by hand. `npm run vale:build` regenerates them, and the
test suite compares the committed files to the generator output, so a change to
`patterns.js` that is not followed by a rebuild turns `npm test` red. This is the
same anti-drift contract `detector/CATEGORIES.md` uses between the skill prose and
the engine.

## Decisions, against the questions in #94

**The export.** `PATTERN_TABLES` holds each table-backed issue type under its
existing `type`, with regexes as `{ source, flags }` strings and a `schemaVersion`.
It is recursively frozen and built from the live tables, which it does not touch, so
`analyzeText` and the other exports are unchanged. Where the engine applies logic on
top of a table (clusters, density, proximity, masking, the `features` noun check), the
entry carries a `gate` note; function fields are not data and are left out.

**Rule coverage.** `manifest.json` gives every detector type one status. `verified`:
the engine reports every match of the type's table with no further gating, and the rule
carries the table unchanged. `approximation`: ported, but the engine gates or filters
the type in a way Vale cannot (Tier 1 tokenization, Tier 2 clusters, Tier 3 density,
negative-parallelism proximity, hyphenation masking, the `features` check,
one alert instead of one per phrase for confidence stacking).
`unsupported`: not ported, with the reason. `unassessed` is available for new types.
The test fails if a type is missing, if a gated type is marked `verified`, or if a
ported type has no rule.

**The count claim.** The README inside the package reports the status counts from
`manifest.json` and the pattern and file counts the generator computed, and lists
what is left out. There is no claim about the catalog as a whole.

**Source pin.** `manifest.json` records the SHA-256 of the exported pattern data. It
changes only when that data does (a pattern, a replacement, a gate note), so an edit elsewhere in `patterns.js` does not
require a rebuild. A file cannot name the commit it is part of, so the release workflow can
add it to the zip.

**Where it lives.** Here, generated, not in a separate repository. A separate
repository would have to copy the regexes, and the copy would drift. The release
cost is one more asset on an existing GitHub release. Until that asset is published,
copy `vale/AvoidAIWriting/` into your project's Vale styles directory. The proposed
release commands are:

```bash
python3 scripts/package-vale.py . "$RUNNER_TEMP/AvoidAIWriting.zip"
gh release upload "v$VERSION" "$RUNNER_TEMP/AvoidAIWriting.zip"
```

The zip holds `AvoidAIWriting/` at its root, with fixed timestamps and sorted entries,
so two builds of one commit are byte-identical. After a release asset is published,
`vale sync` can install it from a `Packages =` line. The release step and the library
entry at `vale-cli/packages` are not in this change.

**False-positive measurement.** `npm run vale:measure` runs Vale over the same
`corpus/cache` the JS detector is measured on and reports two things. Parity: for each
ported `existence` rule, the number of Vale alerts equals the number of matches the
detector's regex produces on the same text. Rates: alerts per 1,000 words and share of
documents with at least one alert, by rule and by level, split by class. Human
documents are false positives by construction; machine rows are true positives.

## Measurement

Measured by the contributor, pending reproduction. Everything needed to re-run it:

```bash
node scripts/corpus.js fetch     # downloads the public sources into corpus/cache
node scripts/corpus.js verify    # every file must match its hash in corpus/manifest.json
VALE_BIN=/path/to/vale node scripts/vale-measure.js          # Vale 3.26.0
VALE_BIN=/path/to/vale node scripts/vale-measure.js --docs   # parity on this repo's docs
```

The run on 2026-11-02 printed:

```
corpus/manifest.json sha256 77e1fc016239f9d92e352db0f02b5fe46acbbc207ee254a454cb5de6992bef00 (40 documents)
vale version 3.26.0; pattern data sha256 f9a7a964c0879bb17e8cf2833050e43e9f54f8e397168b62c2be6e07b870fa26
```

What is counted: every document in `corpus/manifest.json`, with nothing excluded. A
document from a non-dataset source counts as human. The two dataset sources (the HC3
and RAID slices) contribute one document per row, labelled human or machine by the
dataset. That gives 378 human documents (149,325 words: the public-domain works, the
maintainer's archived posts, two RFCs, two W3C mailing-list threads, and the HC3 and
RAID human rows) and 530 machine rows (114,565 words). Each document is linted as a
plain-text `.txt` file with every level enabled. The script stops if any file is
missing or its hash has changed, so a number always covers the whole recorded corpus.

Parity is counted on spans, not on pattern hits. Vale compiles a rule's tokens into one
alternation and reports a region once, so when two patterns of the same type overlap
("marking a pivotal moment" and "a pivotal moment in") the detector lists two issues
and Vale one alert. The measurement merges overlapping spans before comparing. On
that definition, comparing each Vale rule to the raw regexes (not to the detector's
findings, which also apply masking): 35 of 35 existence rules match on the corpus (177
spans, 177 alerts) and 35 of 35 on the repository's own documents with `--docs` (524
spans, 524 alerts). The second run matters because the corpus has few tells; the
catalog quotes most of them.

| Level | Human documents with an alert | Machine rows with an alert |
|---|---:|---:|
| error | 0.3% (1 of 378) | 1.1% (6 of 530) |
| warning | 8.7% (33) | 8.5% (45) |
| suggestion | 17.7% (67) | 26.2% (139) |

The one human error is `VagueAttribution` on "Research shows" in an archived blog
post. Per rule, the highest human rates are `Tier2Vocabulary` (0.29 alerts per 1,000
words, 6.3% of documents), `Tier1Clarity` (0.25, 6.3%), `Transitions` (0.22, 6.1%),
and `Tier1Vocabulary` (0.18, 5.0%). The full table is the script's output.

Two things to read into those numbers. The machine rows are 2023-era HC3 answers and
RAID generations down to GPT-2, so the true-positive rates say little about current
models. And a Vale alert is one match, while the detector scores a document; the
figures are not comparable to the detector's FPR table, which is why they are
reported separately and the package README says so.

## Known differences from the detector

Listed in the package README as well. Overlapping patterns of one type give one alert.
The detector masks blockquotes, double-quoted spans, and ignore-marker regions before
matching; Vale skips code and front matter by format but lints quoted prose, and the
detector reads code. `vale/fixtures/cases.json` records each difference as a case. The
detector reports each distinct (type, text) pair once; Vale reports every occurrence.
Context modes and the homoglyph pre-pass have no counterpart. The Tier 3 `occurrence`
rules use `scope: summary`, which counts across the file's prose; the default `text`
scope counts per block and would never fire across paragraphs.

## Testing locally

```bash
npm run vale:build
VALE_BIN=/path/to/vale node scripts/vale-cases.test.js # Vale 3.26.0; npm test runs it too
vale --config vale/.vale.ini vale/fixtures/tells.md    # should report alerts
vale --config vale/.vale.ini vale/fixtures/clean.md    # should report none
VALE_BIN=/path/to/vale npm run vale:measure            # needs corpus/cache, see Measurement
python3 scripts/package-vale.py . /tmp/AvoidAIWriting.zip
```
