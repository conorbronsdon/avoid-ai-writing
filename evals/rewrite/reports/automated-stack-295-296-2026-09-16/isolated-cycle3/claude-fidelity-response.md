## Final rewrite

The cache may reduce median latency by 12 ms if the working set fits in memory. It did not improve p99 latency in the 40-run test.

## Changes

- Cut the "Moreover" transition opener (filler; nothing to connect to since this is a single result, not a continuation).
- No other changes: the hedge "may" and the condition "if the working set fits in memory" carry real uncertainty, not padding, so they stay per the blunt-voice guidance. The negative finding (p99, 40-run test) is left exactly as stated — no numbers, conditions, or confidence levels were touched.

## Verification

- **Editing passes:** 1 (single targeted cut; no corrective pass needed).
- **Checks:** Model-only. No shell, detector, marks normalizer, or preservation validator was available, so the audit and the quote/apostrophe check were not mechanically verified — this text has no curly quotes or apostrophes to normalize regardless.
- **Residuals:** None. No protected, source-blocked, or intentional findings remain unaddressed.
- **Stop reason:** No further justified in-scope edit remains — the sentence is now a direct claim followed by the direct negative result, with all evidence (12 ms, "if the working set fits in memory," p99, 40-run test) intact.
