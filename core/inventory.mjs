/* What you own.
 *
 * Resolution order: $RECALL_INVENTORY → config/inventory.local.mjs →
 * config/inventory.default.mjs
 *
 * Validation refuses rather than repairs. An entry missing the field its kind
 * needs cannot be checked against anything, and silently skipping it would mean
 * the one appliance you cared about is never looked at while the tool reports
 * "nothing found" with a straight face. Better to fail loudly at load.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_DIR } from './paths.mjs';

/** What each kind needs before it can be matched against anything. */
export const KINDS = {
  appliance: { needs: ['make', 'model'], sources: ['safetygate'] },
  device: { needs: ['make', 'model'], sources: ['safetygate'] },
  vehicle: { needs: ['make', 'model', 'year'], sources: ['nhtsa', 'safetygate'] },
  software: { needs: ['product'], sources: ['endoflife'] },
  medicine: { needs: ['name'], sources: ['bfarm'] },
};

export async function loadInventory() {
  const candidates = [
    process.env.RECALL_INVENTORY ? path.resolve(process.env.RECALL_INVENTORY) : null,
    path.join(CONFIG_DIR, 'inventory.local.mjs'),
    path.join(CONFIG_DIR, 'inventory.default.mjs'),
  ].filter(Boolean);

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    // mtime in the URL: ESM caches module records, and a long-running check
    // would otherwise never see an edit.
    const mod = await import(`${pathToFileURL(file).href}?v=${fs.statSync(file).mtimeMs}`);
    const list = mod.default;
    if (!Array.isArray(list)) throw new Error(`${file}: default export must be an array`);

    const items = list.map((item, i) => validateItem(item, i, file));
    const ids = new Set();
    for (const item of items) {
      if (ids.has(item.id)) throw new Error(`${file}: duplicate id "${item.id}"`);
      ids.add(item.id);
    }
    return { file, items, isDefault: file.endsWith('inventory.default.mjs') };
  }

  throw new Error('No inventory found. Expected config/inventory.default.mjs to exist.');
}

export function validateItem(item, index, file = '') {
  const where = `${file ? `${file} ` : ''}item[${index}]${item?.id ? ` (${item.id})` : ''}`;
  const fail = (msg) => { throw new Error(`${where}: ${msg}`); };

  if (!item || typeof item !== 'object') fail('is not an object');
  if (!item.id || !/^[a-z0-9][a-z0-9-]*$/i.test(item.id)) {
    fail('needs an id matching [a-z0-9][a-z0-9-]*');
  }

  const kind = item.kind;
  if (!kind || !KINDS[kind]) {
    fail(`kind must be one of: ${Object.keys(KINDS).join(', ')}`);
  }

  for (const field of KINDS[kind].needs) {
    const v = item[field];
    if (v === undefined || v === null || String(v).trim() === '') {
      fail(`a ${kind} needs ${field}. Without it there is nothing to match against, and a`
        + ' silently skipped item looks identical to a clean result');
    }
  }

  if (item.year !== undefined) {
    const y = Number(item.year);
    if (!Number.isInteger(y) || y < 1900 || y > new Date().getFullYear() + 2) {
      fail(`year ${JSON.stringify(item.year)} is not plausible`);
    }
  }
  if (item.vin !== undefined && String(item.vin).replace(/\s/g, '').length !== 17) {
    fail('a VIN is 17 characters. Leave it out rather than guessing');
  }
  if (item.pzn !== undefined && String(item.pzn).replace(/[^0-9]/g, '').length !== 8) {
    fail('a PZN is 8 digits, printed on every German medicine pack. '
      + 'Leave it out rather than guessing');
  }
  if (item.barcode !== undefined) {
    const digits = String(item.barcode).replace(/[^0-9]/g, '');
    if (digits.length < 8 || digits.length > 14) {
      fail('a barcode is 8 to 14 digits (EAN-8, UPC-A, EAN-13 or GTIN-14). '
        + 'It is the strongest match this tool has, so a wrong one is worse than none');
    }
  }

  return {
    id: item.id,
    label: item.label || [item.make, item.model].filter(Boolean).join(' ') || item.product || item.name || item.id,
    kind,
    make: item.make ? String(item.make).trim() : null,
    model: item.model ? String(item.model).trim() : null,
    year: item.year !== undefined ? Number(item.year) : null,
    vin: item.vin ? String(item.vin).replace(/\s/g, '').toUpperCase() : null,
    barcode: item.barcode ? String(item.barcode).replace(/[^0-9]/g, '') : null,
    pzn: item.pzn ? String(item.pzn).replace(/[^0-9]/g, '') : null,
    product: item.product ? String(item.product).trim() : null,
    cycle: item.cycle !== undefined && item.cycle !== null ? String(item.cycle).trim() : null,
    name: item.name ? String(item.name).trim() : null,
    note: item.note ? String(item.note) : null,
    sources: Array.isArray(item.sources) && item.sources.length ? item.sources : KINDS[kind].sources,
  };
}

/** Items a given source can say anything useful about. */
export function itemsFor(items, sourceId) {
  return items.filter((i) => i.sources.includes(sourceId));
}
