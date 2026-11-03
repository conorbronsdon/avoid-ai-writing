#!/usr/bin/env bash
# Download the HAP-E parquet files used by this note and convert them to JSONL.
# Text lands in the gitignored corpus/cache/hape/ (override with HAPE_DIR); it is never committed.
# Source: https://huggingface.co/datasets/browndw/human-ai-parallel-corpus (MIT).
set -euo pipefail
OUT="${HAPE_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)/corpus/cache/hape}"
mkdir -p "$OUT"
BASE=https://huggingface.co/datasets/browndw/human-ai-parallel-corpus/resolve/main/text_data
for f in human-chunk-2 gpt-4o-2024-08-06 gpt-4o-mini-2024-07-18 llama-3-70B-Instruct llama-3-8B-Instruct; do
  curl -sSL -o "$OUT/$f.parquet" "$BASE/hape-text_$f.parquet"
done
# Needs pyarrow (pip install pyarrow).
python3 - "$OUT" <<'PY'
import json, sys, pyarrow.parquet as pq
out = sys.argv[1]
for f in ['human-chunk-2','gpt-4o-2024-08-06','gpt-4o-mini-2024-07-18','llama-3-70B-Instruct','llama-3-8B-Instruct']:
    with open(f'{out}/{f}.jsonl', 'w') as o:
        for r in pq.read_table(f'{out}/{f}.parquet').to_pylist():
            o.write(json.dumps({'doc_id': r['doc_id'], 'text': r['text']}) + '\n')
    print('converted', f)
PY
