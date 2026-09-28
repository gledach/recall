/* NHTSA: United States vehicle safety recalls.
 *
 * No key, no account. The endpoint takes make, model and year and returns only
 * campaigns affecting that combination, so the API has already done the
 * matching and the result is graded `exact` rather than run through the text
 * matcher.
 *
 * The honest limitation, stated in every result and in the README: this is the
 * US register. A European car has European campaigns that do not appear here,
 * and a model name may differ between markets. A clean result from this source
 * is not a clean bill of health, and the tool must never present it as one.
 */

import { getJson } from '../core/http.mjs';

export const id = 'nhtsa';
export const label = 'NHTSA vehicle recalls (United States)';
export const needsKey = false;
export const attribution = 'Data from the US National Highway Traffic Safety Administration';
export const handles = ['vehicle'];
export const jurisdiction = 'US';

const BASE = 'https://api.nhtsa.gov/recalls/recallsByVehicle';

export function recallUrl({ make, model, year }) {
  const q = new URLSearchParams({
    make: String(make).toLowerCase(),
    model: String(model).toLowerCase(),
    modelYear: String(year),
  });
  return `${BASE}?${q.toString()}`;
}

/** NHTSA dates are MM/DD/YYYY. */
function parseDate(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
}

/**
 * @param {object} item inventory entry of kind "vehicle"
 * @param {{ fixture?: object }} [opts]
 */
export async function check(item, { fixture = null } = {}) {
  if (!item.make || !item.model || !item.year) return [];

  const json = fixture ?? (await getJson(recallUrl(item), { source: id }));
  const results = Array.isArray(json?.results) ? json.results : [];

  return results.map((r) => ({
    source: id,
    id: r.NHTSACampaignNumber ?? `${item.make}-${item.model}-${item.year}-${r.ReportReceivedDate}`,
    matchedIdentifier: 'make, model and year',
    /* Everything here is a safety recall by definition, and NHTSA marks the
       worst of them with "do not drive" or "park outside" flags. Those are the
       only two that deserve to jump the queue. */
    severity: r.parkIt || r.parkOutSide ? 'critical' : 'high',
    title: r.Component ? `${r.Component}: ${r.NHTSACampaignNumber ?? 'recall'}` : (r.NHTSACampaignNumber ?? 'Recall'),
    description: [r.Summary, r.Consequence, r.Remedy ? `Remedy: ${r.Remedy}` : null]
      .filter(Boolean)
      .join(' '),
    parkIt: Boolean(r.parkIt),
    parkOutside: Boolean(r.parkOutSide),
    overTheAirUpdate: Boolean(r.overTheAirUpdate),
    manufacturer: r.Manufacturer ?? null,
    date: parseDate(r.ReportReceivedDate) ?? Date.now(),
    url: 'https://www.nhtsa.gov/recalls',
    jurisdictionNote:
      'US register. A vehicle sold in Europe has campaigns that do not appear here, and model '
      + 'names differ between markets, so an empty result is not a clean bill of health.',
  }));
}
