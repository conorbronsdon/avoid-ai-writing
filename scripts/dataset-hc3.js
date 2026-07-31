/**
 * Avoid AI Writing — HC3 sampler
 *
 * Builds the assistant-register half of the machine corpus from HC3, the
 * Human ChatGPT Comparison Corpus (Guo et al. 2023,
 * https://huggingface.co/datasets/Hello-SimpleAI/HC3, CC-BY-SA-4.0).
 *
 * Why this exists alongside RAID: RAID's task is in-domain continuation —
 * finish this news article, write this recipe. Measured against it, this
 * detector scored a 0% true-positive rate, and inspection showed why. RAID's
 * machine text is encyclopedia entries and novel blurbs, not the register this
 * skill was built to catch: assistant prose, with its hedging, its "it is
 * important to note", its dutiful both-sides summaries.
 *
 * HC3 is that register. Every record is one question with both a human answer
 * and a ChatGPT answer, so the comparison is paired on topic — the strongest
 * design available without generating anything here.
 *
 * The large caveat, stated up front: HC3 was collected in December 2022 from
 * the original ChatGPT. That is the era whose habits the whole anti-AI-writing
 * genre was built to catch. A true-positive rate measured here is an **upper
 * bound** on performance against current models, not an estimate of it.
 */

const DOMAINS = {
  // file → register. Register is the topic domain; the machine answers are all
  // assistant register regardless.
  'wiki_csai.jsonl': { register: 'docs', bytes: null },
  'open_qa.jsonl': { register: 'conversational', bytes: null },
  'finance.jsonl': { register: 'blog', bytes: 12_000_000 },
  'medicine.jsonl': { register: 'academic', bytes: 12_000_000 },
  'reddit_eli5.jsonl': { register: 'conversational', bytes: 12_000_000 },
};

const BASE = 'https://huggingface.co/datasets/Hello-SimpleAI/HC3/resolve/main/';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wordCount = (s) => (s.match(/\S+/g) || []).length;

async function fetchFile(file, bytes) {
  const headers = bytes ? { Range: `bytes=0-${bytes}` } : {};
  const res = await fetch(BASE + file, { headers, signal: AbortSignal.timeout(180000) });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${file}`);
  return res.text();
}

/**
 * @param {object} spec
 * @param {number} spec.perDomain  max question records per domain file
 * @param {number} spec.seed
 * @param {number} [spec.minWords]
 */
async function build(spec, log = () => {}) {
  const { perDomain = 60, seed = 20260731, minWords = 60 } = spec;
  const selected = [];

  for (const [file, cfg] of Object.entries(DOMAINS)) {
    let raw;
    try {
      raw = await fetchFile(file, cfg.bytes);
    } catch (err) {
      log(`  ${file}: ${err.message}`);
      continue;
    }
    const lines = raw.split('\n');
    // A byte-range request cuts the final line in half.
    if (cfg.bytes) lines.pop();

    const records = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch (e) { continue; }
      const human = (rec.human_answers || []).find((a) => wordCount(a) >= minWords);
      const machine = (rec.chatgpt_answers || []).find((a) => wordCount(a) >= minWords);
      // Keep only records where BOTH sides clear the floor, so the pairing
      // holds and neither class is silently filtered differently.
      if (!human || !machine) continue;
      records.push({ q: rec.question, human, machine });
    }

    const rand = mulberry32(seed + file.length);
    const shuffled = records.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const take = shuffled.slice(0, perDomain);
    const domain = file.replace('.jsonl', '');
    for (const [i, r] of take.entries()) {
      selected.push({
        id: `hc3-${domain}-${i}-h`, model: 'human', domain, register: cfg.register,
        class: 'human', paired: `hc3-${domain}-${i}`, text: r.human.trim(),
      });
      selected.push({
        id: `hc3-${domain}-${i}-m`, model: 'chatgpt-2022-12', domain, register: cfg.register,
        class: 'machine', paired: `hc3-${domain}-${i}`, text: r.machine.trim(),
      });
    }
    log(`  ${file}: ${records.length} paired records available, ${take.length} taken`);
  }

  selected.sort((a, b) => a.id.localeCompare(b.id));

  const byClass = {};
  const byDomain = {};
  for (const r of selected) {
    byClass[r.class] = (byClass[r.class] || 0) + 1;
    byDomain[r.domain] = (byDomain[r.domain] || 0) + 1;
  }

  const warnings = [];
  if ((byClass.machine || 0) < 200) warnings.push(`${byClass.machine || 0} machine units (want >= 200)`);
  if (Object.keys(byDomain).length < 4) warnings.push(`only ${Object.keys(byDomain).length} domains`);
  warnings.push('single model family (ChatGPT, Dec 2022) — a TPR here is an upper bound, not an estimate for current models');
  for (const w of warnings) log(`  NOTE: ${w}`);

  return {
    jsonl: selected.map((r) => JSON.stringify(r)).join('\n') + '\n',
    stats: { selected: selected.length, by_class: byClass, by_domain: byDomain, warnings },
  };
}

module.exports = { build, DOMAINS };
