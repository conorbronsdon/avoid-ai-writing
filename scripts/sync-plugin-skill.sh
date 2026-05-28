#!/usr/bin/env bash
# Regenerate the plugin's bundled skill from the canonical root SKILL.md.
# Root SKILL.md is the single source of truth; the plugin copy is generated.
# Run this after editing SKILL.md. CI fails if the copy is out of sync.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$repo_root/SKILL.md"
dest="$repo_root/plugins/avoid-ai-writing/skills/avoid-ai-writing/SKILL.md"

cp "$src" "$dest"

# Keep plugin.json's version in lockstep with the SKILL.md frontmatter version.
# Read the version only from the first YAML frontmatter block, and strip any CR
# so a CRLF checkout can't forge a mismatch on visually-identical strings.
skill_version="$(sed -n '/^---[[:space:]]*$/,/^---[[:space:]]*$/ s/^version:[[:space:]]*//p' "$src" | head -n1 | tr -d '\r')"
if [ -z "$skill_version" ]; then
  echo "could not parse 'version:' from SKILL.md frontmatter" >&2
  exit 1
fi
plugin_version="$(
  python3 - "$repo_root/plugins/avoid-ai-writing/.claude-plugin/plugin.json" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
except FileNotFoundError:
    print(f"Missing plugin manifest: {path}", file=sys.stderr)
    sys.exit(1)
except json.JSONDecodeError as e:
    print(f"Invalid JSON in plugin manifest: {path}: {e}", file=sys.stderr)
    sys.exit(1)

version = data.get("version")
if not isinstance(version, str) or not version:
    print(f'Invalid or missing "version" in plugin manifest: {path}', file=sys.stderr)
    sys.exit(1)

print(version)
PY
)"

if [ "$skill_version" != "$plugin_version" ]; then
  echo "version mismatch: SKILL.md=$skill_version plugin.json=$plugin_version" >&2
  echo "Update plugin.json \"version\" to match SKILL.md frontmatter." >&2
  exit 1
fi

echo "synced: plugin skill + version ($skill_version)"
