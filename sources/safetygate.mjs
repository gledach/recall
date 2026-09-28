/* EU Safety Gate, formerly RAPEX: the European consumer product alert system.
 *
 * No key, no account. This is the source that matters for anyone in the EU:
 * appliances, toys, electronics, cosmetics and motor vehicles, notified by all
 * member states. A German appliance recall appears here and does not appear in
 * any US register.
 *
 * There is no documented API. What exists is a weekly-report export in XML: an
 * index of every report published since 2005, and one detail document per week.
 * That shape is better than an API for this purpose, because it caches cleanly:
 * the report reference ("Report-2026-38") is a stable cursor, so a refresh only
 * fetches weeks it has not already seen.
 *
 * The record carries a barcode. That is the single best matching field in any
 * source consulted by this tool: a user can read it off the box and it is an
 * exact match rather than a guess at prose.
 */

import { blocks, text } from '../core/xml.mjs';
import { saveCache, loadCache } from '../core/store.mjs';

export const id = 'safetygate';
export const label = 'EU Safety Gate';
export const needsKey = false;
export const attribution = 'Data from the European Commission Safety Gate rapid alert system';
export const handles = ['appliance', 'device', 'vehicle'];
export const jurisdiction = 'EU';

const INDEX_URL = 'https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en';
const INDEX_MAX_AGE_MS = 12 * 3600_000;
const DEFAULT_WEEKS = 12;

async function getText(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/xml', 'user-agent': 'recall/0.1 (+https://github.com/gledach/recall)' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Every weekly report, newest first. */
export function parseIndex(xml) {
  return blocks(xml, 'weeklyReport')
    .map((b) => ({
      reference: text(b, 'reference'),
      publicationDate: text(b, 'publicationDate'),
      year: Number(text(b, 'year')) || null,
      week: Number(text(b, 'week')) || null,
      url: text(b, 'URL'),
    }))
    .filter((r) => r.reference && r.url)
    .sort((a, b) => (b.year - a.year) || (b.week - a.week));
}

/** dd/mm/yyyy, which is how the export writes dates. */
function parseDate(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value ?? '').trim());
  return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

export function parseDetail(xml, report = {}) {
  const published = parseDate(text(xml, 'report_date')) ?? parseDate(report.publicationDate) ?? Date.now();

  /* Each alert is a <notifications> element carrying attributes. <order> is a
     field inside it, not the wrapper: mistaking the two yields zero records
     from a document that is full of them, silently. */
  const records = blocks(xml, 'notifications');
  const source = records.length ? records : [xml];

  return source
    .map((r) => {
      const caseNumber = text(r, 'caseNumber');
      const brand = text(r, 'brand');
      const name = text(r, 'name');
      const product = text(r, 'product');
      if (!caseNumber && !brand && !name) return null;

      const level = (text(r, 'level') ?? '').toLowerCase();
      return {
        source: id,
        id: caseNumber ?? `${report.reference}-${name}`,
        severity: level.includes('serious') ? 'high' : level ? 'medium' : 'medium',
        title: [brand, name ?? product].filter(Boolean).join(' ') || (caseNumber ?? 'Safety Gate alert'),
        description: [text(r, 'danger'), text(r, 'measures')].filter(Boolean).join(' '),
        make: brand,
        model: text(r, 'type_numberOfModel'),
        product: [product, name].filter(Boolean).join(' '),
        barcode: text(r, 'barcode'),
        batch: text(r, 'batchNumber'),
        category: text(r, 'category'),
        riskType: text(r, 'riskType'),
        notifyingCountry: text(r, 'notifyingCountry'),
        date: published,
        url: 'https://ec.europa.eu/safety-gate-alerts/screen/search',
        weeklyReport: report.reference ?? null,
        jurisdictionNote: 'EU register, all member states. Does not carry US-only recalls.',
      };
    })
    .filter(Boolean);
}

/**
 * Notices from the last `weeks` weekly reports. Cached per report reference,
 * so a second run costs one index fetch and nothing else.
 */
export async function recentNotices({ weeks = DEFAULT_WEEKS, fixtureIndex = null, fixtureDetail = null } = {}) {
  let indexXml = fixtureIndex;
  if (!indexXml) {
    const cached = loadCache(id, 'index', { maxAgeMs: INDEX_MAX_AGE_MS });
    if (cached) {
      indexXml = cached.data;
    } else {
      indexXml = await getText(INDEX_URL);
      saveCache(id, 'index', indexXml);
    }
  }

  const reports = parseIndex(indexXml).slice(0, weeks);
  const notices = [];

  for (const report of reports) {
    if (fixtureDetail) {
      notices.push(...parseDetail(fixtureDetail, report));
      continue;
    }
    /* A published week never changes, so its cache never expires. This is what
       makes the source cheap: only weeks never seen before are fetched. */
    const cached = loadCache(id, report.reference);
    let detail = cached?.data;
    if (!detail) {
      detail = await getText(report.url);
      saveCache(id, report.reference, detail);
    }
    notices.push(...parseDetail(detail, report));
  }

  return notices;
}

export async function check(item, opts = {}) {
  return recentNotices(opts);
}
