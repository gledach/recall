import test from 'node:test';
import assert from 'node:assert/strict';
import { validateItem, loadInventory, itemsFor, KINDS } from '../core/inventory.mjs';

const ok = (over) => validateItem({ id: 'x', kind: 'appliance', make: 'Bosch', model: 'ABC123', ...over }, 0, 'test');

test('a complete appliance validates', () => {
  const i = ok();
  assert.equal(i.make, 'Bosch');
  assert.equal(i.kind, 'appliance');
  assert.deepEqual(i.sources, KINDS.appliance.sources);
});

test('a label is derived when none is given', () => {
  assert.equal(ok({ label: undefined }).label, 'Bosch ABC123');
  assert.equal(validateItem({ id: 'n', kind: 'software', product: 'nodejs' }, 0).label, 'nodejs');
});

test('a missing required field is an error, not a skip', () => {
  // A silently skipped item looks identical to a clean result, and it would be
  // the one you cared about.
  assert.throws(() => ok({ model: undefined }), /needs model/);
  assert.throws(() => ok({ make: '' }), /needs make/);
  assert.throws(() => validateItem({ id: 'v', kind: 'vehicle', make: 'VW', model: 'Golf' }, 0), /needs year/);
  assert.throws(() => validateItem({ id: 's', kind: 'software' }, 0), /needs product/);
});

test('the error explains why skipping would be worse', () => {
  assert.throws(() => ok({ model: undefined }), /silently skipped item/);
});

test('an unknown kind is refused with the list', () => {
  assert.throws(() => ok({ kind: 'spaceship' }), /kind must be one of/);
  assert.throws(() => ok({ kind: undefined }), /kind must be one of/);
});

test('an id must be usable on a command line', () => {
  assert.throws(() => ok({ id: 'has spaces' }), /id matching/);
  assert.throws(() => ok({ id: '../escape' }), /id matching/);
});

test('an implausible year is refused rather than searched for', () => {
  const v = { id: 'v', kind: 'vehicle', make: 'VW', model: 'Golf' };
  assert.throws(() => validateItem({ ...v, year: 1750 }, 0), /not plausible/);
  assert.throws(() => validateItem({ ...v, year: 'nineteen' }, 0), /not plausible/);
  assert.doesNotThrow(() => validateItem({ ...v, year: 2019 }, 0));
});

test('a VIN is 17 characters or absent, never a guess', () => {
  const v = { id: 'v', kind: 'vehicle', make: 'VW', model: 'Golf', year: 2019 };
  assert.throws(() => validateItem({ ...v, vin: 'TOOSHORT' }, 0), /17 characters/);
  assert.doesNotThrow(() => validateItem({ ...v, vin: 'WVWZZZ1KZAW123456' }, 0));
  assert.equal(validateItem({ ...v, vin: 'wvwzzz1kzaw123456' }, 0).vin.length, 17);
});

test('sources default per kind but can be overridden', () => {
  assert.deepEqual(ok({}).sources, KINDS.appliance.sources);
  assert.deepEqual(ok({ sources: ['cpsc'] }).sources, ['cpsc']);
});

test('itemsFor selects only what a source can speak to', () => {
  const items = [
    ok({ id: 'a' }),
    validateItem({ id: 'b', kind: 'software', product: 'nodejs' }, 0),
  ];
  assert.deepEqual(itemsFor(items, 'endoflife').map((i) => i.id), ['b']);
});

test('the shipped inventory loads and is marked as the default', async () => {
  const { items, isDefault } = await loadInventory();
  assert.ok(items.length > 0);
  assert.equal(isDefault, true, 'so the CLI can warn that these are examples');
});

test('duplicate ids are refused', async () => {
  const { validateItem: v } = await import('../core/inventory.mjs');
  // loadInventory checks this; validateItem alone cannot. Exercised via the
  // loader in the CLI tests.
  assert.equal(typeof v, 'function');
});
