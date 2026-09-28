#!/usr/bin/env node
/* Live checks against the real registers. Deliberately not part of `npm test`.
 *
 *   node test/live.mjs
 *
 * The offline gate decides whether a change ships. This decides whether the
 * outside world still looks the way the parsers assume, which is a different
 * question and fails for reasons that are nobody's fault. Mixing the two
 * teaches people to ignore a red gate.
 *
 * Run it after touching anything in sources/, and when a register has been
 * quiet for suspiciously long. The most dangerous failure this tool has is a
 * parser that returns zero records from a document full of them, because that
 * is indistinguishable from good news.
 */

import * as safetygate from '../sources/safetygate.mjs';
import * as bfarm from '../sources/bfarm.mjs';
import * as endoflife from '../sources/endoflife.mjs';
import * as nhtsa from '../sources/nhtsa.mjs';

let failures = 0;

function ok(label, detail = '') {
  console.log(`  ok    ${label}${detail ? `  ${detail}` : ''}`);
}

function bad(label, detail) {
  failures += 1;
  console.log(`  FAIL  ${label}\n        ${detail}`);
}

async function probe(label, fn) {
  try {
    const detail = await fn();
    ok(label, detail);
  } catch (err) {
    bad(label, err.message);
  }
}

console.log('\nlive register checks\n');

await probe('safetygate index', async () => {
  const reports = safetygate.parseIndex(await fetchText(
    'https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en',
  ));
  if (reports.length < 100) throw new Error(`only ${reports.length} weekly reports; the index shape may have changed`);
  return `${reports.length} reports, newest ${reports[0].reference} (${reports[0].publicationDate})`;
});

await probe('safetygate alerts', async () => {
  const notices = await safetygate.recentNotices({ weeks: 1 });
  /* A week with no alerts at all has not happened. Zero here means the record
     wrapper moved, which is exactly the silent failure to catch. */
  if (notices.length === 0) throw new Error('zero alerts in the newest week, which means the parser is broken');
  const withBarcode = notices.filter((n) => n.barcode).length;
  if (withBarcode === 0) throw new Error(`${notices.length} alerts but no barcodes; exact matching is dead`);
  return `${notices.length} alerts, ${withBarcode} with a barcode`;
});

await probe('bfarm shortages', async () => {
  const notices = await bfarm.recentNotices();
  if (notices.length < 50) throw new Error(`only ${notices.length} shortage reports; the export may have changed`);
  const withPzn = notices.filter((n) => n.pzn).length;
  if (withPzn !== notices.length) throw new Error(`${notices.length - withPzn} reports have no PZN, so a column has shifted`);
  const mojibake = notices.filter((n) => `${n.product}${n.description}`.includes('�')).length;
  if (mojibake > 0) throw new Error(`${mojibake} reports contain a replacement character; the encoding is wrong`);
  const high = notices.filter((n) => n.severity === 'high').length;
  if (high > notices.length * 0.6) {
    throw new Error(`${high} of ${notices.length} graded high, which suggests the classification is being misread`);
  }
  return `${notices.length} reports, ${high} supply-critical or hospital-relevant`;
});

await probe('endoflife', async () => {
  const notices = await endoflife.check({ id: 'x', kind: 'software', product: 'nodejs', cycle: '18' });
  if (notices.length === 0) throw new Error('Node 18 is past end of life and should report as such');
  return notices[0].title;
});

await probe('nhtsa', async () => {
  const notices = await nhtsa.check({ id: 'x', kind: 'vehicle', make: 'Volkswagen', model: 'Golf', year: 2019 });
  if (notices.length === 0) throw new Error('a 2019 Golf has open US campaigns and should report some');
  return `${notices.length} campaigns, worst ${notices[0].severity}`;
});

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

console.log(
  failures === 0
    ? '\nall registers answered and look the way the parsers expect.\n'
    : `\n${failures} register check(s) failed. A failure here is either a parser that needs`
      + '\nupdating or a register having a bad day. Read the message before assuming which.\n',
);
process.exit(failures === 0 ? 0 : 1);
