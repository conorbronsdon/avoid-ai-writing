#!/usr/bin/env bash
# Regenerate cursor-rules/avoid-ai-writing.mdc from the canonical root SKILL.md.
# Root SKILL.md is the single source of truth; the Cursor rule is generated.
# Run this after editing SKILL.md. CI fails if the copy is out of sync.
#
# The rule is a copy-out artifact: users curl it into their own project's
# .cursor/rules/, where nothing else from this repo exists. Five spans in
# SKILL.md point at files in this repo, so the generator rewrites them the
# same way the claude-code-templates vendoring did (davila7/claude-code-templates#773):
#   1. "this repo measures the ratios" -> passive form (no repo to measure)
#   2. the detector/CATEGORIES.md citation -> "reverted upstream"
#   3. the node detector/validate.js mechanical check -> a manual prose check
#   4. the --style config path (scripts/check-style.js, examples/) -> apply, unverified
#   5. --style resolution by bare name out of examples/ -> a path only
# Each rewrite is anchored on the exact upstream text and FAILS LOUDLY if the
# anchor stops matching exactly once — so an upstream edit to one of those
# spans breaks CI here instead of silently shipping a wrong Cursor rule.
#
# The anchors only see spans they already know about. A brand-new SKILL.md
# section that introduces a repo path passes them untouched, so a final gate
# greps the generated body for repo-relative references and fails on any hit.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$repo_root/SKILL.md" "$repo_root/cursor-rules/avoid-ai-writing.mdc" <<'PY'
import io
import re
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
body = replace_once(
    body,
    """**Preferred: a config file.** `--style ./house.json` (or a bare name matching `examples/<name>.json`) applies a user-supplied JSON config and verifies the checkable subset of its mechanics with `node scripts/check-style.js <file> --config <path>` (exit 0 clean / 1 hard violation / 2 tool error). A config is JSON: **`register`** (voice directives you apply as written) plus **`mechanics`** (`quotes` and `latinAbbrev` hard-checkable; `headings`, `emDash`, `spellNumbersUpTo` advisory; `serialComma` model-applied). Schema and rationale: `examples/README.md`. Open the output by naming the resolved config (`Applying config examples/technical.json; checkable mechanics verified.`), the way the fallback below names its guide, so which mode ran is never ambiguous.""",
    """**Preferred: a config file.** `--style ./house.json` applies a user-supplied JSON config: **`register`** (voice directives you apply as written) plus **`mechanics`** (`quotes`, `latinAbbrev`, `headings`, `emDash`, `spellNumbersUpTo`, `serialComma`). Apply the register and enforce the mechanics as written. The upstream repo ships a deterministic checker for the checkable ones; without it, treat the mechanics as applied but unverified. Open the output by naming the config you applied, the way the fallback below names its guide, so which mode ran is never ambiguous.""",
    "span 4 (check-style.js config path)",
)
body = replace_once(
    body,
    """**Resolving `--style <arg>`.** A path, or a bare name matching `examples/<name>.json`, loads that config (apply and verify); anything else is the named-guide fallback above.""",
    """**Resolving `--style <arg>`.** A path to a JSON config loads it, and you apply it as written; anything else is the named-guide fallback above.""",
    "span 5 (--style resolution)",
)

cursor_fm = f"""---
description: Audit and rewrite content to remove AI writing patterns ("AI-isms"). Activate whenever editing prose-heavy files (Markdown, documentation, blog posts, READMEs, release notes, emails). Cursor port of the avoid-ai-writing skill v{version}. See https://github.com/conorbronsdon/avoid-ai-writing.
globs: ["**/*.md", "**/*.mdx", "**/*.txt", "**/*.rst", "**/*.adoc"]
alwaysApply: false
---

<!-- GENERATED FILE — do not edit by hand. Regenerated from ../SKILL.md by
     scripts/sync-cursor-rules.sh; CI fails when the two drift. -->
"""

# ── Portability gate (#103) ──────────────────────────────────────────
# The anchored rewrites above catch EDITS to a span they already know. A new
# SKILL.md section naming a repo path sails through them and lands in a rule
# that users curl into a project where this repo does not exist. Only `body`
# is scanned: the attribution header names scripts/sync-cursor-rules.sh and
# lives in cursor_fm, so it is exempt by construction rather than by carve-out.
#
# A reference worth blocking names a FILE: `scripts/check-style.js`,
# `examples/<name>.json`, `detector/CATEGORIES.md`. Requiring the extension is
# what keeps the gate precise, because the bare directory names collide with
# ordinary prose in this document: "docs/technical-blog" is a context pair,
# "examples/counterexamples" and "transcripts/notes" are slash-joined words.
# Exemptions, each a precision call (the last three from the #110 review):
#   - a left word boundary, so "manuscripts/x.md" is prose, not scripts/;
#     `_` counts as a word character, so "my_scripts/foo.js" is prose too
#   - anything inside an http(s) URL, which is the portable form and is also
#     what this gate's own error message tells an author to switch to
#   - a markdown link whose TARGET is an http(s) URL drops entirely (text and
#     target): [scripts/check-style.js](https://github.com/...) is the exact
#     form the error message recommends, so the gate must not block it
#   - a right boundary, so "patterns.json" cannot block via its patterns.js
#     prefix
REPO_DIRS = ("detector", "scripts", "examples", "plugins", "cursor-rules", "corpus")
# Distinctive enough to block unqualified; README.md and friends are omitted on
# purpose, since every project has them and this skill's prose names them.
REPO_FILES = ("check-style.js", "validate.js", "patterns.js", "self-scan.js",
              "CATEGORIES.md", "PROOF.md")
# Path segments may precede the final filename: every real file under plugins/
# is nested (plugins/avoid-ai-writing/SKILL.md), so without the segment loop
# that REPO_DIRS entry was a guarantee that could never fire (#110 review).
SEGMENT = r"[A-Za-z0-9_.-]+"
FILENAME = r"(?:<[^<>\s]+>|[A-Za-z0-9_.-]+)\.[A-Za-z0-9]+"
REPO_REF = re.compile(
    r"(?<![A-Za-z0-9_])(?:"
    + r"(?:" + "|".join(re.escape(d) for d in REPO_DIRS) + r")/"
    + r"(?:" + SEGMENT + r"/)*" + FILENAME
    + r"|" + "|".join(re.escape(f) for f in REPO_FILES)
    + r")(?![A-Za-z0-9])"
)
URL = re.compile(r"https?://\S+")
MD_LINK_URL = re.compile(r"\[[^\]\n]*\]\(https?://[^)\s]*\)")

def scan_line(line):
    return [m.group(0) for m in REPO_REF.finditer(URL.sub("", MD_LINK_URL.sub("", line)))]

# The review matrix from #110, asserted on every run so the regex cannot
# regress silently — an intentional change to the gate must move the case it
# changes to the other list in the same edit. Runs in <1ms; CI executes this
# script for the drift check, so the matrix rides along with no extra wiring.
MUST_BLOCK = (
    "run scripts/check-style.js against the draft",
    "see detector/CATEGORIES.md for the tiers",
    "bare validate.js and PROOF.md mentions",
    "plugins/avoid-ai-writing/SKILL.md",                # nested — the #110 hole
    "corpus/human/essay-01.md",                         # nested, two segments deep
    "./scripts/self-scan.js",
    "patterns.js, with trailing punctuation",
    "[scripts/check-style.js](see the docs)",           # link text, non-URL target
    "cursor-rules/avoid-ai-writing.mdc",
)
MUST_PASS = (
    "manuscripts/x.md",
    "my_scripts/foo.js",
    "patterns.json and validate.json",
    "docs/technical-blog is a context pair",
    "examples/counterexamples and transcripts/notes",
    "superscripts/subscripts",
    "https://github.com/conorbronsdon/avoid-ai-writing/blob/main/scripts/check-style.js",
    "[scripts/check-style.js](https://github.com/conorbronsdon/avoid-ai-writing/blob/main/scripts/check-style.js)",
    # A bare dotfile is not one of this repo's files; the #110 review ruled the
    # behavior correct and the old claim about it wrong, so it lives here now.
    "examples/.json",
    "DISPROOF.md",
)
for case in MUST_BLOCK:
    assert scan_line(case), f"gate self-test: expected a block, got a pass: {case!r}"
for case in MUST_PASS:
    assert not scan_line(case), f"gate self-test: expected a pass, got a block: {case!r}"

# The error message's count comes from len(hits), so scan_line must report
# every ref on a line, not just the first (#110 review, finding 3). A
# reversion to first-match-only scanning goes red here, not just quieter.
multi_ref = "run scripts/check-style.js then see detector/CATEGORIES.md"
assert len(scan_line(multi_ref)) == 2, \
    f"gate self-test: expected 2 hits on a two-ref line, got {scan_line(multi_ref)!r}"

leaks = []
for n, line in enumerate(body.split("\n"), 1):
    hits = scan_line(line)
    if hits:
        leaks.append((n, hits, line.strip()))
if leaks:
    offset = cursor_fm.count("\n")
    total = sum(len(hits) for _, hits, _ in leaks)
    shown = "\n".join(
        # Quote the matches themselves: a long line truncated from the left can
        # hide them (finditer, so one line with two refs reports both).
        f"  line {offset + n}: {', '.join(hits)}   in: {text[:72]}{'...' if len(text) > 72 else ''}"
        for n, hits, text in leaks[:10]
    )
    more = f"\n  ... and {len(leaks) - 10} more line(s)" if len(leaks) > 10 else ""
    sys.exit(
        f"sync-cursor-rules: {total} repo-relative reference(s) would ship in the "
        f"Cursor rule, where none of this repo's files exist. Line numbers are for the "
        f"rule that would have been generated:\n{shown}{more}\n"
        "Add a portability rewrite for the new span (see the header comment), link the "
        "full https://github.com/... URL, or reword the section so it stands alone."
    )

io.open(dst, "w", encoding="utf-8", newline="\n").write(cursor_fm + body)
print(f"synced: cursor rule (v{version}); no repo references in the ported body")
PY
