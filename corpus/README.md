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

## Current contents and the large caveat

The seed corpus is nine public-domain works, 1788 to 1907, sliced to 6,000 words
each. They were chosen because their provenance is beyond argument: nothing
written in 1859 was machine-generated.

**That is also their limitation, and it is severe.** Nineteenth-century literary
and scientific prose is a poor proxy for the registers this skill actually
operates on. Nobody is running `avoid-ai-writing` over *Walden*. They are
running it over LinkedIn posts, READMEs, release notes, and investor emails, and
this corpus contains none of those.

Read the current numbers as a floor, not as a rate. A corpus this far from the
target distribution can only tell you the detector is not firing wildly on
formal English prose. It cannot tell you how the tool behaves on a technical
blog post written last week.

## Results, first run (v3.22.0, 2026-07-31)

303 paragraphs, 50 to 400 words each, from nine works.

| Threshold | n | flagged | FP rate | Wilson 95% CI |
|---|---:|---:|---:|---|
| score >= 25 | 303 | 0 | 0.0% | 0.0–1.3% |
| score >= 40 | 303 | 0 | 0.0% | 0.0–1.3% |
| score >= 50 | 303 | 0 | 0.0% | 0.0–1.3% |
| score >= 65 | 303 | 0 | 0.0% | 0.0–1.3% |

No paragraph of canonical human prose scored above **8 out of 100**. Per
register, `academic` (116), `essay-literary` (141), `technical-blog` (20), and
`blog` (26) all sit at 0.0%.

The honest reading, in patina's phrasing, is `no_calibration_signal_yet`: **the
corpus is too easy to expose a trade-off.** That is a valid outcome and it is
not a performance claim. Emerson does not say "delve into the landscape," so a
vocabulary detector aimed at LLM register has almost nothing to hit.

### What did fire, and why it matters anyway

Document scores stayed at zero, but individual categories fired on human text,
and in `detect` mode every one of those is shown to a user as a flag.

| Category | Units firing | Reading |
|---|---:|---|
| `em-dash` | 57 / 303 (18.8%) | **corpus artifact, mostly.** Thoreau and Du Bois used real em dashes freely; Emerson and Twain arrive via Gutenberg's `--` transcription convention. Nineteenth-century prose cannot test this rule. |
| `tier1` | 16 / 303 (5.3%) | **real signal.** Formal-register vocabulary: `endeavor` (5), `in order to` (3), `commence` (2), `ascertain` (2), `comprehensive` (2). |
| `hollow-intensifier` | 6 / 303 | `truly` (5), `genuine` (1). |
| `transition` | 5 / 303 | `moreover` (3), `furthermore` (2). |
| `hedge-stack` | 4 / 303 | **three of the four are a bug.** See below. |

Two findings came out of this that a synthetic test would not have produced.

**1. `hedge-stack` over-matches ordinary negation.** The pattern allows two
words between the modal and the hedge adverb, so `could not possibly` and
`could a savage possibly` both fire. Filed as
[#69](https://github.com/conorbronsdon/avoid-ai-writing/issues/69).

**2. The Tier 1 list penalizes formal register.** `endeavor`, `commence`, and
`ascertain` are on the always-flag tier. In LLM output they are inflation. In
Federalist-era prose, in legal writing, and in some academic registers they are
simply the ordinary word. This is not obviously a defect, but it is the shape of
a register-scoped relaxation the tolerance matrix does not currently have, and
it is worth deciding deliberately rather than by omission.

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
