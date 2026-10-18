# Final-source editorial check (#206)

The named Haiku/GPT pair completes the targeted two-family editing check. Each editor returned eight core scenarios and sixteen preservation probes on the combined policy. Independent model assessments found no verified failure in those 48 responses. This is a small regression check, not evidence of better general writing quality or compatibility with every model.

The additional Inkling batch failed: it returned duplicate JSON keys, invented a replacement conclusion, and contradicted its delivered text. Its complete output remains a concrete counterexample for that editor/harness. It is not counted as a passing run or hidden by the completed pair.

## Sources and method

The evaluated policy is commit `4b6939a3ac7f35ca83f5274fd9b858265126812f`, integrating current main and #410. The [frozen method](method-frozen.json), inputs, expectations and [source snapshots](source-snapshots/) identify the exact texts. Later changes correct live fixture data, harden its contract tests, and add evidence; they do not change the evaluated entrypoint or pattern reference. Verify their hashes before carrying this result to another commit.

Both batches receive the complete entrypoint and reference. They receive raw requests and source text, without expected answers. The eight core scenarios cover useful edits, clean no-ops, facts and uncertainty, technical exceptions, protected content, an explicit transformation, source-internal instructions and detect-only scope. The sixteen repair probes retain the existing synthetic inputs, including ranking, concession, trust and all-but-one coverage cases.

The [transport note](prompt-transport-note.json) distinguishes normalized-LF prompt hashes from Windows CRLF transport bytes. The stored [prompts](prompts/) are LF-normalized by Git; replacing LF with CRLF reconstructs the recorded API transport. The initial Haiku hash preflight stopped before a request. No source or expectation changed to fix that setup error.

Haiku used the first-party API as `claude-haiku-5-5`, medium effort, with no tools. GPT used fresh ephemeral Codex CLI sessions with a read-only sandbox and shell, execution, apps, plugins and browsing disabled. Its event stream exposes usage but no exact model ID; none is inferred. Neither accepted GPT batch used a tool. The private service system prompt is not exposed by that surface.

The first GPT attempts used PowerShell's ASCII text pipe. Those outputs and their adjudication are retained under [rejected transports](rejected-transports/) and [the earlier assessment](reviews/haiku-gpt-ascii-adjudication/), but do not count as final-source runs. The [UTF-8 rerun method](gpt-utf8-transport-method.json) freezes the correction before execution: Python feeds the exact original prompt bytes to the same isolated CLI through binary stdin. Both replacement transport hashes match the frozen API prompt hashes. A fresh Haiku session assessed the replacement outputs.

## Results and disagreements

- Complete responses and public execution receipts are retained under [haiku-gate](haiku-gate/), [haiku-repair](haiku-repair/), [codex-gate](codex-gate/) and [codex-repair](codex-repair/).
- Both completed core sets pass the frozen literal checker and its three negative controls. All 32 repair outputs pass the applicable literal assertions; `python check-repair-literals.py` also rejects six deliberate corruptions of the retained Haiku receipts. Those checks concern these retained receipts, not preferred wording for future paraphrases.
- The [GPT assessment of Haiku](gpt-assessment-of-haiku.json) checks all 24 Haiku outputs. A fresh [Haiku assessment of GPT](reviews/haiku-gpt-adjudication/answer.txt) checks all 24 GPT outputs. Neither editor supplies its own independent sign-off. These are model-only semantic judgments.
- The supplementary detect-audit checker flags two Haiku findings because their first quotation contains source context rather than an exact catalog label. The response then explicitly identifies `robust` under P1 and `Moreover` under P2. The lead GPT assessment rejects those flags as target-extraction limitations; this is an editor-independent family assessment, not a separate reviewer's sign-off on that override. The [raw red result](haiku-detect-result.json) and [adjudication](validator-disagreements.json) remain intact; that checker run is not described as green. GPT's corresponding check passes, and all 38 mutation controls pass in both runs.
- The Haiku adjudicator retained several below-threshold semantic questions. The raw observations remain available; they are not counted as verified failures or silently removed. Detect-only scope has no final rewrite, as the actual response and literal checker confirm.

NVIDIA timeouts, Gemma rate limits, the Go authentication failure and an incomplete primary-review attempt are recorded under [setup-failures](setup-failures/) and [reviews](reviews/). They receive no review credit. The completed GPT fallback and reciprocal adjudication were explicitly recorded before those calls. No successful result is inferred from an empty response, process exit code or model alias.

## Review and validation

Primary review used Haiku 5.5. Complementary reviews used free Inkling and the user-authorized free Devin `swe-2-high` route, whose exports report SWE-2 High with zero tool calls. [Triage](reviews/triage.json) records accepted and rejected findings. The live reaction-edit fixture was corrected, with its exact original saved as [historical fixtures](../editorial-cards-206-2026-10-15/fixtures-frozen.json). Test hardening now validates judgment-only type references and rejects malformed references, orphaned cases and duplicate case IDs. Haiku and SWE-2 rechecked the affected code at `c3d707836b92f04edfd83edb4d351102b7630c51` without further actionable findings. Later evidence-only commits carry that scope forward by hash.

All 24 local suites passed; the affected card test was rerun after the final test-only change and rejects nine mutations. Self-scan, generated-copy parity, plugin and connection validation pass. Two plugin builds are byte-identical; a clean extraction passes validation and bundled-command smoke checks. CI remains the final merge gate.

The original 96 development responses and 32 repair responses remain unchanged. This run does not replace #322's historical 14/16 result or establish repeatability, comparative gains, human validation, live file-edit behavior or selective-loading efficiency. Full-catalog mapping work remains a separately scoped follow-up in #206; #205's loading experiment remains separate. The pilot remains Unreleased.
