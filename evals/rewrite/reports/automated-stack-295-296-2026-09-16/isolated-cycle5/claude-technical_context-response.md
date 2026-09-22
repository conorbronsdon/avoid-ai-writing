## Final rewrite

The estimate uses robust standard errors. The old guide says retries are disabled. They are actually enabled when retryLimit is above zero.

## Verification

**Editing passes**: 0 of 2 allowed. No justified, authorized edit was found, so no pass was used.

**Checks**: Model-only audit. The detector, marks normalizer, and preservation validator did not run — no such tools are available in this session.

**Residuals**:
- "robust standard errors" — matches the Tier 1A word list, but `technical-blog` context explicitly exempts `robust` when discussing legitimate technical meaning (here, the econometric/statistical term of art, not ornamental use). Retained.
- "actually" — the pass conditions for hollow intensifiers keep `actually` when it marks a specific correction or expectation gap the sentence names. That's the case here: the old guide states retries are disabled, and "actually" flags the gap between that stated expectation and the real behavior. Retained per the source-fidelity requirement to preserve the correction.

**Stop reason**: No further justified in-scope edit exists after applying `technical-blog` context exceptions and the correction-word carve-out. Text returned unchanged.
