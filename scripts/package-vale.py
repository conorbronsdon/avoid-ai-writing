#!/usr/bin/env python3
"""Build a deterministic AvoidAIWriting.zip Vale package from vale/AvoidAIWriting/.

The zip holds the style directory at its root, the layout Vale expects for a
`Packages =` entry. Run `node scripts/build-vale.js --check` first so the
packaged style matches the detector.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import stat
import zipfile

STYLE = "AvoidAIWriting"
FIXED_TIME = (2026, 1, 1, 0, 0, 0)

def collect(style_dir: Path):
    if not style_dir.is_dir():
        raise SystemExit(f"missing style directory: {style_dir}")
    files = []
    for path in style_dir.rglob("*"):
        if path.is_symlink():
            raise SystemExit(f"symlink not allowed: {path.relative_to(style_dir.parent)}")
        if path.is_file():
            files.append((path.relative_to(style_dir.parent).as_posix(), path))
    if not any(name == f"{STYLE}/meta.json" for name, _ in files):
        raise SystemExit(f"missing {STYLE}/meta.json")
    return sorted(files)

def build(root: Path, output: Path):
    style_dir = (root / "vale" / STYLE).resolve()
    output = output.resolve()
    if output.is_relative_to(style_dir):
        raise SystemExit("output path is inside the style directory")
    entries = collect(style_dir)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for name, path in entries:
            info = zipfile.ZipInfo(name, FIXED_TIME)
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return {"output": str(output), "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "entries": len(entries), "bytes": output.stat().st_size}

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
