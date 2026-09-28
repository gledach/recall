/* Persistence: a cache, an append-only notice ledger, and acknowledgements.
 *
 * The ledger is append-only because a notice that was once reported is a fact,
 * and nothing should be able to quietly rewrite what you were told.
 *
 * Acknowledgements are the feature that makes this tool survivable. Without
 * them every run re-reports the same twelve things, people stop reading, and
 * the one that matters arrives into an inbox nobody opens. Acknowledging is the
 * difference between a tool and a nag.
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths, ensureDataDir } from './paths.mjs';

/* ── source cache ─────────────────────────────────────────────────────── */

function cacheFile(sourceId, key) {
  const safe = `${sourceId}__${key}`.replace(/[^a-z0-9_.-]/gi, '-').slice(0, 120);
  return path.join(paths.cache, `${safe}.json`);
}

export function saveCache(sourceId, key, data) {
  ensureDataDir();
  const file = cacheFile(sourceId, key);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: Date.now(), data }), 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

export function loadCache(sourceId, key, { maxAgeMs = Infinity } = {}) {
  const file = cacheFile(sourceId, key);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - (parsed.fetchedAt ?? 0) > maxAgeMs) return null;
    return parsed;
  } catch {
    return null; // a corrupt cache is a miss, never a crash
  }
}

/* ── notice ledger ────────────────────────────────────────────────────── */

export function appendNotice(entry) {
  ensureDataDir();
  const row = { at: Date.now(), ...entry };
  fs.appendFileSync(paths.notices, `${JSON.stringify(row)}\n`, 'utf8');
  return row;
}

export function readNotices({ sinceMs = 0 } = {}) {
  if (!fs.existsSync(paths.notices)) return [];
  const out = [];
  for (const line of fs.readFileSync(paths.notices, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if ((row.at ?? 0) >= sinceMs) out.push(row);
    } catch {
      // one bad line must not cost the whole history
    }
  }
  return out;
}

/** Has this exact notice for this exact item been recorded before? */
export function seenKeys() {
  return new Set(readNotices().map((n) => n.key));
}

/* ── acknowledgements ─────────────────────────────────────────────────── */

function readAcks() {
  if (!fs.existsSync(paths.acks)) return {};
  try {
    return JSON.parse(fs.readFileSync(paths.acks, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeAcks(next) {
  ensureDataDir();
  const tmp = `${paths.acks}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, paths.acks);
}

export function acknowledge(key, note = null) {
  const acks = readAcks();
  acks[key] = { at: Date.now(), note };
  writeAcks(acks);
  return acks[key];
}

export function unacknowledge(key) {
  const acks = readAcks();
  if (!(key in acks)) return false;
  delete acks[key];
  writeAcks(acks);
  return true;
}

export function isAcknowledged(key) {
  return key in readAcks();
}

export function allAcks() {
  return readAcks();
}

export function resetForTests() {
  // Nothing is cached in memory; this exists so tests read as intentional.
  return true;
}
