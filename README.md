<div align="center">

# avoid-ai-writing

Audit & rewrite content to remove AI writing patterns. A practical skill for any AI agent. Supports detection-only mode.

[![GitHub stars](https://img.shields.io/github/stars/conorbronsdon/avoid-ai-writing?style=social)](https://github.com/conorbronsdon/avoid-ai-writing/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![X](https://img.shields.io/badge/X-@ConorBronsdon-black?style=flat-square&logo=x)](https://x.com/ConorBronsdon)
[![Web App](https://img.shields.io/badge/Try_the_web_app-ff6b35?style=flat-square&logo=vercel&logoColor=white)](https://avoid-ai-writing-app.vercel.app)

</div>
<div align="center">
The community made a meme coin to support the project🤯 CA: BsidWuYJnayqMXVsLGr34524vmZ1BrWFhPer3198pump
</div>

---


A portable writing skill for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [OpenClaw](https://github.com/openclaw/openclaw), [Hermes](https://github.com/NousResearch/hermes-agent), and any other [agentskills.io](https://agentskills.io)-compatible agent. Audits and rewrites content to remove AI writing patterns ("AI-isms").

**Two modes:**
- **Rewrite** (default) — flags AI patterns and rewrites the text to fix them. A built-in second pass catches patterns that survived the first edit.
- **Detect** — flags AI patterns without rewriting. Shows which flags are real problems vs. judgment calls. Useful when patterns might be intentional, when auditing content you don't want altered, or when you just want a quick scan.

## Quick demo

**Input:**
> Certainly! Acme Analytics, a vibrant startup nestled in the heart of Boulder's thriving tech ecosystem, has secured $40M in Series B funding — marking a watershed moment for the observability landscape. The platform serves as a unified hub, featuring real-time dashboards, boasting sub-second queries, and presenting a seamless integration layer. Moreover, experts believe Acme is poised to disrupt the market. In conclusion, the future looks bright!

**Output:**
> Acme Analytics raised a $40M Series B led by Sequoia. The Boulder-based startup makes an observability platform that runs queries in under a second and plugs into existing monitoring stacks without custom integration work.

**What it caught:** chatbot opener ("Certainly!"), promotional language ("vibrant," "nestled," "thriving"), significance inflation ("watershed moment"), copula avoidance ("serves as," "featuring," "boasting"), 4 word replacements, vague attribution ("experts believe"), filler ("Moreover"), generic conclusion ("the future looks bright"), over-polished uniformity. 15+ AI tells in one paragraph.

## Why a skill, not just a prompt

A one-shot "make this sound human" prompt catches the obvious stuff. This skill is different:

- **Structured audit** — returns identified issues with quoted text, the rewrite, a change summary, and a second-pass audit in four discrete sections. You see exactly what changed and why.
- **Two-pass detection** — the second pass re-reads the rewrite and catches patterns that survive the first edit: recycled transitions, lingering inflation, copula swaps that snuck through.
- **109-entry word replacement table across 3 tiers** — not vibes-based. Every flagged word has a specific, plainer alternative. "Leverage" → "use." "Commence" → "start." Tier 1 words are always flagged, Tier 2 words flag when they cluster, Tier 3 words flag only at high density. This reduces false positives while catching real AI tells.
- **36 pattern categories** — see the full list below, each with before/after examples. Includes rhythm/uniformity checks and a rewrite-vs-patch threshold.
- **Detect mode** — flag patterns without rewriting. See which flags are real problems vs. judgment calls. Useful when patterns might be intentional or you're auditing content you don't want altered.
- **Works with Claude Code and OpenClaw** — single `SKILL.md` with compatible frontmatter for both platforms.

## Installation & Usage

### Claude Code

**Option 1: Clone into skills directory**

```bash
git clone https://github.com/conorbronsdon/avoid-ai-writing ~/.claude/skills/avoid-ai-writing
```

**Option 2: Copy the file directly**

Download `SKILL.md` and place it in any directory that Claude Code can read. Reference it in your `CLAUDE.md`:

```markdown
- Editing for AI patterns → read `path/to/avoid-ai-writing/SKILL.md`
```

**Option 3: Use as a slash command**

Create a command file (e.g., `~/.claude/commands/clean-ai-writing.md`):

```markdown
---
description: Audit and rewrite content to remove AI writing patterns
---

$ARGUMENTS

Read and follow the instructions in ~/.claude/skills/avoid-ai-writing/SKILL.md
```

Then use `/clean-ai-writing <your text>` in Claude Code.

### OpenClaw

**Option 1: [Install from ClawHub](https://clawhub.ai/conorbronsdon/avoid-ai-writing)**

```bash
clawhub install avoid-ai-writing
```

**Option 2: Clone into skills directory**

```bash
git clone https://github.com/conorbronsdon/avoid-ai-writing ~/.openclaw/skills/avoid-ai-writing
```

### Triggering the skill

Once installed, ask your assistant to clean up AI writing:

- "Remove AI-isms from this post"
- "Audit this draft for AI tells"
- "Make this sound less like AI"
- "Clean up AI writing in this paragraph"

In **rewrite mode** (default), the skill returns four sections:

1. **Issues found** — every AI-ism identified, with the text quoted
2. **Rewritten version** — clean version with all AI-isms removed
3. **What changed** — summary of the major edits
4. **Second-pass audit** — re-reads the rewrite and catches any surviving tells

In **detect mode**, the skill returns two sections:

1. **Issues found** — every AI-ism identified, grouped by severity (P0/P1/P2)
2. **Assessment** — which flags are clear problems vs. patterns that may be intentional or effective in context

Trigger detect mode with: "detect," "flag only," "audit only," "just flag," "scan," or similar.

## 36 Patterns Detected

### Content Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 1 | **Significance inflation** | "marking a pivotal moment in the evolution of..." | "was founded in 2019 to solve X" |
| 2 | **Notability name-dropping** | "cited in NYT, BBC, and Wired" | "In a 2024 NYT interview, she argued..." |
| 3 | **Superficial -ing analyses** | "symbolizing... reflecting... showcasing..." | Replace with specific facts or cut |
| 4 | **Promotional language** | "nestled within the breathtaking region" | "is a town in the Gonder region" |
| 5 | **Vague attributions** | "Experts believe it plays a crucial role" | "according to a 2019 survey by Gartner" |
| 6 | **Formulaic challenges** | "Despite challenges... continues to thrive" | Name the challenge and the response |
| 7 | **Novelty inflation** | "He introduced a term I hadn't heard before" | "He walked through how X works in practice" |

### Language Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 8 | **Word/phrase replacements (3 tiers)** | "leverage... robust... seamless... utilize" | "use... reliable... smooth... use" |
| 9 | **Copula avoidance** | "serves as... features... boasts" | "is... has" |
| 10 | **Synonym cycling** | "developers... engineers... practitioners... builders" | "developers" (repeat the clear word) |
| 11 | **Template phrases** | "a [adj] step towards [adj] infrastructure" | Describe the specific outcome |
| 12 | **Filler phrases** | "In order to," "Due to the fact that" | "To," "Because" |
| 13 | **False ranges** | "from the Big Bang to dark matter" | List the actual topics |
| 14 | **Parenthetical hedging** | "tools (like X and Y)" | Name them directly or cut |

### Structure Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 15 | **Formatting** | Em dashes (— and --), bold overuse, emoji headers, bullet-heavy | Commas/periods, prose paragraphs |
| 16 | **Sentence structure** | "It's not X, it's Y" + hollow intensifiers + hedging | Direct positive statements |
| 17 | **Structural issues** | Uniform paragraphs, formulaic openings, too-clean grammar | Varied length, lead with the point |
| 18 | **Transition phrases** | "Moreover," "Furthermore," "In today's [X]" | "and," "also," or restructure |
| 19 | **Inline-header lists** | "**Speed:** Speed improved by..." | Write the point directly |
| 20 | **Title case headings** | "Strategic Negotiations And Partnerships" | "Strategic negotiations and partnerships" |
| 21 | **Numbered list inflation** | "Here are 7 reasons why..." | Cut to the 2-3 that matter |
| 22 | **False concession** | "While X has limitations, it's still remarkable" | State the real tradeoff |
| 23 | **Rhetorical question openers** | "What if there were a better way to...?" | Lead with the claim |

### Communication Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 24 | **Chatbot artifacts** | "I hope this helps! Let me know if..." | Remove entirely |
| 25 | **"Let's" constructions** | "Let's explore," "Let's break this down" | Just start with the point |
| 26 | **Cutoff disclaimers** | "While details are limited in available sources..." | Find sources or remove |
| 27 | **Generic conclusions** | "The future looks bright," "Only time will tell" | Specific closing thought or cut |
| 28 | **Emotional flatline** | "What surprised me most," "I was fascinated to discover" | Earn the emotion or cut the claim |
| 29 | **Reasoning chain artifacts** | "Let me think step by step," "Breaking this down" | State conclusion, then evidence |
| 30 | **Sycophantic tone** | "Great question!", "You're absolutely right!" | Remove entirely |
| 31 | **Acknowledgment loops** | "You're asking about," "To answer your question" | Just answer directly |
| 32 | **Confidence calibration** | "It's worth noting," "Interestingly," "Surprisingly" | Let the fact speak for itself |

### Meta Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 33 | **Excessive structure** | 5 headers in 200 words, "Overview:", "Key Points:" | Merge sections, use specific headers |
| 34 | **Rhythm and uniformity** | All sentences 15–25 words, all paragraphs same length | Mix short/long, fragments, questions |
| 35 | **Over-polishing** | Every irregularity sanded away, perfectly uniform prose | Keep natural disfluency, varied rhythm |
| 36 | **Rewrite-vs-patch threshold** | 5+ vocabulary flags + 3+ pattern categories + uniform rhythm | Advise full rewrite, not patching |

## Full Example

**Before (AI-generated):**

> Certainly! Here's a comprehensive overview of Acme's Series B.
>
> Acme Analytics, a vibrant startup nestled in the heart of Boulder's thriving tech ecosystem, has secured $40M in Series B funding — marking a watershed moment for the company and the observability landscape at large. The round was led by Sequoia, with participation from Andreessen Horowitz, Y Combinator, and Index Ventures, underscoring the robust investor confidence in Acme's vision.
>
> The platform serves as a unified hub for engineering teams, featuring real-time dashboards, boasting sub-second query performance, and presenting a seamless integration layer. It's not just another monitoring tool — it's a paradigm shift in how organizations navigate complex distributed systems. Experts believe Acme is poised to disrupt the $15B observability market. Studies show that companies utilizing comprehensive monitoring solutions can ascertain issues 40% faster.
>
> - 🚀 **Performance:** The platform streamlines incident response, empowering engineers to resolve issues faster.
> - 💡 **Scale:** Acme fosters collaboration across teams, from frontend developers to SRE practitioners to platform builders to infrastructure engineers.
> - ✅ **Adoption:** Customer adoption continues to accelerate, reflecting broader industry trends.
>
> Moreover, Acme's approach showcases the potential of modern observability — symbolizing a shift toward proactive monitoring, reflecting years of R&D investment, and highlighting the intricate interplay between data collection and actionable intelligence. Despite challenges common in the crowded monitoring space, Acme continues to thrive. In order to fully capitalize on this momentum, the company plans to expand its go-to-market endeavors.
>
> In conclusion, the future looks bright for Acme Analytics. Only time will tell how this game-changer will reshape the observability paradigm. Feel free to reach out if you'd like more details!

**After (cleaned up):**

> Acme Analytics raised a $40M Series B led by Sequoia. The Boulder-based startup makes an observability platform that runs queries in under a second and plugs into existing monitoring stacks without custom integration work.
>
> The pitch is speed. Their median time-to-resolution is 12 minutes, compared to the 45-minute industry average that Datadog reported in 2024. That gap is why 380 companies are paying for it.
>
> They'll use the money to hire sales reps in EMEA and add log management. The monitoring market is crowded, but Acme's bet is that most teams still stitch together three or four tools and lose time switching between them.

**What the skill caught:** chatbot artifacts (Certainly!, Feel free to reach out), 3 em dashes, promotional language (vibrant, nestled, thriving), significance inflation (watershed moment), copula avoidance (serves as, featuring, boasting, presenting), 10 word replacements (landscape, robust, seamless, paradigm, streamline, empower, foster, utilize, ascertain, endeavor), synonym cycling (developers/practitioners/builders/engineers), negative parallelism (It's not just X, it's Y), notability name-dropping (Sequoia, a16z, YC, Index stacked for credibility), vague attributions (Experts believe, Studies show), filler phrases (In order to, Moreover), inline-header list with emoji, superficial -ing analysis (symbolizing... reflecting... highlighting...), formulaic challenges (Despite challenges... continues to thrive), generic conclusion (the future looks bright, only time will tell), false range implied in the adoption bullet.

That's 35+ AI tells.

## $avoid token + web app

The community created a Solana token around this project. You can burn $avoid tokens to run the audit skill through a web app:

**[avoid-ai-writing-app.vercel.app](https://avoid-ai-writing-app.vercel.app)** — paste text, burn 1,000 $avoid, get a full audit + rewrite. Every token burned is permanently removed from circulation.

| | |
|---|---|
| Web App | [avoid-ai-writing-app.vercel.app](https://avoid-ai-writing-app.vercel.app) |
| DexScreener | [dexscreener.com/solana/4b5m...](https://dexscreener.com/solana/4b5mprekzapcwybrsbbaiewtk4amck62rpcznjcxz69m) |
| Telegram | [t.me/avoidaiwriting](https://t.me/avoidaiwriting) |
| X Community | [x.com/i/communities/2036440377356591415](https://x.com/i/communities/2036440377356591415) |
| CA | `BsidWuYJnayqMXVsLGr34524vmZ1BrWFhPer3198pump` |

## Credits

Pattern research informed by:
- [Pangram Labs](https://www.pangram.com/) AI detection research — structural regularity insights, vocabulary flags from a decoder-only classifier trained on 28M human documents
- Wikipedia's [Signs of AI-generated text](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) documentation — the canonical reference for AI writing tells, maintained by Wikipedia editors
- [blader/humanizer](https://github.com/blader/humanizer) Claude Code skill
- [brandonwise/humanizer](https://github.com/brandonwise/humanizer) — tiered vocabulary system, statistical analysis research (burstiness, sentence length variation, trigram repetition), and rewrite philosophy
- [OpenClaw](https://github.com/openclaw/openclaw) humanizer skill ecosystem — community patterns and vocabulary research

Authored by [Conor Bronsdon](https://github.com/conorbronsdon) · [LinkedIn](https://www.linkedin.com/in/conorbronsdon/) · [Chain of Thought podcast](https://chainofthought.show)

---

## Disclaimer

*All views, opinions, and statements expressed on this account are solely my own and are made in my personal capacity. They do not reflect, and should not be construed as reflecting, the views, positions, or policies of Modular. This account is not affiliated with, authorized by, or endorsed by Modular in any way.*

## License

MIT
