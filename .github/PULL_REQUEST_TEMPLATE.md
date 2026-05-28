## Summary

<!-- What does this change and why? -->

## Checklist

- [ ] `npm test` passes (engine fixtures + `CATEGORIES.md` contract check)
- [ ] If I added a detector `type`: it's documented in `detector/CATEGORIES.md` and has a fixture in `detector/patterns.test.js` (a true positive **and** a must-not-fire case)
- [ ] If I added a judgment-only rule: it's listed under "Skill-only" in `detector/CATEGORIES.md`
- [ ] I considered false positives and added carve-outs for legitimate human writing
- [ ] Any factual claim about how AI or humans write (e.g. "ChatGPT emits X", "humans rarely do Y") cites a source
- [ ] The prose I added passes the skill's own audit (no AI-writing tells, terse bullets, no hollow intensifiers)
- [ ] `CHANGELOG.md` entry added under a dated `## [X.Y.Z]` heading, and `SKILL.md` `version:` bumped if a rule changed
