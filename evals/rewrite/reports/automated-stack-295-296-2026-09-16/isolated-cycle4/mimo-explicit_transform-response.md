**Final rewrite**

Staged rollouts are preferable because we can stop after the first batch. A full rollout might save time, but we have not measured that.

**Changes**

- Replaced first-person preference ("I prefer staged rollouts") with impersonal construction ("Staged rollouts are preferable")
- Preserved all other content: reason, comparison, and uncertainty

**Verification**

- **Editing passes:** 1 (limit: 1)
- **Checks:** Model-only (detector, marks normalizer, preservation validator unavailable)
- **Residuals:** Source text was already clean — no AI-isms, hedging, or filler detected. The single edit was the requested voice transformation, not a pattern fix.
- **Stop reason:** Requested scope completed; `--iterate 1` limit reached. No further justified in-scope edit remains.
