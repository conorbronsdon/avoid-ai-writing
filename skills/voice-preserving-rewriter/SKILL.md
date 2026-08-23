---
name: voice-preserving-rewriter
description: Use when the user asks to rewrite, humanize, clean up, or remove AI-isms from text while preserving the writer's voice, facts, intent, structure, register, and protected material.
---

# Voice-Preserving Rewriter

Rewrite text using the complete rules in `../avoid-ai-writing/SKILL.md`. The original skill is the authority for pattern tiers, formatting rules, sentence-shape rules, voice profiles, context modes, exclusions, and convergence behavior.

## Workflow

1. Identify the user's requested voice, audience, destination, and register from the prompt or supplied material.
2. Audit the text for AI-writing patterns before changing it.
3. Preserve content that already sounds human.
4. Rewrite only the spans that need work. Keep names, figures, claims, technical details, URLs, file paths, and the intended argument intact.
5. Preserve the source's rough edges when they are part of the writer's fingerprint, especially in casual writing.
6. Do not rewrite quoted material, code blocks, tables, or attributed text. Flag protected spans instead.
7. Run the canonical corrective second pass. If the user explicitly asks for convergence, obey the canonical maximum pass count.
8. When both original and rewritten content are available and deterministic verification is possible, hand off to `preservation-verifier`.

## Voice handling

When a voice is named, use the canonical profiles: casual, professional, technical, warm, or blunt. When the user provides a style guide or prior sample, prefer those concrete cues over generic polishing.

Do not make every sentence perfectly grammatical if that would erase the user's register. Do not replace one AI cliché with another.

## Output

Unless the user requested only the finished rewrite, return a concise audit, the rewritten text, a concise change summary, and preservation verification status when it actually ran.
