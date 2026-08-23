#!/usr/bin/env python3
"""Build a deterministic public ChatGPT and Codex plugin ZIP."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import stat
import zipfile

INCLUDE_DIRS = [".codex-plugin", "skills", "assets"]
INCLUDE_FILES = ["OPENAI_PLUGIN.md", "NOTICE.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md", "LICENSE"]
FIXED_TIME = (2026, 1, 1, 0, 0, 0)

def collect(root: Path):
    files = []
    for rel in INCLUDE_DIRS:
        base = root / rel
        if not base.is_dir():
            raise SystemExit(f"missing required directory: {rel}")
        for path in base.rglob("*"):
            if path.is_symlink():
                raise SystemExit(f"symlink not allowed: {path.relative_to(root)}")
            if path.is_file():
                files.append(path)
    for rel in INCLUDE_FILES:
        path = root / rel
        if path.is_file():
            files.append(path)
    unique = {p.relative_to(root).as_posix(): p for p in files}
    return [(name, unique[name]) for name in sorted(unique)]

def build(root: Path, output: Path):
    entries = collect(root)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for name, path in entries:
            info = zipfile.ZipInfo(name, FIXED_TIME)
            info.create_system = 3
            mode = 0o755 if path.name.endswith((".js", ".py", ".sh")) else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return {"output": str(output),"sha256": hashlib.sha256(output.read_bytes()).hexdigest(),"entries": len(entries),"bytes": output.stat().st_size}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", nargs="?", default=".")
    parser.add_argument("output")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = build(Path(args.root).resolve(), Path(args.output).resolve())
    print(json.dumps(result, indent=2) if args.json else f"{result['output']} {result['sha256']}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
