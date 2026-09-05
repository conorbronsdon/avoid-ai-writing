#!/usr/bin/env python3
"""Validate the public ChatGPT and Codex plugin surface with stdlib only."""
from __future__ import annotations
import argparse
import hashlib
import json
import sys
from pathlib import Path, PurePosixPath
import re
import subprocess
import xml.etree.ElementTree as ET

SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n(.*)\Z", re.S)
# The top-level `metadata` key only: `metadata:` at column 0 followed by
# whitespace or end of line, so `metadata:extra:` (a different plain key) is kept.
METADATA_KEY = re.compile(r"metadata:(?:\s|$)")
TOP_LEVEL_INCLUDE_FILES = ("OPENAI_PLUGIN.md", "NOTICE.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md", "LICENSE")
CANONICAL_PROJECT_URL = "https://github.com/conorbronsdon/avoid-ai-writing"
MAX_SVG_BYTES = 256 * 1024
YAML_MAPPING = re.compile(r"([A-Za-z_][A-Za-z0-9_-]*):(?:[ 	]+(.*)|$)")
AGENT_METADATA_KEYS = {
    "interface": {"display_name", "short_description", "default_prompt"},
    "policy": {"allow_implicit_invocation", "products"},
}

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

def strip_frontmatter_metadata(text: str) -> str:
    """Drop the top-level `metadata` block from SKILL.md frontmatter, byte-exact otherwise.

    Mirrors the OpenAI copy written by scripts/sync-plugin-skill.sh (which calls
    this function): the OpenAI plugin portal rejects `metadata` in SKILL.md
    ("Skill interface settings must use agents/openai.yaml"). Line endings are
    preserved; a blank line inside the metadata block does not end it; text
    without a well-formed frontmatter is returned unchanged.
    """
    match = FRONTMATTER.match(text)
    if not match:
        return text
    inner = match.group(1)
    kept, skip = [], False
    for line in inner.splitlines(keepends=True):
        if METADATA_KEY.match(line):
            skip = True
            continue
        if skip and (line[:1] in (" ", "\t", "#") or line.strip() == ""):
            continue
        skip = False
        kept.append(line)
    joined = "".join(kept)
    if skip and joined:
        # The block ran to the end of the frontmatter, so the last kept line
        # still carries the terminator that used to separate it from the block.
        # Drop exactly that terminator and keep the delimiter's own line ending
        # (the regex leaves a trailing "\r" inside the group for CRLF files).
        joined = joined[:-2] if joined.endswith("\r\n") else joined[:-1]
        if inner.endswith("\r"):
            joined += "\r"
    start, end = match.start(1), match.end(1)
    return text[:start] + joined + text[end:]


def frontmatter_has_metadata(path: Path) -> bool:
    match = FRONTMATTER.match(path.read_text(encoding="utf-8"))
    return bool(match) and any(METADATA_KEY.match(line) for line in match.group(1).split("\n"))


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
    top_keys, nested_keys = validate_yaml_shape(path, text, errors)
    for key in ("interface", "policy"):
        if key not in top_keys:
            errors.append(f"{path}: missing {key}:")
    for section, keys in (("interface", ("display_name", "short_description")), ("policy", ("allow_implicit_invocation",))):
        for key in keys:
            if key not in nested_keys.get(section, set()):
                errors.append(f"{path}: missing {key}:")

    lines = text.splitlines()
    policy_entry = next(
        ((i, (match.group(2) or "").split("#", 1)[0].strip())
         for i, line in enumerate(lines)
         if (match := YAML_MAPPING.fullmatch(line.rstrip())) and match.group(1) == "policy"),
        None,
    )
    if policy_entry and policy_entry[1]:
        errors.append(f"{path}: policy must be a non-empty mapping")
        return
    if policy_entry is None:
        return
    policy_start = policy_entry[0]
    block = []
    for line in lines[policy_start + 1:]:
        if line and not line[0].isspace() and not line.lstrip().startswith("#"):
            break
        block.append(line)
    candidates = []
    for i, line in enumerate(block):
        leading = re.match(r"^( +)", line)
        match = YAML_MAPPING.fullmatch(line[len(leading.group(1)):].rstrip()) if leading else None
        if leading and match:
            candidates.append((i, len(leading.group(1)), match.group(1), match.group(2) or ""))
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
                match = re.fullmatch(r"-\s+(.+)", stripped)
                value = parse_supported_yaml_scalar(match.group(1)) if match else None
                if value is None:
                    malformed = True
                    continue
                values.append(value)
            if malformed:
                errors.append(f"{path}: policy.products must be a YAML list")
        else:
            values = []
            errors.append(f"{path}: policy.products must be a YAML list")
        # agents/openai.yaml policy schema:
        # https://developers.openai.com/plugins/build/skills
        if not values or len(values) != len(set(values)) or not set(values).issubset({"CHAT", "CODEX"}):
            errors.append(f"{path}: policy.products must contain unique CHAT and/or CODEX values")


def parse_supported_yaml_scalar(value: str):
    """Decode the deliberately small scalar subset supported by this validator."""
    value = value.strip()
    if not value:
        return None
    if value.startswith('"'):
        escaped = False
        for index, char in enumerate(value[1:], 1):
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                remainder = value[index + 1:].strip()
                if remainder and not remainder.startswith("#"):
                    return None
                try:
                    decoded = json.loads(value[:index + 1])
                    return decoded if isinstance(decoded, str) else None
                except json.JSONDecodeError:
                    return None
        return None
    if value.startswith("'"):
        index = 1
        while index < len(value):
            if value[index] != "'":
                index += 1
                continue
            if index + 1 < len(value) and value[index + 1] == "'":
                index += 2
                continue
            remainder = value[index + 1:].strip()
            if remainder and not remainder.startswith("#"):
                return None
            return value[1:index].replace("''", "'")
        return None

    comment = re.search(r"(?:^|\s)#", value)
    scalar = value[:comment.start()].rstrip() if comment else value
    if not scalar or any(ord(char) < 32 for char in scalar):
        return None
    if scalar[0] in "-?:,[]{}#&*!|>'\"%@`":
        return None
    return None if re.search(r":(?:\s|$)|[\[\]{}]", scalar) else scalar


def supported_yaml_scalar(value: str) -> bool:
    """Return whether value uses the scalar subset supported by this validator."""
    return parse_supported_yaml_scalar(value) is not None


def valid_products_value(value: str) -> bool:
    """Accept an empty block value or the supported inline products sequence."""
    value = value.strip()
    if not value or value.startswith("#"):
        return True
    return bool(
        re.fullmatch(
            r"\[\s*(['\"]?)(?:CHAT|CODEX)\1(?:\s*,\s*(['\"]?)(?:CHAT|CODEX)\2)*\s*\](?:\s+#.*)?",
            value,
        )
    )


def validate_yaml_shape(path: Path, text: str, errors):
    """Reject lines outside the deliberately small openai.yaml schema."""
    current_section = None
    current_nested = None
    top_keys = set()
    nested_keys = {section: set() for section in AGENT_METADATA_KEYS}
    for number, raw in enumerate(text.splitlines(), 1):
        if not raw.strip():
            continue
        leading = re.match(r"^[ \t]*", raw).group(0)
        if "\t" in leading:
            errors.append(f"{path}: malformed YAML line {number}: tabs are not valid indentation")
            current_nested = None
            continue
        if raw.lstrip().startswith("#"):
            continue
        indent = len(leading)
        stripped = raw.strip()
        if indent == 0:
            match = YAML_MAPPING.fullmatch(raw.rstrip())
            if not match:
                errors.append(f"{path}: malformed YAML line {number}: expected top-level mapping")
                current_section = None
                current_nested = None
                continue
            key, value = match.groups()
            value = value or ""
            if key in top_keys:
                errors.append(f"{path}: duplicate top-level key: {key}")
            top_keys.add(key)
            if key not in AGENT_METADATA_KEYS:
                errors.append(f"{path}: unknown top-level key: {key}")
                current_section = None
            elif value.strip() and not value.strip().startswith("#"):
                errors.append(f"{path}: malformed YAML line {number}: {key} must be a mapping")
                current_section = None
            else:
                current_section = key
            current_nested = None
            continue
        if indent == 2:
            current_nested = None
            if current_section is None:
                errors.append(f"{path}: malformed YAML line {number}: indented value has no parent mapping")
                continue
            match = YAML_MAPPING.fullmatch(stripped)
            if not match:
                errors.append(f"{path}: malformed YAML line {number}: expected key/value mapping")
                continue
            key, value = match.groups()
            value = value or ""
            if key not in AGENT_METADATA_KEYS[current_section]:
                errors.append(f"{path}: unknown {current_section} key: {key}")
                continue
            if key in nested_keys[current_section]:
                errors.append(f"{path}: duplicate {current_section} key: {key}")
            nested_keys[current_section].add(key)
            if current_section == "policy" and key == "products":
                if not valid_products_value(value):
                    errors.append(f"{path}: malformed YAML line {number}: unsupported products value")
                elif not value.strip() or value.strip().startswith("#"):
                    current_nested = key
            elif current_section == "policy" and key == "allow_implicit_invocation":
                if not re.fullmatch(r"(?:true|false)(?:\s+#.*)?", value.strip()):
                    errors.append(f"{path}: malformed YAML line {number}: unsupported boolean value")
            elif not supported_yaml_scalar(value):
                errors.append(f"{path}: malformed YAML line {number}: unsupported scalar value")
            continue
        if indent == 4:
            if current_section != "policy" or current_nested != "products":
                errors.append(f"{path}: malformed YAML line {number}: unexpected nested value")
                continue
            match = re.fullmatch(r"-\s+(.+)", stripped)
            if not match or not supported_yaml_scalar(match.group(1)):
                errors.append(f"{path}: malformed YAML line {number}: invalid products list item")
            continue
        if current_section is None:
            errors.append(f"{path}: malformed YAML line {number}: indented value has no parent mapping")
        else:
            errors.append(f"{path}: malformed YAML line {number}: invalid indentation")
    return top_keys, nested_keys


def graph_sha256(graph: dict) -> str:
    payload = json.dumps(graph, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def validate_routing_matrix(graph: dict, path: Path, errors):
    """Check the generated route inventory so prose cannot silently drift from the graph."""
    text = path.read_text(encoding="utf-8")
    begin = "<!-- BEGIN GENERATED GRAPH ROUTES -->"
    end = "<!-- END GENERATED GRAPH ROUTES -->"
    if begin not in text or end not in text:
        errors.append(f"{path}: missing generated graph route inventory")
        return
    generated = text.split(begin, 1)[1].split(end, 1)[0].strip()
    expected_lines = [
        f"<!-- skill-graph-sha256: {graph_sha256(graph)} -->",
        "| Type | From | To | When | Max reentries |",
        "| --- | --- | --- | --- | --- |",
    ]
    edges = graph.get("edges", [])
    if not isinstance(edges, list):
        errors.append("router skill graph edges must be an array")
        return
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            errors.append(f"router skill graph edge {index} must be an object")
            continue
        malformed = False
        for key in ("type", "from", "to", "when"):
            if not isinstance(edge.get(key), str) or not edge[key].strip():
                errors.append(f"router skill graph edge {index} {key} must be a non-empty string")
                malformed = True
        limit = edge.get("max_reentries", "")
        if limit != "" and (not isinstance(limit, int) or isinstance(limit, bool)):
            errors.append(f"router skill graph edge {index} max_reentries must be an integer")
            malformed = True
        if malformed:
            continue
        expected_lines.append(
            f"| {edge.get('type', '')} | `{edge.get('from', '')}` | `{edge.get('to', '')}` | "
            f"`{edge.get('when', '')}` | {limit} |"
        )
    expected = "\n".join(expected_lines)
    if generated != expected:
        errors.append(f"{path}: generated graph route inventory drifted from skill-graph.json")

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
    if root.tag.split("}")[-1] != "svg":
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
        if frontmatter_has_metadata(skill_path):
            errors.append(
                f"{skill_path}: `metadata` in SKILL.md frontmatter is rejected by the OpenAI plugin portal; "
                "put interface settings under `interface` in agents/openai.yaml"
            )
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
        elif strip_frontmatter_metadata(canonical.read_bytes().decode("utf-8")).encode("utf-8") != openai_copy.read_bytes():
            errors.append("skills/avoid-ai-writing/SKILL.md drifted from root SKILL.md (expected: root minus the frontmatter `metadata` block)")
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
    routing_path = skills_root / "avoid-ai-writing-router" / "references" / "routing-matrix.md"
    if not routing_path.is_file():
        errors.append("missing router routing matrix")
    elif isinstance(graph, dict) and graph:
        validate_routing_matrix(graph, routing_path, errors)
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
    parser.add_argument(
        "--strip-frontmatter-metadata",
        metavar="SKILL_MD",
        help="print SKILL_MD with the frontmatter `metadata` block removed (used by sync-plugin-skill.sh) and exit",
    )
    args = parser.parse_args()
    if args.strip_frontmatter_metadata:
        data = Path(args.strip_frontmatter_metadata).read_bytes().decode("utf-8")
        sys.stdout.buffer.write(strip_frontmatter_metadata(data).encode("utf-8"))
        return 0
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
