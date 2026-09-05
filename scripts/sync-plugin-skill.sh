#!/usr/bin/env bash
# Regenerate plugin copies from canonical repository sources.
# Root SKILL.md, detector resources, scripts/check-style.js, and examples/ are
# sources of truth.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$repo_root/SKILL.md"
claude_dest="$repo_root/plugins/avoid-ai-writing/skills/avoid-ai-writing/SKILL.md"
openai_dest="$repo_root/skills/avoid-ai-writing/SKILL.md"
patterns_src="$repo_root/detector/patterns.js"
validate_src="$repo_root/detector/validate.js"
categories_src="$repo_root/detector/CATEGORIES.md"
check_style_src="$repo_root/scripts/check-style.js"
examples_src="$repo_root/examples"
canonical_skill_root="$repo_root/skills/avoid-ai-writing"
canonical_detector_dest="$canonical_skill_root/detector"
canonical_scripts_dest="$canonical_skill_root/scripts"
canonical_examples_dest="$canonical_skill_root/examples"
detector_patterns_dest="$repo_root/skills/ai-writing-detector/scripts/patterns.js"
verifier_patterns_dest="$repo_root/skills/preservation-verifier/scripts/patterns.js"
verifier_validate_dest="$repo_root/skills/preservation-verifier/scripts/validate.js"

for required in "$src" "$patterns_src" "$validate_src" "$categories_src" "$check_style_src"; do
  if [ ! -f "$required" ]; then
    echo "missing canonical source: $required" >&2
    exit 1
  fi
done
if [ ! -d "$examples_src" ]; then
  echo "missing canonical source directory: $examples_src" >&2
  exit 1
fi

mkdir -p \
  "$(dirname "$claude_dest")" \
  "$(dirname "$openai_dest")" \
  "$canonical_detector_dest" \
  "$canonical_scripts_dest" \
  "$(dirname "$detector_patterns_dest")" \
  "$(dirname "$verifier_patterns_dest")" \
  "$(dirname "$verifier_validate_dest")"

cp "$src" "$claude_dest"
# The OpenAI plugin portal rejects a `metadata` key in SKILL.md frontmatter
# ("Skill interface settings must use agents/openai.yaml"); that block carries
# agentskills.io/OpenClaw fields, so the OpenAI copy omits it and everything
# else stays byte-identical. validate-openai-plugin.py applies the same
# transform before its drift check.
awk '
  NR == 1 && $0 == "---" { fm = 1; print; next }
  fm && $0 == "---" { fm = 0; print; next }
  fm && /^metadata:/ { skip = 1; next }
  fm && skip && /^[[:blank:]]/ { next }
  { skip = 0; print }
' "$src" > "$openai_dest"
cp "$patterns_src" "$canonical_detector_dest/patterns.js"
cp "$validate_src" "$canonical_detector_dest/validate.js"
cp "$categories_src" "$canonical_detector_dest/CATEGORIES.md"
cp "$check_style_src" "$canonical_scripts_dest/check-style.js"
rm -rf "$canonical_examples_dest"
cp -R "$examples_src" "$canonical_examples_dest"
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

echo "synced: canonical Skill + bundled commands/examples + detector + preservation resources + plugin versions ($skill_version)"
