// Exploratory HAP-E run (browndw/human-ai-parallel-corpus, MIT). Counts only; text stays local.
const fs = require('fs'); const REPO = require('path').resolve(__dirname, '../../..'); const HAPE = process.env.HAPE_DIR || require('path').resolve(__dirname, '../../../corpus/cache/hape');
const AIDetector = require(REPO + '/detector/patterns.js'); const { rocAuc } = require(REPO + '/scripts/fp-measure.js');
const src = fs.readFileSync(REPO + '/detector/patterns.js', 'utf8'); const st = src.indexOf('const ISSUE_WEIGHTS = {') + 'const ISSUE_WEIGHTS = '.length;
let dp = 0, en = st; for (; en < src.length; en++) { if (src[en] === '{') dp++; if (src[en] === '}') { dp--; if (!dp) { en++; break; } } } const W = Function('return ' + src.slice(st, en))();
const SHOW = process.argv.includes('--show'); const LIMIT = +(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) || 1e9);
const files = { human: 'human-chunk-2', 'gpt-4o': 'gpt-4o-2024-08-06', 'gpt-4o-mini': 'gpt-4o-mini-2024-07-18', 'llama-3-70B-Instruct': 'llama-3-70B-Instruct', 'llama-3-8B-Instruct': 'llama-3-8B-Instruct' };
const STOP = "(?!matter\\b|one\\b|doubt\\b|longer\\b|way\\b|less\\b|more\\b|such\\b|other\\b|means\\b)";
const STOP2 = "(?!(?:in|on|at|of|to|for|with|from|by|is|are|was|were|be|been|being|will|would|can|could|should|shall|may|might|must|have|has|had|do|does|did)\\b)";
const ITEM = STOP + "[a-z'’-]+(?:\\s+" + STOP2 + "[a-z'’-]+)?";
const chain = (anchor, first, min) => new RegExp(anchor + first + "\\s+" + ITEM + "(?:\\s*,\\s*(?:and\\s+|or\\s+|just\\s+)?no\\s+" + ITEM + "){" + min + ",}", 'gm');
const A_CUR = "(?<=^|[.!?]\\s|\\n|[:\\u2013\\u2014]\\s)"; const A_COLON = "(?<=[:\\u2013\\u2014]\\s|\\s--\\s)";
const V = {
  'nochain/current: sentence-initial No, 3+ items': chain(A_CUR, 'No', 2),
  'nochain/loosen: sentence-initial No, 2 items': chain(A_CUR, 'No', 1),
  'nochain/loosen: lowercase no after colon/dash, 3+': chain(A_COLON, 'no', 2),
  'nochain/loosen: lowercase no after colon/dash, 2': chain(A_COLON, 'no', 1),
  'nochain/control: unanchored, 3+': chain('\\b', '[Nn]o', 2),
  'phrase: the punchline': /\bthe\s+punchline\b/gi,
  'phrase: worth naming': /\bworth\s+naming\b/gi,
  'phrase: batteries included': /\bbatteries[-\s]+included\b/gi,
  'devblog/current: it just works': /\bit\s+just\s+works\b(?!\s+out\b(?![-\s]+of[-\s]+the[-\s]+box\b))/gi,
  'devblog/loosen: unicode-dash out-of-the-box': /\bit\s+just\s+works\s+out[‐-—]of[‐-—]the[‐-—]box\b/gi,
};
const res = {}; const shows = {}; const scores = {}; const reg = {};
for (const [cls, f] of Object.entries(files)) {
  const lines = fs.readFileSync(HAPE + '/' + f + '.jsonl', 'utf8').trim().split('\n').slice(0, LIMIT).map((l) => JSON.parse(l));
  let words = 0; const c = {}; for (const k of Object.keys(V)) c[k] = { hits: 0, quoted: 0, detectorFlagged: 0 }; scores[cls] = [];
  for (const { doc_id, text } of lines) {
    words += text.split(/\s+/).filter(Boolean).length; const key = doc_id.split('@')[0]; const register = key.split('_')[0];
    const r = AIDetector.analyzeText(text, { contextMode: 'general', sourceMode: 'plain' });
    const iss = r.issues || []; const raw = iss.reduce((s, i) => s + (W[i.type] ?? 2), 0);
    scores[cls].push({ key, register, score: r.score ?? 0, raw, words: r.stats?.wordCount || 0, types: iss.map((i) => i.type) });
    for (const [k, re] of Object.entries(V)) for (const mt of text.matchAll(re)) {
      c[k].hits++; const before = text.slice(Math.max(0, mt.index - 300), mt.index); const quoted = (before.match(/["“]/g) || []).length % 2 === 1; if (quoted) c[k].quoted++;
      if (iss.some((i) => Number.isInteger(i.index) && i.index <= mt.index + 2 && i.index + (i.text || '').length >= mt.index + 2 && ['negation-chain', 'dev-blog-boilerplate'].includes(i.type))) c[k].detectorFlagged++;
      if (SHOW) (shows[k] ||= []).push(`[${cls}${quoted ? ' q' : ''} ${key}] …${text.slice(Math.max(0, mt.index - 70), mt.index).replace(/\s+/g, ' ')}<<${mt[0]}>>${text.slice(mt.index + mt[0].length, mt.index + mt[0].length + 50).replace(/\s+/g, ' ')}`);
    }
  }
  for (const k of Object.keys(c)) c[k].perMillion = +(c[k].hits / words * 1e6).toFixed(2);
  res[cls] = { docs: lines.length, words, variants: c };
  const dt = {}; for (const s of scores[cls]) for (const t of s.types) dt[t] = (dt[t] || 0) + 1; res[cls].negationChainDetector = dt['negation-chain'] || 0; res[cls].devBlogDetector = dt['dev-blog-boilerplate'] || 0;
}
// #70 on HAP-E: per-model AUC vs human, range, label occupancy, any-hit AUC, per-register AUC, paired win rate
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const H = scores.human; const s70 = {};
for (const cls of Object.keys(files)) { const A = scores[cls]; const o = { max: Math.max(...A.map((d) => d.score)), zeroShare: +(A.filter((d) => !d.score).length / A.length).toFixed(3), p50: q(A.map((d) => d.score), .5), p90: q(A.map((d) => d.score), .9), p99: q(A.map((d) => d.score), .99), medianWords: q(A.map((d) => d.words), .5), over15: +(A.filter((d) => d.score > 15).length / A.length).toFixed(4) };
  if (cls !== 'human') { o.aucScore = +rocAuc(A.map((d) => d.score), H.map((d) => d.score)).toFixed(3); o.aucAnyHit = +rocAuc(A.map((d) => +(d.raw > 0)), H.map((d) => +(d.raw > 0))).toFixed(3); o.aucPer100 = +rocAuc(A.map((d) => d.raw / Math.max(1, d.words)), H.map((d) => d.raw / Math.max(1, d.words))).toFixed(3);
    const hp95 = q(H.map((d) => d.score), .95); o.tprAboveHumanP95 = { flagAt: '>=' + (hp95 + 1), fpr: +(H.filter((d) => d.score > hp95).length / H.length).toFixed(3), tpr: +(A.filter((d) => d.score > hp95).length / A.length).toFixed(3) };
    const hm = new Map(H.map((d) => [d.key, d.score])); let win = 0, tie = 0, n = 0; for (const d of A) if (hm.has(d.key)) { n++; const h = hm.get(d.key); if (d.score > h) win++; else if (d.score === h) tie++; } o.paired = { n, machineHigher: +(win / n).toFixed(3), tie: +(tie / n).toFixed(3) };
    o.byRegisterAUC = {}; for (const rg of ['acad', 'blog', 'fic', 'news', 'spok', 'tvm']) { const v = rocAuc(A.filter((d) => d.register === rg).map((d) => d.score), H.filter((d) => d.register === rg).map((d) => d.score)); o.byRegisterAUC[rg] = v == null ? null : +v.toFixed(3); } }
  s70[cls] = o; }
console.log(JSON.stringify({ revision: require('child_process').execSync('git -C ' + REPO + ' rev-parse HEAD').toString().trim(), carve140: res, score70: s70 }, null, 1));
if (SHOW) for (const [k, arr] of Object.entries(shows)) { console.error('\n## ' + k + ' (' + arr.length + ')'); arr.slice(0, 25).forEach((x) => console.error(x)); }
