#!/usr/bin/env bash
# Regenerate plugin copies from canonical repository sources.
# Root SKILL.md, detector/patterns.js, and detector/validate.js are sources of truth.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$repo_root/SKILL.md"
claude_dest="$repo_root/plugins/avoid-ai-writing/skills/avoid-ai-writing/SKILL.md"
openai_dest="$repo_root/skills/avoid-ai-writing/SKILL.md"
patterns_src="$repo_root/detector/patterns.js"
validate_src="$repo_root/detector/validate.js"
detector_patterns_dest="$repo_root/skills/ai-writing-detector/scripts/patterns.js"
verifier_patterns_dest="$repo_root/skills/preservation-verifier/scripts/patterns.js"
verifier_validate_dest="$repo_root/skills/preservation-verifier/scripts/validate.js"

for required in "$src" "$patterns_src" "$validate_src"; do
  if [ ! -f "$required" ]; then
    echo "missing canonical source: $required" >&2
    exit 1
  fi
done

mkdir -p \
  "$(dirname "$claude_dest")" \
  "$(dirname "$openai_dest")" \
  "$(dirname "$detector_patterns_dest")" \
  "$(dirname "$verifier_patterns_dest")" \
  "$(dirname "$verifier_validate_dest")"

cp "$src" "$claude_dest"
cp "$src" "$openai_dest"
cp "$patterns_src" "$detector_patterns_dest"
cp "$patterns_src" "$verifier_patterns_dest"
cp "$validate_src" "$verifier_validate_dest"

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

echo "synced: canonical Skill + detector + preservation resources + plugin versions ($skill_version)"
