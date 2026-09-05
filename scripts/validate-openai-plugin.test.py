#!/usr/bin/env python3
"""Focused tests for OpenAI plugin validation."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import time

sys.dont_write_bytecode = True
MODULE_PATH = Path(__file__).with_name("validate-openai-plugin.py")
SPEC = importlib.util.spec_from_file_location("validate_openai_plugin", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

PACKAGER_PATH = Path(__file__).with_name("package-openai-plugin.py")
PACKAGER_SPEC = importlib.util.spec_from_file_location("package_openai_plugin", PACKAGER_PATH)
assert PACKAGER_SPEC and PACKAGER_SPEC.loader
PACKAGER = importlib.util.module_from_spec(PACKAGER_SPEC)
PACKAGER_SPEC.loader.exec_module(PACKAGER)

PREFIX = """interface:
  display_name: Test
  short_description: Test metadata
policy:
  allow_implicit_invocation: true
"""
REPO_ROOT = Path(__file__).resolve().parent.parent


def errors_for(policy_tail: str):
    with tempfile.TemporaryDirectory() as temp_dir:
        path = Path(temp_dir) / "openai.yaml"
        path.write_text(PREFIX + policy_tail, encoding="utf-8")
        errors = []
        MODULE.validate_agent_metadata(path, errors)
        return errors


def metadata_errors(text: str):
    with tempfile.TemporaryDirectory() as temp_dir:
        path = Path(temp_dir) / "openai.yaml"
        path.write_text(text, encoding="utf-8")
        errors = []
        MODULE.validate_agent_metadata(path, errors)
        return errors


def make_packager_root(root: Path):
    for rel in PACKAGER.INCLUDE_DIRS:
        (root / rel).mkdir()
    for rel in PACKAGER.INCLUDE_FILES:
        (root / rel).write_text(f"fixture for {rel}\n", encoding="utf-8")


def make_valid_plugin_root(root: Path):
    for rel in MODULE.TOP_LEVEL_INCLUDE_FILES:
        shutil.copy2(REPO_ROOT / rel, root / rel)
    shutil.copy2(REPO_ROOT / "SKILL.md", root / "SKILL.md")
    shutil.copytree(REPO_ROOT / "references", root / "references")
    for rel in (".codex-plugin", "skills", "assets"):
        shutil.copytree(REPO_ROOT / rel, root / rel)


def validation_errors_for(*, manifest=None, tests=None, listing=None, pack=None):
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        manifest_dir = root / ".codex-plugin"
        manifest_dir.mkdir()
        (root / "skills").mkdir()
        submission = root / "submission"
        submission.mkdir()
        (manifest_dir / "plugin.json").write_text(
            json.dumps(manifest if manifest is not None else {}), encoding="utf-8"
        )
        (submission / "reviewer-tests.json").write_text(
            json.dumps(tests if tests is not None else {"positive": [], "negative": []}),
            encoding="utf-8",
        )
        (submission / "listing.json").write_text(
            json.dumps(listing if listing is not None else {
                "source": {}, "fields": {}, "checks": {}, "publisherIdentity": {},
            }),
            encoding="utf-8",
        )
        (submission / "submission-pack.json").write_text(
            json.dumps(pack if pack is not None else {"source": {}}),
            encoding="utf-8",
        )
        errors, _, _ = MODULE.validate(root)
        return errors


assert errors_for("  products: [CHAT, CODEX]\n") == []
assert errors_for('  products: ["CHAT", "CODEX"]\n') == []
assert errors_for("  products: ['CHAT', 'CODEX']\n") == []
assert errors_for("  products:\n    - CHAT\n") == []
assert errors_for('  products:\n    - "CHAT" # comment\n') == []
assert any(
    "CHAT and/or CODEX" in error
    for error in errors_for('  products:\n    - "CHAT # comment"\n')
)
assert any("CHAT and/or CODEX" in error for error in errors_for("  products: [API]\n"))
assert any("unknown policy key" in error for error in errors_for("  surprise: true\n"))
assert any(
    "policy must be a non-empty mapping" in error
    for error in metadata_errors(PREFIX.replace("policy:\n", "policy: true\n"))
)
assert any(
    "malformed YAML line" in error
    for error in errors_for("  products:\n    this is not a list item\n")
)
assert any("tabs are not valid indentation" in error for error in errors_for(" \tproducts: [CHAT]\n"))
assert any("invalid indentation" in error for error in errors_for("  products:\n - CHAT\n"))
assert any(
    "unknown interface key: policy" in error
    for error in metadata_errors(PREFIX.replace("policy:\n", "  policy:\n"))
)
assert any(
    "unknown interface key: surprise" in error
    for error in metadata_errors(PREFIX.replace("  short_description: Test metadata\n", "  short_description: Test metadata\n  surprise: value\n"))
)
assert any(
    "unknown top-level key: surprise" in error
    for error in metadata_errors(PREFIX + "surprise:\n")
)
assert any(
    "unsupported scalar value" in error
    for error in metadata_errors(PREFIX.replace("display_name: Test", "display_name: [unterminated"))
)
assert any("expected top-level mapping" in error or "expected key/value mapping" in error for error in errors_for("  products:[CHAT]\n"))
scalar_interface_errors = metadata_errors(
    """interface: true
  display_name: Test
  short_description: Test metadata
policy:
  allow_implicit_invocation: true
  products: [CHAT]
"""
)
assert any("interface must be a mapping" in error for error in scalar_interface_errors)
commented_key_errors = metadata_errors(PREFIX.replace("  short_description: Test metadata", "  # short_description: missing"))
assert any("missing short_description:" in error for error in commented_key_errors)
quoted_tokens_errors = metadata_errors(
    """interface:
  display_name: Test
  short_description: Test metadata
  default_prompt: \"policy: allow_implicit_invocation:\"
"""
)
assert any("missing policy:" in error for error in quoted_tokens_errors)
assert any("missing allow_implicit_invocation:" in error for error in quoted_tokens_errors)

with tempfile.TemporaryDirectory() as temp_dir:
    svg_path = Path(temp_dir) / "wrong-root.svg"
    svg_path.write_text(
        '<not-svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />',
        encoding="utf-8",
    )
    errors = []
    MODULE.check_square_svg(svg_path, errors)
    assert errors == [f"{svg_path}: root element is not svg"]

with tempfile.TemporaryDirectory() as temp_dir:
    matrix = Path(temp_dir) / "routing-matrix.md"
    matrix.write_text("<!-- BEGIN GENERATED GRAPH ROUTES -->\n<!-- END GENERATED GRAPH ROUTES -->\n", encoding="utf-8")
    errors = []
    MODULE.validate_routing_matrix({"edges": []}, matrix, errors)
    assert errors == [f"{matrix}: generated graph route inventory drifted from skill-graph.json"]

for invalid_edges, expected_error in (
    (None, "router skill graph edges must be an array"),
    (7, "router skill graph edges must be an array"),
    ([None], "router skill graph edge 0 must be an object"),
    ([{"type": "ROUTE"}], "router skill graph edge 0 from must be a non-empty string"),
):
    with tempfile.TemporaryDirectory() as temp_dir:
        matrix = Path(temp_dir) / "routing-matrix.md"
        matrix.write_text("<!-- BEGIN GENERATED GRAPH ROUTES -->\n<!-- END GENERATED GRAPH ROUTES -->\n", encoding="utf-8")
        errors = []
        MODULE.validate_routing_matrix({"edges": invalid_edges}, matrix, errors)
        assert expected_error in errors

with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    make_valid_plugin_root(root)
    matrix = root / "skills/avoid-ai-writing-router/references/routing-matrix.md"
    matrix.write_text(matrix.read_text(encoding="utf-8").replace("detect_or_audit_only", "changed_route"), encoding="utf-8")
    errors, _, _ = MODULE.validate(root)
    assert any("routing-matrix.md: generated graph route inventory drifted" in error for error in errors)

for invalid_edges, expected_error in (
    (None, "router skill graph edges must be an array"),
    ([None], "router skill graph edge 0 must be an object"),
):
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        make_valid_plugin_root(root)
        graph_path = root / "skills/avoid-ai-writing-router/references/skill-graph.json"
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
        graph["edges"] = invalid_edges
        graph_path.write_text(json.dumps(graph), encoding="utf-8")
        errors, _, summary = MODULE.validate(root)
        assert expected_error in errors
        assert summary["ok"] is False

with tempfile.TemporaryDirectory() as temp_dir:
    svg_path = Path(temp_dir) / "entity-expansion.svg"
    svg_path.write_text(
        """<?xml version="1.0"?>
<!DOCTYPE svg [
  <!ENTITY a "1234567890">
  <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
  <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
  <!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">
  <!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;">
  <!ENTITY f "&e;&e;&e;&e;&e;&e;&e;&e;&e;&e;">
]>
<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">&f;</svg>
""",
        encoding="utf-8",
    )
    started = time.monotonic()
    errors = []
    MODULE.check_square_svg(svg_path, errors)
    elapsed = time.monotonic() - started
    assert errors == [f"{svg_path}: SVG contains forbidden XML declaration: <!DOCTYPE"]
    assert elapsed < 1.0, f"entity-expansion SVG validation took {elapsed:.3f}s"

with tempfile.TemporaryDirectory() as temp_dir:
    svg_path = Path(temp_dir) / "oversized.svg"
    svg_path.write_bytes(
        b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">'
        + b" " * MODULE.MAX_SVG_BYTES
        + b"</svg>"
    )
    errors = []
    MODULE.check_square_svg(svg_path, errors)
    assert errors == [f"{svg_path}: SVG exceeds 256 KiB size limit"]

with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    make_valid_plugin_root(root)
    skill_dir = root / "skills" / "missing-name"
    skill_dir.mkdir()
    skill_path = skill_dir / "SKILL.md"
    skill_path.write_text(
        "---\ndescription: Fixture without a name\n---\n# Missing name\n\nTest body.\n",
        encoding="utf-8",
    )
    agents_dir = skill_dir / "agents"
    agents_dir.mkdir()
    (agents_dir / "openai.yaml").write_text(PREFIX + "  products: [CHAT]\n", encoding="utf-8")
    errors, _, _ = MODULE.validate(root)
    assert errors == [f"{skill_path}: name, description, and body are required"]

for payload in ("[]", "null"):
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        manifest_dir = root / ".codex-plugin"
        manifest_dir.mkdir()
        (root / "skills").mkdir()
        (manifest_dir / "plugin.json").write_text(payload, encoding="utf-8")
        errors, _, summary = MODULE.validate(root)
        assert any("JSON root must be an object" in error for error in errors)
        assert summary["ok"] is False

for key in ("source", "fields", "checks", "publisherIdentity"):
    for invalid in (None, [], "scalar"):
        listing = {"source": {}, "fields": {}, "checks": {}, "publisherIdentity": {}}
        listing[key] = invalid
        errors = validation_errors_for(listing=listing)
        assert any(f"submission listing {key} must be an object" in error for error in errors)

for key in ("positive", "negative"):
    for invalid in (None, {}, "scalar"):
        tests = {"positive": [], "negative": []}
        tests[key] = invalid
        errors = validation_errors_for(tests=tests)
        assert any(f"submission reviewer tests {key} must be an array" in error for error in errors)

for invalid in (None, [], "scalar"):
    errors = validation_errors_for(pack={"source": invalid})
    assert any("submission pack source must be an object" in error for error in errors)

fork_url = "https://github.com/example/avoid-ai-writing"
fork_manifest = {
    "author": {"url": fork_url},
    "homepage": fork_url,
    "repository": fork_url,
    "interface": {
        key: fork_url
        for key in ("websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL")
    },
}
fork_errors = validation_errors_for(manifest=fork_manifest)
assert any(
    "author.url" in error and MODULE.CANONICAL_PROJECT_URL in error
    for error in fork_errors
)
assert any(
    "homepage" in error and MODULE.CANONICAL_PROJECT_URL in error
    for error in fork_errors
)

with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    make_packager_root(root)
    license_path = root / "LICENSE"
    original = license_path.read_bytes()
    try:
        PACKAGER.build(root, license_path)
    except SystemExit as exc:
        assert "output path is a packaged input: LICENSE" in str(exc)
    else:
        raise AssertionError("packager accepted an output path equal to a packaged input")
    assert license_path.read_bytes() == original

with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    make_packager_root(root)
    output = root / "skills" / "plugin.zip"
    try:
        PACKAGER.build(root, output)
    except SystemExit as exc:
        assert "output path is inside included directory: skills" in str(exc)
    else:
        raise AssertionError("packager accepted an output path inside an included directory")
    assert not output.exists()

with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    make_packager_root(root)
    (root / "SUPPORT.md").unlink()
    try:
        PACKAGER.collect(root)
    except SystemExit as exc:
        assert "missing required file: SUPPORT.md" in str(exc)
    else:
        raise AssertionError("packager accepted a missing required top-level file")
    errors, _, _ = MODULE.validate(root)
    assert any("missing required top-level file: SUPPORT.md" in error for error in errors)

with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    make_packager_root(root)
    target = root / "outside-license.txt"
    target.write_text("must not be packaged", encoding="utf-8")
    license_path = root / "LICENSE"
    license_path.unlink()
    try:
        license_path.symlink_to(target)
    except (NotImplementedError, OSError) as exc:
        print(f"skipped symlink rejection test: {exc}")
    else:
        try:
            PACKAGER.collect(root)
        except SystemExit as exc:
            assert "symlink not allowed: LICENSE" in str(exc)
        else:
            raise AssertionError("packager accepted a symlinked LICENSE")
        errors, _, _ = MODULE.validate(root)
        assert any("symlink not allowed in plugin surface: LICENSE" in error for error in errors)

# The OpenAI copy of the canonical skill must drop the frontmatter `metadata`
# block (the portal rejects it) and otherwise match root SKILL.md exactly.
ROOT_SKILL = (REPO_ROOT / "SKILL.md").read_text(encoding="utf-8")
assert "\nmetadata:\n" in ROOT_SKILL, "fixture assumption: root SKILL.md carries a metadata block"
STRIPPED = MODULE.strip_frontmatter_metadata(ROOT_SKILL)
ROOT_HEAD, ROOT_BODY = ROOT_SKILL.split("\n---\n", 1)
STRIPPED_HEAD, STRIPPED_BODY = STRIPPED.split("\n---\n", 1)
assert "metadata:" not in STRIPPED_HEAD
assert "\nversion:" in STRIPPED_HEAD and "\nlicense:" in STRIPPED_HEAD and "\ncompatibility:" in STRIPPED_HEAD
assert STRIPPED_BODY == ROOT_BODY, "body must be untouched"
assert MODULE.strip_frontmatter_metadata("no frontmatter\nmetadata:\n  x: y\n") == "no frontmatter\nmetadata:\n  x: y\n"
STRIP = MODULE.strip_frontmatter_metadata
# metadata not last; a blank line inside the block; CRLF preserved; no trailing newline preserved
assert STRIP("---\nname: x\nmetadata:\n  author: y\n\n  repository: z\nlicense: MIT\n---\nBody\n") == "---\nname: x\nlicense: MIT\n---\nBody\n"
assert STRIP("---\r\nname: x\r\nmetadata:\r\n  author: y\r\n---\r\nBody\r\n") == "---\r\nname: x\r\n---\r\nBody\r\n"
assert STRIP("---\nname: x\nmetadata:\n  author: y\n---\nBody") == "---\nname: x\n---\nBody"
assert STRIP("---\nname: x\nmetadata:\n  author: y\n---\nmetadata:\n  in: body\n") == "---\nname: x\n---\nmetadata:\n  in: body\n"
# blank line before the closing delimiter survives; CRLF with metadata not last
assert STRIP("---\nname: x\nmetadata:\n  a: b\nlicense: MIT\n\n---\nBody\n") == "---\nname: x\nlicense: MIT\n\n---\nBody\n"
assert STRIP("---\r\nname: x\r\nmetadata:\r\n  a: b\r\nlicense: MIT\r\n---\r\nBody\r\n") == "---\r\nname: x\r\nlicense: MIT\r\n---\r\nBody\r\n"
# a column-zero comment inside the block belongs to it; `metadata:extra` is a different key and stays
assert STRIP("---\nname: x\nmetadata:\n  author: y\n# note\n  repository: z\nlicense: MIT\n---\nBody\n") == "---\nname: x\nlicense: MIT\n---\nBody\n"
assert STRIP("---\nname: x\nmetadata:extra: keep\n---\nBody\n") == "---\nname: x\nmetadata:extra: keep\n---\nBody\n"
# missing closing delimiter: not a frontmatter, untouched
assert STRIP("---\nname: x\nmetadata:\n  author: y\nBody\n") == "---\nname: x\nmetadata:\n  author: y\nBody\n"
# the CLI path sync-plugin-skill.sh uses must be byte-exact with the function
import subprocess
cli = subprocess.run(
    [sys.executable, str(MODULE_PATH), "--strip-frontmatter-metadata", str(REPO_ROOT / "SKILL.md")],
    capture_output=True, check=True,
)
assert cli.stdout == STRIPPED.encode("utf-8"), "CLI output differs from strip_frontmatter_metadata"
assert STRIPPED == (REPO_ROOT / "skills" / "avoid-ai-writing" / "SKILL.md").read_text(encoding="utf-8"), (
    "run bash scripts/sync-plugin-skill.sh; the OpenAI copy is out of date"
)

with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    make_valid_plugin_root(root)
    errors, _, _ = MODULE.validate(root)
    assert errors == [], errors
    # red control 1: a byte-identical copy (metadata kept) is rejected on both rules
    shutil.copy2(root / "SKILL.md", root / "skills" / "avoid-ai-writing" / "SKILL.md")
    errors, _, _ = MODULE.validate(root)
    assert any("`metadata` in SKILL.md frontmatter is rejected" in error for error in errors), errors
    assert any("drifted from root SKILL.md" in error for error in errors), errors
    # red control 2: a body edit in the copy still counts as drift
    copy = root / "skills" / "avoid-ai-writing" / "SKILL.md"
    copy.write_text(STRIPPED.replace("\n---\n", "\n---\n\nextra line\n", 1), encoding="utf-8")
    errors, _, _ = MODULE.validate(root)
    assert any("drifted from root SKILL.md" in error for error in errors), errors
    assert not any("`metadata` in SKILL.md" in error for error in errors), errors
    # red control 3: metadata in any other skill is rejected too
    copy.write_text(STRIPPED, encoding="utf-8")
    other = root / "skills" / "ai-writing-detector" / "SKILL.md"
    other.write_text(other.read_text(encoding="utf-8").replace("\n---\n", "\nmetadata:\n  author: x\n---\n", 1), encoding="utf-8")
    errors, _, _ = MODULE.validate(root)
    assert any("ai-writing-detector" in error and "`metadata` in SKILL.md" in error for error in errors), errors

print("all OpenAI plugin validation tests passed")

# Missing split references and transitive imports must fail packaged validation.
for rel in ("references/patterns.md", "scripts/markdown-prose.js", "scripts/normalize-quotes.js"):
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        make_valid_plugin_root(root)
        (root / "skills/avoid-ai-writing" / rel).unlink()
        errors, _, _ = MODULE.validate(root)
        assert any(f"missing bundled resource: {rel}" in e for e in errors), errors
print("split reference and transitive dependency negative controls passed")
