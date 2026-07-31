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

Two sources, chosen for different reasons.

**Nine public-domain works, 1788 to 1907**, sliced to 6,000 words each. Their
provenance is beyond argument: nothing written in 1859 was machine-generated.
That is also their limitation, and it is severe. Nobody runs this tool over
*Walden*. On its own, this leg can only show the detector is not firing wildly
on formal English prose.

**Thirty-four blog posts by this repo's maintainer, 2019 to October 2022**,
published on his own site and fetched from it. Written before ChatGPT's
release, in the register the tool is actually pointed at, by someone whose
authorship is not in question. This is the leg that produced the useful
findings.

Three exclusions are worth recording:

- **Two guest posts** on the same site, by Adam Noble and Steve Fawthrop, were
  found by byline and excluded. They are human-written, so they would not have
  corrupted an FP rate, but attributing them to the wrong author would have.
- **Three posts carried "Looking back from 2025" retrospective sections** added
  years after publication. Their pre-LLM provenance is broken, so they are out.
  This is the corpus equivalent of a contaminated sample, and it was caught by
  reading the worst-scoring paragraphs rather than by any check in the tooling.

**A standing caveat on the maintainer's leg:** these are the *currently
published* versions of pre-2023 posts, not verified originals. The site has been
rebuilt since. Silent post-2023 edits would not announce themselves the way the
three above did. Fetching from the Wayback Machine at a pre-2023 timestamp is
the fix, and it has not been done.

## Results (v3.22.0, 2026-07-31)

628 paragraphs of 50 to 400 words, from 43 documents.

| Threshold | n | flagged | FP rate | Wilson 95% CI |
|---|---:|---:|---:|---|
| score >= 25 | 628 | 0 | 0.0% | 0.0–0.6% |
| score >= 40 | 628 | 0 | 0.0% | 0.0–0.6% |
| score >= 50 | 628 | 0 | 0.0% | 0.0–0.6% |
| score >= 65 | 628 | 0 | 0.0% | 0.0–0.6% |

Not one human paragraph crossed the lowest threshold. The worst scored **11 out
of 100**. Per register: `blog` 351, `essay-literary` 141, `academic` 116,
`technical-blog` 20, all at 0.0%.

**At the document-score level, the detector does not fire on human prose.** That
is the result, and it is a real one now that the corpus contains modern
blog-register writing rather than only Victorian essays.

### The flag level tells a different story

`detect` mode does not show users a document score. It shows them every flag.
And categories fire on human writing constantly.

On the maintainer's own pre-LLM posts alone (325 paragraphs, 2019–2022):

| Category | Paragraphs firing | Rate |
|---|---:|---|
| `em-dash` | 56 | **17.2%** |
| `tier1` | 38 | **11.7%** |
| `transition` | 9 | 2.8% |
| `uniformity` | 8 | 2.5% |
| `smart-punct-signature` | 5 | 1.5% |
| `hollow-intensifier` | 3 | 0.9% |

The Tier 1 words doing it: `embrace` (9), `leverage` and inflections (8),
`in order to` (5), `when it comes to` (4), `that said` (4), `features` (3),
`thriving` (2), `robust` (2), `truly` (2), plus single hits on `utilize`,
`pivotal`, `serves as`, `genuinely`, and `in an era where`.

**Read that carefully. Those are not AI tells in this text. They are the
author's ordinary 2019 vocabulary, written years before the models existed.**
Tier 1 is documented as "always flag — replace on sight," and on genuine
pre-LLM prose from a marketing and developer-relations writer it fires in
roughly one paragraph in eight.

The same holds for `em-dash`, and this time it is not a transcription artifact:
one paragraph in six of his own pre-2023 writing exceeds the em-dash rate
ceiling. The rule targets a habit he already had.

None of this makes the document score wrong. It does mean the two numbers
answer different questions, and only one of them is what a `detect`-mode user
sees.

### Two defects found

**1. `hedge-stack` over-matches ordinary negation.** The pattern allows two
words between the modal and the hedge adverb, so `could not possibly` and
`could a savage possibly` both fire. Filed as
[#69](https://github.com/conorbronsdon/avoid-ai-writing/issues/69).

**2. Nineteenth-century text cannot test the em-dash rule at all.** On the
public-domain leg the flags are a mix of real period usage and Gutenberg's `--`
transcription convention. Recorded so nobody later reads that leg's 18.8% as a
rate.

### One decision this raises

`endeavor`, `commence`, and `ascertain` fire on the Federalist Papers and
Faraday; `embrace`, `leverage`, and `in order to` fire on the maintainer's own
posts. All sit on the always-flag tier. In LLM output they are inflation; in
formal registers and in ordinary professional writing they are just the word
someone reached for.

That is the shape of a register-scoped relaxation the tolerance matrix does not
have, and it is worth deciding deliberately rather than by omission. The
counter-argument is real too: the skill is a writing-quality tool, and
"`leverage` → `use`" is good advice whether or not a machine wrote the
sentence.

## What this does not measure

**No true-positive rate.** The corpus contains no machine-written text, so
nothing here says how often the detector is right when it fires. An FP rate
alone tells you how often the tool cries wolf, not whether it can see wolves.
Adding a positive corpus with known provenance is a separate piece of work with
its own design problems, starting with which models and which prompts count as
representative.

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
