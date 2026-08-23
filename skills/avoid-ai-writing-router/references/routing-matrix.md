# Routing matrix

| User intent | Primary skill | Follow-up |
| --- | --- | --- |
| "scan", "flag only", "detect", "audit only", "score this" | `ai-writing-detector` | `false-positive-reviewer` only if interpretation becomes consequential |
| "rewrite", "remove AI-isms", "make this sound less like AI" | `voice-preserving-rewriter` | `preservation-verifier` when an original is available |
| "edit this file", "clean draft.md in place" | `file-edit-in-place` | `preservation-verifier` after the edit when before/after content is available |
| "compare before and after", "did anything important change?" | `preservation-verifier` | `voice-preserving-rewriter` only if the user asks to repair the rewrite |
| "does this prove they used AI?" | `false-positive-reviewer` | `ai-writing-detector` when fresh signal collection is requested |
| "scan, rewrite, and verify" | `avoid-ai-writing-router` | detector -> rewriter/editor -> verifier |
| explicit original skill invocation | `avoid-ai-writing` | stay in the canonical skill unless the user asks for a specialized workflow |

## Tie breakers

- A named file plus a mutation request wins over general rewrite wording.
- "Flag only" wins over generic cleanup wording.
- Consequential authorship claims always add the false-positive boundary.
- When no specialized path fits cleanly, use the original `avoid-ai-writing` skill instead of inventing a new mode.
