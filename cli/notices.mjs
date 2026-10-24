import { readNotices, allAcks } from '../core/store.mjs';
import { c, table, dayLabel, hhmm } from '../core/format.mjs';
import { bool, num } from '../core/args.mjs';

export default async function notices({ flags }) {
  const days = num(flags.days, 90);
  const rows = readNotices({ sinceMs: Date.now() - days * 86400_000 });
  const acks = allAcks();

  if (bool(flags.json)) { console.log(JSON.stringify({ days, rows, acknowledged: acks }, null, 2)); return 0; }

  console.log('');
  console.log(`${c.bold('notices')}  ${c.dim(`recorded in the last ${days} days`)}`);
  console.log('');

  if (rows.length === 0) {
    console.log(c.dim('  Nothing recorded yet. Run `gledach-recall check`.'));
    console.log('');
    return 0;
  }

  console.log(
    table(
      rows.slice().reverse().map((r) => [
        c.dim(`${dayLabel(r.at)} ${hhmm(r.at)}`),
        r.severity,
        r.itemLabel,
        String(r.title).slice(0, 52),
        acks[r.key] ? c.green('acked') : '',
      ]),
      { headers: ['recorded', 'severity', 'thing', 'notice', ''] },
    ).split('\n').map((l) => `  ${l}`).join('\n'),
  );

  console.log('');
  console.log(c.dim(`  ${rows.length} notice(s), ${Object.keys(acks).length} acknowledged.`));
  console.log(c.dim('  The ledger is append-only: what you were told, when, stays on the record.'));
  console.log('');
  return 0;
}
