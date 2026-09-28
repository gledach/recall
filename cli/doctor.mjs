/* Reports, does not repair. Ends with what the tool cannot see, because an
 * empty result from a safety tool is the most dangerous thing it can print. */

import fs from 'node:fs';
import { loadInventory, KINDS } from '../core/inventory.mjs';
import { SOURCES } from '../core/check.mjs';
import { readNotices, allAcks } from '../core/store.mjs';
import { paths, ensureDataDir, pretty } from '../core/paths.mjs';
import { c, scopeOf } from '../core/format.mjs';
import { bool } from '../core/args.mjs';

export default async function doctor({ flags }) {
  const offline = bool(flags.offline);
  let problems = 0, warnings = 0;
  const ok = (l, d = '') => console.log(`  ${c.green('ok')}    ${l}${d ? `  ${c.dim(d)}` : ''}`);
  const warn = (l, d = '') => { warnings += 1; console.log(`  ${c.yellow('warn')}  ${l}${d ? `  ${c.dim(d)}` : ''}`); };
  const bad = (l, d = '') => { problems += 1; console.log(`  ${c.red('FAIL')}  ${l}${d ? `  ${c.dim(d)}` : ''}`); };

  console.log('');
  console.log(c.bold('recall doctor'));
  console.log('');

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) ok('node', `v${process.versions.node}`);
  else bad('node', `v${process.versions.node}, needs >= 22`);

  let items = [];
  try {
    const inv = await loadInventory();
    items = inv.items;
    ok('inventory', `${pretty(inv.file)}, ${items.length} item(s)`);
    if (inv.isDefault) warn('inventory is the shipped example', 'nothing in it is yours');
  } catch (err) {
    bad('inventory', err.message);
  }

  for (const [id, s] of Object.entries(SOURCES)) {
    const covers = items.filter((i) => (s.handles ?? []).includes(i.kind)).length;
    const detail = `${covers} of your items, handles ${(s.handles ?? []).join(', ')}` +
      (scopeOf(s) ? `, ${scopeOf(s)}` : '');
    if (offline) { warn(`source ${id}`, `${detail}. Not contacted (--offline)`); continue; }
    ok(`source ${id}`, detail);
  }

  const orphans = items.filter((i) => !Object.values(SOURCES).some((s) => (s.handles ?? []).includes(i.kind)));
  if (orphans.length) {
    warn(`${orphans.length} item(s) no source can check`, orphans.map((i) => i.label).join(', '));
  }

  try {
    ensureDataDir();
    fs.accessSync(paths.data, fs.constants.W_OK);
    ok('data', `${pretty(paths.data)}, ${readNotices().length} notice(s), ${Object.keys(allAcks()).length} acknowledged`);
  } catch (err) {
    bad('data directory', err.message);
  }

  console.log('');
  console.log(c.bold('  What this cannot see'));
  console.log(c.dim('    Registers it does not have. Only the sources above are consulted, so a'));
  console.log(c.dim('    clean result means "nothing in those", never "this product is safe".'));
  console.log(c.dim('    Jurisdiction. A European appliance has European notices; a US register'));
  console.log(c.dim('    will not carry them, and model names differ between markets.'));
  console.log(c.dim('    Anything you did not write down. It checks your list, not your house.'));
  console.log(c.dim('    Wording. A notice that spells your model differently will be graded'));
  console.log(c.dim('    lower or missed entirely, which is why weak matches are shown by default.'));

  console.log('');
  if (problems) console.log(`  ${c.red(`${problems} problem(s)`)}${warnings ? `, ${warnings} warning(s)` : ''}`);
  else if (warnings) console.log(`  ${c.yellow(`${warnings} warning(s)`)}, nothing broken`);
  else console.log(`  ${c.green('all good')}`);
  console.log('');
  console.log(c.dim(`  Kinds: ${Object.keys(KINDS).join(', ')}`));
  console.log('');
  return problems > 0 ? 1 : 0;
}
