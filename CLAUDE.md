# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A directory-based writing skill (`SKILL.md` plus `references/patterns.md`) that audits and rewrites content to remove AI writing patterns. The skill is a markdown file consumed by AI coding assistants; the repository also includes a dependency-free deterministic detector and test suite.

## Repository structure

- `SKILL.md` — entry instructions, severity tiers, preservation rules, and output formats.
- `references/patterns.md` — canonical word tiers, catalog, context and voice profiles.
- `SKILL.full.md` — generated full source for comparison and self-scan.
- `dist/avoid-ai-writing.md` — generated portable paste instructions.
- `README.md` — public-facing docs, installation instructions, pattern reference table, full before/after example.
- `CHANGELOG.md` — version history with what changed and why.

## How to make changes

Edit `SKILL.md` and `references/patterns.md` directly. When making changes:

- Follow the [changelog and versioning policy](CONTRIBUTING.md#changelog-and-versioning): add an Unreleased entry for user-facing changes; routine docs corrections, tests, and maintenance with no user-facing effect need no entry or version bump.
- When preparing a release, update the SKILL.md frontmatter (`version: X.Y.Z`), `package.json`, and the dated changelog heading. Update the same version manually in both plugin manifests before syncing:
  - `plugins/avoid-ai-writing/.claude-plugin/plugin.json`
  - `.codex-plugin/plugin.json`
- Run `bash scripts/sync-plugin-skill.sh && bash scripts/sync-cursor-rules.sh`. The first script validates both manifest versions against `SKILL.md` and regenerates bundled skill copies, detector resources, scripts, and examples; the second regenerates the portable paste/Cursor artifacts. Neither script generates the manifest versions. A mismatch fails with messages such as `version mismatch: SKILL.md=X Claude plugin=Y` or `version mismatch: SKILL.md=X OpenAI plugin=Y`.
- Run `npm test` to exercise the detector, category contract, validator, corpus helpers, and style checks.
- Update README.md if the change affects installation, usage, feature list, or pattern count
- The pattern count is canonical in the README "74 pattern categories" bullet (derived from references/patterns.md's detection `###` entries). This bullet quotes that number here as a **checked copy** for agent context — update README and this sentence when you add or remove a detection category. Don't restate the count elsewhere; CI (`scripts/check-pattern-count.sh`) fails if either literal drifts from `references/patterns.md`.

## Architecture of the skill

The skill has three modes (`rewrite` default, `detect` flag-only, `edit` in-place) and processes text through this pipeline:

1. **Context profile detection** — auto-detects or accepts a profile hint (linkedin, blog, technical-blog, investor-email, docs, casual) that adjusts rule strictness via the tolerance matrix
2. **Pattern matching** — detection categories across content, language, structure, communication, and meta patterns (see references/patterns.md for the catalog; the count is in the README bullet)
3. **Vocabulary flagging** — 3-tier system: Tier 1 (always flag), Tier 2 (flag in clusters), Tier 3 (flag at high density)
4. **Severity classification** — P0 (credibility killers), P1 (obvious AI smell), P2 (stylistic polish)
5. **Output** — rewrite mode: 4 sections including a second-pass audit; detect mode: 2 sections with problem vs. judgment-call assessment

## Key constraints

- Keep the entry SKILL.md under 500 lines with agentskills.io-compatible frontmatter; preserve all rule text in the reference and generated artifacts.
- Run `bash scripts/sync-plugin-skill.sh && bash scripts/sync-cursor-rules.sh` after canonical edits. Never edit generated copies.
- Word replacement table entries need specific alternatives, not just "rephrase"
- The self-reference escape hatch (quoted examples exempt from flagging) must be preserved — without it the skill flags its own documentation
- Technical-blog profile has explicit word table exceptions (e.g., "robust" and "ecosystem" are legitimate in technical contexts)
- "Extra strict" and "skip" in the tolerance matrix have specific meanings defined in the file
- The `ai-writing-skill-field-guide` survey ranks this repo first on upkeep, and its author filed #12 here. Any public citation of that ranking has to carry the disclosure with it

## Compatibility

The skill works with Claude Code, OpenClaw/ClawHub, and any agentskills.io-compatible agent. The frontmatter includes both `agentskills_spec` and `openclaw` fields. Changes must not break either format.
