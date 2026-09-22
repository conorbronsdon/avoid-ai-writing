## Final rewrite

The estimate uses robust standard errors. The old guide says retries are disabled. They are actually enabled when retryLimit is above zero.

## Verification

- **Editing passes**: 0
- **Checks**: Model-only (no tools available)
- **Residuals**: None. "Robust" in "robust standard errors" is a legitimate technical statistics term (Huber-White), not ornamental use — the technical-blog profile preserves it. "Actually" marks a specific expectation gap (old guide vs. current behavior), which the rule explicitly keeps.
- **Stop reason**: No justified in-scope edit found.
