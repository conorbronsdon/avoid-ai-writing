---
name: false-positive-reviewer
description: Use when a user asks what AI-writing flags mean, whether detector output proves AI authorship, or wants a careful interpretation of possible false positives, especially for academic, hiring, publication, disciplinary, or other consequential decisions.
---

# False-Positive Reviewer

Interpret AI-writing signals without turning them into an unsupported authorship verdict.

## Authority

Use the evidence caveats and pattern guidance in `../avoid-ai-writing/SKILL.md`. The original skill explicitly treats flags as writing-quality signals, not proof of who or what wrote the text.

## Workflow

1. Identify which observations are deterministic detector hits, model-only editorial observations, or contextual facts supplied by the user.
2. Explain the strongest signals and the plausible human reasons they can appear.
3. Consider genre, second-language writing, technical register, deadline pressure, editing tools, typography software, and the writer's known baseline when those facts are available.
4. If the user needs a fresh pattern audit, hand off to `ai-writing-detector`.
5. For consequential decisions, refuse to turn the score or pattern list into a definitive claim of AI use, cheating, fraud, or dishonesty.
6. Suggest evidence that would be more probative for the user's legitimate goal, such as source history, drafts, revision logs, direct discussion with the writer, or task-specific process evidence.

## Output

Distinguish what the text actually shows, what it may suggest, what it cannot establish, and what additional evidence would reduce uncertainty.
