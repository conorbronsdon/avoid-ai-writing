# Repository instructions for Codex

Read `CONTRIBUTING.md` and `CLAUDE.md` for repository structure, canonical files,
generated artifacts, and validation commands before making changes.

## Commit attribution

When Codex performs work at Conor Bronsdon's direction, every commit it creates
must credit both Conor and Codex. Never create or push a Codex-only commit.

- Use `Conor Bronsdon <120674402+conorbronsdon@users.noreply.github.com>` as
  the author and include `Co-authored-by: Codex <codex@openai.com>` in the message.
- If preserving a different original author, retain that author and add the
  missing Conor and Codex co-author trailers instead.
- Before pushing, inspect the author and trailers of every new commit in the
  branch. Correct missing attribution on unpublished commits before pushing.
- Preserve attribution when amending, rebasing, cherry-picking, or squashing.
  Do not rewrite shared or merged history solely to change attribution.
- This requirement applies to Codex work directed by Conor. It does not require
  adding Conor to independent contributors' commits or taking over their PRs.
