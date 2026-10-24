/* Acknowledging is what keeps this a tool rather than a nag. Without it every
 * run re-reports the same things, people stop reading, and the one that matters
 * lands in a list nobody opens. */

import { acknowledge, unacknowledge, isAcknowledged, allAcks } from '../core/store.mjs';
import { c } from '../core/format.mjs';
import { bool } from '../core/args.mjs';

export default async function ack({ flags, _ }) {
  const key = _[0];
  if (!key) {
    const acks = allAcks();
    console.log('');
    console.log(`${c.bold('ack')}  ${c.dim(`${Object.keys(acks).length} acknowledged`)}`);
    console.log('');
    for (const [k, v] of Object.entries(acks)) {
      console.log(`  ${k}${v.note ? c.dim(`  (${v.note})`) : ''}`);
    }
    console.log('');
    console.log(c.dim('  gledach-recall ack <key>            stop reporting this one'));
    console.log(c.dim('  gledach-recall ack <key> --undo     start reporting it again'));
    console.log('');
    return 0;
  }

  if (bool(flags.undo)) {
    const removed = unacknowledge(key);
    console.log(removed ? c.green(`  no longer acknowledged: ${key}`) : c.yellow(`  was not acknowledged: ${key}`));
    return removed ? 0 : 1;
  }

  if (isAcknowledged(key)) {
    console.log(c.dim(`  already acknowledged: ${key}`));
    return 0;
  }

  acknowledge(key, typeof flags.note === 'string' ? flags.note : null);
  console.log(c.green(`  acknowledged: ${key}`));
  console.log(c.dim('  It stays in the ledger. It just stops appearing in `check`.'));
  return 0;
}
