# ChatGPT and Codex plugin package

This repository contains a native ChatGPT and Codex plugin package while keeping the existing Claude plugin and the canonical root `SKILL.md`.

## Architecture

The public package is skills-only. The separate `avoid-ai-writing-mcp` project remains optional and is not bundled or required.

The canonical root `SKILL.md` remains the editorial authority. The OpenAI package adds focused workflow skills around it:

- `avoid-ai-writing`: exact copy of the original skill
- `avoid-ai-writing-router`: orchestration for mixed requests
- `ai-writing-detector`: detect-only workflow with the bundled deterministic detector
- `voice-preserving-rewriter`: rewrite workflow
- `file-edit-in-place`: narrow mutation workflow for named files
- `preservation-verifier`: deterministic before/after safety check
- `false-positive-reviewer`: interpretation guardrail for authorship claims

The router graph lives in `skills/avoid-ai-writing-router/references/skill-graph.yaml`.

## Local marketplace

The repo marketplace entry is `.agents/plugins/marketplace.json` and points to the repository root. ChatGPT and Codex discover the native manifest at `.codex-plugin/plugin.json`.

## Validation

Run:

```bash
python3 scripts/validate-openai-plugin.py . --json
python3 scripts/package-openai-plugin.py . /tmp/avoid-ai-writing.zip --json
```

The packager emits a deterministic archive containing only the public plugin surface. It does not include repository CI, corpus data, development utilities, the Claude marketplace, or the optional external MCP server.

## Source of truth

After changing the root `SKILL.md`, run:

```bash
bash scripts/sync-plugin-skill.sh
```

That updates both generated plugin copies and verifies that the Claude and OpenAI manifests match the canonical skill version.
