/* A CSV reader that handles the two things naive splitting gets wrong.
 *
 * Splitting a register export on the delimiter looks fine until it is not. In
 * the German medicine shortage export, 66 of 967 records contain a quoted field
 * with a semicolon or a line break inside it. Split on ";" and those records
 * silently shift by a column, so a reason ends up in the date field and a drug
 * name ends up nowhere. Nothing throws. The row just becomes quietly wrong.
 *
 * So: quotes group, "" is a literal quote inside a quoted field, and a newline
 * inside quotes is data rather than a record boundary.
 *
 * Still deliberately small. No type coercion, no header mapping beyond what
 * `rows` does, no streaming. Registers here are a few hundred kilobytes.
 */

/**
 * @param {string} text
 * @param {{ delimiter?: string }} [opts]
 * @returns {string[][]} every record, as raw fields
 */
export function parse(text, { delimiter = ',' } = {}) {
  const out = [];
  let record = [];
  let field = '';
  let quoted = false;
  let started = false; // distinguishes a trailing newline from a final empty record

  const endField = () => { record.push(field); field = ''; };
  const endRecord = () => { endField(); out.push(record); record = []; started = false; };

  const src = String(text ?? '').replace(/^﻿/, '');

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    started = true;

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '') { quoted = true; continue; }
    if (ch === delimiter) { endField(); continue; }
    if (ch === '\r') { if (src[i + 1] === '\n') i += 1; endRecord(); continue; }
    if (ch === '\n') { endRecord(); continue; }
    field += ch;
  }

  if (started || field !== '' || record.length > 0) endRecord();
  return out;
}

/**
 * The same, as objects keyed by the header row.
 * @param {string} text
 * @param {{ delimiter?: string }} [opts]
 * @returns {Record<string, string>[]}
 */
export function rows(text, opts = {}) {
  const records = parse(text, opts);
  if (records.length < 2) return [];
  const header = records[0].map((h) => h.trim());
  return records.slice(1)
    .filter((r) => r.length > 1 || (r[0] ?? '') !== '')
    .map((r) => {
      const obj = {};
      header.forEach((key, i) => { obj[key] = (r[i] ?? '').trim(); });
      return obj;
    });
}

/**
 * Registers still ship legacy single-byte encodings. The German shortage export
 * is cp1252, and decoding it as UTF-8 turns every umlaut into a replacement
 * character, which then fails to match anything a user typed.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {string} encoding
 */
export function decode(buffer, encoding = 'utf-8') {
  return new TextDecoder(encoding).decode(buffer);
}
