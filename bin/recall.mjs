#!/usr/bin/env node
/* Router. Each command is its own file, imported lazily. */

import { parseArgs } from '../core/args.mjs';

const COMMANDS = {
  check: () => import('../cli/check.mjs'),
  list: () => import('../cli/list.mjs'),
  notices: () => import('../cli/notices.mjs'),
  ack: () => import('../cli/ack.mjs'),
  doctor: () => import('../cli/doctor.mjs'),
  help: () => import('../cli/help.mjs'),
};

const args = parseArgs(process.argv.slice(2));
const name = args._[0] ?? (args.flags.help || args.flags.h ? 'help' : 'help');

const loader = COMMANDS[name];
if (!loader) {
  console.error(`gledach-recall: unknown command "${name}"`);
  console.error(`Try one of: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(2);
}

try {
  const mod = await loader();
  const code = await mod.default({ ...args, _: args._.slice(1) });
  process.exit(typeof code === 'number' ? code : 0);
} catch (err) {
  console.error(`gledach-recall ${name}: ${err.message}`);
  if (process.env.RECALL_DEBUG) console.error(err.stack);
  process.exit(1);
}
