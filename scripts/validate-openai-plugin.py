#!/usr/bin/env python3
"""Validate the public ChatGPT and Codex plugin surface with stdlib only."""
from __future__ import annotations
import argparse
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import xml.etree.ElementTree as ET

SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n(.*)\Z", re.S)
TOP_LEVEL_INCLUDE_FILES = ("OPENAI_PLUGIN.md", "NOTICE.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md", "LICENSE")
CANONICAL_PROJECT_URL = "https://github.com/conorbronsdon/avoid-ai-writing"
MAX_SVG_BYTES = 256 * 1024

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
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"{path}: invalid JSON: {exc}")
        return {}
    if not isinstance(value, dict):
        errors.append(f"{path}: JSON root must be an object")
        return {}
    return value

def typed_member(mapping, key, expected_type, errors, label):
    default = {} if expected_type is dict else []
    value = mapping.get(key, default)
    if not isinstance(value, expected_type):
        kind = "object" if expected_type is dict else "array"
        errors.append(f"{label} must be an {kind}")
        return default
    return value

def validate_agent_metadata(path: Path, errors):
    text = path.read_text(encoding="utf-8")
    for token in ("interface:", "display_name:", "short_description:", "policy:", "allow_implicit_invocation:"):
        if token not in text:
            errors.append(f"{path}: missing {token}")

    lines = text.splitlines()
    policy_start = next((i for i, line in enumerate(lines) if re.fullmatch(r"policy:\s*(?:#.*)?", line)), None)
    if policy_start is None:
        return
    block = []
    for line in lines[policy_start + 1:]:
        if line and not line[0].isspace() and not line.lstrip().startswith("#"):
            break
        block.append(line)
    candidates = []
    for i, line in enumerate(block):
        match = re.match(r"^( +)([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$", line)
        if match:
            candidates.append((i, len(match.group(1)), match.group(2), match.group(3)))
    if not candidates:
        errors.append(f"{path}: policy must be a non-empty mapping")
        return
    policy_indent = min(item[1] for item in candidates)
    entries = [(i, key, value) for i, indent, key, value in candidates if indent == policy_indent]
    seen = set()
    for _, key, _ in entries:
        if key in seen:
            errors.append(f"{path}: duplicate policy key: {key}")
        seen.add(key)
    allowed_policy_keys = {"allow_implicit_invocation", "products"}
    for key in sorted(seen - allowed_policy_keys):
        errors.append(f"{path}: unknown policy key: {key}")

    entry_map = {key: (i, value) for i, key, value in entries}
    implicit = entry_map.get("allow_implicit_invocation")
    if implicit and implicit[1].split("#", 1)[0].strip() not in {"true", "false"}:
        errors.append(f"{path}: policy.allow_implicit_invocation must be true or false")

    products = entry_map.get("products")
    if products:
        product_index, raw = products
        raw = raw.split("#", 1)[0].strip()
        if raw.startswith("[") and raw.endswith("]"):
            values = [item.strip().strip('"').strip("'") for item in raw[1:-1].split(",") if item.strip()]
        elif not raw:
            next_entry = min((i for i, _, _ in entries if i > product_index), default=len(block))
            product_lines = block[product_index + 1:next_entry]
            values = []
            malformed = False
            for line in product_lines:
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                match = re.fullmatch(r"-\s*([^#]+?)(?:\s+#.*)?", stripped)
                if not match:
                    malformed = True
                    continue
                values.append(match.group(1).strip().strip('"').strip("'"))
            if malformed:
                errors.append(f"{path}: policy.products must be a YAML list")
        else:
            values = []
            errors.append(f"{path}: policy.products must be a YAML list")
        # agents/openai.yaml policy schema:
        # https://developers.openai.com/plugins/build/skills
        if not values or len(values) != len(set(values)) or not set(values).issubset({"CHAT", "CODEX"}):
            errors.append(f"{path}: policy.products must contain unique CHAT and/or CODEX values")

def check_square_svg(path: Path, errors):
    try:
        if path.stat().st_size > MAX_SVG_BYTES:
            errors.append(f"{path}: SVG exceeds 256 KiB size limit")
            return
        text = path.read_text(encoding="utf-8")
        for declaration in ("<!DOCTYPE", "<!ENTITY"):
            if declaration in text:
                errors.append(f"{path}: SVG contains forbidden XML declaration: {declaration}")
                return
        root = ET.fromstring(text)
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
    for rel in TOP_LEVEL_INCLUDE_FILES:
        path = root / rel
        if path.is_symlink():
            errors.append(f"symlink not allowed in plugin surface: {rel}")
        elif not path.is_file():
            errors.append(f"missing required top-level file: {rel}")
    manifest_dir = root / ".codex-plugin"
    manifest_path = manifest_dir / "plugin.json"
    if not manifest_path.is_file():
        return errors + ["missing .codex-plugin/plugin.json"], warnings, {}
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
    for key in ("websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"):
        value = interface.get(key)
        if not isinstance(value, str) or not value.startswith("https://") or len(value) > 1024:
            errors.append(f"interface.{key} must be an HTTPS URL")
    # Whoever the published listing points at owns the legal, support and
    # homepage destinations users land on. Those must be the repository-owned
    # canonical project, not a fork. Every public URL in the manifest has to sit
    # under that fixed root.
    author = manifest.get("author")
    author_url = author.get("url") if isinstance(author, dict) else None
    if author_url != CANONICAL_PROJECT_URL:
        errors.append(
            f"author.url must equal the canonical project URL {CANONICAL_PROJECT_URL}: {author_url!r}"
        )
    prefix = CANONICAL_PROJECT_URL.rstrip("/")
    owned = [("homepage", manifest.get("homepage")), ("repository", manifest.get("repository"))]
    owned += [(f"interface.{k}", interface.get(k)) for k in ("websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL")]
    for label, value in owned:
        if isinstance(value, str) and not (value.rstrip("/") == prefix or value.startswith(prefix + "/")):
            errors.append(f"{label} does not point at the canonical project {prefix}: {value}")
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
        if name:
            if name in names:
                errors.append(f"duplicate skill name {name!r}: {names[name]} and {skill_dir.name}")
            names[name] = skill_dir.name
        agent = skill_dir / "agents" / "openai.yaml"
        if not agent.is_file():
            errors.append(f"{skill_dir}: missing agents/openai.yaml")
        else:
            validate_agent_metadata(agent, errors)
    canonical = root / "SKILL.md"
    openai_copy = skills_root / "avoid-ai-writing" / "SKILL.md"
    if canonical.is_file():
        if not openai_copy.is_file():
            errors.append("skills/avoid-ai-writing/SKILL.md missing; cannot check drift from root SKILL.md")
        elif canonical.read_bytes() != openai_copy.read_bytes():
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
        positive_tests = typed_member(tests, "positive", list, errors, "submission reviewer tests positive")
        negative_tests = typed_member(tests, "negative", list, errors, "submission reviewer tests negative")
        if len(positive_tests) < 5:
            errors.append("submission reviewer tests need at least five positive cases")
        if len(negative_tests) < 3:
            errors.append("submission reviewer tests need at least three negative cases")
        listing = load_json(submission / "listing.json", errors)
        source = typed_member(listing, "source", dict, errors, "submission listing source")
        # baseCommit is the origin/main commit the port was last synced against.
        # It may lag origin/main, but it must remain in this branch's history.
        base_commit = source.get("baseCommit")
        if not isinstance(base_commit, str) or not re.fullmatch(r"[0-9a-f]{40}", base_commit):
            errors.append("submission listing source.baseCommit must be a full lowercase commit SHA")
        else:
            ancestry = subprocess.run(
                ["git", "-C", str(root), "merge-base", "--is-ancestor", base_commit, "HEAD"],
                capture_output=True,
                text=True,
            )
            if ancestry.returncode != 0:
                detail = ancestry.stderr.strip()
                suffix = f": {detail}" if detail else ""
                errors.append(f"submission listing baseCommit is not an ancestor of HEAD: {base_commit}{suffix}")
        fields = typed_member(listing, "fields", dict, errors, "submission listing fields")
        # submission/listing.json restates the manifest. Three fields used to be
        # gated here and the rest were free to drift, which is how a listing can
        # ship a different developer name or support URL than the manifest it
        # claims to describe. The manifest is the source; every duplicated field
        # is asserted against it.
        for listing_key, manifest_key in (
            ("name", "displayName"),
            ("subtitle", "shortDescription"),
            ("description", "longDescription"),
            ("category", "category"),
            ("developerName", "developerName"),
            ("websiteURL", "websiteURL"),
            ("supportURL", "supportURL"),
            ("privacyPolicyURL", "privacyPolicyURL"),
            ("termsOfServiceURL", "termsOfServiceURL"),
            ("capabilities", "capabilities"),
            ("logo", "logo"),
            ("composerIcon", "composerIcon"),
            ("brandColor", "brandColor"),
        ):
            if fields.get(listing_key) != interface.get(manifest_key):
                errors.append(f"submission listing {listing_key} drifted from manifest interface.{manifest_key}")
        if fields.get("starterPrompts") != interface.get("defaultPrompt"):
            errors.append("submission listing starterPrompts drifted from manifest interface.defaultPrompt")
        if fields.get("version") != version:
            errors.append("submission listing version drifted from manifest")
        if fields.get("packageName") != manifest.get("name"):
            errors.append("submission listing packageName drifted from manifest name")
        # The "checks" block records character counts as evidence for the
        # submission portal's limits. Hand-maintained counts go stale the first
        # time a field is edited, so derive them instead of trusting them.
        checks = typed_member(listing, "checks", dict, errors, "submission listing checks")
        for check_key, source in (
            ("nameCharacters", fields.get("name")),
            ("subtitleCharacters", fields.get("subtitle")),
            ("descriptionCharacters", fields.get("description")),
            ("developerNameCharacters", fields.get("developerName")),
        ):
            if isinstance(source, str) and check_key in checks and checks[check_key] != len(source):
                errors.append(f"submission listing {check_key} says {checks[check_key]}, actual {len(source)}")
        for check_key, source in (
            ("starterPromptCharacters", fields.get("starterPrompts")),
            ("capabilityCharacters", fields.get("capabilities")),
        ):
            if isinstance(source, list) and check_key in checks:
                actual = [len(item) for item in source if isinstance(item, str)]
                if checks[check_key] != actual:
                    errors.append(f"submission listing {check_key} says {checks[check_key]}, actual {actual}")
        identity = typed_member(listing, "publisherIdentity", dict, errors, "submission listing publisherIdentity")
        if identity.get("packagePublisher") != interface.get("developerName"):
            errors.append("submission listing packagePublisher drifted from manifest interface.developerName")
        pack = load_json(submission / "submission-pack.json", errors)
        pack_source = typed_member(pack, "source", dict, errors, "submission pack source")
        if pack_source.get("canonicalSkillVersion") != version:
            errors.append("submission pack canonicalSkillVersion drifted from manifest version")
        if pack_source.get("baseCommit") != base_commit:
            errors.append("submission pack baseCommit drifted from submission listing")
    # Scanning the whole checkout means walking .git (thousands of objects, and
    # loose refs that look nothing like the plugin surface). Only the packaged
    # surface is in scope here; keep this list aligned with
    # scripts/package-openai-plugin.py's INCLUDE_DIRS.
    scan_roots = [root / name for name in (".codex-plugin", "skills", "assets", "submission")]
    for scan_root in scan_roots:
        if not scan_root.is_dir():
            continue
        for path in scan_root.rglob("*"):
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
