// #70 analysis: score range, monotone-rescaling ceiling, alternative length normalizations, fitted weights.
const path = require('path'); const fs = require('fs');
const REPO = require('path').resolve(__dirname, '../../..');
const AIDetector = require(REPO + '/detector/patterns.js');
const { measure, rocAuc } = require(REPO + '/scripts/fp-measure.js');
const src = fs.readFileSync(REPO + '/detector/patterns.js', 'utf8');
const start = src.indexOf('const ISSUE_WEIGHTS = {') + 'const ISSUE_WEIGHTS = '.length;
let depth = 0, end = start; for (; end < src.length; end++) { if (src[end] === '{') depth++; if (src[end] === '}') { depth--; if (!depth) { end++; break; } } }
const W = Function('return ' + src.slice(start, end))();
const unit = process.argv[2] || 'paragraph';
const rows = [];
const wrap = { analyzeText(text, o) { const r = AIDetector.analyzeText(text, o); if (r && r.issues && r.stats) { const raw = r.issues.reduce((s, i) => s + (W[i.type] ?? 2), 0); rows.push({ raw, words: r.stats.wordCount, score: r.score, types: r.issues.map((i) => i.type) }); r.__k = rows.length - 1; } return r; } };
const m = measure({ unit, detector: wrap });
// map units to rows via order: units are pushed in same order as successful analyze calls that are not skipped
// safer: re-key by recomputing
const U = m.units.map((u) => { const r = AIDetector.analyzeText; return u; });
// re-run per unit is impossible without text; instead match by sequence: rows for skipped (too-short etc.) have stats too.
// Use record order: every selected decision produced exactly one analyze call.
const sel = m.records.filter((r) => r.recordKind === 'unit' && r.selectionStatus === 'selected');
if (sel.length !== rows.length) throw new Error('row mismatch ' + sel.length + ' ' + rows.length);
const data = []; sel.forEach((rec, i) => { if (rec.status !== 'skipped') data.push({ ...rows[i], cls: rec.cls, doc: rec.doc, register: rec.register, model: rec.model }); });
let bad = 0; for (const d of data) { const lf = Math.max(1, Math.log2(d.words / 50)); if (Math.min(100, Math.round(d.raw / lf)) !== d.score) bad++; }
const H = data.filter((d) => d.cls === 'human'), M = data.filter((d) => d.cls === 'machine');
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const out = { unit, revision: m.metadata.revision, n: { human: H.length, machine: M.length }, rawReconstructionMismatches: bad };
const f = { score: (d) => d.score, raw: (d) => d.raw, per100: (d) => d.raw / d.words * 100, perSqrt: (d) => d.raw / Math.sqrt(d.words), anyHit: (d) => d.raw > 0 ? 1 : 0 };
out.auc = {}; for (const [k, fn] of Object.entries(f)) out.auc[k] = +rocAuc(M.map(fn), H.map(fn)).toFixed(3);
out.max = { human: Math.max(...H.map((d) => d.score)), machine: Math.max(...M.map((d) => d.score)) };
out.zeroShare = { human: +(H.filter((d) => d.score === 0).length / H.length).toFixed(3), machine: +(M.filter((d) => d.score === 0).length / M.length).toFixed(3) };
out.quantiles = {}; for (const p of [0.5, 0.75, 0.9, 0.95, 0.99]) out.quantiles['p' + p * 100] = { human: q(H.map((d) => d.score), p), machine: q(M.map((d) => d.score), p) };
const bands = (s) => s === 0 ? 'Clean' : s <= 15 ? 'Minimal' : s <= 35 ? 'Some' : s <= 60 ? 'Moderate' : s <= 80 ? 'Strong' : 'Heavy';
out.labels = {}; for (const [c, A] of [['human', H], ['machine', M]]) { const t = {}; for (const d of A) t[bands(d.score)] = (t[bands(d.score)] || 0) + 1; out.labels[c] = t; }
// percentile bands (option 2): threshold at human pXX of score; report TPR and realized FPR (ties!)
out.percentileBands = {}; for (const p of [0.9, 0.95, 0.99]) { const t = q(H.map((d) => d.score), p); const thr = t + 1; out.percentileBands['p' + p * 100] = { humanScoreAtP: t, flagAt: '>=' + thr, fpr: +(H.filter((d) => d.score >= thr).length / H.length).toFixed(3), tpr: +(M.filter((d) => d.score >= thr).length / M.length).toFixed(3) }; }
// per-source AUC for sources with both classes, + per-register
out.bySource = {}; for (const doc of [...new Set(data.map((d) => d.doc))]) { const h = H.filter((d) => d.doc === doc), mm = M.filter((d) => d.doc === doc); if (h.length && mm.length) out.bySource[doc] = { h: h.length, m: mm.length, aucScore: +rocAuc(mm.map(f.score), hh(h)).toFixed(3), aucPer100: +rocAuc(mm.map(f.per100), h.map(f.per100)).toFixed(3) }; }
function hh(h) { return h.map(f.score); }
// Within-source human vs machine word count (length confound)
out.medianWords = { human: q(H.map((d) => d.words), 0.5), machine: q(M.map((d) => d.words), 0.5) };
// Fitted-weights ceiling: logistic regression on category counts + log words, 5-fold CV, stratified by doc (leave-doc-group-out for mixed docs is not possible; use random folds)
const cats = [...new Set(data.flatMap((d) => d.types))].sort();
const X = data.map((d) => { const v = cats.map((c) => d.types.filter((t) => t === c).length); v.push(Math.log2(d.words / 50)); return v; }); const y = data.map((d) => d.cls === 'machine' ? 1 : 0);
function fit(Xs, ys, l2 = 1.0, it = 400, lr = 0.1) { const k = Xs[0].length; let w = new Array(k).fill(0), b = 0; for (let e = 0; e < it; e++) { const g = new Array(k).fill(0); let gb = 0; for (let i = 0; i < Xs.length; i++) { const z = b + Xs[i].reduce((s, x, j) => s + x * w[j], 0); const p = 1 / (1 + Math.exp(-z)); const err = p - ys[i]; gb += err; for (let j = 0; j < k; j++) g[j] += err * Xs[i][j]; } for (let j = 0; j < k; j++) w[j] -= lr * (g[j] / Xs.length + l2 * w[j] / Xs.length); b -= lr * gb / Xs.length; } return { w, b }; }
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const idx = data.map((_, i) => i).sort(() => rnd() - 0.5); const folds = 5; const pred = new Array(data.length);
for (let f2 = 0; f2 < folds; f2++) { const test = idx.filter((_, i) => i % folds === f2), train = idx.filter((_, i) => i % folds !== f2); const md = fit(train.map((i) => X[i]), train.map((i) => y[i])); for (const i of test) pred[i] = md.b + X[i].reduce((s, x, j) => s + x * md.w[j], 0); }
out.fittedCV = { features: cats.length + 1, auc: +rocAuc(pred.filter((_, i) => y[i]), pred.filter((_, i) => !y[i])).toFixed(3), noteOnLength: 'includes log2(words/50) as a feature' };
// Same without length feature
const X2 = X.map((v) => v.slice(0, -1)); const pred2 = new Array(data.length);
for (let f2 = 0; f2 < folds; f2++) { const test = idx.filter((_, i) => i % folds === f2), train = idx.filter((_, i) => i % folds !== f2); const md = fit(train.map((i) => X2[i]), train.map((i) => y[i])); for (const i of test) pred2[i] = md.b + X2[i].reduce((s, x, j) => s + x * md.w[j], 0); }
out.fittedCVNoLength = +rocAuc(pred2.filter((_, i) => y[i]), pred2.filter((_, i) => !y[i])).toFixed(3);
out.lengthOnlyAUC = +rocAuc(M.map((d) => d.words), H.map((d) => d.words)).toFixed(3);
console.log(JSON.stringify(out, null, 1));
