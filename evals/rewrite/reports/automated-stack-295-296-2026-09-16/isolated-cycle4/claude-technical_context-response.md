I'll audit the source for AI-isms under the technical-blog profile, then rewrite while preserving the technical meaning and the correction.

Checking findings:
- "robust standard errors" — technical-blog word-table exception explicitly exempts `robust` (it has a legitimate statistical meaning here: heteroskedasticity-robust standard errors is a term of art). No edit.
- "actually" — this is a **meaningful correction word**: it connects to an expectation stated earlier in the source ("the old guide says retries are disabled"), directly contrasting old documentation with current behavior. Per the editing contract and the word-table entry for `actually`, this is preserved, not deleted. A direct-contrast rewording ("disabled... but they are enabled") could be clearer, but the source already uses a correction structure tied to a named expectation gap, so I'm leaving the meaning intact and only tightening wording minimally.
- No other candidate patterns (no hedging, no vague attribution, no filler, no P0/P1 issues) are present.

## Final rewrite

The estimate uses robust standard errors. The old guide says retries are disabled, but they're actually enabled when retryLimit is above zero.

## Changes

- Merged the two short sentences describing the retry correction with "but" and a contraction, replacing the standalone "They are actually enabled" sentence. This is a minor clarity tightening, not an AI-ism removal — "actually" is preserved because it marks a real correction (old guide vs. current behavior), which the word-table entry explicitly allows.
- "Robust standard errors" was left untouched — it's a technical-blog exception for `robust` (established statistical term).

## Verification

- **Editing passes:** 1 (minimal wording tightening only).
- **Checks:** Model-only. No detector, marks normalizer, or preservation validator was available in this session, so quote/apostrophe normalization and automated pattern detection were not mechanically verified.
- **Residuals:** None — no protected, intentional, or source-blocked findings remain unresolved.
- **Stop reason:** No further justified in-scope edit found; the text was already close to clean once the technical-blog exception and correction-word exception were applied.
