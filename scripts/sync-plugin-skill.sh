#!/usr/bin/env bash
# Regenerate plugin copies from the canonical root SKILL.md.
# Root SKILL.md is the single source of truth; plugin copies are generated.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$repo_root/SKILL.md"
claude_dest="$repo_root/plugins/avoid-ai-writing/skills/avoid-ai-writing/SKILL.md"
openai_dest="$repo_root/skills/avoid-ai-writing/SKILL.md"

mkdir -p "$(dirname "$claude_dest")" "$(dirname "$openai_dest")"
cp "$src" "$claude_dest"
cp "$src" "$openai_dest"

skill_version="$(sed -n '/^---[[:space:]]*$/,/^---[[:space:]]*$/ s/^version:[[:space:]]*//p' "$src" | head -n1 | tr -d '\r')"
if [ -z "$skill_version" ]; then
  echo "could not parse 'version:' from SKILL.md frontmatter" >&2
  exit 1
fi

read_manifest_version() {
  python3 - "$1" <<'PY'
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
}

claude_version="$(read_manifest_version "$repo_root/plugins/avoid-ai-writing/.claude-plugin/plugin.json")"
openai_version="$(read_manifest_version "$repo_root/.codex-plugin/plugin.json")"

if [ "$skill_version" != "$claude_version" ]; then
  echo "version mismatch: SKILL.md=$skill_version Claude plugin=$claude_version" >&2
  exit 1
fi
if [ "$skill_version" != "$openai_version" ]; then
  echo "version mismatch: SKILL.md=$skill_version OpenAI plugin=$openai_version" >&2
  exit 1
fi

echo "synced: Claude + OpenAI plugin skills + version ($skill_version)"
