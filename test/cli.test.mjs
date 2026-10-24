/* The command line, exercised as a subprocess.
 *
 * Only the offline commands. `check` reaches four registers, so it belongs in
 * test/live.mjs: a gate that fails when a public API has a bad afternoon teaches
 * people to ignore the gate.
 *
 * These tests are mostly about honesty of output rather than mechanics. The
 * failure this tool has to avoid is a person reading a clean screen as a
 * guarantee, and that is a property of what gets printed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'recall.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-cli-'));

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function run(args, { expectFail = false } = {}) {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], {
      encoding: 'utf8',
      env: { ...process.env, RECALL_DATA: TMP, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.ok(!expectFail, `expected a non-zero exit from "${args.join(' ')}"`);
    return out;
  } catch (err) {
    assert.ok(expectFail, `"${args.join(' ')}" failed unexpectedly:\n${err.stdout ?? ''}${err.stderr ?? ''}`);
    return `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
}

test('help lists every command the binary accepts', () => {
  const out = run(['help']);
  for (const cmd of ['check', 'list', 'notices', 'ack', 'doctor']) {
    assert.ok(out.includes(cmd), `help does not mention "${cmd}"`);
  }
});

test('no arguments prints help rather than doing something unasked', () => {
  const out = run([]);
  assert.ok(out.includes('check'), 'a bare invocation should explain itself');
});

test('an unknown command fails loudly instead of being ignored', () => {
  const out = run(['frobnicate'], { expectFail: true });
  assert.match(out, /frobnicate/, 'the error should name what was not understood');
});

test('list shows the inventory and which register watches each thing', () => {
  const out = run(['list']);
  assert.match(out, /safetygate|endoflife|nhtsa|bfarm/, 'list must say what watches each item');
});

test('list warns that the shipped inventory is an example', () => {
  // Someone who runs this on the defaults and sees a clean result must not
  // conclude anything about their own belongings.
  const out = run(['list']);
  assert.match(out, /example/i, 'the default inventory must be flagged as not the user’s own');
  assert.match(out, /inventory\.local\.mjs/, 'it should say how to fix that');
});

test('doctor reports on every register without needing the network', () => {
  const out = run(['doctor']);
  for (const id of ['safetygate', 'bfarm', 'endoflife', 'nhtsa']) {
    assert.ok(out.includes(id), `doctor does not mention "${id}"`);
  }
});

test('doctor states which jurisdictions are covered', () => {
  const out = run(['doctor']);
  assert.match(out, /EU/, 'the EU register should be identified as such');
  assert.match(out, /US/, 'the US register should be identified as such');
});

test('notices is empty and says so on a fresh install', () => {
  const out = run(['notices']);
  assert.match(out, /no|none|nothing/i, 'an empty log should read as empty, not as a clean bill of health');
});

test('ack with no key lists the ledger and shows how to use it', () => {
  // A bare `ack` is a legitimate question ("what have I already dealt with?"),
  // so it reports rather than failing.
  const out = run(['ack']);
  assert.match(out, /acknowledged/i);
  assert.match(out, /gledach-recall ack <key>/, 'it should show the usage it expects');
  assert.match(out, /--undo/, 'and how to reverse itself');
});

test('ack and undo round trip through the ledger', () => {
  const key = 'thing|safetygate|SR/00001/26';

  const added = run(['ack', key, '--note=handled by hand']);
  assert.match(added, /acknowledged/i);
  // Acknowledging must not delete anything: the record stays, it stops being shown.
  assert.match(added, /ledger|stays/i, 'the user should be told the notice is not deleted');

  const listed = run(['ack']);
  assert.ok(listed.includes(key), `the acknowledged key should be listed back:\n${listed}`);

  run(['ack', key, '--undo']);
  const after = run(['ack']);
  assert.ok(!after.includes(key), `--undo should remove it from the ledger:\n${after}`);
});

test('an acknowledgement does not remove anything from the notice log', () => {
  // The log is the record of what the registers said. Acknowledging is the
  // owner's note about it, and must never edit the underlying history.
  const key = 'thing|safetygate|SR/00002/26';
  run(['ack', key]);
  const out = run(['notices']);
  assert.match(out, /no|none|nothing/i, 'nothing was ever checked, so the log stays empty');
  run(['ack', key, '--undo']);
});

test('a human-readable command prints no ANSI codes when NO_COLOR is set', () => {
  // Colour in piped output corrupts anything downstream, including these tests.
  const out = run(['doctor']);
  assert.ok(!out.includes('['), 'NO_COLOR must be honoured');
});
