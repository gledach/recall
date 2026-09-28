import { c } from '../core/format.mjs';

export default function help() {
  const b = c.bold, d = c.dim;
  console.log(`
${b('recall')} ${d('· tell me when something I own is recalled')}

Recalls and safety notices are published every week. They are published as a
firehose about everyone's things, which is why nobody reads them. This checks
them against the specific things on your list.

${b('COMMANDS')}

  ${b('check')}      Run every source against everything you own
  ${b('list')}       Your inventory, and which source can check each item
  ${b('notices')}    What you have been told, and when
  ${b('ack')}        Stop reporting one you have dealt with
  ${b('doctor')}     Config, sources, and what this cannot see
  ${b('help')}       This

${b('START HERE')}

  cp config/inventory.default.mjs config/inventory.local.mjs
  ${d('# edit it: the things you own, with model numbers off the label')}
  recall check

${b('HOW SURE IT IS')}

  Every finding carries a grade, because matching a label you typed against
  prose a regulator wrote is not exact:

    ${b('exact')}     the register matched on an identifier. Trust it
    ${b('strong')}    make and model both appear in the notice
    ${b('weak')}      the model appears, the make does not. Check it yourself
    ${b('mention')}   only the maker appears. Usually a different product

  Weak matches are shown by default. Missing the one that mattered is worse
  than reading one that turns out to be unrelated. Use ${b('--confidence=strong')}
  if it gets noisy, and ${b('--confidence=mention')} if you are being thorough.

${b('KEEPING IT QUIET')}

  recall ack <key>     ${d('# dealt with, stop showing it')}
  recall ack           ${d('# list what you have acknowledged')}

  Without this, every run re-reports the same things and you stop reading.

${b('WHAT THIS CANNOT SEE')}

  ${b('Registers it does not have.')} A clean result means "nothing in the sources
  listed", never "this product is safe".

  ${b('The wrong jurisdiction.')} Four registers: EU products, German medicine
  shortages, US vehicle campaigns, software support dates. No UK, Swiss,
  Australian, Canadian or Japanese register. German vehicle recalls are not
  checked at all, so a European car is covered by US campaigns plus whatever
  the EU product register happens to carry.

  ${b('Medicine means availability, not safety.')} That source lists medicines
  that are hard to get, not medicines that are dangerous.

  ${b('Anything you did not write down.')} It checks your list, not your house.

${d('MIT licensed. No account. Your list of possessions stays on your machine.')}
`);
  return 0;
}
