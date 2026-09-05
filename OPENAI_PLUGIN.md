# ChatGPT and Codex plugin package

This repository contains a native ChatGPT and Codex plugin package while keeping the existing Claude plugin and the canonical root `SKILL.md`.

The package is published as [Avoid AI Writing](https://chatgpt.com/plugins/plugins_6a9b77b18b8881918efa9c1255868164) in the OpenAI Plugins Directory (version 3.29.0, approved and published 2026-09-04).

## Architecture

The public package is skills-only. The separate `avoid-ai-writing-mcp` project remains optional and is not bundled or required.

The canonical root `SKILL.md` remains the editorial authority. The OpenAI package adds focused workflow Skills around it:

- `avoid-ai-writing`: generated copy of the original Skill, identical except that the frontmatter `metadata` block (agentskills.io/OpenClaw fields) is omitted because the OpenAI portal rejects it
- `avoid-ai-writing-router`: orchestration for mixed and multi-stage requests
- `ai-writing-detector`: detect-only workflow with the bundled deterministic detector
- `voice-preserving-rewriter`: returned-text rewrite owner
- `file-edit-in-place`: narrow mutation owner for explicitly named files
- `preservation-verifier`: before/after preservation gate
- `false-positive-reviewer`: terminal interpretation guardrail

## Connected Skill graph

The machine-readable graph is `skills/avoid-ai-writing-router/references/skill-graph.json`.

The network uses typed relationships rather than loose prose references:

- `ROUTE` selects a primary owner.
- `FEED` passes evidence into another requested stage.
- `VERIFY` sends before/after content to the preservation gate.
- `REPAIR` returns a failed preservation scope to the correct owner once.
- `RECHECK` permits one bounded residual audit when requested.
- `ESCALATE` sends interpretation questions to the terminal reviewer.
- `GUARD` attaches protected semantic constraints without changing the primary owner.

Cross-stage state follows `skills/avoid-ai-writing-router/references/handoff-contract.md`. The envelope carries context mode, voice, protected constraints, execution evidence, detector summary, verification state, risk flags, and pass limits without making each Skill infer them again.

Terminal Skills have no outgoing Skill edges. Every permitted graph cycle must pass through an edge with `max_reentries: 1`, which keeps repair and residual-check loops bounded.

## Agency review lenses

The graph design was reviewed through four existing agency Skill roles without adding them as public Plugin dependencies:

- `agency-software-architect`: ownership, dependency direction, graph boundaries, loop control, fallback
- `agency-ai-engineer`: detector semantics, uncertainty, context propagation, false-positive discipline, evaluation
- `agency-senior-developer`: executable handoffs, mutation evidence, failure propagation, package/CI behavior
- `agency-inclusive-visuals-specialist`: conditional protection of identity-sensitive details when the cleaned text is itself a visual prompt or creative brief involving people

The encoded review rules live in `skills/avoid-ai-writing-router/references/agency-role-lenses.md`.

The representation lens is conditional. It protects cultural, geographic, age, disability, attire, lighting, physical-reality, and anti-stereotype meaning in visual prompts without turning ordinary writing cleanup into a visual-generation workflow.

## Local marketplace

The repo marketplace entry is `.agents/plugins/marketplace.json` and points to the repository root. ChatGPT and Codex discover the native manifest at `.codex-plugin/plugin.json`.

## Validation

Run:

```bash
python3 skills/avoid-ai-writing-router/scripts/validate_connections.py .
python3 scripts/validate-openai-plugin.py . --json
python3 scripts/package-openai-plugin.py . /tmp/avoid-ai-writing.zip --json
```

The connection validator fails on dangling graph nodes, missing incoming/outgoing routes, terminal-node leaks, unbounded graph cycles, missing handoff references, legacy graph files, and drift between the public Skill inventory and the graph.

The packager emits a deterministic archive containing only the public Plugin surface. The connection validator itself is inside the router Skill, so the same graph check can run against a clean extracted ZIP.

The archive does not include repository CI, corpus data, development-only utilities, the Claude marketplace, or the optional external MCP server.

## Routing evals

`submission/discovery-evals.json` covers:

- direct discovery
- indirect intent
- negative triggers
- expected multi-stage paths
- repair/recheck limits
- tie breakers
- handoff fields that must persist
- conditional human-representation guards

## Source of truth

After changing the root `SKILL.md`, run:

```bash
bash scripts/sync-plugin-skill.sh
```

That updates both generated plugin copies and verifies that the Claude and OpenAI manifests match the canonical Skill version.
