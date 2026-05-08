#!/usr/bin/env bash
# Avoid AI Writing GitHub Action — composite runner.
#
# What it does:
#   1. Detect changed markdown files in this PR (vs the base ref)
#   2. Filter against the user's `paths` globs and `max-files` cap
#   3. POST each file's contents to the audit API
#   4. Summarize findings as a single PR comment
#
# Why composite + bash (not a JS action):
#   The skill repo is intentionally zero-build (markdown only). Adding
#   a JS action means committing a bundled `dist/index.js`, which is
#   review noise + a maintenance surface that isn't worth it for this
#   action's narrow scope. curl + gh + jq cover the full path cleanly.
#
# Failure modes (action exits 0 on all of these — the goal is review
# signal, not blocking the PR):
#   - No markdown changes → "no files to audit" comment, done
#   - API key missing or rejected → log + exit 0 with no comment
#   - Individual file too large (>60KB or >5000 words) → skipped with
#     note in the summary, other files still audit normally
#   - Insufficient credits mid-run → partial summary + credit note
#   - Network failure on a single file → that file marked errored,
#     others continue
set -euo pipefail

if [[ -z "${AVOID_API_KEY:-}" ]]; then
  echo "::warning::AVOID_API_KEY not set — skipping audit. Set the api-key input via secrets."
  exit 0
fi

if [[ "${GITHUB_EVENT_NAME:-}" != "pull_request" && "${GITHUB_EVENT_NAME:-}" != "pull_request_target" ]]; then
  echo "::warning::This action expects to run on pull_request or pull_request_target events; got ${GITHUB_EVENT_NAME:-unknown}. Skipping."
  exit 0
fi

# Resolve base + head refs from the GitHub event payload.
base_sha="$(jq -r '.pull_request.base.sha' < "$GITHUB_EVENT_PATH")"
head_sha="$(jq -r '.pull_request.head.sha' < "$GITHUB_EVENT_PATH")"
pr_number="$(jq -r '.pull_request.number' < "$GITHUB_EVENT_PATH")"

if [[ -z "$base_sha" || "$base_sha" == "null" ]]; then
  echo "::warning::Could not resolve base SHA from event payload. Skipping."
  exit 0
fi

# Make sure both commits are fetched (actions/checkout often only
# pulls a shallow tree).
git fetch --no-tags --depth=1 origin "$base_sha" 2>/dev/null || true
git fetch --no-tags --depth=1 origin "$head_sha" 2>/dev/null || true

# Get the list of changed files. `--diff-filter=AM` keeps Added +
# Modified, drops deletes (no point auditing a file we just removed).
mapfile -t changed < <(git diff --name-only --diff-filter=AM "$base_sha" "$head_sha" 2>/dev/null || true)

# Filter against the user-supplied glob list. We intentionally don't
# use `find` here — the filter is comma-separated globs matched with
# bash `[[`, which keeps the action self-contained.
IFS=',' read -ra patterns <<< "$AVOID_PATHS"
matched=()
for f in "${changed[@]}"; do
  for p in "${patterns[@]}"; do
    p="${p# }"; p="${p% }"  # trim spaces
    # shellcheck disable=SC2053
    if [[ "$f" == $p ]]; then
      matched+=("$f")
      break
    fi
  done
done

if [[ ${#matched[@]} -eq 0 ]]; then
  echo "No markdown changes matched paths=$AVOID_PATHS. Skipping."
  echo "files-audited=0" >> "$GITHUB_OUTPUT"
  echo "files-flagged=0" >> "$GITHUB_OUTPUT"
  exit 0
fi

# Cap to max-files.
max_files="${AVOID_MAX_FILES:-10}"
if [[ ${#matched[@]} -gt $max_files ]]; then
  echo "::warning::Found ${#matched[@]} matching files; capping to $max_files (configure via max-files input)."
  matched=("${matched[@]:0:$max_files}")
fi

context="${AVOID_CONTEXT:-docs}"
api_url="${AVOID_API_URL:-https://www.avoidaiwriting.com/api/v1/audit}"

# Limits matching the server's cap (60_000 chars / 5000 words). We
# pre-check locally so a too-large file doesn't burn an API credit
# just to come back as 400.
MAX_CHARS=60000
MAX_WORDS=5000

flagged=0
audited=0
audited_list=""
flagged_list=""
skipped_list=""
errored_list=""
last_credits=""

for f in "${matched[@]}"; do
  if [[ ! -f "$f" ]]; then
    skipped_list+=$'\n'"- \`$f\` — file not present at HEAD (renamed or moved)"
    continue
  fi
  bytes=$(wc -c < "$f")
  words=$(wc -w < "$f")
  if [[ $bytes -gt $MAX_CHARS ]]; then
    skipped_list+=$'\n'"- \`$f\` — too large ($bytes bytes; cap is $MAX_CHARS)"
    continue
  fi
  if [[ $words -gt $MAX_WORDS ]]; then
    skipped_list+=$'\n'"- \`$f\` — too many words ($words; cap is $MAX_WORDS)"
    continue
  fi

  # Build the JSON body. jq handles all escaping so embedded quotes /
  # backticks / newlines in the markdown don't break the request.
  body="$(jq -n --arg t "$(cat "$f")" --arg c "$context" '{text: $t, context: $c}')"

  http_status=0
  resp_file="$(mktemp)"
  http_status=$(curl -sS -o "$resp_file" -w '%{http_code}' \
    -X POST "$api_url" \
    -H "Authorization: Bearer $AVOID_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary "$body" \
    --max-time 90 || echo "000")

  if [[ "$http_status" == "200" ]]; then
    audited=$((audited + 1))
    audited_list+=$'\n'"- \`$f\` audited"
    result="$(jq -r '.result // empty' < "$resp_file")"
    last_credits="$(jq -r '.credits // empty' < "$resp_file")"
    if [[ -n "$result" && "$result" != "null" ]]; then
      flagged=$((flagged + 1))
      flagged_list+=$'\n\n'"### \`$f\`"$'\n\n'"$result"
    fi
  elif [[ "$http_status" == "402" ]]; then
    errored_list+=$'\n'"- \`$f\` — out of API credits (run halted; remaining files skipped)"
    rm -f "$resp_file"
    break
  elif [[ "$http_status" == "401" ]]; then
    errored_list+=$'\n'"- API key rejected (\`401\`). Halting."
    rm -f "$resp_file"
    break
  else
    msg="$(jq -r '.error.message // .error // "unknown"' < "$resp_file" 2>/dev/null || echo "unknown")"
    errored_list+=$'\n'"- \`$f\` — HTTP $http_status: $msg"
  fi
  rm -f "$resp_file"
done

# Build the comment body. Always include a header so it's identifiable
# (and so a future pass could replace prior comments by header match).
comment_body="<!-- avoid-ai-writing-action -->
## ✍️ Avoid AI Writing — audit summary

Audited **$audited** changed markdown file(s); **$flagged** flagged AI writing patterns."

if [[ -n "$last_credits" ]]; then
  comment_body+=$'\n\n'"_API credits remaining: $last_credits_"
fi

if [[ -n "$flagged_list" ]]; then
  comment_body+=$'\n\n---\n\n## Findings'"$flagged_list"
fi

if [[ -n "$skipped_list" ]]; then
  comment_body+=$'\n\n---\n\n### Skipped'"$skipped_list"
fi

if [[ -n "$errored_list" ]]; then
  comment_body+=$'\n\n---\n\n### Errors'"$errored_list"
fi

comment_body+=$'\n\n---\n\n*Generated by [avoid-ai-writing](https://github.com/conorbronsdon/avoid-ai-writing). [Get an API key](https://www.avoidaiwriting.com/developers).*'

# Post the comment via gh CLI. Use a temp file for the body so the
# command line doesn't choke on long markdown.
tmp_comment="$(mktemp)"
printf '%s' "$comment_body" > "$tmp_comment"
gh pr comment "$pr_number" --body-file "$tmp_comment" --repo "$GITHUB_REPOSITORY"
rm -f "$tmp_comment"

echo "files-audited=$audited" >> "$GITHUB_OUTPUT"
echo "files-flagged=$flagged" >> "$GITHUB_OUTPUT"
