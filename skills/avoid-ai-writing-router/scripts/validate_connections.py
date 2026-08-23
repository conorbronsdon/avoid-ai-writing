#!/usr/bin/env python3
"""Validate the Avoid AI Writing cross-Skill orchestration graph.

Stdlib only. Fails closed on dangling nodes/edges, missing connection contracts,
unbounded repair edges, legacy graph references, or a missing canonical fallback.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ALLOWED_EDGE_TYPES = {"ROUTE", "FEED", "VERIFY", "REPAIR", "RECHECK", "ESCALATE"}
SPECIALIZED = {
    "ai-writing-detector",
    "voice-preserving-rewriter",
    "file-edit-in-place",
    "preservation-verifier",
    "false-positive-reviewer",
}
EXPECTED_LENSES = {
    "agency-software-architect",
    "agency-ai-engineer",
    "agency-senior-developer",
    "agency-inclusive-visuals-specialist",
}


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    graph_path = root / "skills/avoid-ai-writing-router/references/skill-graph.json"
    handoff_path = root / "skills/avoid-ai-writing-router/references/handoff-contract.md"
    lenses_path = root / "skills/avoid-ai-writing-router/references/agency-role-lenses.md"
    router_path = root / "skills/avoid-ai-writing-router/SKILL.md"
    errors: list[str] = []

    for path in (graph_path, handoff_path, lenses_path, router_path):
        if not path.is_file():
            fail(errors, f"missing required orchestration file: {path.relative_to(root)}")

    legacy = root / "skills/avoid-ai-writing-router/references/skill-graph.yaml"
    if legacy.exists():
        fail(errors, "legacy skill-graph.yaml must not coexist with canonical skill-graph.json")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    try:
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: invalid skill graph: {exc}")
        return 1

    if graph.get("version") != 2:
        fail(errors, "skill graph version must be 2")

    nodes = graph.get("nodes")
    if not isinstance(nodes, dict) or not nodes:
        fail(errors, "nodes must be a non-empty object")
        nodes = {}

    canonical = graph.get("canonical_authority")
    entrypoint = graph.get("entrypoint")
    if canonical != "avoid-ai-writing":
        fail(errors, "canonical_authority must be avoid-ai-writing")
    if entrypoint != "avoid-ai-writing-router":
        fail(errors, "entrypoint must be avoid-ai-writing-router")

    skill_dirs = {
        p.name
        for p in (root / "skills").iterdir()
        if p.is_dir() and (p / "SKILL.md").is_file()
    }
    graph_nodes = set(nodes)

    missing_dirs = sorted(graph_nodes - skill_dirs)
    if missing_dirs:
        fail(errors, f"graph nodes without Skill directories: {missing_dirs}")

    uncovered_public_skills = sorted(skill_dirs - graph_nodes)
    if uncovered_public_skills:
        fail(errors, f"public Skills missing from orchestration graph: {uncovered_public_skills}")

    incoming: dict[str, int] = {name: 0 for name in graph_nodes}
    outgoing: dict[str, int] = {name: 0 for name in graph_nodes}

    edges = graph.get("edges")
    if not isinstance(edges, list):
        fail(errors, "edges must be an array")
        edges = []

    seen_edges: set[tuple[str, str, str, str]] = set()
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            fail(errors, f"edge {index} must be an object")
            continue
        edge_type = edge.get("type")
        source = edge.get("from")
        target = edge.get("to")
        condition = edge.get("when")
        if edge_type not in ALLOWED_EDGE_TYPES:
            fail(errors, f"edge {index} has unsupported type: {edge_type!r}")
        if source not in graph_nodes:
            fail(errors, f"edge {index} has unknown source: {source!r}")
        if target not in graph_nodes:
            fail(errors, f"edge {index} has unknown target: {target!r}")
        if source == target and source is not None:
            fail(errors, f"edge {index} creates a self-loop on {source}")
        if not isinstance(condition, str) or not condition.strip():
            fail(errors, f"edge {index} requires a non-empty when condition")
        if source in graph_nodes:
            outgoing[source] += 1
        if target in graph_nodes:
            incoming[target] += 1
        key = (str(edge_type), str(source), str(target), str(condition))
        if key in seen_edges:
            fail(errors, f"duplicate edge: {key}")
        seen_edges.add(key)
        if edge_type in {"REPAIR", "RECHECK"}:
            limit = edge.get("max_reentries")
            if not isinstance(limit, int) or limit != 1:
                fail(errors, f"{edge_type} edge {source}->{target} must set max_reentries to 1")

    for name in graph_nodes:
        node = nodes.get(name, {})
        terminal = bool(node.get("terminal")) if isinstance(node, dict) else False
        if name not in {entrypoint, canonical} and incoming.get(name, 0) == 0:
            fail(errors, f"Skill has no incoming orchestration edge: {name}")
        if not terminal and outgoing.get(name, 0) == 0:
            fail(errors, f"non-terminal Skill has no outgoing orchestration edge: {name}")

    fallback = graph.get("fallback")
    if not isinstance(fallback, dict) or fallback.get("skill") != canonical:
        fail(errors, "fallback must return to the canonical avoid-ai-writing Skill")

    loop_policy = graph.get("loop_policy")
    if not isinstance(loop_policy, dict):
        fail(errors, "loop_policy must be present")
    else:
        if loop_policy.get("canonical_rewrite_pass_max") != 2:
            fail(errors, "canonical_rewrite_pass_max must remain 2")
        if loop_policy.get("repair_reentry_max") != 1:
            fail(errors, "repair_reentry_max must remain 1")
        if loop_policy.get("self_loops_allowed") is not False:
            fail(errors, "self_loops_allowed must be false")

    lenses = set(graph.get("review_lenses") or [])
    if lenses != EXPECTED_LENSES:
        fail(errors, f"review_lenses mismatch: expected {sorted(EXPECTED_LENSES)}, got {sorted(lenses)}")

    guards = graph.get("guards")
    if not isinstance(guards, list) or not guards:
        fail(errors, "at least one conditional guard is required")
    else:
        guard_names = {g.get("name") for g in guards if isinstance(g, dict)}
        if "human_representation_preservation" not in guard_names:
            fail(errors, "human_representation_preservation guard is required")
        for guard in guards:
            if not isinstance(guard, dict):
                continue
            lens = guard.get("review_lens")
            if lens and lens not in EXPECTED_LENSES:
                fail(errors, f"guard references unknown review lens: {lens}")

    router_text = router_path.read_text(encoding="utf-8")
    if "references/skill-graph.json" not in router_text:
        fail(errors, "router must reference canonical skill-graph.json")
    if "skill-graph.yaml" in router_text:
        fail(errors, "router still references legacy skill-graph.yaml")
    if "references/handoff-contract.md" not in router_text:
        fail(errors, "router must reference handoff-contract.md")

    for slug in SPECIALIZED:
        path = root / "skills" / slug / "SKILL.md"
        if not path.is_file():
            fail(errors, f"missing specialized Skill: {slug}")
            continue
        text = path.read_text(encoding="utf-8")
        if "## Connection contract" not in text:
            fail(errors, f"{slug} is missing a Connection contract section")
        if "handoff-contract.md" not in text:
            fail(errors, f"{slug} does not reference handoff-contract.md")
        if "skill-graph.json" not in text:
            fail(errors, f"{slug} does not reference skill-graph.json")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"skill connection validation failed with {len(errors)} error(s)")
        return 1

    print(
        json.dumps(
            {
                "ok": True,
                "graph_version": graph.get("version"),
                "skills": len(graph_nodes),
                "edges": len(edges),
                "review_lenses": sorted(lenses),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
