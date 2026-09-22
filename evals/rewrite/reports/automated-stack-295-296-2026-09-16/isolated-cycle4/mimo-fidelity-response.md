**Final rewrite**

The cache may reduce median latency by 12 ms if the working set fits in memory, but it did not improve p99 latency in the 40-run test.

**Changes**

- Removed the transition word "Moreover" to make the connection between the two facts more direct and blunt.

**Verification**

- **Editing passes:** 1 of 2 (initial rewrite pass).
- **Checks:** Audit was model-only; no detector, marks normalizer, or preservation validator ran.
- **Residuals:** No other justified in-scope edits remain. The conditional "may" preserves necessary technical uncertainty.
- **Stop reason:** No further justified in-scope edit; requested limit reached.
