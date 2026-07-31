/**
 * Avoid AI Writing — minimal RFC 4180 CSV reader
 *
 * The machine-written corpus comes from a 3.7 GB CSV whose text fields contain
 * commas, quotes, and newlines. Splitting on commas would silently corrupt the
 * generations being measured, which is the kind of bug that changes a published
 * number without failing anything.
 *
 * Dependency-free by policy: this repo ships no node_modules, so a parser is
 * vendored rather than installed. It handles quoted fields, escaped quotes
 * (""), embedded newlines, and CRLF. It does not handle alternate delimiters
 * or comment lines, because the input does not use them.
 */

/**
 * Parse CSV text into rows of objects keyed by the header row.
 * @param {string} text
 * @param {object} [opts]
 * @param {boolean} [opts.dropLastPartial] drop a trailing record that was cut
 *        off mid-file, which is what a byte-range request produces
 * @returns {{header: string[], rows: object[]}}
 */
function parseCsv(text, opts = {}) {
  const rows = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  let sawAnyQuote = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }

    if (ch === '"') { inQuotes = true; sawAnyQuote = true; i++; continue; }
    if (ch === ',') { record.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { record.push(field); rows.push(record); record = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  // Trailing record with no final newline.
  if (field.length || record.length) { record.push(field); rows.push(record); }

  const header = rows.shift() || [];
  // A byte-range request almost always cuts the final record in half, and an
  // unterminated quote means everything after it landed in one giant field.
  if (opts.dropLastPartial && rows.length && (inQuotes || rows[rows.length - 1].length !== header.length)) {
    rows.pop();
  }

  const objects = rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx]])));

  return { header, rows: objects, truncated: inQuotes, sawAnyQuote };
}

module.exports = { parseCsv };
