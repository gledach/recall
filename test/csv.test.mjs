/* The CSV reader, tested on the cases that break naive splitting.
 *
 * These are not hypothetical. 65 of 967 records in the live German shortage
 * export contain a quoted field with a semicolon or a line break in it, and
 * splitting on the delimiter shifts every later column in those records without
 * raising anything.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, rows, decode } from '../core/csv.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('splits plain records', () => {
  assert.deepEqual(parse('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('a delimiter inside quotes is data, not a boundary', () => {
  const r = parse('a;b\n"one;two";three', { delimiter: ';' });
  assert.deepEqual(r[1], ['one;two', 'three']);
});

test('a newline inside quotes does not end the record', () => {
  const r = parse('a;b\n"line one\nline two";after', { delimiter: ';' });
  assert.equal(r.length, 2, 'the quoted break must not split the record in two');
  assert.deepEqual(r[1], ['line one\nline two', 'after']);
});

test('a doubled quote is one literal quote', () => {
  const r = parse('a\n"he said ""no"""');
  assert.deepEqual(r[1], ['he said "no"']);
});

test('CRLF ends a record without leaving a stray carriage return', () => {
  const r = parse('a;b\r\n1;2\r\n', { delimiter: ';' });
  assert.deepEqual(r, [['a', 'b'], ['1', '2']]);
});

test('a trailing newline does not add an empty record', () => {
  assert.equal(parse('a,b\n1,2\n').length, 2);
});

test('empty fields are preserved, not dropped', () => {
  assert.deepEqual(parse('a;;c', { delimiter: ';' }), [['a', '', 'c']]);
});

test('a byte order mark does not become part of the first header', () => {
  const r = rows('﻿name;value\nx;1', { delimiter: ';' });
  assert.deepEqual(Object.keys(r[0]), ['name', 'value'], 'a BOM on the first key breaks every lookup');
});

test('rows keys by header and tolerates a short record', () => {
  // The live shortage export has one record with 22 fields where the header has 23.
  const r = rows('a;b;c\n1;2', { delimiter: ';' });
  assert.deepEqual(r[0], { a: '1', b: '2', c: '' }, 'a missing trailing field should be empty, not undefined');
});

test('rows on a header with no records is empty rather than throwing', () => {
  assert.deepEqual(rows('a;b;c', { delimiter: ';' }), []);
});

test('decode reads cp1252, which is what the German register ships', () => {
  // 0xF6 is o-umlaut in cp1252 and invalid on its own in UTF-8.
  const bytes = new Uint8Array([0x45, 0x72, 0x68, 0xF6, 0x68, 0x74, 0x65]);
  assert.equal(decode(bytes, 'windows-1252'), 'Erhöhte');
  assert.notEqual(decode(bytes, 'utf-8'), 'Erhöhte', 'decoding it as UTF-8 should visibly differ');
});

test('the real fixture survives the round trip with its awkward records intact', () => {
  const text = decode(fs.readFileSync(path.join(FIXTURES, 'bfarm.csv')), 'windows-1252');
  const r = rows(text, { delimiter: ';' });
  assert.ok(r.length >= 5, `expected several records, got ${r.length}`);

  // Every record must have a real 8-digit PZN. A column shift shows up here
  // first, because a shifted record puts a name or a date in the PZN field.
  for (const rec of r) {
    assert.match(rec.PZN, /^\d{8}$/, `PZN "${rec.PZN}" is not 8 digits, so a column has shifted`);
  }
  assert.ok(r.some((rec) => rec.klassifikation), 'the last column must be populated, not shifted off the end');
});
