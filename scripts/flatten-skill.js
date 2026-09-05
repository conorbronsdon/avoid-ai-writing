'use strict';
const fs = require('node:fs');
const path = require('node:path');
function flatten(root) {
  let front = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const reference = fs.readFileSync(path.join(root, 'references/patterns.md'), 'utf8').replace(/\r\n/g, '\n');
  const boundary = '## Context profiles\n';
  if (!reference.startsWith('## What to remove or fix\n') || reference.split(boundary).length !== 2) throw new Error('Invalid pattern reference boundaries');
  const index = reference.indexOf(boundary);
  const loading = /<!-- reference-loading:start -->\n[\s\S]*?<!-- reference-loading:end -->\n\n/g;
  if ((front.match(loading) || []).length !== 1) throw new Error('Expected one reference-loading instruction');
  front = front.replace(loading, '');
  for (const [name, content] of [['catalog', reference.slice(0, index)], ['profiles', reference.slice(index)]]) {
    const marker = `<!-- patterns:${name} -->\n\n`;
    if (front.split(marker).length !== 2) throw new Error(`Expected one ${name} include marker`);
    front = front.replace(marker, () => content);
  }
  if (/<!-- patterns:/.test(front)) throw new Error('Unknown pattern include marker');
  return front;
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const result = flatten(root);
  const target = path.join(root, 'SKILL.full.md');
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== result) throw new Error('SKILL.full.md drifted; run node scripts/flatten-skill.js');
  } else fs.writeFileSync(target, result);
}
module.exports = { flatten };
