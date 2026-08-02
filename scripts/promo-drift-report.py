#!/usr/bin/env python3
"""Turn `ssot_check.py check --json` output into a readable drift report.

Reads the JSON on stdin, writes markdown to stdout. Exit code decides whether
the workflow opens an issue:

    0  every surface that could be read is in sync
    1  at least one surface carries a stale number

A surface that could not be read at all (repo renamed, moved, or a clone that
failed) is reported as NOT CHECKED and does *not* fail the job. That case is a
coverage gap, not drift, and conflating the two makes a red check meaningless.
It is always printed, never silently dropped.
"""
import json
import sys

# Statuses ssot-check emits for a copy it managed to read and compare.
REAL_DRIFT = {"drifted", "stale_entry"}
UNREADABLE = {"unverified"}


def main():
    try:
        result = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"could not parse ssot-check output: {exc}", file=sys.stderr)
        return 2

    drifted, unreadable, checked = [], [], 0

    for fact in result.get("facts", []):
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
            elif status in UNREADABLE:
                # ssot-check reports the *source* it tried, so a missing file
                # comes back as the bare word "local". Say what that means.
                note = copy.get("note") or ""
                if note in ("", "local"):
                    note = ("file not present on the runner — the surface repo "
                            "was renamed, moved, or failed to clone")
                unreadable.append(f"- **{name}** — `{copy.get('file')}` ({note})")
            else:
                checked += 1

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
    sys.exit(main())
