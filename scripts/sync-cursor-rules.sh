#!/usr/bin/env bash
# Regenerate cursor-rules/avoid-ai-writing.mdc from the canonical root SKILL.md.
# Root SKILL.md is the single source of truth; the Cursor rule is generated.
# Run this after editing SKILL.md. CI fails if the copy is out of sync.
#
# The rule is a copy-out artifact: users curl it into their own project's
# .cursor/rules/, where nothing else from this repo exists. Three spans in
# SKILL.md point at files in this repo, so the generator rewrites them the
# same way the claude-code-templates vendoring did (davila7/claude-code-templates#773):
#   1. "this repo measures the ratios" -> passive form (no repo to measure)
#   2. the detector/CATEGORIES.md citation -> "reverted upstream"
#   3. the node detector/validate.js mechanical check -> a manual prose check
# Each rewrite is anchored on the exact upstream text and FAILS LOUDLY if the
# anchor stops matching exactly once — so an upstream edit to one of those
# spans breaks CI here instead of silently shipping a wrong Cursor rule.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$repo_root/SKILL.md" "$repo_root/cursor-rules/avoid-ai-writing.mdc" <<'PY'
import io
import sys

src, dst = sys.argv[1], sys.argv[2]
text = io.open(src, encoding="utf-8", newline="").read().replace("\r\n", "\n")


def replace_once(haystack, old, new, label):
    n = haystack.count(old)
    if n != 1:
        sys.exit(
            f"sync-cursor-rules: anchor for {label} found {n} times (expected 1). "
            "SKILL.md changed one of the ported spans — update this script's "
            "anchors and rewrites together."
        )
    return haystack.replace(old, new, 1)


# ── Split frontmatter from body ──────────────────────────────────────
if not text.startswith("---\n"):
    sys.exit("sync-cursor-rules: SKILL.md has no YAML frontmatter")
end = text.index("\n---\n", 4) + len("\n---\n")
fm, body = text[:end], text[end:]

version_lines = [l for l in fm.splitlines() if l.startswith("version:")]
if len(version_lines) != 1:
    sys.exit("sync-cursor-rules: expected exactly one version: line in frontmatter")
version = version_lines[0].split(":", 1)[1].strip()

# ── Portability rewrites (see header comment) ────────────────────────
body = replace_once(
    body,
    "until this repo measures the ratios itself against a machine-written corpus",
    "until the ratios are measured against a machine-written corpus",
    "span 1 (1A caveat)",
)
body = replace_once(
    body,
    "why the structural detector was reverted (see `detector/CATEGORIES.md` §C), and why",
    "why an automated structural detector for this rule was reverted upstream, and why",
    "span 2 (CATEGORIES.md citation)",
)
body = replace_once(
    body,
    """**Mechanical check (optional, recommended for edit mode).** If the repo ships the detector engine, run the preservation validator against the before and after text:

```bash
node detector/validate.js <original> <rewritten>
```

It exits non-zero when a rewrite altered a fenced code block, YAML frontmatter, a blockquote, a table cell, inline code, a URL, a file path, or the heading structure, and when the rewrite introduced more flagged patterns than it removed. Those are the promises made above; this is what checks them. Rewording a heading to fix Title Case and stripping an AI tracking parameter from a URL are carved out, because this skill instructs both.""",
    """**3. Preservation check**
Confirm the rewrite did not alter a fenced code block, YAML frontmatter, a blockquote, a table cell, inline code, a URL, a file path, or the heading structure, and that it did not introduce more flagged patterns than it removed. Those are the promises made above. Rewording a heading to fix Title Case and stripping an AI tracking parameter from a URL are the two carve-outs, because this skill instructs both.""",
    "span 3 (validate.js mechanical check)",
)

cursor_fm = f"""---
description: Audit and rewrite content to remove AI writing patterns ("AI-isms"). Activate whenever editing prose-heavy files (Markdown, documentation, blog posts, READMEs, release notes, emails). Cursor port of the avoid-ai-writing skill v{version}. See https://github.com/conorbronsdon/avoid-ai-writing.
globs: ["**/*.md", "**/*.mdx", "**/*.txt", "**/*.rst", "**/*.adoc"]
alwaysApply: false
---

<!-- GENERATED FILE — do not edit by hand. Regenerated from ../SKILL.md by
     scripts/sync-cursor-rules.sh; CI fails when the two drift. -->
"""

io.open(dst, "w", encoding="utf-8", newline="\n").write(cursor_fm + body)
print(f"synced: cursor rule (v{version})")
PY
