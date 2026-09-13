# Security Policy

## Supported versions

Security fixes target the current `main` branch and the latest [release tag](https://github.com/conorbronsdon/avoid-ai-writing/releases). Older tags are not routinely patched unless the same flaw affects a supported branch.

## Reporting a vulnerability

Do **not** file a public issue for an undisclosed security problem. This project runs in CI, pre-commit hooks, and local tooling on other people's machines; public reports can put users at risk before a fix ships.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/conorbronsdon/avoid-ai-writing/security/advisories/new) for this repository. If that form is unavailable, contact [@conorbronsdon](https://github.com/conorbronsdon) through GitHub's private communication options instead of the public issue tracker.

Include:

- Affected components (for example `detector/`, `scripts/`, `bin/`, or packaged plugin paths)
- Version, tag, or commit SHA
- Steps to reproduce and realistic impact (code execution, path traversal, supply-chain via install scripts, etc.)

## Response expectations

- **Acknowledgment** within 7 business days for reports that appear actionable.
- **Status updates** at least every 14 days until the issue is fixed, declined with explanation, or closed as duplicate.
- **Disclosure** coordinated with the reporter after a fix is available; credit on request.
