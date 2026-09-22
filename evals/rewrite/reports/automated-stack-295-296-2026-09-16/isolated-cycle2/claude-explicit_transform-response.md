I'll rewrite this as an impersonal decision note, converting the first-person framing to a neutral stance while keeping the preference, reason, and uncertainty intact.

## Final rewrite

Staged rollouts are preferred because they allow stopping after the first batch. A full rollout might save time, but that has not been measured.

## Verification

- **Editing passes**: 1 used (limit 1, per `--iterate 1`)
- **Checks**: model-only; the detector, marks normalizer, and preservation validator did not run (no tools available in this environment)
- **Residuals**: none found — the preference (staged rollouts), the reason (ability to stop after the first batch), and the uncertainty (unmeasured time savings of a full rollout) are all preserved
- **Stop reason**: requested limit reached (single pass); no further edit was needed to satisfy the requested transformation
