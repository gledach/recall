/* The orchestration: how sources are run, and how their answers are combined.
 *
 * Tested against fake sources rather than real ones, because the properties that
 * matter here are about the runner, not about any register: a source is fetched
 * once, one failing source does not silence the others, and the same notice is
 * reported once.
 *
 * RECALL_DATA is set before the modules load, because paths.mjs reads it at
 * import time. A static import at the top of the file would already have
 * resolved the store into the real data directory.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-check-'));
process.env.RECALL_DATA = TMP;

const { runCheck, coverageOf, SOURCES } = await import('../core/check.mjs');
const { validateItem } = await import('../core/inventory.mjs');
const store = await import('../core/store.mjs');

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const item = (over = {}) => validateItem({ id: 'thing', kind: 'device', make: 'Acme', model: 'XR4500', ...over }, 0);

/* A source registered only for the duration of one test.
   Must await fn(): returning the promise from inside try{} runs the finally as
   soon as the body hits its first await, which removed the source mid-test and
   made later assertions in the same test pass or fail for the wrong reason. */
async function withSource(def, fn) {
  const id = def.id;
  SOURCES[id] = { label: id, handles: ['device'], jurisdiction: 'TEST', ...def };
  try {
    return await fn();
  } finally {
    delete SOURCES[id];
  }
}

const notice = (over = {}) => ({
  source: 'fake', id: 'N1', severity: 'high', title: 'Acme XR4500 recall',
  description: 'Fault.', make: 'Acme', model: 'XR4500', date: Date.now(), ...over,
});

test('a bulk source is fetched once per run, not once per item', async () => {
  let calls = 0;
  await withSource({
    id: 'fake',
    async recentNotices() { calls += 1; return [notice()]; },
    async check() { throw new Error('check() must not be called when recentNotices() exists'); },
  }, async () => {
    const items = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })];
    items.forEach((i) => { i.sources = ['fake']; });
    const { findings } = await runCheck(items, { only: ['fake'] });
    assert.equal(calls, 1, `fetched ${calls} times for 3 items; this is what caused the timeout`);
    assert.equal(findings.length, 3, 'all three items should still be matched');
  });
});

test('a per-item source is called once per item', async () => {
  let calls = 0;
  await withSource({
    id: 'fake',
    async check() { calls += 1; return [notice()]; },
  }, async () => {
    const items = [item({ id: 'a' }), item({ id: 'b' })];
    items.forEach((i) => { i.sources = ['fake']; });
    await runCheck(items, { only: ['fake'] });
    assert.equal(calls, 2);
  });
});

test('the same notice is reported once, keeping the best evidence', async () => {
  // One German shortage report covers every pack size of a drug under a single
  // report number, so several register rows produce one notice id.
  await withSource({
    id: 'fake',
    async recentNotices() {
      return [
        notice({ id: 'SAME', title: 'Acme recall', make: 'Acme', model: null }),   // weaker: make only
        notice({ id: 'SAME', title: 'Acme XR4500 recall', make: 'Acme', model: 'XR4500' }), // stronger
      ];
    },
  }, async () => {
    const it = item(); it.sources = ['fake'];
    const { findings } = await runCheck([it], { only: ['fake'], minConfidence: 'mention' });
    assert.equal(findings.length, 1, 'one notice id must yield one finding');
    assert.equal(findings[0].confidence, 'strong', 'the stronger match should win, not whichever came first');
  });
});

test('two different notices about one item both survive', async () => {
  await withSource({
    id: 'fake',
    async recentNotices() { return [notice({ id: 'N1' }), notice({ id: 'N2' })]; },
  }, async () => {
    const it = item(); it.sources = ['fake'];
    const { findings } = await runCheck([it], { only: ['fake'] });
    assert.equal(findings.length, 2);
  });
});

test('a failing source is recorded as unreachable, not as clean', async () => {
  await withSource({
    id: 'fake',
    async recentNotices() { throw new Error('register is down'); },
  }, async () => {
    const it = item(); it.sources = ['fake'];
    const { findings, sources } = await runCheck([it], { only: ['fake'] });
    assert.equal(findings.length, 0);
    const report = sources.find((s) => s.source === 'fake');
    assert.equal(report.reachable, false, 'a source that threw must not read as reachable');
    assert.match(report.error, /register is down/);

    const coverage = coverageOf([it], sources);
    assert.equal(coverage.trustEmptyResult, false, 'an empty result must not be trustworthy here');
    assert.equal(coverage.sourcesFailed.length, 1);
  });
});

test('one source failing does not hide another source finding something', async () => {
  SOURCES.broken = { id: 'broken', label: 'broken', handles: ['device'], jurisdiction: 'TEST', async recentNotices() { throw new Error('down'); } };
  SOURCES.working = { id: 'working', label: 'working', handles: ['device'], jurisdiction: 'TEST', async recentNotices() { return [notice({ source: 'working' })]; } };
  try {
    const it = item(); it.sources = ['broken', 'working'];
    const { findings, sources } = await runCheck([it], { only: ['broken', 'working'] });
    assert.equal(findings.length, 1, 'the working source must still report');
    assert.equal(sources.filter((s) => !s.reachable).length, 1);
    assert.equal(coverageOf([it], sources).trustEmptyResult, false);
  } finally {
    delete SOURCES.broken;
    delete SOURCES.working;
  }
});

test('an acknowledged notice is hidden by default and returned on request', async () => {
  store.resetForTests();
  await withSource({
    id: 'fake',
    async recentNotices() { return [notice({ id: 'ACK-ME' })]; },
  }, async () => {
    const it = item(); it.sources = ['fake'];
    const first = await runCheck([it], { only: ['fake'] });
    assert.equal(first.findings.length, 1);

    store.acknowledge(first.findings[0].key, 'dealt with');
    assert.equal((await runCheck([it], { only: ['fake'] })).findings.length, 0);

    const shown = await runCheck([it], { only: ['fake'], includeAcknowledged: true });
    assert.equal(shown.findings.length, 1);
    assert.equal(shown.findings[0].acknowledged, true);
  });
  store.resetForTests();
});

test('the confidence floor excludes weaker matches', async () => {
  await withSource({
    id: 'fake',
    // Nothing here names the model, in the title or anywhere else.
    async recentNotices() { return [notice({ id: 'MENTION', title: 'Acme recall', description: 'A fault.', model: null })]; },
  }, async () => {
    const it = item(); it.sources = ['fake'];
    assert.equal((await runCheck([it], { only: ['fake'], minConfidence: 'weak' })).findings.length, 0);
    assert.equal((await runCheck([it], { only: ['fake'], minConfidence: 'mention' })).findings.length, 1);
  });
});

test('findings are ordered by severity before anything else', async () => {
  await withSource({
    id: 'fake',
    async recentNotices() {
      return [
        notice({ id: 'LOW', severity: 'low' }),
        notice({ id: 'CRIT', severity: 'critical' }),
        notice({ id: 'MED', severity: 'medium' }),
      ];
    },
  }, async () => {
    const it = item(); it.sources = ['fake'];
    const { findings } = await runCheck([it], { only: ['fake'] });
    assert.deepEqual(findings.map((f) => f.notice.severity), ['critical', 'medium', 'low']);
  });
});

test('a source is not asked about a kind it does not handle', async () => {
  let asked = false;
  await withSource({
    id: 'fake',
    handles: ['vehicle'],
    async recentNotices() { asked = true; return []; },
  }, async () => {
    const it = item(); it.sources = ['fake'];   // a device, but the source handles vehicles
    const { sources } = await runCheck([it], { only: ['fake'] });
    assert.equal(asked, false, 'no network request should be made for an irrelevant source');
    assert.equal(sources.find((s) => s.source === 'fake').itemsChecked, 0);
  });
});

test('coverage names an item nothing can check', async () => {
  await withSource({ id: 'fake', handles: ['vehicle'], async recentNotices() { return []; } }, async () => {
    const it = item(); it.sources = ['fake'];
    const { sources } = await runCheck([it], { only: ['fake'] });
    const coverage = coverageOf([it], sources);
    assert.equal(coverage.itemsWithNoSource.length, 1, 'an unwatched item must be named, not quietly omitted');
    assert.equal(coverage.itemsWithNoSource[0].id, 'thing');
  });
});
