## Final rewrite

The estimate uses robust standard errors. The old guide says retries are disabled. They are actually enabled when retryLimit is above zero.

## Verification

- **Editing passes:** 0 (no justified in-scope edit found; text returned unchanged)
- **Checks:** Model-only. No detector, marks normalizer, or preservation validator available in this session — none of those ran.
- **Residuals:** Two candidate matches considered and passed, not edited:
  - "robust standard errors" — Tier 1A lists `robust`, but the `technical-blog` profile explicitly exempts this word as a legitimate technical term, and here it's the standard statistical term of art (robust SEs), not the AI-ism sense (strong/reliable). Preserved.
  - "actually enabled" — `actually` is flagged for deletion by default, but this instance marks a specific correction against an expectation the sentence itself names (the old guide's claim vs. the real behavior), which the pattern catalog carves out. Preserved.
- **Stop reason:** No further justified in-scope edit found; text is clean under the `technical-blog` profile.
