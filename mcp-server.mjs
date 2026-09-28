#!/usr/bin/env node
/* recall over MCP, so an assistant can answer "is anything I own recalled?"
 *
 * JSON-RPC 2.0 over stdio, hand-rolled. No SDK, because the protocol surface
 * this needs is four methods and a dependency would be the only one in the repo.
 *
 * Two house rules, both deliberate:
 *
 *   Read only. Nothing here writes to the inventory or acknowledges a notice.
 *   Acknowledging is a person deciding they have dealt with something, and an
 *   assistant cannot make that decision on their behalf. `recall ack` is a CLI
 *   command for exactly that reason.
 *
 *   Every result carries its coverage. A model asked "is my car recalled?" will
 *   otherwise turn "no notices found" into "your car is fine", which is a
 *   different and much stronger claim. So each response states which registers
 *   were consulted, which failed, and what is therefore not covered.
 */

import { loadInventory, KINDS } from './core/inventory.mjs';
import { runCheck, coverageOf, SOURCES } from './core/check.mjs';
import { readNotices, allAcks } from './core/store.mjs';
import { paths, pretty } from './core/paths.mjs';

const NAME = 'recall';
const VERSION = '0.1.0';

/* Repeated into every tool result. A caller that sees only the findings array
   has no way to know the difference between "checked and clean" and "could not
   reach the register", and will report the first when it means the second. */
const DISCLAIMER =
  'Absence of a notice is not proof of safety. These registers publish late and '
  + 'incompletely, and only cover the jurisdictions listed. Never present a clean '
  + 'result as a guarantee. Always show the confidence grade next to a match: a '
  + '"weak" match is a suggestion to check, not a finding.';

const tools = [
  {
    name: 'check_inventory',
    description:
      'Run every applicable register against the things in the inventory and return graded matches. '
      + 'This makes network requests and can take a few seconds. Each result carries a confidence '
      + 'grade (exact, strong, weak, mention) that must be shown to the user, plus a coverage block '
      + 'saying which registers answered.',
    inputSchema: {
      type: 'object',
      properties: {
        sources: {
          type: 'array',
          items: { type: 'string', enum: Object.keys(SOURCES) },
          description: 'Limit to these registers. Omit to run all of them.',
        },
        minConfidence: {
          type: 'string',
          enum: ['exact', 'strong', 'weak', 'mention'],
          description: 'Floor for what is returned. Default "weak". "mention" is mostly noise.',
        },
        includeAcknowledged: {
          type: 'boolean',
          description: 'Include notices the owner has already marked as handled. Default false.',
        },
      },
    },
  },
  {
    name: 'list_inventory',
    description:
      'The things being watched, and which register can say anything about each one. '
      + 'Use this to answer questions about coverage without making any network requests.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'notice_history',
    description:
      'Notices recorded by past runs, newest first. Reads the local log only, no network. '
      + 'Useful for "has this come up before?" and for seeing when something was first reported.',
    inputSchema: {
      type: 'object',
      properties: {
        sinceDays: { type: 'number', description: 'Only notices first seen in the last N days.' },
        limit: { type: 'number', description: 'Maximum to return. Default 50.' },
      },
    },
  },
  {
    name: 'describe_sources',
    description:
      'What each register covers, what it does not, and whether it needs a key. '
      + 'Read this before telling a user that something is not recalled.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'blind_spots',
    description:
      'What this tool cannot see: kinds of thing with no register behind them, items missing the '
      + 'fields needed to match, and jurisdictions not covered. Call this when a user asks how '
      + 'much to trust a clean result.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function sourceInfo(id, source) {
  return {
    id,
    label: source.label,
    jurisdiction: source.jurisdiction ?? 'unknown',
    handles: source.handles ?? [],
    needsKey: Boolean(source.needsKey),
    reports: source.reports ?? 'safety recalls and withdrawals',
    attribution: source.attribution ?? null,
  };
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'check_inventory': {
      const { items, file, isDefault } = await loadInventory();
      const { findings, sources } = await runCheck(items, {
        only: Array.isArray(args.sources) && args.sources.length ? args.sources : null,
        minConfidence: args.minConfidence ?? 'weak',
        includeAcknowledged: Boolean(args.includeAcknowledged),
      });
      const coverage = coverageOf(items, sources);
      return {
        checkedAt: new Date().toISOString(),
        inventory: { file: pretty(file), items: items.length, isExampleInventory: isDefault },
        findings: findings.map((f) => ({
          key: f.key,
          item: { id: f.item.id, label: f.item.label, kind: f.item.kind },
          confidence: f.confidence,
          whyItMatched: f.reason,
          severity: f.notice.severity,
          title: f.notice.title,
          description: f.notice.description,
          source: f.notice.source,
          date: f.notice.date ? new Date(f.notice.date).toISOString().slice(0, 10) : null,
          url: f.notice.url ?? null,
          /* Sources set these when their answer needs a caveat travelling with
             it: a shortage is not a recall, and an EU register is not global. */
          kindOfNotice: f.notice.kindOfNotice ?? null,
          jurisdictionNote: f.notice.jurisdictionNote ?? null,
          acknowledged: f.acknowledged,
        })),
        coverage: {
          registersConsulted: sources.map((s) => ({
            source: s.source,
            itemsChecked: s.itemsChecked,
            reachable: s.reachable,
            error: s.error,
            found: s.found,
          })),
          canTrustAnEmptyResult: coverage.trustEmptyResult,
          registersThatFailed: coverage.sourcesFailed,
          itemsNothingCanCheck: coverage.itemsWithNoSource,
        },
        isExampleInventory: isDefault
          ? 'This is the shipped example inventory. It does not describe anything the user owns, '
            + 'so these results are meaningless. Tell them to create config/inventory.local.mjs.'
          : null,
        disclaimer: DISCLAIMER,
      };
    }

    case 'list_inventory': {
      const { items, file, isDefault } = await loadInventory();
      return {
        file: pretty(file),
        isExampleInventory: isDefault,
        items: items.map((i) => ({
          id: i.id,
          label: i.label,
          kind: i.kind,
          make: i.make,
          model: i.model,
          year: i.year,
          product: i.product,
          name: i.name,
          hasExactIdentifier: Boolean(i.barcode || i.pzn || i.vin),
          watchedBy: i.sources.filter((s) => SOURCES[s]),
          unknownSources: i.sources.filter((s) => !SOURCES[s]),
        })),
        disclaimer: DISCLAIMER,
      };
    }

    case 'notice_history': {
      const sinceMs = args.sinceDays ? Date.now() - args.sinceDays * 86400_000 : 0;
      const limit = Number.isFinite(args.limit) ? Math.max(1, Math.floor(args.limit)) : 50;
      const entries = readNotices({ sinceMs });
      const acks = new Set(Object.keys(allAcks()));
      return {
        log: pretty(paths.notices),
        total: entries.length,
        returned: Math.min(entries.length, limit),
        notices: entries.slice(0, limit).map((e) => ({ ...e, acknowledged: acks.has(e.key) })),
        note: 'This is the local record of past runs, not a live query. Something absent here '
          + 'may simply never have been checked.',
      };
    }

    case 'describe_sources':
      return {
        sources: Object.entries(SOURCES).map(([id, s]) => sourceInfo(id, s)),
        kinds: Object.fromEntries(
          Object.entries(KINDS).map(([kind, def]) => [
            kind,
            { requiredFields: def.needs, defaultSources: def.sources },
          ]),
        ),
        disclaimer: DISCLAIMER,
      };

    case 'blind_spots': {
      const { items, isDefault } = await loadInventory();
      const covered = new Set(Object.values(SOURCES).flatMap((s) => s.handles ?? []));
      const jurisdictions = [...new Set(Object.values(SOURCES).map((s) => s.jurisdiction).filter(Boolean))];
      return {
        kindsWithNoRegister: Object.keys(KINDS).filter((k) => !covered.has(k)),
        itemsWithNoRegister: items
          .filter((i) => !i.sources.some((s) => SOURCES[s]?.handles?.includes(i.kind)))
          .map((i) => ({ id: i.id, label: i.label, kind: i.kind })),
        itemsWithoutExactIdentifier: items
          .filter((i) => !i.barcode && !i.pzn && !i.vin)
          .map((i) => ({
            id: i.id,
            label: i.label,
            improveBy: i.kind === 'medicine'
              ? 'add the 8-digit PZN from the pack'
              : i.kind === 'vehicle'
                ? 'add the VIN'
                : 'add the barcode from the box or label',
          })),
        jurisdictionsCovered: jurisdictions,
        knownGaps: [
          'No register here covers the UK, Switzerland, Australia, Canada or Japan.',
          'The German motor vehicle register (KBA) is not consulted: it is behind a '
            + 'proof-of-work challenge. Vehicle coverage is US recalls plus whatever the EU '
            + 'register happens to carry.',
          'Medicine coverage is German supply shortages only. It is not a safety register, '
            + 'and it says nothing about whether a medicine has been withdrawn.',
          'Registers publish days to weeks after a decision. A recall agreed today is not here.',
          'Matching is on text the owner typed against text a regulator wrote. A recall of '
            + 'something owned can be missed because the two describe it differently.',
        ],
        isExampleInventory: isDefault,
        disclaimer: DISCLAIMER,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/* ── transport ─────────────────────────────────────────────────────────────── */

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  /* A notification has no id and must not be answered. Replying to one is a
     protocol error that some clients treat as fatal. */
  const isNotification = id === undefined || id === null;

  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: NAME, version: VERSION },
          instructions:
            'Watches public safety registers for things the user owns. Read only: it cannot add '
            + 'to the inventory or acknowledge a notice, which are deliberately left to the CLI. '
            + 'Always show the confidence grade with a match and never turn an empty result into '
            + 'a statement that something is safe.',
        });

      case 'notifications/initialized':
      case 'notifications/cancelled':
        return undefined;

      case 'tools/list':
        return reply(id, { tools });

      case 'tools/call': {
        const result = await callTool(params?.name, params?.arguments ?? {});
        return reply(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      }

      case 'ping':
        return reply(id, {});

      default:
        if (isNotification) return undefined;
        return fail(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    if (isNotification) return undefined;
    /* Surfaced as a tool error rather than swallowed. A caller that gets no
       answer will guess, and guessing is the failure mode this tool exists to
       prevent. */
    return fail(id, -32603, err?.message ?? String(err));
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  /* Line-delimited JSON. A message can arrive split across chunks, so only
     complete lines are parsed and the remainder stays buffered. */
  let newline = buffer.indexOf('\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        msg = null;
      }
      if (msg) await handle(msg);
    }
    newline = buffer.indexOf('\n');
  }
});

process.stdin.on('end', () => process.exit(0));
