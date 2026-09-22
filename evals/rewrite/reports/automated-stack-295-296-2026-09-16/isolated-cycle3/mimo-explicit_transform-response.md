## Final rewrite

Staged rollouts are preferred because they allow stopping after the first batch. A full rollout might save time, but this has not been measured.

## Changes

- Replaced "I prefer" with "are preferred" to remove first-person pronouns per the impersonal transformation request.

## Verification

- **Editing passes**: 1 (explicit transformation request)
- **Checks**: Model-only — no detector, marks normalizer, or preservation validator available.
- **Residuals**: None. The text had no AI-isms beyond the first-person pronoun, which the transformation addressed.
- **Stop reason**: Requested limit reached (`--iterate 1`).
