# Support

For bugs, routing problems, false positives, packaging issues, or ChatGPT and Codex plugin problems, open an issue at:

https://github.com/conorbronsdon/avoid-ai-writing/issues

Include the plugin version, the host surface you used, the expected behavior, and a minimal reproduction. Do not post confidential drafts or personal information in a public issue.

For security vulnerabilities, do not use the public issue tracker. Follow
[SECURITY.md](SECURITY.md) and use GitHub private vulnerability reporting.

## Static skill scanners

NVIDIA SkillSpector v2.12.0 (`--no-llm`) reported the following findings when scanning v3.38.0 of this skill. These specific matches were reviewed as false positives:

- The `<!-- reference-loading:start -->` and `<!-- patterns:... -->` comments are build markers. The instruction between them is visible text. Some scanners match a keyword substring (for example "get" in "targeted") across two comments and report "hidden instructions" (NVIDIA/SkillSpector#297).
- `references/patterns.md` talks about deleting and dropping quoted phrases, because that is what the skill does. Some scanners read removal verbs near quotes as possible obfuscation and mark the file as partially analyzed (NVIDIA/SkillSpector#868). In this reported case, the trigger was removal vocabulary, not file size.

If you vendor the skill, review new findings independently and baseline or suppress only the specific matches you have verified. An incomplete-analysis warning still indicates reduced scan coverage, even when its trigger is benign. Suppressing that warning does not restore the missing coverage.
