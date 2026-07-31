/**
 * Avoid AI Writing — RAID sampler
 *
 * Builds the machine-written half of the control corpus from RAID
 * (Dugan et al. 2024, https://huggingface.co/datasets/liamdugan/raid, MIT).
 *
 * Why an external dataset rather than generating text here: a corpus generated
 * by one model, prompted by the person evaluating the detector, measures that
 * person's prompting as much as the detector. RAID carries 11 model families,
 * 8 English domains, and its own human baseline, none of it produced by anyone
 * with a stake in this repo's numbers.
 *
 * The file is 11.8 GB, so it is sampled by byte-range windows at fixed offsets
 * rather than downloaded. Everything is deterministic: fixed offsets, a fixed
 * filter, a seeded balanced draw. Same inputs, same JSONL, same hash.
 *
 * Two classes come out of it:
 *   machine  every non-human generation, attack=none
 *   human    RAID's own human rows, kept as an independent human control from
 *            a different source and era than the maintainer's blog
 */

const { parseCsv } = require('./csv-lite.js');

const RAID_URL = 'https://huggingface.co/datasets/liamdugan/raid/resolve/main/train.csv';
const RAID_SIZE = 11779491051;
const HEADER = 'id,adv_source_id,source_id,model,decoding,repetition_penalty,attack,domain,title,prompt,generation\n';
const WINDOW_BYTES = 6_000_000;

// A record always starts at a line beginning with a UUID. Field values contain
// newlines, so the first newline in a window is not a record boundary.
const RECORD_START = /\n[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12},/;

/**
 * RAID domain → this corpus's register vocabulary. Only domains with a
 * defensible mapping are used; `code` and the non-English domains are dropped
 * rather than forced into a register they do not belong to.
 */
const DOMAIN_REGISTER = {
  abstracts: 'academic',
  news: 'blog',
  reviews: 'blog',
  reddit: 'conversational',
  wiki: 'docs',
  recipes: 'docs',
  books: 'essay-literary',
  poetry: 'essay-literary',
};

/** Deterministic PRNG so a seeded draw is reproducible across machines. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Byte offsets to sample, spread by the golden-ratio low-discrepancy sequence
 * rather than at even intervals.
 *
 * This is not decoration. The file is sorted by domain and then by model, so
 * evenly spaced offsets resonate with that block structure: a 40-window even
 * spread returned *fewer* model families than a 16-window one, having landed
 * repeatedly in the same regions and missed gpt4, chatgpt, and cohere
 * entirely. An irrational stride cannot align with a periodic layout.
 */
function offsets(count) {
  const PHI = 0.6180339887498949;
  return Array.from({ length: count }, (_, i) => {
    const frac = (i * PHI) % 1;
    return Math.floor(frac * (RAID_SIZE - WINDOW_BYTES - 1000)) + 1000;
  });
}

async function fetchWindow(offset) {
  const res = await fetch(RAID_URL, {
    headers: { Range: `bytes=${offset}-${offset + WINDOW_BYTES}` },
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} at offset ${offset}`);
  const raw = await res.text();
  const m = raw.match(RECORD_START);
  if (!m) return [];
  return parseCsv(HEADER + raw.slice(m.index + 1), { dropLastPartial: true }).rows;
}

function wordCount(s) {
  return (s.match(/\S+/g) || []).length;
}

/**
 * @param {object} spec
 * @param {number} spec.windows      how many byte-range windows to sample
 * @param {number} spec.perCell      max rows per (domain × model) cell
 * @param {number} spec.seed
 * @param {number} [spec.minWords]
 * @returns {Promise<{jsonl: string, stats: object}>}
 */
async function build(spec, log = () => {}) {
  const { windows = 16, perCell = 6, seed = 20260731, minWords = 60 } = spec;
  const pool = new Map(); // "domain|model" -> rows

  for (const [i, off] of offsets(windows).entries()) {
    let rows = [];
    try {
      rows = await fetchWindow(off);
    } catch (err) {
      log(`  window ${i + 1}/${windows}: ${err.message}`);
      continue;
    }
    let kept = 0;
    for (const r of rows) {
      if (r.attack !== 'none') continue;
      const register = DOMAIN_REGISTER[r.domain];
      if (!register) continue;
      const text = (r.generation || '').trim();
      if (wordCount(text) < minWords) continue;
      const key = `${r.domain}|${r.model}`;
      if (!pool.has(key)) pool.set(key, []);
      pool.get(key).push({
        id: r.id,
        model: r.model,
        domain: r.domain,
        decoding: r.decoding || null,
        register,
        class: r.model === 'human' ? 'human' : 'machine',
        text,
      });
      kept++;
    }
    log(`  window ${i + 1}/${windows} at ${(off / 1e6).toFixed(0)}MB: ${rows.length} rows, ${kept} eligible`);
  }

  // Balanced seeded draw: every populated cell contributes the same cap, so no
  // single model or domain sets the rate.
  const rand = mulberry32(seed);
  const selected = [];
  for (const key of [...pool.keys()].sort()) {
    const rows = pool.get(key).slice().sort((a, b) => a.id.localeCompare(b.id));
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    selected.push(...rows.slice(0, perCell));
  }
  selected.sort((a, b) => a.id.localeCompare(b.id));

  const byModel = {};
  const byDomain = {};
  const byClass = {};
  for (const r of selected) {
    byModel[r.model] = (byModel[r.model] || 0) + 1;
    byDomain[r.domain] = (byDomain[r.domain] || 0) + 1;
    byClass[r.class] = (byClass[r.class] || 0) + 1;
  }

  // Coverage warnings. A thin draw still produces a confident-looking rate, so
  // the shortfall has to be visible at build time rather than discovered when
  // someone quotes the number. Adapted from patina's public-claim gate.
  const machineModels = Object.keys(byModel).filter((m) => m !== 'human');
  const warnings = [];
  if (machineModels.length < 5) {
    warnings.push(`only ${machineModels.length} machine model families sampled (want >= 5): ${machineModels.join(', ')}`);
  }
  if (Object.keys(byDomain).length < 5) {
    warnings.push(`only ${Object.keys(byDomain).length} domains sampled (want >= 5)`);
  }
  if ((byClass.machine || 0) < 300) {
    warnings.push(`${byClass.machine || 0} machine units (want >= 300 for a +/-5pp interval)`);
  }
  for (const w of warnings) log(`  WARNING: ${w}`);

  return {
    jsonl: selected.map((r) => JSON.stringify(r)).join('\n') + '\n',
    stats: {
      cells: pool.size,
      selected: selected.length,
      by_class: byClass,
      by_model: byModel,
      by_domain: byDomain,
      warnings,
    },
  };
}

module.exports = { build, DOMAIN_REGISTER, RAID_URL };
