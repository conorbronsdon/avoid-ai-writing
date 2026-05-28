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
skill_version="$(sed -n 's/^version:[[:space:]]*//p' "$src" | head -n1)"
plugin_version="$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$repo_root/plugins/avoid-ai-writing/.claude-plugin/plugin.json" | head -n1)"

if [ "$skill_version" != "$plugin_version" ]; then
  echo "version mismatch: SKILL.md=$skill_version plugin.json=$plugin_version" >&2
  echo "Update plugin.json \"version\" to match SKILL.md frontmatter." >&2
  exit 1
fi

echo "synced: plugin skill + version ($skill_version)"
