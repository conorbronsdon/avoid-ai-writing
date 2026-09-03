#!/usr/bin/env python3
"""Focused tests for OpenAI plugin validation."""
from __future__ import annotations

import importlib.util
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

with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    for rel in PACKAGER.INCLUDE_DIRS:
        (root / rel).mkdir()
    target = root / "outside-license.txt"
    target.write_text("must not be packaged", encoding="utf-8")
    license_path = root / "LICENSE"
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
