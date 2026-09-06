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

Before checking, the checker skips closed YAML frontmatter, fenced/inline/indented code,
link destinations and titles, reference identifiers, HTML tags and comments, and escaped
punctuation. Link titles use straight quotes as *syntax*. List paragraph continuations stay
checked; extra indentation can start code inside an item. A leading thematic break followed
by a blank line is prose, not frontmatter. The `latinAbbrev` parenthesis carve-out carries
across wrapped lines but resets at a paragraph break, so an unclosed `(` disables that rule
for the rest of its paragraph.

## Normalize quote marks after a rewrite

Rewrite and edit mode run this pass before delivery. Keep the original document as
the reference so generated marks cannot override its existing convention:

```bash
node scripts/normalize-quotes.js draft.md --reference original.md
node scripts/normalize-quotes.js draft.md --reference original.md --write
node scripts/check-style.js draft.md --config ./house.json
```

The default `--quotes auto` infers double quotes and single quotes/apostrophes
independently from unprotected reference prose. Each family's majority wins; ties
use its first observed style. With no evidence, that family stays unchanged. Without
`--reference`, inference uses the input itself. Explicit house style takes precedence:
use `--quotes straight` or `--quotes curly` without `--reference`.

Without `--write`, stdout contains
only the resulting document and the file stays unchanged. The command exits 0 on success
or 2 for invalid arguments or file errors. It also exports
`normalize(text, quotes = 'auto', reference = text)` and `inferQuotes(text)`.
For skill rewrites, normalize only editable prose and retain exempt quotations,
tables and attributed text when inserting the result into the document.

The normalizer shares the checker's Markdown protection and changes only quotation marks
and apostrophes in prose. Protected source, whitespace, BOM and line endings survive
verbatim. Dashes and heading case stay as written. This pass does not claim guide
compliance. Curly education
uses neighboring characters, so leading elisions such as `'twas` and `rock 'n' roll` need
review. Straight marks after digits follow the checker's feet/inch carve-out.

For a bare URL immediately surrounded by single quotes, a closing quote followed
only by terminal punctuation ends the URL even if its parentheses are unbalanced.
Internal apostrophes such as `O'Reilly` remain part of the URL. If a URL literally
ends in an apostrophe or has ambiguous punctuation, use an explicit Markdown link
or `<https://example.com/...>` autolink to keep its destination unchanged.
