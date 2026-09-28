/* The things you own.
 *
 * Everything here is an example. Nothing in this file is yours, and the tool
 * will happily report on someone else's dishwasher until you replace it.
 *
 *   cp config/inventory.default.mjs config/inventory.local.mjs
 *
 * The copy is gitignored, which is where a list of your possessions belongs.
 *
 * KINDS, and what each one needs before it can be checked:
 *
 *   appliance   make, model      washing machines, kettles, heaters
 *   device      make, model      laptops, phones, routers, power banks, toys
 *   vehicle     make, model, year    optionally vin
 *   software    product          the slug used by endoflife.date, eg "nodejs"
 *   medicine    name             optionally pzn
 *
 * A missing required field is an error rather than a skip. An entry that is
 * quietly ignored looks exactly like an entry with nothing wrong, and the one
 * you cared about would be the one never checked.
 *
 * Where to find the model number: the label on the back or underside, the
 * original invoice, or the settings screen. Copy it exactly. Spacing, case and
 * hyphens do not matter, because they are stripped before matching.
 *
 * THE ONE FIELD WORTH THE EFFORT
 *
 * Add `barcode` if the box or label still has one, and `pzn` for a German
 * medicine. Both are digits printed by the manufacturer and reprinted verbatim
 * by the register, so a match on one is exact rather than a guess at how a
 * regulator chose to word a product name. Everything else here is text matching
 * and can be defeated by a spelling difference.
 *
 * Only add digits you can actually read off the thing. A wrong barcode is worse
 * than no barcode: it can match a recall that has nothing to do with you, and it
 * will be reported as certain.
 */

export default [
  {
    id: 'example-dishwasher',
    label: 'Example: kitchen dishwasher',
    kind: 'appliance',
    make: 'Bosch',
    model: 'SMV46KX01E',
    note: 'Replace this with something you actually own.',
  },
  {
    id: 'example-toy',
    label: 'Example: a toy, matched by its barcode',
    kind: 'device',
    make: 'Tickit',
    model: '73281',
    // 13 digits off the box. This is what an exact match looks like.
    barcode: '5060138820289',
    note: 'The EU register carries a barcode for roughly half its alerts.',
  },
  {
    id: 'example-car',
    label: 'Example: the car',
    kind: 'vehicle',
    make: 'Volkswagen',
    model: 'Golf',
    year: 2019,
    // vin: 'WVWZZZ1KZAW000000',  // 17 characters, from the registration document
  },
  {
    id: 'example-medicine',
    label: 'Example: a repeat prescription',
    kind: 'medicine',
    name: 'Pantoprazol',
    // The 8-digit Pharmazentralnummer, printed on every German pack.
    pzn: '10516704',
    note: 'The medicine register reports supply shortages, not safety recalls. '
      + 'A hit means the pharmacy may not be able to fill this, not that it is unsafe.',
  },
  {
    id: 'example-node',
    label: 'Example: Node.js on the server',
    kind: 'software',
    product: 'nodejs',
    cycle: '22',
  },
];
