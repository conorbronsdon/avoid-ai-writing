## Audit

The source text is three sentences reporting a factual correction about technical behavior.

**Findings:**

- **"robust"** (Tier 1A): `robust standard errors` — legitimate statistical term of art. The technical-blog profile explicitly exempts `robust` from flagging in technical context. **Intentional, not an AI-ism.**
- **"actually"** in `They are actually enabled`: functions as a correction word marking the expectation gap between the old guide and current behavior. The editing contract preserves `actually` when it names a specific correction or expectation gap. **Protected.**

No other Tier 1, 2, or 3 matches. No structural or template patterns. No em dashes, hedging, filler, or significance inflation.

## Final rewrite

The estimate uses robust standard errors. The old guide says retries are disabled. They are actually enabled when retryLimit is above zero.

## Verification

- **Editing passes:** 0 — no justified in-scope edit found
- **Checks:** model-only (detector, marks normalizer, preservation validator unavailable)
- **Residuals:** `robust` is a technical term of art exempt under the technical-blog profile; `actually` is a correction word preserved by the editing contract. Both are intentional.
- **Stop reason:** no further justified in-scope edit. The text is clean.
