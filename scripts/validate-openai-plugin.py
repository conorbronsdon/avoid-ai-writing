#!/usr/bin/env python3
"""Validate the public ChatGPT and Codex plugin surface with stdlib only."""
from __future__ import annotations
import argparse
import json
from pathlib import Path, PurePosixPath
import re
import xml.etree.ElementTree as ET

SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n(.*)\Z", re.S)

def parse_frontmatter(path: Path):
    text = path.read_text(encoding="utf-8")
    match = FRONTMATTER.match(text)
    if not match:
        return {}, ""
    meta = {}
    for line in match.group(1).splitlines():
        if ":" not in line or line.startswith((" ", "\t")):
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip('"').strip("'")
    return meta, match.group(2).strip()

def safe_rel(value: str) -> bool:
    if not value or value != value.strip() or any(ord(ch) < 32 for ch in value):
        return False
    if value.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", value):
        return False
    return ".." not in PurePosixPath(value.replace("\\", "/")).parts

def load_json(path: Path, errors):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"{path}: invalid JSON: {exc}")
        return {}

def check_square_svg(path: Path, errors):
    try:
        root = ET.fromstring(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"{path}: invalid SVG: {exc}")
        return
    if not root.tag.endswith("svg"):
        errors.append(f"{path}: root element is not svg")
        return
    def number(value):
        if value is None:
            return None
        match = re.match(r"^\s*([0-9]+(?:\.[0-9]+)?)", value)
        return float(match.group(1)) if match else None
    width, height = number(root.get("width")), number(root.get("height"))
    if width is None or height is None or width <= 0 or height <= 0 or width != height:
        errors.append(f"{path}: SVG width and height must be equal positive numbers")

def validate(root: Path):
    errors, warnings = [], []
    manifest_dir = root / ".codex-plugin"
    manifest_path = manifest_dir / "plugin.json"
    if not manifest_path.is_file():
        return ["missing .codex-plugin/plugin.json"], warnings, {}
    extras = [p.name for p in manifest_dir.iterdir() if p.name != "plugin.json"]
    if extras:
        errors.append(f".codex-plugin contains extra entries: {extras}")
    manifest = load_json(manifest_path, errors)
    version = manifest.get("version")
    if not isinstance(version, str) or not SEMVER.match(version):
        errors.append("manifest version must be strict semver")
    if manifest.get("skills") != "./skills/":
        errors.append('manifest skills must be "./skills/"')
    interface = manifest.get("interface")
    if not isinstance(interface, dict):
        errors.append("manifest interface must be an object")
        interface = {}
    for key, limit in (("displayName",30),("shortDescription",30),("longDescription",4000),("developerName",80)):
        value = interface.get(key)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"interface.{key} must be a non-empty string")
        elif "\n" in value and key != "longDescription":
            errors.append(f"interface.{key} must be one line")
        elif len(value) > limit:
            errors.append(f"interface.{key} exceeds {limit} characters")
    capabilities = interface.get("capabilities", [])
    if not isinstance(capabilities, list) or not capabilities or len(capabilities) > 20:
        errors.append("interface.capabilities must contain 1 to 20 items")
    else:
        for item in capabilities:
            if not isinstance(item, str) or not item.strip() or "\n" in item or len(item) > 120:
                errors.append(f"invalid capability: {item!r}")
    prompts = interface.get("defaultPrompt", [])
    if not isinstance(prompts, list) or not prompts or len(prompts) > 3:
        errors.append("interface.defaultPrompt must contain 1 to 3 prompts")
    else:
        normalized = []
        for item in prompts:
            if not isinstance(item, str) or not item.strip() or "\n" in item or len(item) > 128:
                errors.append(f"invalid starter prompt: {item!r}")
            normalized.append(" ".join(item.lower().split()) if isinstance(item, str) else str(item))
        if len(normalized) != len(set(normalized)):
            errors.append("starter prompts must be unique after normalization")
    for key in ("websiteURL", "privacyPolicyURL", "termsOfServiceURL"):
        value = interface.get(key)
        if not isinstance(value, str) or not value.startswith("https://") or len(value) > 1024:
            errors.append(f"interface.{key} must be an HTTPS URL")
    for key in ("composerIcon", "logo"):
        value = interface.get(key)
        if not isinstance(value, str) or not value.startswith("./") or not safe_rel(value):
            errors.append(f"interface.{key} must be a safe ./ relative path")
            continue
        target = root / value[2:]
        if not target.is_file():
            errors.append(f"interface.{key} target missing: {value}")
        elif target.suffix.lower() == ".svg":
            check_square_svg(target, errors)
    skills_root = root / "skills"
    if not skills_root.is_dir():
        return errors + ["missing skills directory"], warnings, manifest
    names = {}
    loose = sorted(p.name for p in skills_root.iterdir() if not p.is_dir())
    if loose:
        errors.append(f"skills contains non-directory entries: {loose}")
    for skill_dir in sorted(p for p in skills_root.iterdir() if p.is_dir()):
        skill_path = skill_dir / "SKILL.md"
        if not skill_path.is_file():
            errors.append(f"{skill_dir}: missing SKILL.md")
            continue
        meta, body = parse_frontmatter(skill_path)
        name, desc = meta.get("name", ""), meta.get("description", "")
        if not name or not desc or not body:
            errors.append(f"{skill_path}: name, description, and body are required")
        if name in names:
            errors.append(f"duplicate skill name {name!r}: {names[name]} and {skill_dir.name}")
        names[name] = skill_dir.name
        agent = skill_dir / "agents" / "openai.yaml"
        if not agent.is_file():
            errors.append(f"{skill_dir}: missing agents/openai.yaml")
        else:
            text = agent.read_text(encoding="utf-8")
            for token in ("interface:", "display_name:", "short_description:", "policy:", "allow_implicit_invocation:"):
                if token not in text:
                    errors.append(f"{agent}: missing {token}")
            # Keep this aligned with the ingestion contract observed by the
            # actual Plugin validator. Product targeting belongs to host/import
            # behavior, not this Skill policy mapping.
            if re.search(r"(?m)^\s*products\s*:", text):
                errors.append(f"{agent}: unsupported policy.products field")
    canonical = root / "SKILL.md"
    openai_copy = skills_root / "avoid-ai-writing" / "SKILL.md"
    if canonical.is_file():
        if canonical.read_bytes() != openai_copy.read_bytes():
            errors.append("skills/avoid-ai-writing/SKILL.md drifted from root SKILL.md")
        meta, _ = parse_frontmatter(canonical)
        if meta.get("version") != version:
            errors.append(f"canonical SKILL.md version {meta.get('version')!r} does not match manifest {version!r}")
    else:
        warnings.append("root SKILL.md not present in packaged archive; canonical-copy check skipped")
    graph_path = skills_root / "avoid-ai-writing-router" / "references" / "skill-graph.json"
    graph = load_json(graph_path, errors) if graph_path.is_file() else {}
    if not graph_path.is_file():
        errors.append("missing router skill graph v2 JSON")
    else:
        if graph.get("version") != 2:
            errors.append("router skill graph must be version 2")
        graph_nodes = graph.get("nodes")
        if not isinstance(graph_nodes, dict):
            errors.append("router skill graph nodes must be an object")
            graph_nodes = {}
        missing_from_graph = sorted(set(names) - set(graph_nodes))
        extra_graph_nodes = sorted(set(graph_nodes) - set(names))
        if missing_from_graph:
            errors.append(f"router graph missing public skills: {missing_from_graph}")
        if extra_graph_nodes:
            errors.append(f"router graph references non-public skills: {extra_graph_nodes}")
        if graph.get("canonical_authority") != "avoid-ai-writing":
            errors.append("router graph canonical_authority drifted")
        if graph.get("entrypoint") != "avoid-ai-writing-router":
            errors.append("router graph entrypoint drifted")
    # The preservation validator imports ./patterns.js for residual checks.
    # Both resources must be present in the public archive so that behavior
    # does not silently degrade after packaging.
    verifier_scripts = skills_root / "preservation-verifier" / "scripts"
    for resource in ("validate.js", "patterns.js"):
        if not (verifier_scripts / resource).is_file():
            errors.append(f"preservation-verifier missing bundled resource: scripts/{resource}")
    detector_patterns = skills_root / "ai-writing-detector" / "scripts" / "patterns.js"
    if not detector_patterns.is_file():
        errors.append("ai-writing-detector missing bundled scripts/patterns.js")
    submission = root / "submission"
    if submission.is_dir():
        tests = load_json(submission / "reviewer-tests.json", errors)
        if len(tests.get("positive", [])) < 5:
            errors.append("submission reviewer tests need at least five positive cases")
        if len(tests.get("negative", [])) < 3:
            errors.append("submission reviewer tests need at least three negative cases")
        listing = load_json(submission / "listing.json", errors)
        fields = listing.get("fields", {})
        if fields.get("name") != interface.get("displayName"):
            errors.append("submission listing name drifted from manifest")
        if fields.get("subtitle") != interface.get("shortDescription"):
            errors.append("submission listing subtitle drifted from manifest")
        if fields.get("version") != version:
            errors.append("submission listing version drifted from manifest")
    for path in root.rglob("*"):
        if path.is_symlink():
            errors.append(f"symlink not allowed in plugin surface: {path.relative_to(root)}")
        lowered = path.name.lower()
        if lowered in {".env", "id_rsa", "id_ed25519"}:
            errors.append(f"secret-shaped file not allowed: {path.relative_to(root)}")
        if "__pycache__" in path.parts or lowered.endswith((".pyc", ".pyo")):
            errors.append(f"transient Python artifact not allowed: {path.relative_to(root)}")
    return errors, warnings, {"ok": not errors,"plugin": manifest.get("name"),"version": version,"skills": sorted(names),"errors": errors,"warnings": warnings}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", nargs="?", default=".")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    errors, warnings, summary = validate(Path(args.root).resolve())
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print("OK" if not errors else "FAIL")
        for item in errors: print(f"ERROR: {item}")
        for item in warnings: print(f"WARN: {item}")
    return 1 if errors else 0

if __name__ == "__main__":
    raise SystemExit(main())
