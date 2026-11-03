'use strict';
// Hash retained evaluation evidence by its exact checked-out bytes.
//
// Frozen receipts record SHA-256 digests of files committed with LF endings.
// A Git checkout with core.autocrlf (the Windows default) would rewrite them
// to CRLF and every digest would differ (#427). .gitattributes marks the
// report tree -text, so Git leaves those bytes alone; this helper asserts that
// protection is in place, which keeps the guard red on Linux too, where the
// conversion itself never happens.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function checkoutAttributes(file) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const output = execFileSync('git', ['check-attr', 'text', 'eol', '--', relative], { cwd: root, encoding: 'utf8' });
  const attributes = {};
  for (const line of output.trim().split(/\r?\n/)) {
    const match = line.match(/: (text|eol): (.*)$/);
    if (match) attributes[match[1]] = match[2];
  }
  return attributes;
}

// Byte-stable means Git never converts the file (text unset) or always writes
// LF (eol=lf). Anything else depends on the checkout's core.autocrlf.
function isByteStable({ text, eol }) {
  return text === 'unset' || eol === 'lf';
}

function assertByteStable(file) {
  const attributes = checkoutAttributes(file);
  assert(isByteStable(attributes),
    `${path.relative(root, file)} is hashed as retained evidence but Git may convert its line endings on checkout ` +
    `(text: ${attributes.text}, eol: ${attributes.eol}); cover it with "-text" in .gitattributes`);
}

function retainedSha256(file) {
  assertByteStable(file);
  const bytes = fs.readFileSync(file);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function crlfHint(file) {
  return fs.readFileSync(file).includes('\r\n')
    ? `; ${path.relative(root, file)} contains CRLF, so it was likely converted on checkout. ` +
      'Re-checkout it after confirming .gitattributes marks it -text'
    : '';
}

function assertRetainedSha256(file, expected, label = path.relative(root, file)) {
  const actual = retainedSha256(file);
  assert.equal(actual, expected, `${label}: retained SHA-256 differs${crlfHint(file)}`);
}

module.exports = { assertByteStable, assertRetainedSha256, checkoutAttributes, isByteStable, retainedSha256 };
