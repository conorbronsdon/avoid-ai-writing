// #249: test measurable "AI writes X / humans write Y" claims on HAP-E. Counts only.
const fs = require('fs'); const HAPE = process.env.HAPE_DIR || require('path').resolve(__dirname, '../../../corpus/cache/hape');
const { rocAuc } = require(require('path').resolve(__dirname, '../../../scripts/fp-measure.js'));
const files = { human: 'human-chunk-2', 'gpt-4o': 'gpt-4o-2024-08-06', 'gpt-4o-mini': 'gpt-4o-mini-2024-07-18', 'llama-70B-I': 'llama-3-70B-Instruct', 'llama-8B-I': 'llama-3-8B-Instruct' };
const sents = (t) => (t.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || []).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 2);
const PRON = new Set(['i', 'he', 'she', 'it', 'we', 'they', 'you', 'the', 'a', 'and', 'but']);
const rx = {
  colonTriple: /:\s+[^,.;:!?\n]{1,40},\s+[^,.;:!?\n]{1,40},\s+(?:and|or)\s+[^,.;:!?\n]{1,40}[.;!?\n]/g,
  strandedAux: /(?:[;.]|—)\s+(?:[A-Z][a-z]+|[Tt]he\s+[a-z]+)\s+(?:didn['’]t|doesn['’]t|don['’]t|wasn['’]t|isn['’]t|won['’]t|can['’]t|couldn['’]t|wouldn['’]t|hasn['’]t|haven['’]t|weren['’]t|aren['’]t)[.!]/g,
  copulaSwap: /\b(?:serves?\s+as|boasts?|stands?\s+as|represents?\s+a)\b/gi,
  hyphenStack: /\b[a-z]+-[a-z]+,\s+(?:[a-z]+\s+)?[a-z]+-[a-z]+\b/gi,
  calibration: /(?:^|[.!?]\s+)(?:Notably|Interestingly|Importantly|Significantly|Surprisingly|Undoubtedly|Certainly),/gm,
};
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3); };
const res = {}; const per = {};
for (const [cls, f] of Object.entries(files)) {
  let words = 0; const c = Object.fromEntries(Object.keys(rx).map((k) => [k, 0])); c.sameOpenerRun3 = 0; c.sameOpenerRun3NonFunction = 0;
  const cv = [], ttr = [], reg = {};
  for (const l of fs.readFileSync(HAPE + '/' + f + '.jsonl', 'utf8').trim().split('\n')) {
    const { doc_id, text } = JSON.parse(l); const toks = text.split(/\s+/).filter(Boolean); words += toks.length; const rg = doc_id.split('_')[0];
    for (const [k, r] of Object.entries(rx)) c[k] += (text.match(r) || []).length;
    const ss = sents(text); const lens = ss.map((s) => s.split(/\s+/).length);
    if (lens.length >= 5) { const m = lens.reduce((a, b) => a + b, 0) / lens.length; const sd = Math.sqrt(lens.reduce((a, b) => a + (b - m) ** 2, 0) / lens.length); cv.push(sd / m); (reg[rg] ||= { cv: [], ttr: [] }).cv.push(sd / m); }
    const fw = ss.map((s) => (s.match(/[A-Za-z']+/) || [''])[0].toLowerCase()); let run = 1;
    for (let i = 1; i < fw.length; i++) { if (fw[i] && fw[i] === fw[i - 1]) { run++; if (run === 3) { c.sameOpenerRun3++; if (!PRON.has(fw[i])) c.sameOpenerRun3NonFunction++; } } else run = 1; }
    const w200 = toks.map((t) => t.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '')).filter(Boolean);
    if (w200.length >= 200) { const s = w200.slice(0, 200); const v = new Set(s).size / 200; ttr.push(v); (reg[rg] ||= { cv: [], ttr: [] }).ttr.push(v); }
  }
  per[cls] = { cv, ttr, reg };
  res[cls] = { words, perMillionWords: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, +(v / words * 1e6).toFixed(1)])),
    sentenceLengthCV: { p25: q(cv, .25), p50: q(cv, .5), p75: q(cv, .75), n: cv.length },
    ttr200: { p5: q(ttr, .05), p25: q(ttr, .25), p50: q(ttr, .5), p75: q(ttr, .75), shareInside050_065: +(ttr.filter((v) => v >= .5 && v <= .65).length / ttr.length).toFixed(3), shareBelow040: +(ttr.filter((v) => v < .4).length / ttr.length).toFixed(4), n: ttr.length } };
}
for (const cls of Object.keys(files)) if (cls !== 'human') {
  // AUC > 0.5 means machine LOWER cv / LOWER ttr (claim direction)
  res[cls].aucClaimDirection = { cvLowerInMachine: +rocAuc(per[cls].cv.map((x) => -x), per.human.cv.map((x) => -x)).toFixed(3), ttrLowerInMachine: +rocAuc(per[cls].ttr.map((x) => -x), per.human.ttr.map((x) => -x)).toFixed(3) };
  res[cls].cvMedianByRegister = Object.fromEntries(Object.keys(per.human.reg).map((r) => [r, [q(per.human.reg[r].cv, .5), q(per[cls].reg[r]?.cv || [0], .5)]]));
  res[cls].ttrMedianByRegister = Object.fromEntries(Object.keys(per.human.reg).map((r) => [r, [q(per.human.reg[r].ttr, .5), q(per[cls].reg[r]?.ttr || [0], .5)]]));
}
console.log(JSON.stringify(res, null, 1));
