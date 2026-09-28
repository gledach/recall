/* BfArM supply shortage reports: the German federal medicines register.
 *
 * No key, no account: one CSV of every open report, published by the
 * Bundesinstitut für Arzneimittel und Medizinprodukte.
 *
 * Read this before using it, because the distinction matters medically:
 *
 *   This register lists medicines that are HARD TO GET, not medicines that are
 *   DANGEROUS. A report here means a manufacturer has declared a delivery
 *   shortage. It is not a recall, not a safety warning, and it says nothing
 *   about whether the pack in your cupboard is safe to take.
 *
 * It is still the most useful medicine source available without an account,
 * because a shortage is the thing that actually affects someone: a repeat
 * prescription that cannot be filled needs a conversation with a doctor weeks
 * before the box runs out. Every notice from here carries that framing so it
 * can never be read as a safety alert.
 *
 * Matching is on PZN, the eight-digit Pharmazentralnummer printed on every
 * German pack. Like a barcode, it is copied rather than interpreted, so it is
 * an exact match instead of a guess at a drug name.
 *
 * Germany only. A shortage in Austria or Switzerland does not appear here.
 */

import { rows, decode } from '../core/csv.mjs';
import { saveCache, loadCache } from '../core/store.mjs';

export const id = 'bfarm';
export const label = 'BfArM shortages (DE)';
export const needsKey = false;
export const attribution = 'Data from the Bundesinstitut für Arzneimittel und Medizinprodukte (BfArM)';
export const handles = ['medicine'];
export const jurisdiction = 'DE';
export const reports = 'availability, not safety';

const CSV_URL = 'https://anwendungen.pharmnet-bund.de/lieferengpassmeldungen/public/csv';
const MAX_AGE_MS = 12 * 3600_000;

/* The export is cp1252, not UTF-8. Decoded as UTF-8, "Erhöhte Nachfrage"
   becomes mojibake and stops matching anything a user typed. */
const ENCODING = 'windows-1252';

async function getCsv() {
  const res = await fetch(CSV_URL, {
    headers: { accept: 'text/csv', 'user-agent': 'recall/0.1 (+https://github.com/gledach/recall)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status} for the shortage register`);
  return decode(await res.arrayBuffer(), ENCODING);
}

/** dd.mm.yyyy, which is how the register writes dates. */
function parseDate(value) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value ?? '').trim());
  return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

/* The register grades its own reports, and its grading beats anything inferable
   from the text:
     verskri   versorgungskritisch, supply-critical: no adequate alternative
     versrel   versorgungsrelevant, supply-relevant: alternatives exist
   Anything else is a declared shortage with no supply consequence identified.
 *
 * The negative case is spelled "weder versrel noch verskri", German for neither
 * one. It contains both keywords, so a substring test for either matches the
 * value that means the opposite, and 420 of 967 harmless reports came out graded
 * high. The negation has to be ruled out first. */
function severityOf(klass, hospital) {
  const k = (klass ?? '').toLowerCase();
  if (k.startsWith('weder')) return 'low';
  if (k.includes('verskri')) return 'high';
  if (k.includes('versrel')) return hospital === 'ja' ? 'high' : 'medium';
  return 'low';
}

function isEmpty(value) {
  const v = (value ?? '').trim();
  return v === '' || v === 'N/A';
}

export function parseCsv(text) {
  return rows(text, { delimiter: ';' })
    .map((r) => {
      const pzn = (r.PZN ?? '').replace(/[^0-9]/g, '');
      const name = r.Arzneimittlbezeichnung || r.Arzneimittelbezeichnung;
      if (!pzn && !name) return null;

      const klass = r.klassifikation;
      const hospital = (r.Krankenhausrelevant ?? '').toLowerCase();
      const reason = [r.Grund, isEmpty(r['Anm. zum Grund']) ? null : r['Anm. zum Grund']]
        .filter((v) => !isEmpty(v))
        .join('. ');
      const alternative = isEmpty(r['Alternativpräparat']) ? null : r['Alternativpräparat'];
      const end = parseDate(r.Ende);

      return {
        source: id,
        id: r.Bearbeitungsnummer || `${id}-${pzn}`,
        severity: severityOf(klass, hospital),
        /* "Shortage" leads the title so it can never be skim-read as a recall,
           whatever the caller does with the rest of the record. */
        title: `Shortage: ${name || `PZN ${pzn}`}`,
        description: [
          reason,
          end ? `Expected to last until ${r.Ende}.` : 'No end date declared.',
          alternative ? `Alternative named by the manufacturer: ${alternative}.` : null,
          hospital === 'ja' ? 'Flagged as relevant to hospital supply.' : null,
        ].filter(Boolean).join(' '),
        make: isEmpty(r.Zulassungsinhaber) ? null : r.Zulassungsinhaber,
        model: null,
        product: name || null,
        pzn: pzn || null,
        activeIngredient: isEmpty(r.Wirkstoffe) ? null : r.Wirkstoffe,
        atc: isEmpty(r['Atc Code']) ? null : r['Atc Code'],
        form: isEmpty(r.Darreichungsform) ? null : r.Darreichungsform,
        classification: isEmpty(klass) ? null : klass,
        reportType: isEmpty(r.Meldungsart) ? null : r.Meldungsart,
        startsAt: parseDate(r.Beginn),
        endsAt: end,
        date: parseDate(r['Datum der letzten Meldung']) ?? parseDate(r.Beginn) ?? Date.now(),
        url: 'https://anwendungen.pharmnet-bund.de/lieferengpassmeldungen/faces/public/meldungen.xhtml',
        /* Repeated on every record rather than stated once in the report header,
           because a single notice is what a person actually reads, and out of
           context "shortage" is easily misheard as "unsafe". */
        kindOfNotice: 'supply shortage, not a safety recall. The medicine is not '
          + 'being withdrawn. Ask a pharmacist or doctor about a substitute '
          + 'before your current pack runs out',
        jurisdictionNote: 'German register only. Does not cover other countries.',
      };
    })
    .filter(Boolean);
}

/** Every open shortage report. Cached, because it is one file for all items. */
export async function recentNotices({ fixture = null } = {}) {
  if (fixture) return parseCsv(fixture);

  const cached = loadCache(id, 'shortages', { maxAgeMs: MAX_AGE_MS });
  let text = cached?.data;
  if (!text) {
    text = await getCsv();
    saveCache(id, 'shortages', text);
  }
  return parseCsv(text);
}

export async function check(item, opts = {}) {
  return recentNotices(opts);
}
