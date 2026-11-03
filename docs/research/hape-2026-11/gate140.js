const fs = require('fs'); const HAPE = process.env.HAPE_DIR || require('path').resolve(__dirname, '../../../corpus/cache/hape');
const files = { human: 'human-chunk-2', 'gpt-4o': 'gpt-4o-2024-08-06', 'gpt-4o-mini': 'gpt-4o-mini-2024-07-18', 'llama-70B-I': 'llama-3-70B-Instruct', 'llama-8B-I': 'llama-3-8B-Instruct' };
const STOP = "(?!matter\\b|one\\b|doubt\\b|longer\\b|way\\b|less\\b|more\\b|such\\b|other\\b|means\\b)";
const STOP2 = "(?!(?:in|on|at|of|to|for|with|from|by|is|are|was|were|be|been|being|will|would|can|could|should|shall|may|might|must|have|has|had|do|does|did)\\b)";
const ITEM = STOP + "[a-z'’-]+(?:\\s+" + STOP2 + "[a-z'’-]+)?";
const A = "(?<=^|[.!?]\\s|\\n|[:\\u2013\\u2014]\\s)";
const exactly2 = new RegExp(A + "No\\s+" + ITEM + "\\s*,\\s*(?:and\\s+|or\\s+|just\\s+)?no\\s+" + ITEM + "(?!\\s*,\\s*(?:and\\s+|or\\s+)?no\\s)", 'gm');
const JUST = /^\s*(?:[.!;:,]|\s[–—-]+|[–—]|--)\s*(?:just|only|simply|nothing\s+but)\b/i;
const CUR3 = new RegExp(A + "No\\s+" + ITEM + "(?:\\s*,\\s*(?:and\\s+|or\\s+|just\\s+)?no\\s+" + ITEM + "){2,}", 'gm');
const V = { 'exactly-2 (sentence-initial)': [exactly2, null], 'exactly-2 + Just/Only follow-up': [exactly2, JUST], 'punchline rhetorical (here\'s|the punchline is|:)': [/\b(?:here['’]s\s+the\s+punchline|the\s+punchline\s*(?:is|was)?\s*:|the\s+punchline\s+is\s+(?:this|that|simple))/gi, null] };
const out = {};
for (const [cls, f] of Object.entries(files)) { const o = {}; let words = 0;
  for (const l of fs.readFileSync(HAPE + '/' + f + '.jsonl', 'utf8').trim().split('\n')) { const { text } = JSON.parse(l); words += text.split(/\s+/).length;
    for (const [k, [re, gate]] of Object.entries(V)) for (const mt of text.matchAll(re)) { const after = text.slice(mt.index + mt[0].length, mt.index + mt[0].length + 40); const cur = [...text.matchAll(CUR3)].some((c) => c.index === mt.index); if (!gate || gate.test(after)) { o[k] = (o[k] || 0) + 1; if (!cur) o[k + ' [NEW vs current]'] = (o[k + ' [NEW vs current]'] || 0) + 1; if (process.env.SHOW && gate && cls==='human' || process.env.SHOW && gate && !cur && Math.random()<0.3) console.error(cls, '…'+text.slice(Math.max(0,mt.index-50),mt.index+mt[0].length+45).replace(/\s+/g,' ')); } } }
  out[cls] = { words, ...o }; }
console.log(JSON.stringify(out, null, 1));
