#!/usr/bin/env python3
"""Focused tests for agents/openai.yaml policy validation."""
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
print("all agents/openai.yaml policy tests passed")
