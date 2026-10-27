'use strict';

// Proposal fixture only: no public detector API and no Vale translation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const SOURCE_COMMIT = '61a539f914495c4d12118b4ea8a3706535f0fb05';
const SOURCE_SHA256 = '37d6b022821f592b062e421c639789861b692e22388f65e8db0692154f7a59fd';

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
}

function buildSample(source) {
  // Git checkouts may use CRLF; the pin and emitted bytes use LF.
  const canonical = source.replace(/\r\n/g, '\n');
  const digest = crypto.createHash('sha256').update(canonical).digest('hex');
  if (digest !== SOURCE_SHA256) throw new Error('Pinned detector source changed; review before regenerating');
  const table = canonical.match(/^  const AI_UTM_SOURCE = (\[[\s\S]*?^  \]);/m);
  if (!table) throw new Error('Missing AI_UTM_SOURCE table');
  // Evaluate only the array from the hash-verified repository source.
  const patterns = vm.runInNewContext(table[1], Object.create(null), { timeout: 1000 });
  return deepFreeze({
    schemaVersion: '0.1.0-draft',
    source: { commit: SOURCE_COMMIT, path: 'detector/patterns.js', sha256LF: digest },
    scope: 'sample-only',
    rules: [{
      type: 'ai-utm-source',
      semantics: 'raw-js-regex-only',
      valeStatus: 'unverified',
      patterns: patterns.map(pattern => ({ source: pattern.source, flags: pattern.flags })),
    }],
  });
}

function serialize(sample) {
  return JSON.stringify(sample, null, 2) + '\n';
}

if (require.main === module) {
  process.stdout.write(serialize(buildSample(fs.readFileSync(path.join(__dirname, '../detector/patterns.js'), 'utf8'))));
}

module.exports = { buildSample, serialize };
