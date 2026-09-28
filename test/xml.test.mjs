/* The XML reader.
 *
 * It is not a parser and does not pretend to be. These tests pin what it does
 * handle, and one of them pins a limitation on purpose: if someone later needs
 * nested records, the test says plainly that this file gets replaced rather
 * than quietly extended until it half works.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { blocks, text, texts, decodeEntities } from '../core/xml.mjs';

test('blocks finds every record', () => {
  assert.deepEqual(blocks('<a><r>1</r><r>2</r></a>', 'r'), ['1', '2']);
});

test('blocks keeps records whose tag carries attributes', () => {
  // The Safety Gate export writes <notifications xmlns:xsi=... xsi:type=...>,
  // and a pattern that only matched a bare tag found nothing at all.
  const xml = '<doc><notifications xsi:type="WeeklyReportDetail"><a>1</a></notifications></doc>';
  assert.deepEqual(blocks(xml, 'notifications'), ['<a>1</a>']);
});

test('blocks returns nothing rather than throwing on an absent tag', () => {
  assert.deepEqual(blocks('<a><b>1</b></a>', 'missing'), []);
});

test('text reads the first occurrence and trims it', () => {
  assert.equal(text('<a>  hello  </a><a>second</a>', 'a'), 'hello');
});

test('text unwraps CDATA instead of showing the wrapper to a person', () => {
  assert.equal(text('<n><![CDATA[Sensory Blocks]]></n>', 'n'), 'Sensory Blocks');
});

test('text decodes entities', () => {
  assert.equal(text('<n>Toys &amp; Games</n>', 'n'), 'Toys & Games');
  assert.equal(decodeEntities('&#65;&#x42;'), 'AB');
  assert.equal(decodeEntities('caf&eacute;'), 'caf&eacute;', 'an unknown entity is left alone, not dropped');
});

test('text collapses whitespace so a multi-line field is one line', () => {
  assert.equal(text('<d>one\n   two\n\n three</d>', 'd'), 'one two three');
});

test('an empty element reads as absent, not as an empty string', () => {
  // A caller checking truthiness should treat <barcode></barcode> as no barcode.
  assert.equal(text('<barcode></barcode>', 'barcode'), null);
  assert.equal(text('<barcode>   </barcode>', 'barcode'), null);
  assert.equal(text('<barcode><![CDATA[]]></barcode>', 'barcode'), null);
});

test('a missing element reads as null', () => {
  assert.equal(text('<a>1</a>', 'b'), null);
  assert.equal(text(null, 'b'), null);
});

test('texts collects every occurrence of a repeated field', () => {
  assert.deepEqual(texts('<c>DE</c><c>FR</c><c></c>', 'c'), ['DE', 'FR']);
});

test('tags are case insensitive, because exports are inconsistent', () => {
  assert.equal(text('<URL>https://x</URL>', 'url'), 'https://x');
});

test('a nested record of the same name is a known limitation, not a silent wrong answer', () => {
  /* Non-greedy matching stops at the first close tag, so a record nested inside
     another of the same name is truncated. This is documented rather than fixed:
     none of the exports this reads are shaped that way, and the day one is, the
     right move is a real parser. Pinned so the behaviour cannot change unnoticed. */
  assert.deepEqual(blocks('<r>outer<r>inner</r></r>', 'r'), ['outer<r>inner']);
});
