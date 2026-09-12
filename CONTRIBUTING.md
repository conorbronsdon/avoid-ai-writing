# Contributing

Thanks for helping improve this skill. It teaches an LLM (and now a deterministic
engine) to spot and fix AI-writing tells. Contributions are welcome — a few things
keep the project coherent.

## Choosing an issue

Check the assignee, comments, and linked PRs to see whether someone is already
working on an issue. For an unclaimed issue, leave a short comment letting us
know you're starting. We appreciate the heads-up, and you can begin right away:
you do not need to wait for assignment or maintainer confirmation. If someone
is already working on it, coordinate with them before duplicating their work.
If the issue explicitly needs a design decision before implementation, resolve
that question first.

Issues labeled `good first issue` are reserved for people making their first
contribution to this repository. Take only one for your first PR; leave the
others for fellow newcomers, including while your PR is awaiting review.

You are also welcome to propose your own issues and ideas.

If you've already contributed here, choose a `help wanted` issue without the
`good first issue` label, propose another improvement, or help review and test
newcomer PRs.

## How the repo fits together

| Path | What it holds |
|------|---------------|
| `SKILL.md` | Entry instructions, severity tiers, output formats, and guardrails. |
| `references/patterns.md` | Canonical pattern catalog, word tiers, context and voice profiles. |
| `detector/patterns.js` | The deterministic engine — the executable subset of the rules. |
| `detector/CATEGORIES.md` | The map between references/patterns.md rules and detector `type`s. Keep it current. |
| `README.md` | The pitch and the numbered prose-pattern list. |
| `cursor-rules/`, `plugins/` | Editor and tool integrations. |

## Adding or changing a rule

First decide which kind of rule it is:

- **Regex-detectable** (a phrase, a character, a structural shape) → add it to
  `references/patterns.md`, add the detection to `detector/patterns.js` with a new `type`, and
  add a row to `detector/CATEGORIES.md`. Cover it with a fixture in
  `detector/patterns.test.js` (both a true positive and a case that must *not*
  fire).
- **Judgment-only** (needs reading for meaning — tone, structure, name-dropping)
  → add it to `references/patterns.md` prose and list it under "Skill-only" in
  `detector/CATEGORIES.md`. There is no detector type for these.

If you are unsure which it is, open an issue first and we will sort it out.
The [pattern proposal form](https://github.com/conorbronsdon/avoid-ai-writing/issues/new?template=pattern_proposal.yml)
asks for what triage needs, including the example that must stay clean.

### Pattern-category count (detection catalog)

When you add or remove a detection `###` under `## What to remove or fix` in
`references/patterns.md` (not judgment-only prose or writer-side tests), CI
derives the new total and compares it to two literals:

1. **`README.md`** — update the `**NN pattern categories**` feature bullet to
   match the derived count.
2. **`CLAUDE.md`** — update the quoted `README "NN pattern categories" bullet`
   phrase in the pattern-count guidance so it matches the same number.

`scripts/check-pattern-count.sh` enforces both on every PR. Adding a word-table
row instead only requires bumping the separate `**NN-entry word replacement
table**` README bullet (same script).

## Precision over recall

This skill is deliberately biased toward false negatives: a rule that wrongly
flags ordinary human writing is worse than one that misses a tell, because false
positives erode trust in every other rule. Before proposing a rule, ask who would
get flagged by mistake, and add carve-outs for the legitimate cases. A signal
that fires on most normal prose is not worth adding.

## Cite your sources

If your rule rests on a factual claim about how AI or humans write — "ChatGPT
emits curly quotes by default," "most writers rarely do X" — link a source for
it. These claims get checked, and some turn out wrong or more nuanced than they
first seem (smart quotes, for instance, are a typing-time default on macOS and in
Word, not a publication-step artifact). A claim with a citation can be verified;
an asserted one can't. Put the links in the PR description or inline in the rule.

## Style guides and licensing

The rules from the [#88 license audit](https://github.com/conorbronsdon/avoid-ai-writing/issues/88), recorded here so nobody has to rediscover them:

- **This repo bundles no style guide it cannot verify the license for.** The `--style` layer is config-driven; users supply their own conventions.
- **Openly-licensed guides may ship later as example configs** (Google, Microsoft, GOV.UK, and 18F qualify), using Vale's attribution pattern: disclaim endorsement, name the license, link the guide upstream.
- **Paywalled guides (CMOS, APA, MLA, AP) are never shipped, in any form, under any name.** Passing one to `--style` falls through to the fallback that claims no compliance. The reason is trademark and verifiability, not maintenance burden.

## Run the tests

```bash
npm test
```

This runs the engine fixtures and the `CATEGORIES.md` contract checks: every
detector `type` must be documented, every documented type must be real, and every
prose statement of the engine `type` total must match the code. All must pass. No
dependencies to install; Node 18+ only.

## Documentation drift

The `SSOT / ssot` CI job checks repository-local Node requirements using
`.ssot-local.yaml` on every PR. `package.json` owns the detector's Node minimum;
README and contributor instructions carry checked copies. Existing generated
skill, version, and pattern-count checks keep their own ownership.

The separate `.ssot.yaml` and `promo-drift` workflow track cross-repo promotional
counts on release and schedule. Both workflows pin the checker revision; the
local PR check needs no sibling repositories or private credentials.

Registered drift, missing copies, and malformed manifests fail CI. Fix the
claim and its copies, and explain any change to canonical ownership or removed
locators. Do not remove checks merely to make a failure disappear.

Discovery is advisory and scans prose, not every source format or value. The
Node minimum needs its explicit locators. Historical releases, example corpora,
and generated bundles are excluded from discovery. The initial remaining
warnings are fictional funding/percentage examples and repeated editing-budget
guidance. Inspect a warning before registering a fact or excluding a path;
explicitly registered copies remain checked even in excluded files.

To reproduce CI, check out the checker revision pinned in
`.github/workflows/ssot.yml` into a sibling `ssot-check` directory, then run:

```bash
python3 ../ssot-check/ssot_check.py check --manifest .ssot-local.yaml
python3 ../ssot-check/ssot_check.py discover --manifest .ssot-local.yaml --untracked-only --github-annotations
python3 scripts/check-ssot-controls.py ../ssot-check/ssot_check.py
```

The controls mutate disposable copies and verify drift, restoration, missing
locations/manifests, and invalid manifests. They also prove that history can be
excluded while a new unregistered current copy still warns without failing
`check`. Record useful findings, repeated warnings, and maintenance effort in
the pilot PR or a follow-up issue before expanding coverage.

## Write clean prose

This repo polices writing quality, so the prose you add has to clear the same
bar. Run your additions through the skill itself. Keep rule bullets terse and
lead with the directive — match the length and tone of the bullets already in
`SKILL.md`. Drop intensifiers like "strong" or "powerful"; let the rule stand on
its own.

## Changelog and versioning

Add an entry under `## [Unreleased]` in `CHANGELOG.md` when a change affects
users: detection or rewriting behavior, writing rules, public APIs or CLI
options, configuration, installation or packaging, compatibility, or security.

Skip the changelog for routine docs corrections, links, formatting, contributor
guidance, tests, and internal refactoring or CI maintenance with no user-facing
effect. Describe those changes in the PR. A docs or maintenance label does not
exempt a change that affects how the tool works, is installed or used, or is
supported.

When preparing a release, move its Unreleased entries under a dated, versioned
heading (`## [X.Y.Z] — YYYY-MM-DD`) and update the matching versions in
`SKILL.md`, `package.json`, and both plugin manifests. A release that adds a
writing rule needs a minor version bump. Exempt changes need no version bump;
leave published release entries intact.

After changing either canonical file, run `bash scripts/sync-plugin-skill.sh && bash scripts/sync-cursor-rules.sh`. This regenerates both bundles, `SKILL.full.md`, and the portable paste/Cursor artifacts; CI checks parity. Do not edit generated copies.
