import { loadInventory } from '../core/inventory.mjs';
import { runCheck, coverageOf, SOURCES } from '../core/check.mjs';
import { appendNotice, seenKeys } from '../core/store.mjs';
import { c, table, dayLabel, scopeOf } from '../core/format.mjs';
import { bool } from '../core/args.mjs';

const SEVERITY = {
  critical: (s) => c.red(c.bold(s)),
  high: (s) => c.red(s),
  medium: (s) => c.yellow(s),
  low: (s) => c.dim(s),
  info: (s) => c.dim(s),
};

const CONFIDENCE_NOTE = {
  exact: 'the register matched on an identifier',
  strong: 'make and model both appear in the notice',
  weak: 'the model appears but the make does not. Worth checking yourself',
  mention: 'only the maker appears. Probably a different product',
};

export default async function check({ flags }) {
  const { items, file, isDefault } = await loadInventory();
  const only = typeof flags.source === 'string' ? flags.source.split(',').map((s) => s.trim()) : null;
  const minConfidence = typeof flags.confidence === 'string' ? flags.confidence : 'weak';
  const includeAcknowledged = bool(flags.all);

  if (only) {
    const unknown = only.filter((s) => !SOURCES[s]);
    if (unknown.length) {
      console.error(`Unknown source(s): ${unknown.join(', ')}. Known: ${Object.keys(SOURCES).join(', ')}`);
      return 2;
    }
  }

  const { findings, sources } = await runCheck(items, { only, minConfidence, includeAcknowledged });
  const coverage = coverageOf(items, sources);

  if (bool(flags.json)) {
    console.log(JSON.stringify({ findings, sources, coverage }, null, 2));
    return 0;
  }

  console.log('');
  console.log(`${c.bold('check')}  ${c.dim(`${items.length} thing${items.length === 1 ? '' : 's'} in ${file}`)}`);
  if (isDefault) {
    console.log(c.yellow('  ! this is the shipped example inventory. Nothing here is yours.'));
    console.log(c.dim('    cp config/inventory.default.mjs config/inventory.local.mjs'));
  }
  console.log('');

  // Record before printing, so the ledger is complete even if output is piped away.
  const alreadySeen = seenKeys();
  let fresh = 0;
  for (const f of findings) {
    if (alreadySeen.has(f.key)) continue;
    fresh += 1;
    appendNotice({
      key: f.key,
      itemId: f.item.id,
      itemLabel: f.item.label,
      source: f.notice.source,
      severity: f.notice.severity,
      confidence: f.confidence,
      title: f.notice.title,
      url: f.notice.url ?? null,
    });
  }

  if (findings.length === 0) {
    console.log(c.green('  Nothing found.'));
  } else {
    for (const f of findings) {
      const sev = (SEVERITY[f.notice.severity] ?? ((s) => s))(f.notice.severity.toUpperCase());
      const isNew = !alreadySeen.has(f.key);
      console.log(
        `  ${sev}  ${c.bold(f.item.label)}${isNew ? c.green('  new') : ''}${f.acknowledged ? c.dim('  acknowledged') : ''}`,
      );
      console.log(`      ${f.notice.title}`);
      if (f.notice.description) {
        console.log(c.dim(`      ${trim(f.notice.description, 220)}`));
      }
      if (f.notice.parkIt) console.log(c.red('      DO NOT DRIVE until this is fixed.'));
      else if (f.notice.parkOutside) console.log(c.red('      Park outside and away from buildings until fixed.'));
      console.log(
        c.dim(`      ${f.confidence}: ${f.reason}`) +
          (f.notice.date ? c.dim(`  ·  ${dayLabel(f.notice.date)}`) : ''),
      );
      if (f.notice.url) console.log(c.dim(`      ${f.notice.url}`));
      console.log(c.dim(`      ack with: gledach-recall ack ${f.key}`));
      console.log('');
    }
  }

  // What was checked, and what could not be.
  console.log(c.bold('  Sources'));
  console.log(
    table(
      sources.map((s) => [
        s.reachable ? c.green('ok') : c.red('FAILED'),
        s.source,
        `${s.itemsChecked} item${s.itemsChecked === 1 ? '' : 's'}`,
        s.reachable ? `${s.found} finding${s.found === 1 ? '' : 's'}` : c.red(trim(s.error ?? '', 60)),
        c.dim(scopeOf(s)),
      ]),
      { headers: ['', 'source', 'checked', 'result', ''] },
    )
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n'),
  );

  console.log('');
  if (!coverage.trustEmptyResult) {
    console.log(c.red('  A source failed, so "nothing found" above is not a clean bill of health.'));
  }
  if (coverage.itemsWithNoSource.length) {
    console.log(c.yellow(`  ${coverage.itemsWithNoSource.length} item(s) have no source that can check them:`));
    for (const i of coverage.itemsWithNoSource.slice(0, 6)) {
      console.log(c.dim(`    ${i.label} (${i.kind})`));
    }
  }
  console.log(
    c.dim(
      `  ${fresh} new, ${findings.length} shown. ` +
        `Confidence floor: ${minConfidence}. ${CONFIDENCE_NOTE[minConfidence] ?? ''}`,
    ),
  );
  console.log(c.dim('  This covers the registers listed above and nothing else. Absence of a notice'));
  console.log(c.dim('  is not proof a product is safe.'));
  console.log('');

  return findings.some((f) => ['critical', 'high'].includes(f.notice.severity)) ? 1 : 0;
}

function trim(s, n) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
