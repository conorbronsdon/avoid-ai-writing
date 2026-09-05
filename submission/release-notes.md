# Release notes

Initial ChatGPT and Codex plugin package for Avoid AI Writing.

The package preserves the original `avoid-ai-writing` Skill as the canonical rulebook and adds focused routing for detect-only audits, voice-preserving rewrites, named-file edits, preservation verification, false-positive interpretation, and multi-stage cleanup.

The Skill network now uses a typed Graph v2 instead of loose cross-references. It includes a shared handoff envelope for context, protected constraints, execution evidence, detector findings, verification state, risk flags, and pass limits. Routes are expressed as `ROUTE`, `FEED`, `VERIFY`, `REPAIR`, `RECHECK`, and `ESCALATE`, with conditional semantic guards that do not change the primary workflow owner.

Repair and residual-audit loops are bounded. The interpretation reviewer is terminal and returns new intents to the router rather than creating direct reviewer-detector cycles.

Four existing agency roles are encoded as review lenses without becoming public Plugin dependencies: `agency-software-architect` for graph boundaries, `agency-ai-engineer` for evidence semantics, `agency-senior-developer` for executable handoffs and failure propagation, and `agency-inclusive-visuals-specialist` for preserving representation-sensitive meaning in visual prompts and creative briefs involving people.

A packaged connection validator now checks Skill inventory against graph nodes, typed edges, incoming/outgoing coverage, terminal behavior, bounded cycles, agency-lens references, guard contracts, and cross-Skill documentation. CI runs the same validator on the repository and again on a clean extracted Plugin ZIP.

The Plugin remains skills-only. The separate `avoid-ai-writing-mcp` server is optional and is not bundled or required.

The release also adds square SVG assets, public listing metadata, reviewer cases, path-level routing evals, deterministic packaging, and CI checks for canonical Skill drift and package validity.
