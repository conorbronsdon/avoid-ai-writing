#!/usr/bin/env python3
"""Turn `ssot_check.py check --json` output into a readable drift report.

Reads the JSON on stdin, writes markdown to stdout. Exit code decides whether
the workflow opens an issue:

    0  every surface that could be read is in sync
    1  at least one surface carries a stale number
    2  this script could not read the checker's output (not JSON, no
       `facts` list, or no copies at all), or failed itself; the workflow
       fails the job instead of claiming drift

A surface that could not be read at all (a named repo not checked out:
repo_missing; or unreadable: unverified) is reported as NOT CHECKED and does
*not* fail the job. So is any status this script does not recognise, so a
new checker status can never count as in sync. That case is a
coverage gap, not drift, and conflating the two makes a red check meaningless.
It is always printed, never silently dropped.
"""
import json
import sys

# Statuses ssot-check emits for a copy it managed to read and compare.
REAL_DRIFT = {"drifted", "stale_entry"}
# repo_missing: a named surface repo was not checked out (ssot-check named
# repos). Like unverified, the copy was never read: not drift, not a pass.
UNREADABLE = {"unverified", "repo_missing"}


def main():
    try:
        result = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"could not parse ssot-check output: {exc}", file=sys.stderr)
        return 2

    facts = result.get("facts") if isinstance(result, dict) else None
    if not isinstance(facts, list):
        print("ssot-check output has no `facts` list", file=sys.stderr)
        return 2

    drifted, unreadable, checked = [], [], 0

    for fact in facts:
        name = fact.get("name", "?")
        canon = fact.get("canonical", {})
        cval = canon.get("value")

        # A broken canonical means the README bullet moved or was reworded.
        # That is this repo's own problem and always a hard failure.
        if fact.get("status") == "canonical_moved":
            drifted.append(
                f"- **{name}** — canonical unreadable in "
                f"`{canon.get('file')}`: {canon.get('error')}. "
                f"The pattern in `.ssot.yaml` no longer matches the README."
            )
            continue

        for copy in fact.get("copies", []):
            status = copy.get("status")
            if status in REAL_DRIFT:
                drifted.append(
                    f"- **{name}** — `{copy.get('file')}`"
                    f"{':' + str(copy['line']) if copy.get('line') else ''} "
                    f"says **{copy.get('value', '?')}**, canonical is "
                    f"**{cval}**"
                    + (f" ({copy['note']})" if copy.get("note") else "")
                )
            elif status == "in_sync":
                checked += 1
            else:
                # UNREADABLE, or a status this script does not know: never
                # count it as verified. Name an unknown status in the note.
                # ssot-check reports the *source* it tried, so a missing file
                # comes back as the bare word "local". Say what that means.
                note = copy.get("note") or ""
                if note in ("", "local"):
                    note = ("file not present on the runner — the surface repo "
                            "was renamed, moved, or failed to clone")
                if status not in UNREADABLE:
                    note = f"unrecognised checker status {status!r}; {note}"
                unreadable.append(f"- **{name}** — `{copy.get('file')}` ({note})")

    if not (drifted or unreadable or checked):
        # Zero copies seen means the manifest was never exercised: a broken
        # run, never a green "0 drifted".
        print("ssot-check output lists no copies at all", file=sys.stderr)
        return 2

    lines = []
    if drifted:
        lines.append(
            "The number moved here and these surfaces still carry the old one.\n"
        )
        lines.append("### Drifted\n")
        lines.extend(drifted)
        lines.append("")

    if unreadable:
        lines.append("### Not checked\n")
        lines.append(
            "These surfaces could not be read on the runner, so they are "
            "unverified either way — not a pass.\n"
        )
        lines.extend(unreadable)
        lines.append("")

    lines.append(
        f"_{checked} copies verified in sync · "
        f"{len(drifted)} drifted · {len(unreadable)} not checked · "
        f"ssot-check {result.get('version', '?')} on "
        f"{result.get('generated', '?')}_"
    )

    print("\n".join(lines))
    return 1 if drifted else 0


if __name__ == "__main__":
    # Exit 1 means drift and opens an issue, and Python's own exit code for an
    # uncaught exception is also 1. So any crash here (an unexpected JSON
    # shape after a checker change) exits 2: a broken run, not drift.
    try:
        code = main()
    except Exception:  # noqa: BLE001 - the exit code is the contract
        import traceback
        traceback.print_exc()
        code = 2
    sys.exit(code)
