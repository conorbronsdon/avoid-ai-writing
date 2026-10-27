# Draft pattern export contract for #94

Status: proposal for maintainer and contributor review. This adds a sample data
export and JS validation fixture, not a Vale style or a supported export API.

The [October 18 contributor comment](https://github.com/conorbronsdon/avoid-ai-writing/issues/94#issuecomment-6244779071)
reports an existing prototype and asks for frozen pattern tables. That first
claim stays with the contributor. This proposal does not reproduce the port,
validate its measurements, or assign its files to another author.
The thread was checked on 2026-10-27: the contributor's October 18 comment is
its only comment, and its question about exporting the pattern tables as a frozen
object has no maintainer answer yet. No coordination message has been sent.

## Source and reproduction

The source pin is commit `61a539f914495c4d12118b4ea8a3706535f0fb05`, the head of
`origin/main` when checked on 2026-10-27. The executable source is
[`detector/patterns.js`](../detector/patterns.js); the coverage map is
[`detector/CATEGORIES.md`](../detector/CATEGORIES.md), and the prose catalog is
[`references/patterns.md`](../references/patterns.md). Use those instead of the
historical category and registry counts in the issue.

From a checkout containing this proposal and the pinned detector:

```sh
node scripts/vale-export-sample.js
node scripts/run-tests.js scripts/vale-export-sample.test.js
npm test
```

The first command prints the exact UTF-8 JSON in
[`sample.json`](../scripts/fixtures/vale-export-94/sample.json), with two-space
indentation and a final LF. Redirect with a UTF-8 writer when using Windows
PowerShell, whose native output redirection may choose another encoding.
The generator normalizes CRLF to LF before hashing and rejects any other source
change. The full-file SHA-256 is in the sample; no timestamp, absolute path,
locale sort, network lookup, or installed Vale version enters the output.
An unrelated detector edit intentionally requires a reviewed pin refresh.

The script reads only `AI_UTM_SOURCE` from the hash-verified source. Its internal
`buildSample` helper returns recursively frozen plain objects, arrays, and
strings. No mutable `RegExp` objects or their `lastIndex` state are exported.
JSON itself has no freeze semantics; consumers must freeze their parsed copy
if they require runtime immutability. The detector's existing exports and
packaged files stay unchanged.

## Proposed contract, subject to maintainer approval

| Field | Draft meaning |
|---|---|
| `schemaVersion` | Independent contract version, currently `0.1.0-draft`; reject unknown versions. |
| `source.commit`, `source.path`, `source.sha256LF` | Source provenance, with SHA-256 over UTF-8 after CRLF-to-LF normalization. |
| `scope` | `sample-only`; absence from this sample makes no coverage promise. |
| `rules[].type` | Existing detector issue `type`, preserved exactly, never derived from a label. |
| `rules[].semantics` | `raw-js-regex-only`; no promise of detector or Vale parity. |
| `rules[].valeStatus` | `unverified` until a pinned Vale implementation passes compatibility tests. |
| `patterns[].source`, `patterns[].flags` | ECMAScript `RegExp.source` and `RegExp.flags`, stored separately as strings. |

Preserve source table order in this draft. Pattern array positions are not IDs.
If consumers need per-pattern IDs, agree on explicit persistent IDs before
expanding the export; do not manufacture them from offsets or regex hashes.
Existing editorial `ec-` IDs name decision cards, not interchangeable detector
rules. Keep their mappings separate.

For an approved stable contract, propose major versions for removed fields,
changed field meanings, renamed/removed IDs or incompatible types; minor for
additive optional fields/rules; patch for metadata corrections without matching
changes. Any regex, gating or preprocessing change also needs a new source pin
and compatibility review, even if the schema version stays fixed. Consumers
should lock both schema and source revision, and fail on unknown semantics.
The draft has no compatibility guarantee before agreement.

## Coverage boundary

The sample exports only `ai-utm-source`: both current `AI_UTM_SOURCE` patterns.
It is supported as raw JS data, with Vale status unverified. Nothing else is
exported. The current map separates direct mappings, detector-only signals and
skill-only judgment; those groups do not mean equivalent Vale coverage.

| Source group | Proposed treatment beyond the sample |
|---|---|
| Direct phrase arrays, such as `transition`, `chatbot`, `ai-citation-markup`, `template-phrase` | Candidates for later data export; each needs positive/negative fixtures and engine review. No parity claim now. Preserve partial coverage and exclusions in the category map. |
| `tier1`, `tier1-clarity` | Candidate vocabulary/substitution data only after defining tokenization, multiword entries, noun exceptions, context exemptions and suggestion meaning. No automatic safe replacement promise. |
| `tier2`, `tier3`, `tier3-phrase`, `tier3-phrase-cluster` | Unsupported by the raw-regex contract: clustering, density or compound detection needs its own semantics. Do not relabel ungated approximations as equivalent rules. |
| `em-dash`, `formatting`, `hashtag-stuff`, `bullet-np-list`, `title-case-header`, `negative-parallelism`, `smart-punct-signature` | Unsupported by this contract: structural filters, counts, proximity, context or co-occurrence matter. A separate adapter specification would be needed. |
| `uniformity`, `low-ttr`, `punct-distribution`, `fnword-trigram-entropy`, `cross-para-burstiness` | Unsupported stylometry/document statistics. |
| `normalization-flag` | Unsupported preprocessing signal, not a phrase table. |
| `unnecessary-hyphenation`, `performed-insight` | Unexported; custom protected-text filtering or multiple contributing pattern families need a separate mapping. |
| All other detector types | Unexported and unassessed for Vale; being regex-based is insufficient evidence of compatibility. |
| All skill-only entries in category-map section C | Unsupported: includes LLM judgment, register, meaning, preservation decisions and writer-side tests. No substitute regex is proposed. |

For example, current Tier 2 requires at least two distinct listed words in a
paragraph. Tier 3 counts each canonical word against
`max(3, floor(wordCount * 0.03))`. Full context-profile tolerance remains skill
judgment; the detector's `technical` mode supplies only documented exceptions.
Exporting a vocabulary list would discard those behaviors.

A future full manifest should list every current detector type with one of
`verified`, `approximation`, `unsupported`, or `unassessed`, plus a reason and
fixture reference. Compute any counts from that manifest and check membership
against `TYPE_LABELS`; keep skill-only exclusions linked to the catalog. This
sample deliberately cannot substantiate a full-port count.

## Semantics and compatibility fixture

[`cases.json`](../scripts/fixtures/vale-export-94/cases.json) pairs expected raw
JS matches and real `analyzeText` findings for the exported type. Tests use
`plain` source mode and `general` context. Positive and negative cases cover
both branches, case-insensitive matching, query delimiters and word boundaries.
The `prefix-residue` case records the existing prefix match before a hyphen;
this proposal does not tighten it or treat a match as proof of authorship.

Three cases make the boundary visible: a short URL matches the regex but the
detector declines the document; a double-quoted URL matches the regex but is
masked by the detector; an inserted zero-width character prevents a raw match
but normalization restores a detector finding. The fixture asserts only this
type's presence, not score, classification, severity parity or exact offsets.
The detector also handles ignore regions, blockquotes, unsupported scripts,
source modes, length limits and deduplication outside these tables. Those
behaviors are not encoded in this sample.

ECMAScript regex syntax/flags are source data, not Vale YAML. A future adapter
must record its Vale version, rule scope and tokenizer, then verify case
folding, word boundaries, Unicode, lookarounds, anchors, multiline matching,
capture handling and spans. JS `g` means repeated matching with mutable regex
state; it is not a portable Vale flag. Rule types such as existence and
substitution are possible mappings to evaluate, not established equivalences.
This offline work neither inspected current Vale documentation nor ran Vale.

Before a Vale release, run the same cases through the contributor's adapter on
a pinned Vale binary. Add format-specific fixtures for prose, code, URLs,
quotes and Markdown masking, and record intentional differences. Measure that
artifact on a pinned corpus with its own inclusion/exclusion policy. Neither
JS corpus results nor the prototype's reported parity and false-positive rate
establish a rate for a future port.

## Decisions and contributor handoff

Maintainers still need to decide the export surface, coverage policy and release
ownership with the existing contributor. Options have different migration costs:

| Option | Cost and unresolved ownership |
|---|---|
| Versioned JSON in this repository's release assets | Adapter pins an asset and hash; maintainers add generation, validation and asset release steps. Keeps JS runtime independent. |
| Frozen CommonJS export in the existing npm package | Adapter can consume installed data; maintainers add a supported API and package file entry, recursive freezing and browser compatibility checks. Couples data delivery to npm releases. |
| Data directory here, Vale release zip in a separate contributor-maintained repository | Adapter changes its current scraper to a versioned reader and owns Vale conversion/release tests. Requires agreement on attribution, update cadence and support responsibilities. |

These options can be combined after agreement. No package name, registry
location, API entry point or publishing workflow is adopted here. The current
`package.json` file allowlist does not include this sample.

Suggested handoff: share this draft and fixture on #94 after rechecking the
latest thread; ask whether a pinned JSON contract would replace the
prototype's private-table extraction, which semantics it approximates, and
whether it needs persistent per-pattern IDs. Let the contributor keep the
adapter implementation and first claim. After maintainer decisions, agree on
a bounded follow-up for the actual export API and paired JS/Vale tests. No
GitHub comment, registry release or upstream submission is part of this change.
