# Contributing

Thanks for helping improve this skill. It teaches an LLM (and now a deterministic
engine) to spot and fix AI-writing tells. Contributions are welcome — a few things
keep the project coherent.

## How the repo fits together

| Path | What it holds |
|------|---------------|
| `SKILL.md` | The human-readable catalog of rules. The source of truth for what counts as an AI tell. |
| `detector/patterns.js` | The deterministic engine — the executable subset of the rules. |
| `detector/CATEGORIES.md` | The map between SKILL.md rules and detector `type`s. Keep it current. |
| `README.md` | The pitch and the numbered prose-pattern list. |
| `cursor-rules/`, `plugins/` | Editor and tool integrations. |

## Adding or changing a rule

First decide which kind of rule it is:

- **Regex-detectable** (a phrase, a character, a structural shape) → add it to
  `SKILL.md`, add the detection to `detector/patterns.js` with a new `type`, and
  add a row to `detector/CATEGORIES.md`. Cover it with a fixture in
  `detector/patterns.test.js` (both a true positive and a case that must *not*
  fire).
- **Judgment-only** (needs reading for meaning — tone, structure, name-dropping)
  → add it to `SKILL.md` prose and list it under "Skill-only" in
  `detector/CATEGORIES.md`. There is no detector type for these.

If you are unsure which it is, open an issue first and we will sort it out.

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

## Run the tests

```bash
npm test
```

This runs the engine fixtures and the `CATEGORIES.md` contract check (every
detector `type` must be documented, and every documented type must be real). Both
must pass. No dependencies to install; Node 18+ only.

## Write clean prose

This repo polices writing quality, so the prose you add has to clear the same
bar. Run your additions through the skill itself. Keep rule bullets terse and
lead with the directive — match the length and tone of the bullets already in
`SKILL.md`. Drop intensifiers like "strong" or "powerful"; let the rule stand on
its own.

## Changelog and versioning

Add an entry to `CHANGELOG.md` under a dated, versioned heading
(`## [X.Y.Z] — YYYY-MM-DD`), matching the existing entries. A new rule is a minor
version bump; update the `version:` field in the `SKILL.md` frontmatter to match.
