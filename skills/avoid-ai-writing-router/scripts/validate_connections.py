#!/usr/bin/env python3
"""Validate the Avoid AI Writing cross-Skill orchestration graph.

Stdlib only. Fails closed on dangling nodes/edges, missing connection contracts,
unbounded cycles, terminal-node leaks, review-lens drift, legacy graph references,
or a missing canonical fallback.
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


def first_cycle(adjacency: dict[str, list[str]]) -> list[str] | None:
    """Return one directed cycle if the graph contains one, otherwise None."""
    state: dict[str, int] = {node: 0 for node in adjacency}
    stack: list[str] = []
    positions: dict[str, int] = {}

    def visit(node: str) -> list[str] | None:
        state[node] = 1
        positions[node] = len(stack)
        stack.append(node)
        for target in adjacency.get(node, []):
            if state.get(target, 0) == 0:
                cycle = visit(target)
                if cycle:
                    return cycle
            elif state.get(target) == 1:
                start = positions[target]
                return stack[start:] + [target]
        stack.pop()
        positions.pop(node, None)
        state[node] = 2
        return None

    for node in sorted(adjacency):
        if state[node] == 0:
            cycle = visit(node)
            if cycle:
                return cycle
    return None


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    refs = root / "skills/avoid-ai-writing-router/references"
    graph_path = refs / "skill-graph.json"
    handoff_path = refs / "handoff-contract.md"
    lenses_path = refs / "agency-role-lenses.md"
    routing_path = refs / "routing-matrix.md"
    router_path = root / "skills/avoid-ai-writing-router/SKILL.md"
    errors: list[str] = []

    for path in (graph_path, handoff_path, lenses_path, routing_path, router_path):
        if not path.is_file():
            fail(errors, f"missing required orchestration file: {path.relative_to(root)}")

    legacy = refs / "skill-graph.yaml"
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
    if graph.get("handoff_contract") != "handoff-contract.md":
        fail(errors, "handoff_contract must point to handoff-contract.md")

    skills_root = root / "skills"
    if not skills_root.is_dir():
        fail(errors, "skills directory is missing")
        skill_dirs: set[str] = set()
    else:
        skill_dirs = {
            p.name
            for p in skills_root.iterdir()
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
    unbounded_adjacency: dict[str, list[str]] = {name: [] for name in graph_nodes}

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

        limit = edge.get("max_reentries")
        if limit is not None and (not isinstance(limit, int) or isinstance(limit, bool) or limit != 1):
            fail(errors, f"edge {source}->{target} has invalid max_reentries: {limit!r}")
        if edge_type in {"REPAIR", "RECHECK"} and limit != 1:
            fail(errors, f"{edge_type} edge {source}->{target} must set max_reentries to 1")

        if source in graph_nodes:
            outgoing[source] += 1
        if target in graph_nodes:
            incoming[target] += 1
        if source in graph_nodes and target in graph_nodes and limit != 1:
            unbounded_adjacency[source].append(target)

        key = (str(edge_type), str(source), str(target), str(condition))
        if key in seen_edges:
            fail(errors, f"duplicate edge: {key}")
        seen_edges.add(key)

    loop_policy = graph.get("loop_policy")
    if not isinstance(loop_policy, dict):
        fail(errors, "loop_policy must be present")
        loop_policy = {}
    else:
        if loop_policy.get("canonical_rewrite_pass_max") != 2:
            fail(errors, "canonical_rewrite_pass_max must remain 2")
        if loop_policy.get("repair_reentry_max") != 1:
            fail(errors, "repair_reentry_max must remain 1")
        if loop_policy.get("self_loops_allowed") is not False:
            fail(errors, "self_loops_allowed must be false")
        if loop_policy.get("terminal_nodes_have_no_outgoing_edges") is not True:
            fail(errors, "terminal_nodes_have_no_outgoing_edges must be true")
        if loop_policy.get("every_graph_cycle_requires_bounded_edge") is not True:
            fail(errors, "every_graph_cycle_requires_bounded_edge must be true")

    for name in graph_nodes:
        node = nodes.get(name, {})
        terminal = bool(node.get("terminal")) if isinstance(node, dict) else False
        if name not in {entrypoint, canonical} and incoming.get(name, 0) == 0:
            fail(errors, f"Skill has no incoming orchestration edge: {name}")
        if terminal and outgoing.get(name, 0) != 0:
            fail(errors, f"terminal Skill has outgoing orchestration edges: {name}")
        if not terminal and outgoing.get(name, 0) == 0:
            fail(errors, f"non-terminal Skill has no outgoing orchestration edge: {name}")

    reviewer_node = nodes.get("false-positive-reviewer", {})
    if not isinstance(reviewer_node, dict) or reviewer_node.get("terminal") is not True:
        fail(errors, "false-positive-reviewer must remain terminal")
    else:
        router_reasons = set(reviewer_node.get("return_control_to_router_when") or [])
        expected_reasons = {"fresh_signal_collection_needed", "intent_changes_to_rewrite_or_edit"}
        if router_reasons != expected_reasons:
            fail(errors, "false-positive-reviewer router-return reasons drifted")

    unbounded_cycle = first_cycle(unbounded_adjacency)
    if unbounded_cycle:
        fail(errors, "unbounded orchestration cycle detected: " + " -> ".join(unbounded_cycle))

    fallback = graph.get("fallback")
    if not isinstance(fallback, dict) or fallback.get("skill") != canonical:
        fail(errors, "fallback must return to the canonical avoid-ai-writing Skill")

    lenses = set(graph.get("review_lenses") or [])
    if lenses != EXPECTED_LENSES:
        fail(errors, f"review_lenses mismatch: expected {sorted(EXPECTED_LENSES)}, got {sorted(lenses)}")

    lenses_text = lenses_path.read_text(encoding="utf-8")
    for lens in EXPECTED_LENSES:
        if f"`{lens}`" not in lenses_text:
            fail(errors, f"agency-role-lenses.md is missing encoded lens: {lens}")

    guards = graph.get("guards")
    if not isinstance(guards, list) or not guards:
        fail(errors, "at least one conditional guard is required")
    else:
        guard_names = {g.get("name") for g in guards if isinstance(g, dict)}
        if "human_representation_preservation" not in guard_names:
            fail(errors, "human_representation_preservation guard is required")
        if "authorship_uncertainty" not in guard_names:
            fail(errors, "authorship_uncertainty guard is required")
        for guard in guards:
            if not isinstance(guard, dict):
                continue
            lens = guard.get("review_lens")
            if lens and lens not in EXPECTED_LENSES:
                fail(errors, f"guard references unknown review lens: {lens}")

    handoff_text = handoff_path.read_text(encoding="utf-8")
    for required in (
        "return_to_router_reason",
        "Terminal Skills have no outgoing Skill edges",
        "Every graph cycle must contain an edge with `max_reentries: 1`",
    ):
        if required not in handoff_text:
            fail(errors, f"handoff contract is missing required rule: {required}")

    router_text = router_path.read_text(encoding="utf-8")
    if "references/skill-graph.json" not in router_text:
        fail(errors, "router must reference canonical skill-graph.json")
    if "skill-graph.yaml" in router_text:
        fail(errors, "router still references legacy skill-graph.yaml")
    if "references/handoff-contract.md" not in router_text:
        fail(errors, "router must reference handoff-contract.md")
    if "references/agency-role-lenses.md" not in router_text:
        fail(errors, "router must reference agency-role-lenses.md")

    skill_texts: dict[str, str] = {}
    for slug in SPECIALIZED:
        path = root / "skills" / slug / "SKILL.md"
        if not path.is_file():
            fail(errors, f"missing specialized Skill: {slug}")
            continue
        text = path.read_text(encoding="utf-8")
        skill_texts[slug] = text
        if "## Connection contract" not in text:
            fail(errors, f"{slug} is missing a Connection contract section")
        if "handoff-contract.md" not in text:
            fail(errors, f"{slug} does not reference handoff-contract.md")
        if "skill-graph.json" not in text:
            fail(errors, f"{slug} does not reference skill-graph.json")

    detector_text = skill_texts.get("ai-writing-detector", "")
    if "Do not accept a direct handoff from `false-positive-reviewer`" not in detector_text:
        fail(errors, "ai-writing-detector must explicitly reject direct reviewer handoff")

    reviewer_text = skill_texts.get("false-positive-reviewer", "")
    if "This Skill has no direct outgoing Skill edge" not in reviewer_text:
        fail(errors, "false-positive-reviewer must declare terminal behavior")
    if "return control to `avoid-ai-writing-router`" not in reviewer_text:
        fail(errors, "false-positive-reviewer must return new intents to the router")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"skill connection validation failed with {len(errors)} error(s)")
        return 1

    bounded_edges = sum(1 for edge in edges if isinstance(edge, dict) and edge.get("max_reentries") == 1)
    print(
        json.dumps(
            {
                "ok": True,
                "graph_version": graph.get("version"),
                "skills": len(graph_nodes),
                "edges": len(edges),
                "bounded_edges": bounded_edges,
                "terminal_nodes": sorted(name for name, node in nodes.items() if isinstance(node, dict) and node.get("terminal") is True),
                "review_lenses": sorted(lenses),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
