/* The matching engine decides whether this tool is useful or a nuisance.
 *
 * Both failure modes are tested, and they are not symmetrical: crying wolf
 * trains people to ignore it, and silence hides the one notice that mattered.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalise, words, isDistinctive, matchNotice, matchAll, noticeKey } from '../core/match.mjs';

const dishwasher = { id: 'dw', make: 'Bosch', model: 'SMV46KX01E', label: 'Kitchen dishwasher' };

test('model numbers normalise across the ways people write them', () => {
  const canonical = 'SMV46KX01E';
  for (const written of ['SMV46KX01E', 'smv46kx01e', 'SMV-46KX01E', 'SMV 46 KX01E', ' smv/46kx01e ']) {
    assert.equal(normalise(written), canonical, `${written} should normalise`);
  }
});

test('normalise survives nothing', () => {
  assert.equal(normalise(null), '');
  assert.equal(normalise(undefined), '');
  assert.equal(normalise(''), '');
  assert.equal(normalise(12345), '12345');
});

test('words drops punctuation and single letters', () => {
  assert.deepEqual(words('Bosch-Siemens, A GmbH'), ['bosch', 'siemens', 'gmbh']);
});

test('a distinctive model needs length and both letters and digits', () => {
  assert.equal(isDistinctive('SMV46KX01E'), true);
  assert.equal(isDistinctive('A3'), false, 'short codes appear in any long document');
  assert.equal(isDistinctive('12345678'), false, 'a bare number is a year, a price, anything');
  assert.equal(isDistinctive('DISHWASHER'), false, 'a word is not a model number');
  assert.equal(isDistinctive('WM14N2K1'), true);
});

/* ── the four grades ─────────────────────────────────────────────────────── */

test('an identifier match from the source beats any text matching', () => {
  const m = matchNotice(dishwasher, {
    source: 'nhtsa', matchedIdentifier: 'make, model and year', title: 'Unrelated words entirely',
  });
  assert.equal(m.confidence, 'exact');
  assert.match(m.reason, /nhtsa matched on/);
});

test('make and model both present is a strong match', () => {
  const m = matchNotice(dishwasher, {
    source: 'safetygate',
    title: 'Bosch dishwasher SMV46KX01E, risk of fire',
    description: 'The appliance may overheat.',
  });
  assert.equal(m.confidence, 'strong');
});

test('spacing and hyphens in the notice do not break a strong match', () => {
  const m = matchNotice(dishwasher, {
    source: 'safetygate', title: 'Bosch model SMV-46 KX01E recalled',
  });
  assert.equal(m.confidence, 'strong', 'the notice writes the model its own way');
});

test('a distinctive model without the make is weak, and says why', () => {
  const m = matchNotice(dishwasher, { source: 'cpsc', title: 'Unit SMV46KX01E withdrawn' });
  assert.equal(m.confidence, 'weak');
  assert.match(m.reason, /Check it is the same product/);
});

test('the make alone is only a mention', () => {
  const m = matchNotice(dishwasher, { source: 'cpsc', title: 'Bosch power drill recalled' });
  assert.equal(m.confidence, 'mention');
  assert.match(m.reason, /different product from the same maker/);
});

test('an unrelated notice does not match at all', () => {
  assert.equal(matchNotice(dishwasher, { source: 'cpsc', title: 'Acme kettle recalled' }), null);
});

/* ── crying wolf ─────────────────────────────────────────────────────────── */

test('a short model number does not fire on unrelated prose', () => {
  // The single most likely way this tool becomes a nuisance.
  const car = { id: 'c', make: 'Audi', model: 'A3' };
  const notice = {
    source: 'cpsc',
    title: 'Recall of garden hose',
    description: 'Affected batches are marked A3 through A9 on the packaging.',
  };
  const m = matchNotice(car, notice);
  assert.notEqual(m?.confidence, 'weak', 'A3 must not produce a weak match on its own');
  assert.equal(m, null, 'and with no make present, no match at all');
});

test('a make that is an ordinary word does not match every notice', () => {
  const item = { id: 'x', make: 'Apple', model: 'A2338' };
  const m = matchNotice(item, { source: 'cpsc', title: 'Recall of apple juice, contamination risk' });
  // "apple" genuinely appears, so this is reported, but only as a mention,
  // which is the grade that exists precisely for this case.
  assert.equal(m.confidence, 'mention');
});

test('an item with no model still matches on make alone, at the lowest grade', () => {
  const m = matchNotice({ id: 'y', make: 'Bosch' }, { source: 'cpsc', title: 'Bosch kettle recalled' });
  assert.equal(m.confidence, 'mention');
});

/* ── silence ─────────────────────────────────────────────────────────────── */

test('matchAll reports weak matches by default, because missing one is worse', () => {
  const notices = [
    { source: 's', id: 1, title: 'Unit SMV46KX01E withdrawn' },
    { source: 's', id: 2, title: 'Bosch drill recalled' },
  ];
  const hits = matchAll(dishwasher, notices);
  assert.equal(hits.length, 1, 'the weak match is kept, the mention is filtered');
  assert.equal(hits[0].confidence, 'weak');
});

test('mentions can be asked for explicitly', () => {
  const notices = [{ source: 's', id: 2, title: 'Bosch drill recalled' }];
  assert.equal(matchAll(dishwasher, notices).length, 0);
  assert.equal(matchAll(dishwasher, notices, { minConfidence: 'mention' }).length, 1);
});

test('results are ordered by how much they deserve attention', () => {
  const notices = [
    { source: 's', id: 1, title: 'Bosch drill' },
    { source: 's', id: 2, title: 'Bosch dishwasher SMV46KX01E fire risk' },
    { source: 's', id: 3, title: 'Unit SMV46KX01E' },
  ];
  const hits = matchAll(dishwasher, notices, { minConfidence: 'mention' });
  assert.deepEqual(hits.map((h) => h.confidence), ['strong', 'weak', 'mention']);
});

test('noticeKey is stable, so the same notice is not reported twice', () => {
  const n = { source: 'cpsc', id: '12345', title: 'x' };
  assert.equal(noticeKey(dishwasher, n), noticeKey(dishwasher, n));
  assert.notEqual(noticeKey(dishwasher, n), noticeKey({ ...dishwasher, id: 'other' }, n));
});

test('noticeKey falls back to the title when a source has no id', () => {
  const a = noticeKey(dishwasher, { source: 's', title: 'Bosch dishwasher fire risk' });
  const b = noticeKey(dishwasher, { source: 's', title: 'Bosch  dishwasher, fire risk!' });
  assert.equal(a, b, 'punctuation drift must not resurrect an acknowledged notice');
});

/* ── identifiers printed on the box ───────────────────────────────────────── */

test('a matching barcode is exact, whatever the prose says', () => {
  const item = { id: 'x', make: 'Wrong Make', model: 'WRONGMODEL1', barcode: '5060138820289' };
  const m = matchNotice(item, { source: 'safetygate', title: 'Some toy', barcode: '5060138820289' });
  assert.equal(m.confidence, 'exact');
  assert.match(m.reason, /barcode/);
});

test('barcode formatting differences do not break the match', () => {
  const m = matchNotice(
    { id: 'x', barcode: '5060138820289' },
    { source: 'safetygate', title: 'Toy', barcode: '5060-1388-20289' },
  );
  assert.equal(m?.confidence, 'exact');
});

test('a different barcode does not match on the barcode', () => {
  const m = matchNotice(
    { id: 'x', make: 'Acme', model: 'XR4500', barcode: '1111111111116' },
    { source: 's', title: 'Acme XR4500 fault', make: 'Acme', model: 'XR4500', barcode: '5060138820289' },
  );
  assert.equal(m.confidence, 'strong', 'it should fall through to text matching, not claim exact');
});

test('a matching PZN is exact, which is the point of typing one in', () => {
  const m = matchNotice(
    { id: 'x', name: 'Something else entirely' },
    { source: 'bfarm', title: 'Shortage: Pantoprazol', pzn: '10516704' },
  );
  assert.equal(m, null, 'no PZN on the item means no exact claim');

  const withPzn = matchNotice(
    { id: 'x', name: 'Something else entirely', pzn: '10516704' },
    { source: 'bfarm', title: 'Shortage: Pantoprazol', pzn: '10516704' },
  );
  assert.equal(withPzn.confidence, 'exact');
  assert.match(withPzn.reason, /PZN/);
});

/* ── things that carry a name instead of a make and a model ───────────────── */

test('every word of a name appearing is a strong match', () => {
  const m = matchNotice(
    { id: 'x', name: 'Pantoprazol-Micro Labs' },
    { source: 'bfarm', title: 'Shortage: Pantoprazol-Micro Labs 40 mg magensaftresistente Tabletten' },
  );
  assert.equal(m.confidence, 'strong');
});

test('a one-word name is only weak, because it probably names an ingredient', () => {
  const m = matchNotice(
    { id: 'x', name: 'Pantoprazol' },
    { source: 'bfarm', title: 'Shortage: Pantoprazol-Micro Labs 40 mg Tabletten' },
  );
  assert.equal(m.confidence, 'weak');
  assert.match(m.reason, /ingredient/);
});

test('a name that does not fully appear does not match', () => {
  const m = matchNotice(
    { id: 'x', name: 'Ibuprofen Ratiopharm' },
    { source: 'bfarm', title: 'Shortage: Pantoprazol-Micro Labs 40 mg' },
  );
  assert.equal(m, null);
});

test('a make and model item is not matched by its name path by accident', () => {
  // The name path must not rescue an item that make and model matching rejected.
  const m = matchNotice(
    { id: 'x', make: 'Acme', model: 'XR4500' },
    { source: 's', title: 'Totally unrelated product notice' },
  );
  assert.equal(m, null);
});

