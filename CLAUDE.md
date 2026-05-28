# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file writing skill (`SKILL.md`) that audits and rewrites content to remove AI writing patterns. No build system, no dependencies, no tests — the skill is a markdown file consumed by AI coding assistants.

## Repository structure

- `SKILL.md` — the skill itself (v3.7.2). This is the product. All rules, tiers, profiles, and output format live here.
- `README.md` — public-facing docs, installation instructions, pattern reference table, full before/after example.
- `CHANGELOG.md` — version history with what changed and why.

## How to make changes

Edit `SKILL.md` directly. There's nothing to build or test. When making changes:

- Bump the version in the SKILL.md frontmatter (`version: X.Y.Z`)
- Add a dated entry to CHANGELOG.md
- Update README.md if the change affects installation, usage, feature list, or pattern count
- The pattern count lives in **one** place — the README "46 pattern categories" bullet — and is derived from SKILL.md's detection `###` entries. Don't restate it elsewhere; CI (`scripts/check-pattern-count.sh`) fails the build if the README number drifts from SKILL.md, so just add the new `###` entry and bump the README bullet.

## Architecture of the skill

The skill has three modes (`rewrite` default, `detect` flag-only, `edit` in-place) and processes text through this pipeline:

1. **Context profile detection** — auto-detects or accepts a profile hint (linkedin, blog, technical-blog, investor-email, docs, casual) that adjusts rule strictness via the tolerance matrix
2. **Pattern matching** — detection categories across content, language, structure, communication, and meta patterns (see SKILL.md for the catalog; the count is in the README bullet)
3. **Vocabulary flagging** — 3-tier system: Tier 1 (always flag), Tier 2 (flag in clusters), Tier 3 (flag at high density)
4. **Severity classification** — P0 (credibility killers), P1 (obvious AI smell), P2 (stylistic polish)
5. **Output** — rewrite mode: 4 sections including a second-pass audit; detect mode: 2 sections with problem vs. judgment-call assessment

## Key constraints

- The skill must remain a single `SKILL.md` file with agentskills.io-compatible frontmatter
- Word replacement table entries need specific alternatives, not just "rephrase"
- The self-reference escape hatch (quoted examples exempt from flagging) must be preserved — without it the skill flags its own documentation
- Technical-blog profile has explicit word table exceptions (e.g., "robust" and "ecosystem" are legitimate in technical contexts)
- "Extra strict" and "skip" in the tolerance matrix have specific meanings defined in the file

## Compatibility

The skill works with Claude Code, OpenClaw/ClawHub, and any agentskills.io-compatible agent. The frontmatter includes both `agentskills_spec` and `openclaw` fields. Changes must not break either format.
