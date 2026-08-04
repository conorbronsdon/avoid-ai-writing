# House-style config examples

`--style` adds a house style on top of the de-AI pass. It is not a guide registry: it
applies **register/voice** directives and removes AI tells, on top of whatever
**mechanics** you enforce. The preferred way in is a **config file**
(`--style ./house.json`, or a bare name matching `examples/<name>.json`): it is applied, and
the checkable subset of its mechanics is verified deterministically (see the table below for
which rules gate the exit code and which are advisory). The files here are *examples of that
format*; copy one and edit it.

## Where encoded guides live

For a real published guide, don't reach for a bare name or expect a bundled config: see the
README's [**House style is a different job**](../README.md#house-style-is-a-different-job)
section, which points at [Vale](https://github.com/vale-cli/vale) (where licensed, attributed
guide packages live) and records the licensing decision in
[#88](https://github.com/conorbronsdon/avoid-ai-writing/issues/88). In short: Vale enforces a
guide's mechanics; this layer adds register/voice and removes AI tells; the config format
below is for a quick custom house style.

**This repo bundles no style guides.** The example files are generic and guide-neutral (no
guide names or aliases), so nothing here claims to implement a guide or tracks its edition.

A bare name resolves by filename only: `--config technical` loads `technical.json`. Because
the shipped examples carry no guide names, `--style chicago` resolves to no config and falls
back to applying the guide from the model's own knowledge as best-effort, labeled such as
`Applying Chicago from general knowledge (not verified; no compliance claim).`. `SKILL.md`
instructs the model to print that status line and not to reproduce the guide's text; both are
instructions rather than checked rules, so treat that path as unverified. For enforcement, use
Vale or write a config. The checker covers only the config path, so pointing it at an
unresolvable name exits 2 (a tool error).

## Schema

A config is JSON with two parts:

```json
{
  "name": "My house style",
  "genre": "technical documentation",
  "register": [
    "Second person, active voice, present tense.",
    "No hype."
  ],
  "mechanics": {
    "quotes": "straight",
    "headings": "sentence",
    "emDash": "sparing",
    "latinAbbrev": "parentheses",
    "serialComma": true,
    "spellNumbersUpTo": 9
  }
}
```

- **`register`** (list of strings) — voice/register directives the model applies as
  guidance. These are judgment calls, not machine-checked.
- **`genre`** (string, optional) — what the config is written for. Don't apply a config
  to a genre it wasn't written for.
- **`mechanics`** (object) — output rules, of which the checkable subset is verified by
  `node scripts/check-style.js <file> --config <config.json>`:

| key | values | how it's checked |
|---|---|---|
| `quotes` | `straight` \| `curly` | **hard** — flags the wrong mark form in prose |
| `latinAbbrev` | `never` \| `parentheses` \| `any` | **hard** — `never` flags any `e.g.`/`i.e.`; `parentheses` flags them outside parentheses; `any` is unchecked |
| `headings` | `sentence` \| `title` | advisory — proper nouns make sentence vs. title case ambiguous, so it can't be verified deterministically |
| `emDash` | `sparing` \| `deliberate` | advisory — `sparing` flags a rate over ~1 per 1,000 words; `deliberate` is unchecked |
| `spellNumbersUpTo` | number | advisory — flags numerals at or below the threshold in prose |
| `serialComma` | `true` \| `false` | model-applied only; not machine-checked |

Unrecognized keys or values are reported as **warnings** (a config the tool couldn't fully
apply) rather than silently ignored; omitted keys do nothing.

Before checking, the checker skips YAML frontmatter (only when it closes), code (fenced and
inline), and markdown link destinations, link titles, and reference-definition tails, so
identifiers, examples, and link syntax don't false-positive. It also masks HTML tags, whose
attribute values are straight-quoted. Link titles matter here because they are delimited with
straight quotes as *syntax*, which `quotes: curly` would otherwise read as a violation. Some
limits worth knowing: an unclosed or multi-line HTML tag still registers, as do quotes inside
an HTML comment; and the `latinAbbrev` parenthesis carve-out tracks depth across wrapped
lines but resets at a paragraph break, so an unclosed `(` disables that rule for the rest of
its paragraph. Indented code blocks are masked, with a list exception: 4-space content
inside a list item is the item's own prose (use a fence there). A double-backtick code span
whose body contains a backtick leaks to the quote checks; a reference definition with its
title on the next line is read as prose; and a document opening with a thematic break is
prose, not frontmatter.
