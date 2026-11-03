// #140: recall cost of rhetorical-tic carve-outs. Counts only; no corpus text leaves this machine
// except when --show is passed (local inspection).
const REPO = require('path').resolve(__dirname, '../../..');
const AIDetector = require(REPO + '/detector/patterns.js');
const { measure } = require(REPO + '/scripts/fp-measure.js');
const SHOW = process.argv.includes('--show');
const texts = [];
const wrap = { analyzeText(text, o) { const r = AIDetector.analyzeText(text, o); texts.push({ text, r }); return r; } };
const m = measure({ unit: 'document', detector: wrap });
const sel = m.records.filter((r) => r.recordKind === 'unit' && r.selectionStatus === 'selected');
if (sel.length !== texts.length) throw new Error('mismatch');
const docs = sel.map((rec, i) => ({ cls: rec.cls, doc: rec.doc, register: rec.register, ...texts[i] }));
const words = { human: 0, machine: 0 }; for (const d of docs) words[d.cls] += d.text.split(/\s+/).filter(Boolean).length;
const STOP = "(?!matter\\b|one\\b|doubt\\b|longer\\b|way\\b|less\\b|more\\b|such\\b|other\\b|means\\b)";
const STOP2 = "(?!(?:in|on|at|of|to|for|with|from|by|is|are|was|were|be|been|being|will|would|can|could|should|shall|may|might|must|have|has|had|do|does|did)\\b)";
const ITEM = STOP + "[a-z'’-]+(?:\\s+" + STOP2 + "[a-z'’-]+)?";
const chain = (anchor, first, min, flags = 'gm') => new RegExp(anchor + first + "\\s+" + ITEM + "(?:\\s*,\\s*(?:and\\s+|or\\s+|just\\s+)?no\\s+" + ITEM + "){" + min + ",}", flags);
const A_CUR = "(?<=^|[.!?]\\s|\\n|[:\\u2013\\u2014]\\s)";
const variants = {
  'nochain/current (sentence-initial No, 3+)': chain(A_CUR, 'No', 2),
  'nochain/2-item (sentence-initial No, 2+)': chain(A_CUR, 'No', 1),
  'nochain/lowercase after colon-dash (3+)': chain("(?<=[:\\u2013\\u2014]\\s|\\s--\\s)", 'no', 2),
  'nochain/lowercase after colon-dash (2+)': chain("(?<=[:\\u2013\\u2014]\\s|\\s--\\s)", 'no', 1),
  'nochain/unanchored any case (3+)': chain("\\b", '[Nn]o', 2),
  'phrase/the punchline': /\bthe\s+punchline\b/gi,
  'phrase/worth naming': /\bworth\s+naming\b/gi,
  'phrase/batteries included': /\bbatteries[-\s]+included\b/gi,
  'devblog/it just works (current)': /\bit\s+just\s+works\b(?!\s+out\b(?![-\s]+of[-\s]+the[-\s]+box\b))/gi,
  'devblog/out-of-the-box unicode dash forms': /\bit\s+just\s+works\s+out[‐‑‒–—]of[‐‑‒–—]the[‐‑‒–—]box\b/gi,
};
const out = { revision: m.metadata.revision, unit: 'document', docs: { human: docs.filter((d) => d.cls === 'human').length, machine: docs.filter((d) => d.cls === 'machine').length }, words, variants: {} };
for (const [name, re] of Object.entries(variants)) {
  const c = { human: 0, machine: 0, humanQuoted: 0, machineQuoted: 0, humanDocs: new Set(), machineDocs: new Set() }; const shows = [];
  docs.forEach((d, i) => { for (const mt of d.text.matchAll(re)) { c[d.cls]++; c[d.cls + 'Docs'].add(i);
    const before = d.text.slice(Math.max(0, mt.index - 300), mt.index); const opens = (before.match(/["“]/g) || []).length; const quoted = opens % 2 === 1; if (quoted) c[d.cls + 'Quoted']++;
    if (SHOW) shows.push(`[${d.cls}${quoted ? ' quoted' : ''} ${d.doc}] …${d.text.slice(Math.max(0, mt.index - 60), mt.index).replace(/\s+/g, ' ')}<<${mt[0]}>>${d.text.slice(mt.index + mt[0].length, mt.index + mt[0].length + 40).replace(/\s+/g, ' ')}`); } });
  out.variants[name] = { human: c.human, machine: c.machine, humanQuoted: c.humanQuoted, machineQuoted: c.machineQuoted, humanDocs: c.humanDocs.size, machineDocs: c.machineDocs.size,
    perMillionWords: { human: +(c.human / words.human * 1e6).toFixed(2), machine: +(c.machine / words.machine * 1e6).toFixed(2) } };
  if (SHOW && shows.length) { console.error('\n## ' + name); shows.slice(0, 40).forEach((s) => console.error(s)); }
}
// Detector-path recall check: how many raw current-regex hits survive into the detector's negation-chain findings (masking cost)
let raw = 0, found = 0; for (const d of docs) { raw += [...d.text.matchAll(variants['nochain/current (sentence-initial No, 3+)'])].length; found += (d.r.issues || []).filter((x) => x.type === 'negation-chain' && /^no\b/i.test(x.text || '')).length; }
out.maskingCheck = { rawCurrentRegexHits: raw, detectorNoChainFindings: found };
const nc = { human: 0, machine: 0 }; for (const d of docs) nc[d.cls] += (d.r.issues || []).filter((x) => x.type === 'negation-chain').length; out.detectorNegationChainAll = nc;
const dv = { human: 0, machine: 0 }; for (const d of docs) dv[d.cls] += (d.r.issues || []).filter((x) => x.type === 'dev-blog-boilerplate').length; out.detectorDevBlogAll = dv;
console.log(JSON.stringify(out, null, 1));
