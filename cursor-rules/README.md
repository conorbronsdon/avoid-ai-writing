# Cursor Rule — avoid-ai-writing

Drop-in [Cursor](https://cursor.sh) rule that ports the [`avoid-ai-writing`](../SKILL.md) skill to Cursor's `.mdc` rule format. Functionally identical to the upstream skill — same tier vocabulary, same context profiles, same detect / rewrite modes.

## Install

Copy `avoid-ai-writing.mdc` into your project's `.cursor/rules/` directory:

```sh
mkdir -p .cursor/rules
curl -o .cursor/rules/avoid-ai-writing.mdc \
  https://raw.githubusercontent.com/conorbronsdon/avoid-ai-writing/main/cursor-rules/avoid-ai-writing.mdc
```

By default the rule activates on `.md`, `.mdx`, `.txt`, `.rst`, and `.adoc` files (via the `globs` field in the frontmatter). Edit the globs in the rule file if you want it on other file types — or set `alwaysApply: true` if you want it on every Cursor session.

## Trigger phrases

Once installed, ask Cursor:
- *"Remove AI-isms from this section."*
- *"Audit this draft for AI writing patterns."*
- *"Make this sound less like AI."*
- *"Run avoid-ai-writing in detect mode."* (flag without rewriting)

## Old Cursor projects

If you're on a Cursor version that still uses `.cursorrules` (single file at repo root), you can append `avoid-ai-writing.mdc`'s body (the part below the `---` frontmatter) directly to your existing `.cursorrules` file. Modern Cursor projects should prefer the `.cursor/rules/*.mdc` layout.

## Updating

This file and [`dist/avoid-ai-writing.md`](../dist/avoid-ai-writing.md) are generated from `SKILL.md` plus `references/patterns.md`. Run `bash scripts/sync-cursor-rules.sh` after editing either source. The generator first builds the lossless `SKILL.full.md`, then applies six anchored portability rewrites so copied instructions use manual fallbacks where bundled commands are unavailable. CI regenerates all artifacts and fails on drift. Do not edit generated files.
