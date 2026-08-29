# Human-control corpus

This repo asserts things about false positives. The tiering exists "to reduce
false positives on words that are fine in isolation but suspicious in clusters."
The tolerance matrix relaxes rules per register. `SKILL.md` opens by saying the
patterns are "signals, not proof."

None of that had ever been measured. This corpus is how it gets measured.

## The design

Every document here was written by a person. So every flag the detector raises
on it is a false positive, by construction. There is no labelling step, no
judge, and no model in the loop: the ground truth is provenance.

**The corpus is hash-only.** `manifest.json` records what a document is, where
it came from, its license, its register, and the sha256 of the exact text that
was measured. The text is never committed. Public-domain sources are fetched
into a gitignored `cache/`; anything private stays wherever it already lives and
contributes only its hash. That keeps the measurement auditable without
republishing anyone's writing. Borrowed from `devswha/patina`, which uses the
same pattern for its Korean human controls.

```bash
node scripts/corpus.js list      # what's in the manifest
node scripts/corpus.js fetch     # populate cache/
node scripts/corpus.js verify    # cache still matches recorded hashes
node scripts/fp-measure.js       # the measurement
```

`verify` fails loudly on a hash mismatch rather than re-recording. A source that
changed under us invalidates the measurement it backs, and that should be an
argument, not a silent update.

## Register is the unit of analysis

Not a label of convenience. Patina's Korean human-control pilot measured false
positives from 4.0% on chat updates to 34.0% on technical how-to prose inside a
single language. A single aggregate rate would have been set almost entirely by
the worst register and would have hidden the finding.

This repo's tolerance matrix already asserts that registers differ. The register
buckets are what let that assertion be checked instead of assumed.

## Current contents

Four source groups, chosen for different reasons. The last two are deliberately
small seed entries: they make the missing-register state visible in the manifest
without pretending that one document is enough to support a rate.

**Nine public-domain works, 1788 to 1907**, sliced to 6,000 words each. Their
provenance is beyond argument: nothing written in 1859 was machine-generated.
That is also their limitation, and it is severe. Nobody runs this tool over
*Walden*. On its own, this leg can only show the detector is not firing wildly
on formal English prose.

**Twenty-five blog posts by this repo's maintainer, 2019 to December 2022**,
read from **Project Gutenberg's equivalent for the web**: `web.archive.org`
captures taken before 2023. Written before ChatGPT, in the register the tool is
actually pointed at, by someone whose authorship is not in question. This is the
leg that produced the useful findings.

Reading them from the archive rather than the live site is deliberate. The live
site has been rebuilt and its posts edited since; the median archived capture is
only **0.92 similar** to its currently published counterpart, and five of the
twenty-five fall below 0.90. Measuring "his pre-2023 writing" against pages
edited in 2025 would have measured the wrong thing.

**One documentation source**, [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259),
is included as a first `docs` seed. It is a pre-LLM, human-authored
standards-track document with a named editor and a stable IETF publication
record. It is useful for checking that the fetch-and-hash path handles a
technical document, but one source is nowhere near a register-level sample.

**One conversational source**, a 1995 message from the public
[W3C `www-talk` archive](https://lists.w3.org/Archives/Public/www-talk/1995MayJun/0026.html),
is included as a first `conversational` seed. It is a pre-LLM mailing-list
exchange with preserved author, date, and thread context. The archive's page
chrome is excluded by the HTML extractor; only the message page's main content
is hashed. This seed is still far short of the `n >= 100` units needed for a
claim.

The manifest therefore has non-zero coverage for `docs` and `conversational`,
but both remain under-sampled. `social` and `email` remain at zero: social posts
need an export or an attested author source, and private correspondence must
not enter the corpus. The register gap is still an explicit limitation, not a
number the project can publish.

Resolving them was not a matter of swapping a domain. The old site used
compressed slugs (`beveragetax`, `challengerfunnel`, `emailmarketing`) that do
not match current URLs, so candidates were found by slug similarity and then
**verified by content**: an archived page is accepted only if its extracted text
scores at least 0.45 Jaccard similarity against the current version. Genuine
matches land between 0.76 and 0.98. Four slug guesses scored below 0.17 and were
rejected by that check rather than silently accepted, which is the entire reason
the check exists.

Exclusions, all recorded rather than quietly dropped:

- **Two guest posts** on the same site, by Adam Noble and Steve Fawthrop, found
  by byline. They are human-written, so they would not have corrupted an FP
  rate, but attributing them to the wrong author would have.
- **Three posts carrying "Looking back from 2025" retrospective sections**
  added years after publication. Their pre-LLM provenance is broken. Caught by
  reading the worst-scoring paragraphs, not by any check in the tooling.
- **Nine posts with no verifiable pre-2023 capture.** Five have no archived
  snapshot at all; four had candidate slugs that failed the content check. They
  are out rather than included on their current-site text, because a corpus
  whose provenance rule bends for convenience is not a provenance rule.

## The machine half

Two datasets, chosen because they fail in different directions and the
difference turned out to be the finding.

**RAID** (Dugan et al. 2024, MIT) — 11 model families across 8 English domains,
sampled by byte-range from an 11.8 GB CSV. Its task is in-domain continuation:
finish this news article, write this recipe, draft this abstract. It also ships
its own human baseline rows, kept here as an independent human control.

**HC3** (Guo et al. 2023, CC-BY-SA-4.0) — the Human ChatGPT Comparison Corpus.
Every record is one question with both a human answer and a ChatGPT answer, so
the comparison is **paired on topic**, which is the strongest design available
without generating anything here. This is assistant register: hedging, dutiful
both-sides framing, "it is important to note".

Neither was generated by anyone with a stake in this repo's numbers. That
matters more than it sounds: a corpus generated by the person evaluating the
detector measures their prompting as much as the detector.

**The caveat that governs every number below.** HC3 is December 2022 ChatGPT,
the exact era whose habits this genre was built to catch, and RAID is 2024. A
true-positive rate measured here is an **upper bound** on performance against
current models, not an estimate of it. Nothing here has seen a 2026 model.

## Results (v3.22.0, 2026-07-31)

875 human paragraphs, 779 machine paragraphs.

| Threshold | FPR (95% CI) | TPR (95% CI) |
|---|---|---|
| score >= 3 | 16.6% (14.3–19.2) | 16.3% (13.9–19.1) |
| score >= 5 | 4.2% (3.1–5.8) | 7.2% (5.6–9.2) |
| score >= 10 | 0.5% (0.2–1.2) | 0.1% (0.0–0.7) |
| score >= 15 | 0.0% (0.0–0.4) | 0.0% (0.0–0.5) |
| score >= 25 | 0.0% (0.0–0.4) | 0.0% (0.0–0.5) |

**ROC-AUC, paragraph level: 0.501 pooled.** By source: HC3 0.554, RAID 0.451.
At document level, which is closer to real use: **0.623 pooled, HC3 0.654,
RAID 0.599.**

Read plainly: **the composite score cannot reliably separate machine text from
human text.** 0.5 is a coin flip. 0.65 is weak. There is no threshold on this
scale that buys a useful true-positive rate at a tolerable false-positive rate,
and the best operating point found — document score >= 3 — costs 12.8% false
positives to catch 27.7% of machine text.

### Three findings, in order of how much they should change the roadmap

**1. The 0–100 scale uses about a tenth of its range.** No paragraph of either
class scored above 11. Every threshold at or above 15 reports 0.0% on both
sides, and `SKILL.md`'s own label band puts everything at or under 15 in
"Minimal AI signals". So in practice every ordinary paragraph is labelled
Minimal regardless of who wrote it. The cause is mechanical: category weights
run 2–12, and `rawScore` is divided by `max(1, log2(words / 50))`, so a
200-word paragraph has its total halved. This is a calibration defect, not a
detection failure, and it is the most fixable thing on this page.

**2. The signal that exists is structural, not lexical.** Per-category firing
rates, document level:

| Category | Human | Machine | Lift |
|---|---:|---:|---:|
| `uniformity` | 2.1% | **25.1%** | **11.7x** |
| `filler` | 2.4% | 8.3% | 3.4x |
| `low-ttr` | 6.4% | 9.8% | 1.5x |
| `chatbot` | 0.0% | 1.1% | machine-only |
| `fnword-trigram-entropy` | 0.0% | 1.5% | machine-only |
| `hedge-stack` | 0.0% | 1.0% | machine-only |
| `tier1` | 8.0% | 7.4% | **0.9x** |
| `em-dash` | 9.9% | 1.9% | **0.2x** |

Rhythm uniformity is the single best discriminator in the whole engine, by an
order of magnitude. The 112-entry vocabulary table — the thing the README
leads with, the thing that took the most work — has a lift of **0.9**. It
fires slightly *more often on human writing than on machine writing.*

This is what `NulightJens/humanizer-stack` argues from StoryScope (discourse
features alone reach 93.2% F1 while professional surface rewriting moves
detection 1.6 points), and what `harshaneel/humanize` argues independently.
Measured here, on this engine, they look right.

**3. `em-dash` is inverted.** It fires on 9.9% of human documents and 1.9% of
machine ones — a lift of 0.2. On this corpus an em dash is evidence the text is
*human*. That holds on both legs and is not a transcription artifact: the
maintainer's own 2019–2022 posts are full of them and RAID and HC3 generations
are not. The rule is not wrong as *writing* advice, and the maintainer has
deliberately cut back on em dashes since. But as an authorship signal, on this
evidence, it points the wrong way.

### What this does not license

It does not license "the detector does not work". It measures one thing: how
well the composite score separates two labelled classes on two 2022–2024
corpora. The skill is documented as a writing-quality tool, and none of this
touches whether its edits improve prose.

It does not license a rewrite of the pattern list either. A lift near 1.0 says
a category does not separate *these* classes on *these* corpora; `delve` is
still worth replacing.

What it does license is a change of emphasis: the structural and stylometric
detectors are carrying the discriminative load, and they are the least
developed part of the engine.

## What this does not measure

**No current model.** Every machine unit predates 2025. The genre's whole
premise is that model habits shift; these numbers cannot speak to models
released after the corpora were collected.

**One assistant-register family.** HC3 is ChatGPT only. RAID adds ten more
families but in a different task shape. Nothing here is a modern
instruction-tuned model writing a LinkedIn post, which is the actual use case.

**No local generation, on purpose.** Generating the positives here would make
the numbers a measurement of the prompting as much as of the detector, and the
prompts would inevitably be written by someone who knows the pattern list.

**No claim is release-ready.** Adapting patina's public-claim gate: no number
from this corpus goes into the README, a release note, or a social post until
each claim cell has n >= 100, covers more than one register that people actually
write in today, and carries a confidence interval. The current run satisfies the
interval and the n, and fails the register test outright.

## Adding to it

Public-domain or permissively licensed source, fetchable by URL:

```jsonc
{
  "id": "short-slug",
  "title": "...", "author": "...", "year": 1900,
  "register": "blog",              // see REGISTERS in scripts/corpus.js
  "authorship": "human-pre-llm",
  "source": { "type": "url", "url": "https://…", "license": "public-domain", "gutenberg": true },
  "slice": { "after": "literal marker string", "maxWords": 6000 }
}
```

Then `node scripts/corpus.js fetch` records the hash.

Text you cannot redistribute, including your own:

```bash
node scripts/corpus.js add-local my-2019-posts /path/to/file.md \
  --register blog --author "Name" --year 2019
```

The file stays where it is. Only its hash, word count, and metadata enter the
repo, and `fp-measure.js` skips it with a note on machines where it is absent.

The most valuable additions are the ones this corpus is missing: writing from
after 2010 in the registers people actually run this tool on, with provenance
someone is willing to attest to. The
[false-positive report form](https://github.com/conorbronsdon/avoid-ai-writing/issues/new?template=false_positive.yml)
is the other intake for exactly that.
