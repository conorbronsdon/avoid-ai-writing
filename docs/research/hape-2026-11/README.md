# Exploratory HAP-E counts for catalog claim corrections

These are this repository's exploratory measurements for #249, not numerical findings reported by the dataset paper. They describe five matched classes in the [HAP-E dataset](https://huggingface.co/datasets/browndw/human-ai-parallel-corpus), introduced by [Reinhart et al.](https://arxiv.org/abs/2410.16107). Measurements cover 2024 continuations. Claude and newer models are absent, and the corpus has no dedicated marketing, LinkedIn, or documentation register.

The corpus asks models to continue roughly 500 words of human text with another 500 words in the same style. Human chunk 2 is the corresponding comparison. The six source registers are academic, blogs, fiction, news, spoken, and television/movie scripts. A register can contain different subjects; absence of a dedicated marketing register does not imply absence of marketing language.

`claims249.js` is copied byte-for-byte from committed source 1784e0999555d5ec90dda20952e08e9bc9a1dc8d. `provenance-2026-11-03.json` pins dataset revision b514ff64988d9e322fd81c5d70d69a38e78491f5, publisher file sizes/SHA256, converted JSONL hashes, method SHA256, dependency blob and aggregate-output SHA256. `results-2026-11-03.json` is frozen output. Raw text and Parquet/JSONL data stay outside the repository.

Each class has 8,290 documents with exactly the same normalized document-ID set. Normalization takes `doc_id.split("@")[0]`; the shared prefix before `_` names the register. The set hash is SHA256 of sorted unique normalized IDs joined by LF, UTF-8 encoded, with no trailing LF. Word denominators are whitespace-delimited tokens pooled over those documents. Sentence CV and TTR eligibility differ:

| Class | Word denominator | CV documents | TTR200 documents |
|---|---:|---:|---:|
| human | 3,974,889 | 8,281 | 8,283 |
| gpt-4o | 4,373,556 | 8,288 | 8,290 |
| gpt-4o-mini | 4,791,862 | 8,290 | 8,290 |
| llama-70B-I | 3,809,397 | 8,282 | 8,285 |
| llama-8B-I | 3,532,560 | 8,268 | 8,224 |

Metric definitions and limits:

- Sentence-length CV uses the script's punctuation splitter, excludes segments shorter than two whitespace tokens, requires at least five segments/document, and divides population standard deviation by mean sentence length. Reported medians use the sorted element at floor(p*n), rounded to three decimals. This is a rough sentence proxy, not a syntactic parser.
- TTR200 lowercases whitespace tokens, strips leading/trailing characters outside ASCII letters/digits/apostrophes, drops empty tokens, takes the first 200 remaining tokens, and divides unique types by 200. Documents shorter than 200 such tokens are excluded. It is one opening window/document, not an average over every window.
- Calibration counts only `Notably`, `Interestingly`, `Importantly`, `Significantly`, `Surprisingly`, `Undoubtedly`, and `Certainly` followed immediately by a comma at text/line starts or after sentence punctuation and whitespace. Rates are per million whitespace tokens, not per sentence or per document. Quote- or parenthesis-prefixed forms and lowercase forms are excluded; this is a literal-match proxy, not a count of every grammatical sentence opener.
- Same-opener runs count one occurrence on reaching three consecutive eligible segments. `sameOpenerRun3NonFunction` excludes exactly `i, he, she, it, we, they, you, the, a, and, but`; it is not a comprehensive pronoun exclusion. The first alphabetic/apostrophe token is lowercased. Longer runs count once.
- Hyphen stacks, stranded auxiliaries and colon triples use the literal regexes in the frozen script. These are narrow proxies, not coverage of every grammatical instance: colon triples require an Oxford comma/and-or shape and short items; stranded auxiliaries restrict subject/case and punctuation. Low rates need caution, not an authorship verdict.
- Counts are descriptive, with no confidence intervals or causal claim. Continuation prompts, the 2024 model set, regex choices, document eligibility and register mix limit generalization. Editing rules, thresholds and the production detector are unchanged.

To reproduce, download the five Parquet paths at the pinned revision in provenance from `https://huggingface.co/datasets/browndw/human-ai-parallel-corpus/resolve/<revision>/<path>`. Verify each byte size and publisher SHA256 before conversion. With pyarrow available, convert only `doc_id`/`text`, preserving row order:

```python
import hashlib, json, pathlib, pyarrow.parquet as pq
root = pathlib.Path("/path/to/public-hape-cache")
manifest = json.loads(pathlib.Path("docs/research/hape-2026-11/provenance-2026-11-03.json").read_text())
for item in manifest["files"]:
    source = root / item["file"]
    assert source.stat().st_size == item["bytes"]
    assert hashlib.sha256(source.read_bytes()).hexdigest() == item["sha256"]
    label = source.stem.removeprefix("hape-text_")
    target = root / (label + ".jsonl")
    ids, registers = set(), {}
    with target.open("w", encoding="utf-8", newline="\n") as out:
        for batch in pq.ParquetFile(source).iter_batches(batch_size=512, columns=["doc_id", "text"]):
            for row in batch.to_pylist():
                normalized = row["doc_id"].split("@")[0]
                assert normalized not in ids
                ids.add(normalized)
                register = normalized.split("_")[0]
                registers[register] = registers.get(register, 0) + 1
                out.write(json.dumps({"doc_id": row["doc_id"], "text": row["text"]}) + "\n")
    assert len(ids) == item["documents"]
    assert registers == item["registers"]
    assert hashlib.sha256("\n".join(sorted(ids)).encode("utf-8")).hexdigest() == item["normalizedDocIdSetSha256"]
    assert hashlib.sha256(target.read_bytes()).hexdigest() == item["jsonlSha256"]
```

Set `HAPE_DIR` to that cache and run `node docs/research/hape-2026-11/claims249.js`; compare its JSON output with the frozen results. The script imports the repository's existing `rocAuc` helper only for supplemental AUC fields; the catalog's counts, CV and TTR are calculated directly in the script.

The method copy in this folder is canonical for this report. For full-output reproduction with the recorded helper, copy this frozen folder into a disposable checkout of the recorded dependency base; that older base does not contain the folder itself. Verify `git rev-parse HEAD:scripts/fp-measure.js` equals the dependency blob in provenance and `git diff --exit-code -- scripts/fp-measure.js` is clean before running the copied method.

Uncited supplemental fields: `copulaSwap` counts the literal serve-as/boast/stand-as/represent-a regex in the script. The AUC fields compare negated CV/TTR values, so a value over 0.5 means lower values in the machine class. These fields do not evaluate the production detector.
