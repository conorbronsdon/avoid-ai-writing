# avoid-ai-writing

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) skill that audits and rewrites content to remove AI writing patterns ("AI-isms").

Paste any text, get back a clean version with every AI tell identified, fixed, and explained. A built-in second pass re-reads the rewrite to catch patterns that survived the first edit.

## Before & After

**Input:**
> In today's rapidly evolving AI landscape, developers are embarking on a pivotal journey to leverage cutting-edge tools that streamline their workflows. Moreover, these robust solutions serve as a testament to the industry's commitment to fostering seamless experiences. Experts believe this represents a watershed moment for the field. The future looks bright — only time will tell how these game-changing innovations will reshape the paradigm.

**Output:**
> Developers are starting to use newer AI tools to simplify their work. These tools are reliable, and they're making development less painful. The shift matters because [cite specific impact or cut the claim]. [Cut: "The future looks bright" and "only time will tell" — say something specific or end the piece.]

**What the skill flagged:** em dash, 3 copula substitutions (serves as, represents, fostering), 6 word replacements (landscape, embarking, leverage, cutting-edge, streamline, robust), significance inflation (watershed moment, pivotal), vague attribution (Experts believe), generic conclusion, formulaic opening (In today's rapidly evolving...), filler transition (Moreover).

That's 16 AI tells in 4 sentences. Most human editors catch 3 or 4.

## Why a skill, not just a prompt

A one-shot "make this sound human" prompt catches the obvious stuff. This skill is different:

- **Structured audit** — returns identified issues with quoted text, the rewrite, a change summary, and a second-pass audit in four discrete sections. You see exactly what changed and why.
- **Two-pass detection** — the second pass re-reads the rewrite and catches patterns that survive the first edit (recycled transitions, lingering inflation, copula swaps that snuck through).
- **38-entry replacement table** — not vibes-based. Every flagged word has a specific, plainer alternative. "Leverage" → "use." "Commence" → "start." No judgment calls needed.
- **13 pattern categories** — covers formatting, sentence structure, word choice, structural tells, and conversational artifacts. See the full list below.
- **Claude Code native** — installs as a skill with YAML frontmatter, works with slash commands, and integrates into your existing workflow.

## What it catches

| # | Category | Examples |
|---|----------|----------|
| 1 | **Formatting** | Em dash overuse, bold overuse, emoji in headers, excessive bullet lists |
| 2 | **Sentence structure** | "It's not X, it's Y" pattern, hollow intensifiers, hedging, missing bridges, compulsive rule of three |
| 3 | **Word/phrase replacements** | 38 flagged terms: delve, leverage, robust, seamless, utilize, endeavor, etc. |
| 4 | **Template phrases** | "a [adjective] step towards [adjective] infrastructure" |
| 5 | **Transition phrases** | Moreover, Furthermore, In today's [X], When it comes to |
| 6 | **Structural issues** | Uniform paragraph length, formulaic openings, suspiciously clean grammar |
| 7 | **Significance inflation** | "marking a pivotal moment in the evolution of..." |
| 8 | **Copula avoidance** | "serves as," "features," "boasts" instead of "is" or "has" |
| 9 | **Synonym cycling** | Rotating developers/engineers/practitioners/builders in one paragraph |
| 10 | **Vague attributions** | "Experts believe," "Studies show" without citing anyone |
| 11 | **Filler phrases** | "In order to," "Due to the fact that," "It is important to note" |
| 12 | **Generic conclusions** | "The future looks bright," "Only time will tell" |
| 13 | **Chatbot artifacts** | "I hope this helps!", "Certainly!", "Feel free to reach out" |

## Installation

### Option 1: Clone into skills directory

```bash
git clone https://github.com/conorbronsdon/avoid-ai-writing ~/.claude/skills/avoid-ai-writing
```

### Option 2: Copy the file directly

Download `SKILL.md` and place it in any directory that Claude Code can read. Reference it in your `CLAUDE.md`:

```markdown
- Editing for AI patterns → read `path/to/avoid-ai-writing/SKILL.md`
```

### Option 3: Use as a slash command

Create a command file (e.g., `~/.claude/commands/clean-ai-writing.md`):

```markdown
---
description: Audit and rewrite content to remove AI writing patterns
---

$ARGUMENTS

Read and follow the instructions in ~/.claude/skills/avoid-ai-writing/SKILL.md
```

Then use `/clean-ai-writing <your text>` in Claude Code.

## Usage

Once installed, ask Claude Code to clean up AI writing:

- "Remove AI-isms from this post"
- "Audit this draft for AI tells"
- "Make this sound less like AI"
- "Clean up AI writing in this paragraph"

The skill returns four sections:

1. **Issues found** — every AI-ism identified, with the text quoted
2. **Rewritten version** — clean version with all AI-isms removed
3. **What changed** — summary of the major edits
4. **Second-pass audit** — re-reads the rewrite and catches any surviving tells

## Credits

Pattern research informed by:
- Wikipedia's [Signs of AI-generated text](https://en.wikipedia.org/wiki/AI-generated_text#Detection) documentation
- [blader/humanizer](https://github.com/blader/humanizer) Claude Code skill

## License

MIT
