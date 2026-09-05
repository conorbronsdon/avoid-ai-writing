#!/usr/bin/env python3
"""Focused subprocess tests for cross-Skill connection validation."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
VALIDATOR = Path(__file__).with_name("validate_connections.py").resolve()
REPO_ROOT = VALIDATOR.parents[3]
GRAPH_RELATIVE_PATH = Path(
    "skills/avoid-ai-writing-router/references/skill-graph.json"
)
BASE_GRAPH = json.loads((REPO_ROOT / GRAPH_RELATIVE_PATH).read_text(encoding="utf-8"))


def validate(payload: object, expected_error: str) -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        shutil.copytree(REPO_ROOT / "skills", root / "skills")
        (root / GRAPH_RELATIVE_PATH).write_text(
            json.dumps(payload), encoding="utf-8"
        )
        result = subprocess.run(
            [sys.executable, str(VALIDATOR), str(root)],
            capture_output=True,
            check=False,
            text=True,
        )
        output = result.stdout + result.stderr
        assert result.returncode != 0, output
        assert "ERROR:" in result.stdout, output
        assert expected_error in result.stdout, output
        assert "Traceback" not in output, output


validate(None, "skill graph JSON root must be an object")
validate([], "skill graph JSON root must be an object")

list_target = copy.deepcopy(BASE_GRAPH)
list_target["edges"][0]["to"] = ["avoid-ai-writing"]
validate(list_target, "edge 0 to must be a string")

object_type = copy.deepcopy(BASE_GRAPH)
object_type["edges"][0]["type"] = {"name": "ROUTE"}
validate(object_type, "edge 0 type must be a string")

print("all Skill connection validation tests passed")
