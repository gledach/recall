/* endoflife.date: when software stops getting security fixes.
 *
 * No key, no account. The match is exact: a product slug and a release cycle
 * are identifiers, not prose, so nothing here goes through the text matcher and
 * the result is graded `exact`.
 *
 * The useful nuance is that "end of life" and "end of active support" are
 * different dates. A release can be out of active support but still getting
 * security fixes for another year, and reporting the first as if it were the
 * second would have people upgrading in a panic a year early.
 */

import { getJson } from '../core/http.mjs';

export const id = 'endoflife';
export const label = 'endoflife.date';
export const needsKey = false;
export const attribution = 'Data from endoflife.date, CC BY-SA 4.0';
/* Software support dates are set by the vendor, not by a regulator, so this
   one source is the same everywhere. */
export const jurisdiction = 'global';
export const reports = 'end of support, not safety';
export const handles = ['software'];

const BASE = 'https://endoflife.date/api';

export function productUrl(product) {
  return `${BASE}/${encodeURIComponent(String(product).toLowerCase())}.json`;
}

/** The API uses `false` for "not yet", `true` for "yes, unspecified date", or a date. */
function readDate(value) {
  if (value === true) return { state: 'yes', date: null };
  if (value === false || value === null || value === undefined) return { state: 'no', date: null };
  const t = Date.parse(value);
  if (Number.isNaN(t)) return { state: 'unknown', date: null };
  return { state: t <= Date.now() ? 'yes' : 'pending', date: t };
}

function daysUntil(ms) {
  return Math.round((ms - Date.now()) / 86400_000);
}

/**
 * @param {object} item an inventory entry of kind "software"
 * @param {{ fixture?: object[] }} [opts]
 * @returns {Promise<object[]>} notices, possibly empty
 */
export async function check(item, { fixture = null } = {}) {
  const cycles = fixture ?? (await getJson(productUrl(item.product), { source: id }));
  if (!Array.isArray(cycles) || cycles.length === 0) return [];

  /* Without a cycle we cannot say anything useful: reporting on the newest
     release when the operator is running an old one would be worse than
     silence, because it would read as reassurance. */
  if (!item.cycle) {
    return [{
      source: id,
      id: `${item.product}-no-cycle`,
      matchedIdentifier: 'product',
      severity: 'info',
      title: `${item.product}: no version recorded, so support status is unknown`,
      description:
        `endoflife.date knows ${cycles.length} release cycles for ${item.product}. `
        + 'Add a `cycle` to the inventory entry to find out whether yours is still supported.',
      url: `https://endoflife.date/${item.product}`,
      date: Date.now(),
    }];
  }

  const wanted = String(item.cycle);
  const cycle = cycles.find((c) => String(c.cycle) === wanted);

  if (!cycle) {
    return [{
      source: id,
      id: `${item.product}-${wanted}-unknown`,
      matchedIdentifier: 'product and version',
      severity: 'info',
      title: `${item.product} ${wanted} is not a cycle endoflife.date knows about`,
      description:
        `Known cycles: ${cycles.map((c) => c.cycle).slice(0, 12).join(', ')}. `
        + 'Either the version is written differently there, or it is old enough to have been dropped.',
      url: `https://endoflife.date/${item.product}`,
      date: Date.now(),
    }];
  }

  const eol = readDate(cycle.eol);
  const support = readDate(cycle.support);
  const out = [];
  const base = {
    source: id,
    matchedIdentifier: 'product and version',
    url: `https://endoflife.date/${item.product}`,
    latest: cycle.latest ?? null,
  };

  if (eol.state === 'yes') {
    out.push({
      ...base,
      id: `${item.product}-${wanted}-eol`,
      severity: 'high',
      title: `${item.product} ${wanted} is end of life${eol.date ? ` since ${new Date(eol.date).toISOString().slice(0, 10)}` : ''}`,
      description: 'No further security fixes. Upgrading is the only remedy.',
      date: eol.date ?? Date.now(),
    });
  } else if (eol.state === 'pending' && daysUntil(eol.date) <= 180) {
    out.push({
      ...base,
      id: `${item.product}-${wanted}-eol-soon`,
      severity: 'medium',
      title: `${item.product} ${wanted} reaches end of life in ${daysUntil(eol.date)} days`,
      description: `Security fixes stop on ${new Date(eol.date).toISOString().slice(0, 10)}.`,
      date: eol.date,
    });
  }

  /* Only worth saying while the release is still getting security fixes.
     Once it is fully end of life, the support date is noise. */
  if (eol.state !== 'yes' && support.state === 'yes' && cycle.support !== undefined) {
    out.push({
      ...base,
      id: `${item.product}-${wanted}-support`,
      severity: 'low',
      title: `${item.product} ${wanted} is out of active support`,
      description:
        'Still receiving security fixes, but no longer getting bug fixes or new features. '
        + 'Different from end of life, and not urgent on its own.',
      date: support.date ?? Date.now(),
    });
  }

  return out;
}
