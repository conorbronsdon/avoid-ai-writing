# Release recovery

The release workflow runs only after a version change reaches `main`. Its
read-only preflight checks the version agreement, test suite, and npm package
payload before either publishing job receives write authority.

GitHub serializes release runs. Keep `queue: max`: `cancel-in-progress: false`
protects the running job but does not retain more than one pending run by
itself.

## Recover a failed npm publication

If the GitHub release exists but npm publication fails, rerun the failed jobs
from the original workflow run. A rerun keeps the original commit SHA, sees the
existing GitHub release, verifies that its tag still names that SHA, and retries
only the missing npm version. Do not merge another version bump as a recovery
mechanism, move the release tag, or reuse a version that reached the registry.

If preflight fails, no release or package exists. Fix the failure through a new
pull request, keep the intended version unchanged, then manually dispatch the
release workflow from `main`. The release environment rejects another ref.
