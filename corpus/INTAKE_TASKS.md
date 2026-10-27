# Corpus expansion task drafts for #85

These three task bodies prepare additional intake without changing the measured
corpus. Source URLs and bibliographic details below are candidates, **unverified
offline**. No upstream fetch, license inspection, archive comparison, issue claim
check, or PR check was possible during preparation on 2026-10-27. Do not treat
these drafts as confirmed unclaimed issues or accepted human labels.

The supplied #85/#411/#412 tracker snapshot was stale against this working tree (checked live on 2026-10-27: #411 and #412 are closed, #85 is open):
`manifest.json` already contains `rfc-4180-csv-2005` and
`w3c-www-talk-cgi-spec-1995`, alongside the earlier two seeds. Their presence
does not establish that the linked issues are closed. Leave those newcomer
tasks and their contributors' work alone. None of the three candidate URLs or
IDs below occurs in the current measurement manifest.

Before posting any draft, check #85, #411, #412, open and closed issues, comments,
assignees, linked PR heads, and current main for the candidate ID, URL and title.
Follow [Choosing an issue](../CONTRIBUTING.md#choosing-an-issue). If someone owns
the source, coordinate another slice or withdraw the draft. Post a bounded claim
only after checking; these files do not claim work for anyone. Posting and live
coordination are deferred to the maintainer's online handoff.

## Shared acceptance and commands

Each task adds one public source to `corpus/manifest.json` and updates the
appropriate source paragraph in `corpus/README.md`. No detector, extractor,
dependency, score, publication gate, or existing hash changes. Candidate entries
are in [`intake-candidates.json`](intake-candidates.json); this separate file is
not read by measurement. Do not copy its provisional metadata into the live
manifest without completing the checks below.

1. Inspect the named source's byline, publication date, historical version and
   rights notice. Link that evidence in the PR. A current page displaying an old
   date alone does not prove its current text predates 2023: check a pre-2023
   capture or immutable publication version, or obtain explicit public human
   attestation from a named author covering the exact text. Never label text
   human because of how it reads. Correct or reject candidate metadata when the
   source disagrees.
2. Inspect upstream access terms before fetching. Fetchability, permission to
   redistribute, and suitability for a hash-only record are separate questions.
   Record the actual notice and its URL; do not infer a permissive license from
   public access or copy RFC 8259's license. Hash-only storage does not override
   upstream terms. If access or permitted use is unclear, stop that candidate
   and report the unresolved question. Never bypass access controls.
3. Fetch in an isolated directory using the existing CLI as shown below. Inspect
   extracted text for missing body, navigation, duplicated quotations, legal
   boilerplate and cap truncation. Keep existing quote handling. If the existing
   extractor cannot isolate the intended text, report the failure rather than
   adding an extractor in this task. Preserve unsuccessful URL/selector attempts
   and their errors in the PR; keep local logs outside the repository.
4. Record the resulting SHA-256 and word count, verify, force a second fetch,
   then verify again. `fetch` without `--force` may only reuse cache. Compare
   both hashes; never overwrite an existing manifest hash to pass verification.
   `verify` exits zero for missing files, so require an explicit `ok` for this
   source, not merely a successful exit. No `DRIFT`, `MISSING`, or `UNHASHED` is
   acceptable for the new entry.
5. Commit metadata only. Source text, screenshots, raw newsletters, cache,
   fixtures and logs stay out of the commit. No private correspondence may be
   submitted, **including hashes**. Add the inspected entry to the live manifest,
   update the source paragraph, and run `npm run corpus:fetch`,
   `npm run corpus:verify`, and `npm test`. Report unrelated unavailable sources
   separately, preserving their metadata. Review the diff for raw text and
   unrelated hash/word-count changes before submitting.

Run these commands from the repository root on a network-enabled contributor
machine **after** the rights and provenance check. They use Node's file API and
work in PowerShell or Bash. Substitute one candidate ID per task; the first
command prints the unique disposable directory. Use that printed path in place
of `<intake-dir>` in later commands. Review and correct that directory's
`corpus/manifest.json` before fetching, including its provisional license label
and extraction settings. There is no CLI `--manifest` or per-ID fetch option.

```sh
node -e "const fs=require('node:fs'),p=require('node:path');const id=process.argv[1];const d=require('./corpus/intake-candidates.json').documents.find(d=>d.id===id);if(!d)throw Error('Unknown candidate');const dir=fs.mkdtempSync(p.join(require('node:os').tmpdir(),'corpus-intake-'));for(const sub of ['scripts','corpus'])fs.mkdirSync(p.join(dir,sub));fs.copyFileSync('scripts/corpus.js',p.join(dir,'scripts/corpus.js'));fs.writeFileSync(p.join(dir,'corpus/manifest.json'),JSON.stringify({version:1,documents:[d]},null,2)+'\n');console.log(dir)" rfc-2119-keywords-1997
node <intake-dir>/scripts/corpus.js fetch
node <intake-dir>/scripts/corpus.js verify
node -e "const fs=require('node:fs');const p=process.argv[1];fs.copyFileSync(p,p+'.first')" <intake-dir>/corpus/manifest.json
node <intake-dir>/scripts/corpus.js fetch --force
node <intake-dir>/scripts/corpus.js verify
node -e "const fs=require('node:fs'),assert=require('node:assert/strict');const p=process.argv[1];assert.equal(fs.readFileSync(p,'utf8'),fs.readFileSync(p+'.first','utf8'));console.log('Manifest unchanged')" <intake-dir>/corpus/manifest.json
node -e "const fs=require('node:fs'),c=require('node:crypto');const t=fs.readFileSync(process.argv[1],'utf8');console.log(c.createHash('sha256').update(t,'utf8').digest('hex'),(t.match(/\S+/g)||[]).length)" <intake-dir>/corpus/cache/rfc-2119-keywords-1997.txt
```

For another task, change the ID in the first and final commands. The hash above
is of the extracted UTF-8 text, not the upstream HTTP bytes. The copied manager
resolves cache and manifest relative to its own location, keeping experiments
out of the measurement manifest. Plain URL sources need no dataset helpers.

Run the offline example separately:

```sh
node scripts/corpus-intake-example.test.js
```

It copies the existing manager to a temporary directory, stubs all fetches with
synthetic responses, and exercises the real `fetch` and `verify` CLI commands.
It checks extraction, independent hash/word counts, a repeated forced fetch,
changed-body rejection without hash replacement, and restoration. Synthetic text
is not a corpus source, an upstream fixture, or proof that these selectors work
online. It makes no network calls.

## Task 1: Add RFC 2119 as one documentation source

**Source:** Scott Bradner, *Key words for use in RFCs to Indicate Requirement
Levels* (candidate date March 1997),
[RFC 2119 text](https://www.rfc-editor.org/rfc/rfc2119.txt) and
[publication page](https://www.rfc-editor.org/info/rfc2119).

Use candidate ID `rfc-2119-keywords-1997`, register `docs`, class `human`, and
`human-pre-llm` only after verifying the immutable publication and byline.
This is standards requirement language, not a sample of social or email prose.
Check the RFC's own Internet Society copyright/permission notice; its age does
not establish public-domain status or the modern IETF Trust license.

The candidate literal marker is `1. MUST`; inspect exact spacing and confirm
that the first requirement paragraph survives. The marker itself is removed by
`slice.after`. Retain the 6,000-word cap and inspect any end matter that remains;
report it rather than claiming every token is authored instructional prose.
Run the shared commands with this ID. Acceptance is one inspected, repeatable
metadata entry plus the README seed-count update and shared checks.

## Task 2: Add RFC 3986 as one documentation source

**Source:** Tim Berners-Lee, Roy Fielding and Larry Masinter, *Uniform Resource
Identifier (URI): Generic Syntax* (candidate date January 2005),
[RFC 3986 text](https://www.rfc-editor.org/rfc/rfc3986.txt) and
[publication page](https://www.rfc-editor.org/info/rfc3986).

Use `rfc-3986-uri-2005`, `docs`, `human`, and `human-pre-llm` after checking the
publication record and all named authors. Inspect its actual Internet Society
copyright and BCP 78 notice. Do not transfer another RFC's license wording.
This adds reference/specification prose, not broad documentation coverage.

Start with the body anchor `URI) provides a simple and extensible`. Do not use
`1.  Introduction`: the extractor's `slice.after` takes the **first** match, and
that string also appears in the table of contents (line 65 of the text), so it
would start measurement in the contents. Retain the 6,000-word cap; record the
ending section and whether the cap cuts prose or syntax examples. Treat grammar
and code examples as source structure, without inventing a new cleaning rule.
Run the shared commands with this ID. Acceptance is one inspected, repeatable
metadata entry plus the README seed-count update and shared checks.

## Task 3: Add one public Crypto-Gram issue as email evidence

**Source:** Bruce Schneier, *CRYPTO-GRAM, May 15, 1998*,
[candidate public newsletter archive](https://www.schneier.com/crypto-gram/archives/1998/0515.html).
The URL, issue identity, byline, public distribution, historic body, rights
notice and current HTML structure all need online confirmation.

Use `crypto-gram-1998-05-15`, `email`, `human`, and `human-pre-llm` only after
confirming this is an archived distributed newsletter and the exact body has
pre-2023 provenance. An ordinary web essay on the same site is not email
evidence. Link a historical capture or immutable original issue. If modern
editorial additions cannot be separated with existing extraction, stop and
report the candidate as unsuitable.

Inspect the issue's actual copyright/reprint conditions and site terms. The
provisional rights label claims no redistribution permission. Even a newsletter
allowing some reprints may impose conditions; record them without claiming an
open license. Submit metadata only. Do not use subscriber messages, private
replies, exports containing addresses, or any private correspondence.

Start with `source.html.selector: "article"` and a 6,000-word cap. This selector
is a hypothesis, not a verified upstream wrapper. Inspect whether it selects
the full issue without site navigation, related posts or comments. Record any
subscription/footer material retained inside the issue. If no supported selector
isolates it, record failure and request a different candidate in a follow-up.
Run the shared commands with this ID. Acceptance includes evidence for the
`email` classification, one repeatable hash, the README email-seed update, and
shared checks. One archived issue is not representative personal email.

## Live check, 2026-10-27

The drafts above were written offline. A later maintainer-side check fetched all three candidates
through the real extractor in a scratch directory (nothing committed, no manifest
change) and found:

- **RFC 2119:** the marker works and the body is clean, but the whole document is
  only 480 words, and the retained tail includes the author address block and a
  page footer (`[Page 3]`). It is a small sample, mostly keyword definitions.
- **RFC 3986:** with the body anchor above, extraction starts at the introduction
  body and hits the 6,000-word cap mid-sentence in section 3.2.2, inside the IPv6
  literal discussion. Per-page RFC headers and footers are likely inside the
  extracted text; count them when judging the sample.
- **Crypto-Gram 1998-05-15:** the page exists, its title is the issue date, it
  carries a `Copyright (c) 1998 by Bruce Schneier` line and a reprint condition
  (reprinting only in its entirety), and the `article` selector isolates 1,177
  words starting at the date and byline. The retained footer is a Counterpane
  consulting advertisement. Whether a pre-2023 capture exists is still unchecked.
- **Not checked live:** each RFC's copyright and BCP 78 notice, the site terms for
  Crypto-Gram, and archive captures. Rights and provenance stay open per the
  checks above.

## Units, publication limits, and deferred candidates

For each task, one source is one document unit. Paragraph measurement uses the
existing [preparation rules](README.md#how-text-reaches-the-detector), including
the 50–400-token selection window; do not count a short message, heading or code
block as an eligible paragraph merely to grow the sample. Record actual selected
and skipped units when measuring. Paragraphs from one author or document are
related observations; do not present them as independent authors or broad
register evidence.

The [publication gate](README.md#what-this-does-not-measure) remains unchanged:
`n >= 100` per claim cell, more than one relevant register, and a confidence
interval. These partial seeds do not establish a new false-positive rate, unblock
a cross-tool benchmark, or close #85.

No upstream candidate was attempted offline, so there are no observed HTTP or
extraction failures to report. The newsletter remains conditional; the fixture
cannot resolve that uncertainty. No usable social source with verified public
provenance is available in the supplied evidence. Maintainer LinkedIn/X exports
are deferred pending a named, public source and provenance/access review; no
personal export or outreach is requested. Private email is excluded outright.
The two existing W3C messages are excluded from this shortlist as duplicates,
regardless of the stale tracker checkboxes. More RFCs alone would still leave
register diversity unresolved.
