#!/usr/bin/env bash
# Guard against count drift in the README. Both counts are derived facts, so each
# lives in exactly one user-facing place and is asserted against SKILL.md here:
#
#   "**NN pattern categories**"        <- the detection catalog
#   "**NN-entry word replacement table"  <- the Tier 1/2/3 word tables
#
# Run in CI so adding a pattern or a word without bumping the README is a red
# check, not silent rot.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill="$repo_root/SKILL.md"
readme="$repo_root/README.md"

# Detection categories = the `###` entries under "## What to remove or fix",
# minus the writer-side tests (judgment checks with no detectable form):
# paragraph-reshuffle immunity, treadmill effect, and rewrite-vs-patch.
detection_count="$(awk '
  /^## What to remove or fix/ { inside = 1; next }
  /^## / { inside = 0 }
  inside && /^### / {
    if ($0 ~ /\(structure test\)/) next
    if ($0 ~ /\(content test\)/) next
    if ($0 ~ /^### When to rewrite from scratch/) next
    n++
  }
  END { print n + 0 }
' "$skill")"

# The single user-facing count literal.
readme_count="$(sed -n 's/.*\*\*\([0-9][0-9]*\) pattern categories\*\*.*/\1/p' "$readme" | head -n1)"

if [ -z "$readme_count" ]; then
  echo "could not find the '**NN pattern categories**' bullet in README.md" >&2
  exit 1
fi

if [ "$detection_count" != "$readme_count" ]; then
  echo "pattern-count drift: SKILL.md has $detection_count detection categories, README says $readme_count" >&2
  echo "Update the '**NN pattern categories**' bullet in README.md to $detection_count (or fix SKILL.md)." >&2
  exit 1
fi

echo "pattern count in sync: $detection_count"

# Word-table entries = data rows across the Tier 1/2/3 word tables. The Tier 3
# *phrases* table is counted separately in the README bullet, so it is excluded.
#
# Header rows are identified positionally — a table's header is the row before
# its `|---|---|` separator — rather than by label. The tables do not agree on a
# label (Tier 1/2 use "| Replace | With |", Tier 3 uses "| Word | What to do |"),
# and matching a hardcoded label silently counts the others' headers as data.
read -r t1 t2 t3 <<EOF
$(awk '
  /^#### Tier 1 — /      { t = 1; sep = 0; next }
  /^#### Tier 2 — /      { t = 2; sep = 0; next }
  /^#### Tier 3 — /      { t = 3; sep = 0; next }
  /^#### Tier 3 phrases/ { t = 0; next }
  /^#### / || /^### / || /^## / { t = 0; next }
  t && /^\|/ {
    if ($0 ~ /^\|[-: ]*\|[-: ]*\|?[-: ]*$/) { sep = 1; next }   # separator row
    if (!sep) next                                              # header row
    n[t]++
  }
  END { printf "%d %d %d\n", n[1] + 0, n[2] + 0, n[3] + 0 }
' "$skill")
EOF

# Each tier must be non-empty. A zero means the scoping above stopped matching
# that tier's heading (renamed, or the em-dash changed) — not that every entry
# was deleted. Fail with a distinct message so nobody "fixes" a broken counter
# by pasting its wrong number into the README.
for tier in 1 2 3; do
  eval "count=\$t$tier"
  if [ "$count" -eq 0 ]; then
    echo "word-table counter found 0 entries in Tier $tier — it has stopped matching" >&2
    echo "that tier's '#### Tier N — ...' heading in SKILL.md." >&2
    echo "Fix the counter in $0, do not edit README.md." >&2
    exit 1
  fi
done

word_count=$((t1 + t2 + t3))

readme_words="$(sed -n 's/.*\*\*\([0-9][0-9]*\)-entry word replacement table.*/\1/p' "$readme" | head -n1)"

if [ -z "$readme_words" ]; then
  echo "could not find the '**NN-entry word replacement table**' bullet in README.md" >&2
  exit 1
fi

if [ "$word_count" != "$readme_words" ]; then
  echo "word-table drift: SKILL.md has $word_count word entries ($t1 + $t2 + $t3), README says $readme_words" >&2
  echo "Update the '**NN-entry word replacement table**' bullet in README.md to $word_count (or fix SKILL.md)." >&2
  exit 1
fi

echo "word-table count in sync: $word_count ($t1 + $t2 + $t3)"
