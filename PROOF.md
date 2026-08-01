# Proof: this skill's detector, run against this skill's own writing

A tool that flags "delve" in your draft should survive its own pass. This page
is the result of running `detector/patterns.js` over the repo's documentation,
including the findings that are unflattering.

Reproduce it in one command, no dependencies:

```bash
git clone https://github.com/conorbronsdon/avoid-ai-writing && cd avoid-ai-writing
node scripts/self-scan.js
```

## Result (v3.22.0, measured 2026-07-31)

| Document | Words | Raw score | Exempt score | Budget |
|---|---:|---:|---:|---:|
| `README.md` | 3,977 | 65 | **21** | 30 |
| `SKILL.md` | 14,008 | 89 | **12** | 25 |
| `CONTRIBUTING.md` | 527 | 3 | **1** | 15 |
| `detector/README.md` | 593 | 2 | **2** | 15 |
| `detector/CATEGORIES.md` | 1,064 | 1 | **1** | 15 |
| `CHANGELOG.md` | 7,192 | 62 | **32** | 40 |
| `PROOF.md` | 995 | 15 | **14** | 20 |

The `PROOF.md` row is a snapshot and mildly self-referential: editing this page
changes its own word count and score. CI gates the live number from
`scripts/self-scan.js`, not the table text, so treat that row as accurate to
the commit it was written in and run the command for the current value.

Score runs 0 to 100, where 0 is clean. Two columns are published because
publishing only the flattering one is the behavior this project exists to
criticize.

**Raw** counts every match, including the 112-entry vocabulary table and every
pattern this repo quotes to warn about it. `SKILL.md` scoring 92 raw
means the catalog contains the words it catalogs. That number is noise, and it
is here so nobody has to wonder what was suppressed.

**Exempt** applies the self-reference escape hatch that `SKILL.md` has always
documented in prose: *"quoted examples are exempt from flagging. Text inside
quotation marks, code blocks, or explicitly marked as illustrative should not
be rewritten."* Until this scan existed, that rule was an instruction to a
model and nothing more. `applyExemptions()` in `scripts/self-scan.js` is its
executable form: it blanks fenced code, inline code, tables, blockquotes, and
quoted spans, then scores what remains.

Budgets gate the exempt column in CI. They are regression ceilings set from
measured values with a few points of headroom, not quality claims, and they
only move down. Raising one is a decision that belongs in a pull request with
the new number stated.

## What the scan found in our own writing

Four results worth naming rather than scrubbing.

**1. `CHANGELOG.md` scores worst, and roughly half of it is unreachable by the
exemption.** A changelog announcing a new rule lists the words that rule
catches, unquoted and comma-separated: *bustling, intricate, ever-evolving,
daunting, holistic, actionable, impactful, learnings, synergy, interplay*. The
detector reads a Tier 1 vocabulary run. A reader reads a release note. The
exemption only reaches quoted or code-fenced text, so this residue stays in the
number.

**2. The em-dash rule does not implement its own carve-out for two shapes.**
`SKILL.md` exempts the list-item separator (`- **Term** — description`) as
typography rather than prose punctuation, and `detector/patterns.js`
implements exactly that. It does not exempt two near-identical forms:

- Keep-a-Changelog version headings: `## [3.21.0] — 2026-07-30`. Thirty-two of
  them in `CHANGELOG.md`, every one counted as a prose em dash.
- A bulleted item whose bold lead term carries a parenthetical before the dash:
  ``- **Lingering-attention claims** (`lingering-attention`) — the share-post
  frame…``

Of 137 em dashes in `CHANGELOG.md` at the time of the scan, the detector carved
out 53 and counted 84. Thirty-three of those 84 were the two shapes above.

**Fixed** in [#67](https://github.com/conorbronsdon/avoid-ai-writing/issues/67):
both shapes are now carve-outs, with fixtures pinning the narrow scope — a prose
dash inside a heading still counts, because `SKILL.md` applies the em-dash rule
to headings too. The scan is what surfaced it, which is the argument for having
the scan.

**3. This page is in the table, and it scores 14 for the reason it just
described.** Nearly every hit on `PROOF.md` comes from the italicized list of
Tier 1 words two paragraphs above. Italics are not an exempt span; quotation
marks, code, tables, and blockquotes are. The page explaining that release
notes trip the detector by naming patterns trips the detector by naming
patterns. One hit was a real one, an "in order to" in the paragraph above the
table, and it is now "to".

**4. `README.md` at 21 is the honest number for a page that sells something.**
The residue is promotional register, not vocabulary. That is the expected
failure mode for a project README, and the tolerance matrix in `SKILL.md`
relaxes exactly nothing for it.

## What this page does not claim

A low score means the text carries no surface pattern hits. It does not mean
the writing is good, and it does not mean the writing is human. The detector
measures a regex-detectable subset of `SKILL.md` plus a few stylometric
signals. Prose can be hollow, structurally uniform, and entirely free of tells.

The scan also has a known limitation worth stating: blanking exempt spans
slightly changes document-level metrics that are computed over the whole text
(em-dash rate, type-token ratio, bold-phrase count), because the denominator
shrinks. Vocabulary and phrase categories are unaffected.

A false-positive rate has been measured, and it is not quoted here as a claim.
[`corpus/README.md`](corpus/README.md) publishes the full table against 875
human and 779 machine paragraphs: at `score >= 5`, 4.2% FPR (95% CI 3.1–5.8)
against 7.2% TPR. Paragraph-level ROC-AUC is 0.501 pooled — a coin flip — and
0.623 at document level. Read plainly, the composite score cannot reliably
separate machine text from human text, and no threshold on it buys a useful
true-positive rate at a tolerable false-positive cost.

Those numbers stay in the corpus write-up rather than becoming a headline
because they do not clear this repo's own publication gate. The gate requires
each claim cell to carry n >= 100, a confidence interval, and more than one
register people actually write in today. The current run satisfies the first
two and **fails the register test outright**: HC3 is ChatGPT only, RAID is a
different task shape, and nothing in either is a modern instruction-tuned model
writing a LinkedIn post. A rate measured on 2022–2024 assistant prose is an
upper bound on performance against current models, not an estimate of it.

The intake to fix that is open: if a rule fires on writing a person wrote, the
[false-positive report](https://github.com/conorbronsdon/avoid-ai-writing/issues/new?template=false_positive.yml)
form collects the shortest text that fires, the register, how the text was
actually written, and whether it can become a public fixture. Register is the
field that matters, because false-positive rates are not uniform across blog,
documentation, academic, and chat prose, and a single number that hides that
spread would be a worse claim than none.

## In CI

`.github/workflows/detector-test.yml` runs `node scripts/self-scan.js --check`
on every push that touches the detector or the docs. A document that drifts
past its budget fails the build.
