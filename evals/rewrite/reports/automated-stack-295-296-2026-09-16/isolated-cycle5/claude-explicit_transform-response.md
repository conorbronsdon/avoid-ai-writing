Recasting the source into impersonal register, dropping first-person pronouns while keeping the preference, reason, and uncertainty intact.

## Final rewrite

Staged rollouts are preferred because the rollout can stop after the first batch. A full rollout might save time, but that has not been measured.

## Changes
- "I prefer" → "Staged rollouts are preferred" (removes first-person, preserves the stated preference)
- "we can stop" → "the rollout can stop" (removes first-person plural, preserves the reason)
- "we have not measured that" → "that has not been measured" (removes first-person plural, preserves the stated uncertainty)

## Verification
- **Editing passes:** 1 of 1 requested. The single pass recast the pronouns per the explicit transformation; no further justified edit remained.
- **Checks:** Model-only. No detector, marks normalizer, or preservation validator was available; quotes/apostrophes needed no normalization since none appear in the source.
- **Residuals:** None. Preference, reason, and uncertainty are all retained at their original confidence; no protected or source-blocked findings.
- **Stop reason:** No further justified in-scope edit remains after the requested transformation was applied.
