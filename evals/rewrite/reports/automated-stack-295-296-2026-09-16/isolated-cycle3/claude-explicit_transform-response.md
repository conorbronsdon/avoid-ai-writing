I'll apply the skill's editing contract: this is an explicit voice/register transformation (impersonal, no first-person pronouns) that must preserve the stated preference, reason, and uncertainty without adding new claims.

## Final rewrite

Staged rollouts are the preferred approach, since a rollout can be stopped after the first batch. A full rollout might save time, but that has not been measured.

**Changes**
- Recast "I prefer" as "Staged rollouts are the preferred approach" — same preference, no first-person pronoun.
- Recast "we can stop" as "a rollout can be stopped" — same reason, agentless.
- Recast "we have not measured that" as "that has not been measured" — same uncertainty, agentless.

**Verification**
- **Editing passes:** 1 of 1 (`--iterate 1` ceiling; no corrective pass needed).
- **Checks:** Model-only. No detector, marks normalizer, or preservation validator available in this environment; source had no curly quotes/apostrophes to normalize.
- **Residuals:** None — preference, reason, and uncertainty are all preserved; no unsupported claims added.
- **Stop reason:** Requested pass limit reached; no further edit needed within scope.
