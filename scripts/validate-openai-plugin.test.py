#!/usr/bin/env python3
"""Focused tests for OpenAI plugin validation."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile

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


def errors_for(policy_tail: str):
    with tempfile.TemporaryDirectory() as temp_dir:
        path = Path(temp_dir) / "openai.yaml"
        path.write_text(PREFIX + policy_tail, encoding="utf-8")
        errors = []
        MODULE.validate_agent_metadata(path, errors)
        return errors


def make_packager_root(root: Path):
    for rel in PACKAGER.INCLUDE_DIRS:
        (root / rel).mkdir()
    for rel in PACKAGER.INCLUDE_FILES:
        (root / rel).write_text(f"fixture for {rel}\n", encoding="utf-8")


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
assert errors_for("  products:\n    - CHAT\n") == []
assert any("CHAT and/or CODEX" in error for error in errors_for("  products: [API]\n"))
assert any("unknown policy key" in error for error in errors_for("  surprise: true\n"))

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

print("all OpenAI plugin validation tests passed")
