import { loadInventory, KINDS } from '../core/inventory.mjs';
import { SOURCES } from '../core/check.mjs';
import { c, table } from '../core/format.mjs';
import { bool } from '../core/args.mjs';

export default async function list({ flags }) {
  const { items, file, isDefault } = await loadInventory();
  if (bool(flags.json)) { console.log(JSON.stringify({ file, items }, null, 2)); return 0; }

  console.log('');
  console.log(`${c.bold('list')}  ${c.dim(file)}`);
  console.log('');
  console.log(
    table(
      items.map((i) => {
        const usable = i.sources.filter((s) => SOURCES[s] && (SOURCES[s].handles ?? []).includes(i.kind));
        return [
          i.id,
          i.label,
          i.kind,
          [i.make, i.model, i.year].filter(Boolean).join(' ') || i.product || i.name || '',
          usable.length ? usable.join(', ') : c.yellow('no source'),
        ];
      }),
      { headers: ['id', 'label', 'kind', 'identifiers', 'checked by'] },
    ).split('\n').map((l) => `  ${l}`).join('\n'),
  );

  const orphans = items.filter((i) => !i.sources.some((s) => SOURCES[s] && (SOURCES[s].handles ?? []).includes(i.kind)));
  console.log('');
  if (orphans.length) {
    console.log(c.yellow(`  ${orphans.length} item(s) cannot be checked by any source that exists yet.`));
    console.log(c.dim('  They are listed so their absence from results is visible rather than silent.'));
  }
  if (isDefault) {
    console.log(c.yellow('  This is the shipped example inventory. Nothing here is yours.'));
    console.log(c.dim('  cp config/inventory.default.mjs config/inventory.local.mjs'));
  }
  console.log(c.dim(`  Kinds: ${Object.keys(KINDS).join(', ')}`));
  console.log('');
  return 0;
}
