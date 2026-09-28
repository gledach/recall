/* The source adapters, against fixtures cut from real register downloads.
 *
 * Each of these tests exists because the parser was once wrong in that exact
 * way and the failure was silent. A source that returns zero records from a
 * document full of them looks identical to good news.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as safetygate from '../sources/safetygate.mjs';
import * as bfarm from '../sources/bfarm.mjs';
import { decode } from '../core/csv.mjs';
import { SOURCES } from '../core/check.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIXTURES, f), 'utf8');

/* ── contract shared by every source ───────────────────────────────────────── */

test('every registered source declares what it covers', () => {
  for (const [id, source] of Object.entries(SOURCES)) {
    assert.equal(source.id, id, `${id}: the module id must match its key in SOURCES`);
    assert.ok(source.label, `${id}: needs a label for the coverage table`);
    assert.ok(Array.isArray(source.handles) && source.handles.length, `${id}: must declare handles`);
    assert.ok(source.jurisdiction, `${id}: must declare a jurisdiction, so a clean result can be qualified`);
    assert.equal(typeof source.check, 'function', `${id}: needs check()`);
  }
});

/* ── EU Safety Gate ────────────────────────────────────────────────────────── */

test('safetygate reads the weekly report index newest first', () => {
  const reports = safetygate.parseIndex(read('safetygate-index.xml'));
  assert.ok(reports.length > 0, 'the index must yield reports');
  for (const r of reports) {
    assert.ok(r.reference, 'a report without a reference cannot be used as a cache key');
    assert.ok(r.url.startsWith('https://'), 'a report needs a fetchable URL');
  }
  const [first] = reports;
  assert.ok(first.year >= 2005, `implausible year ${first.year}`);
  assert.ok(first.week >= 1 && first.week <= 53, `implausible week ${first.week}`);
});

test('safetygate finds the alerts in a weekly report', () => {
  // The record wrapper is <notifications>. <order> is a field inside it, and
  // treating that as the wrapper returned zero alerts from this same document.
  const notices = safetygate.parseDetail(read('safetygate-detail.xml'), { reference: 'Report-2026-38' });
  assert.ok(notices.length >= 2, `expected several alerts, got ${notices.length}`);
});

test('safetygate carries the barcode, which is the strongest match available', () => {
  const notices = safetygate.parseDetail(read('safetygate-detail.xml'), {});
  const withBarcode = notices.filter((n) => n.barcode);
  assert.ok(withBarcode.length > 0, 'no barcodes parsed, so exact matching is dead');
  for (const n of withBarcode) {
    assert.match(n.barcode, /^\d{8,14}$/, `"${n.barcode}" is not a barcode`);
  }
});

test('safetygate decodes CDATA rather than passing the wrapper through', () => {
  const notices = safetygate.parseDetail(read('safetygate-detail.xml'), {});
  for (const n of notices) {
    const all = [n.title, n.description, n.product, n.make].filter(Boolean).join(' ');
    assert.ok(!all.includes('CDATA'), `CDATA leaked into a field: ${all.slice(0, 80)}`);
    assert.ok(!all.includes('&amp;'), 'entities must be decoded, not passed on');
  }
});

test('safetygate says it is the EU register and nothing wider', () => {
  const notices = safetygate.parseDetail(read('safetygate-detail.xml'), {});
  assert.equal(safetygate.jurisdiction, 'EU');
  for (const n of notices) {
    assert.ok(n.jurisdictionNote, 'every alert must carry its own scope caveat');
    assert.ok(n.date && n.date > 0, 'every alert needs a date for sorting');
    assert.ok(n.title, 'an alert with no title cannot be shown to anyone');
  }
});

test('safetygate returns nothing for a document with no alerts, without throwing', () => {
  assert.deepEqual(safetygate.parseDetail('<Safety-Gate><report_date>25/09/2026</report_date></Safety-Gate>', {}), []);
});

/* ── BfArM shortages ───────────────────────────────────────────────────────── */

const bfarmFixture = () => decode(fs.readFileSync(path.join(FIXTURES, 'bfarm.csv')), 'windows-1252');

test('bfarm reads every shortage report with its PZN', () => {
  const notices = bfarm.parseCsv(bfarmFixture());
  assert.ok(notices.length >= 5, `expected several reports, got ${notices.length}`);
  for (const n of notices) {
    assert.match(n.pzn, /^\d{8}$/, `PZN "${n.pzn}" is not 8 digits`);
    assert.ok(n.product, 'a shortage with no drug name is unusable');
  }
});

test('bfarm does not read "neither critical nor relevant" as critical', () => {
  // "weder versrel noch verskri" is German for neither one. It contains both
  // keywords, so a substring test for either graded 420 of 967 harmless
  // reports as high severity.
  const notices = bfarm.parseCsv(bfarmFixture());
  const negated = notices.filter((n) => (n.classification ?? '').startsWith('weder'));
  assert.ok(negated.length > 0, 'the fixture must contain a negated classification to test this');
  for (const n of negated) {
    assert.equal(n.severity, 'low', `"${n.classification}" must not grade as ${n.severity}`);
  }

  const critical = notices.filter((n) => (n.classification ?? '').startsWith('verskri'));
  assert.ok(critical.length > 0, 'the fixture must contain a genuinely critical report');
  for (const n of critical) {
    assert.equal(n.severity, 'high', 'a supply-critical shortage must grade high');
  }
});

test('bfarm never lets a shortage read as a safety recall', () => {
  const notices = bfarm.parseCsv(bfarmFixture());
  for (const n of notices) {
    assert.match(n.title, /^Shortage:/, `"${n.title}" could be skim-read as a recall`);
    assert.ok(n.kindOfNotice?.includes('not a safety recall'), 'the caveat must travel with the record');
  }
  assert.equal(bfarm.reports, 'availability, not safety');
});

test('bfarm decodes umlauts rather than mangling them', () => {
  const notices = bfarm.parseCsv(bfarmFixture());
  const all = notices.map((n) => `${n.product} ${n.description}`).join(' ');
  assert.ok(!all.includes('�'), 'a replacement character means the encoding is wrong and matching will fail');
});

test('bfarm treats N/A as absent rather than as a value', () => {
  const notices = bfarm.parseCsv(bfarmFixture());
  for (const n of notices) {
    for (const field of ['make', 'activeIngredient', 'atc', 'form']) {
      assert.notEqual(n[field], 'N/A', `${field} should be null when the register writes N/A`);
    }
    assert.ok(!n.description.includes('N/A'), 'N/A must not be shown to a person as prose');
  }
});

test('bfarm returns nothing for a header with no records', () => {
  assert.deepEqual(bfarm.parseCsv('PZN;Arzneimittlbezeichnung;klassifikation'), []);
});
