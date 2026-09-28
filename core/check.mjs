/* Running every source against every thing you own.
 *
 * The important property is that a source failing is not the same as a source
 * finding nothing, and the result says which happened for each one. A tool that
 * prints "nothing found" when in fact it could not reach the register is worse
 * than useless: it is reassuring and wrong.
 */

import * as endoflife from '../sources/endoflife.mjs';
import * as nhtsa from '../sources/nhtsa.mjs';
import * as safetygate from '../sources/safetygate.mjs';
import * as bfarm from '../sources/bfarm.mjs';
import { matchAll, noticeKey } from './match.mjs';
import { itemsFor } from './inventory.mjs';
import { isAcknowledged } from './store.mjs';

export const SOURCES = { safetygate, bfarm, endoflife, nhtsa };

/**
 * @param {object[]} items      validated inventory
 * @param {object} opts
 * @param {string[]} [opts.only] source ids to run
 * @param {string} [opts.minConfidence]
 * @param {boolean} [opts.includeAcknowledged]
 * @returns {Promise<{ findings: object[], sources: object[] }>}
 */
export async function runCheck(items, {
  only = null,
  minConfidence = 'weak',
  includeAcknowledged = false,
} = {}) {
  const findings = [];
  const sourceReports = [];
  /* key -> finding, so a notice reported under several register rows is one
     finding. Spans sources: the same key cannot be produced by two sources. */
  const seen = new Map();

  for (const [sourceId, source] of Object.entries(SOURCES)) {
    if (only && !only.includes(sourceId)) continue;

    const relevant = itemsFor(items, sourceId).filter((i) => (source.handles ?? []).includes(i.kind));
    const report = {
      source: sourceId,
      label: source.label,
      itemsChecked: relevant.length,
      reachable: true,
      error: null,
      jurisdiction: source.jurisdiction ?? null,
      found: 0,
    };

    if (relevant.length === 0) {
      sourceReports.push(report);
      continue;
    }

    /* A bulk source publishes one register covering everything, so it is
       fetched once per run and matched against every item. Calling it per item
       re-downloaded twelve weeks of European alerts for each thing you own,
       which turned a two-second check into a timeout. */
    let bulkNotices = null;
    if (typeof source.recentNotices === 'function') {
      try {
        bulkNotices = await source.recentNotices();
      } catch (err) {
        report.reachable = false;
        report.error = err.message;
        sourceReports.push(report);
        continue;
      }
    }

    for (const item of relevant) {
      let notices;
      if (bulkNotices) {
        notices = bulkNotices;
      } else {
        try {
          notices = await source.check(item);
        } catch (err) {
          /* Recorded per source rather than thrown, so one register being down
             does not hide the results of the others, and the report can say
             exactly which part of the answer is missing. */
          report.reachable = false;
          report.error = err.message;
          continue;
        }
      }

      for (const hit of matchAll(item, notices, { minConfidence })) {
        const key = noticeKey(item, hit.notice);
        const acked = isAcknowledged(key);
        if (acked && !includeAcknowledged) continue;

        /* One register record is not one notice. A German shortage report covers
           every pack size of a drug under a single report number, so matching on
           the name produced the same finding five times over. Collapse on the
           key, keeping the best-evidenced match: the reason shown should be the
           strongest one found, not whichever row happened to come first. */
        const existing = seen.get(key);
        if (existing) {
          if (hit.score > existing.score) {
            Object.assign(existing, {
              notice: hit.notice,
              confidence: hit.confidence,
              reason: hit.reason,
              score: hit.score,
            });
          }
          continue;
        }

        const finding = {
          key,
          item,
          notice: hit.notice,
          confidence: hit.confidence,
          reason: hit.reason,
          score: hit.score,
          acknowledged: acked,
        };
        seen.set(key, finding);
        findings.push(finding);
        report.found += 1;
      }
    }

    sourceReports.push(report);
  }

  const severityRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort(
    (a, b) =>
      (severityRank[a.notice.severity] ?? 5) - (severityRank[b.notice.severity] ?? 5) ||
      b.score - a.score ||
      (b.notice.date ?? 0) - (a.notice.date ?? 0),
  );

  return { findings, sources: sourceReports };
}

/** What the run could not see. Printed whether or not anything was found. */
export function coverageOf(items, sourceReports) {
  const unreachable = sourceReports.filter((s) => !s.reachable);
  const uncheckable = items.filter(
    (i) => !sourceReports.some((s) => s.itemsChecked > 0 && itemsFor([i], s.source).length > 0),
  );
  return {
    sourcesRun: sourceReports.length,
    sourcesFailed: unreachable.map((s) => ({ source: s.source, error: s.error })),
    itemsWithNoSource: uncheckable.map((i) => ({ id: i.id, label: i.label, kind: i.kind })),
    trustEmptyResult: unreachable.length === 0,
  };
}
