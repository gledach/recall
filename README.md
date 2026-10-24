# recall

Tell me when something I own is recalled.

Recalls are published. Nobody reads them. A regulator puts out a notice, a
manufacturer writes to whoever registered a warranty card in 2019, and the sand
in your child's toy turns out to contain asbestos. You find out because someone
mentions it.

`recall` keeps a list of the things you actually own and checks it against the
public registers. It reports what matched, how it matched, and how much that
deserves your attention.

Zero dependencies. No account, no key, no signup for any of the four registers.
Node 22+.

The command is `gledach-recall`. Inside a clone, `node bin/recall.mjs` is that command
and needs nothing on your PATH. `npm link` installs `gledach-recall`. Nothing named
`recall` is installed. npm already publishes an unrelated package under that name, and
Microsoft Recall is a different product. This package is `gledach-recall`.

```
gledach-recall check
```

```
  HIGH  Something scanned off the box
      Tickit Sensory Blocks Set of 16
      The toy could rupture and the filling of the inside could come out. The sand
      inside contains asbestos (measured value up to 1.92% by weight). Asbestos
      could cause cancer.
      exact: barcode 5060138820289 matches exactly  ·  Fri, 25/09
      https://ec.europa.eu/safety-gate-alerts/screen/search
      ack with: gledach-recall ack by-barcode|safetygate|SR/02546/26

  HIGH  The stomach tablets
      Shortage: Pantoprazol-Micro Labs 40 mg magensaftresistente Tabletten
      Erhöhte Nachfrage Expected to last until 28.10.2026. Flagged as relevant
      to hospital supply.
      exact: PZN 10516704 matches exactly  ·  Mon, 28/09

  Sources
      source      checked  result
  ──  ──────────  ───────  ──────────  ────────────────
  ok  safetygate  3 items  2 findings  EU register only
  ok  bfarm       1 item   2 findings  DE register only
  ok  endoflife   1 item   0 findings  every jurisdiction
  ok  nhtsa       1 item   0 findings  US register only

  This covers the registers listed above and nothing else. Absence of a notice
  is not proof a product is safe.
```

That last line is the point of the tool, and the reason for most of the design
decisions below.

## Install

```sh
git clone https://github.com/gledach/recall.git
cd recall
node --version        # needs 22 or newer
npm test              # 98 tests, offline, about two seconds
```

No `npm install`. There is nothing to install.

Optionally, `npm link` to get `recall` on your path. Otherwise use
`node bin/recall.mjs <command>` or the npm scripts.

## Tell it what you own

```sh
cp config/inventory.default.mjs config/inventory.local.mjs
```

The local copy is gitignored, which is where a list of your possessions belongs.
It is a plain JS file, not a config format to learn:

```js
export default [
  {
    id: 'kitchen-dishwasher',
    kind: 'appliance',
    make: 'Bosch',
    model: 'SMV46KX01E',
  },
  {
    id: 'the-car',
    kind: 'vehicle',
    make: 'Volkswagen',
    model: 'Golf',
    year: 2019,
  },
  {
    id: 'blood-pressure-tablets',
    kind: 'medicine',
    name: 'Pantoprazol',
    pzn: '10516704',        // the 8 digits on the pack
  },
];
```

Five kinds, each with the fields it needs before it can be checked at all:

| kind | needs | also accepts |
| --- | --- | --- |
| `appliance` | `make`, `model` | `barcode` |
| `device` | `make`, `model` | `barcode` |
| `vehicle` | `make`, `model`, `year` | `vin` |
| `software` | `product` (the [endoflife.date](https://endoflife.date) slug) | `cycle` |
| `medicine` | `name` | `pzn` |

A missing required field is a startup error, not a skipped entry. An entry
silently ignored looks exactly like an entry with nothing wrong, and it would be
the one thing you cared about that never got checked.

### Add the barcode

If the box or the label still has a barcode, add it. Same for the PZN on a
German medicine pack.

Everything else here is text matching: your spelling of a model number against a
regulator's. It works, and it is graded honestly when it is uncertain. A barcode
is not matching at all. The manufacturer printed those digits and the register
reprinted them, so either it is your product or it is not.

Roughly half the EU alerts carry one. Every German shortage report carries a PZN.

Only add digits you can read off the thing itself. A wrong barcode is worse than
no barcode, because it will match something unrelated and be reported as certain.

## Commands

```sh
gledach-recall check                     # the thing you actually run
gledach-recall check --source=safetygate # one register
gledach-recall check --confidence=exact  # only certain matches
gledach-recall check --json              # for scripts and cron
gledach-recall check --all               # include ones you acknowledged
gledach-recall list                      # what is being watched, and by what
gledach-recall notices                   # what past runs found
gledach-recall ack <key>                 # stop reporting one notice
gledach-recall ack <key> --undo          # start again
gledach-recall ack                       # what have I already dealt with?
gledach-recall doctor                    # what works, and what this cannot see
gledach-recall help
```

`gledach-recall doctor` is worth running once. It ends with a section called "What this
cannot see", which is the honest version of a feature list.

## How sure is it?

Every match is graded, and the grade is shown with the notice. This is not
decoration. Two failure modes, and they are not symmetrical:

- **Crying wolf.** Match loosely and every run reports a dozen unrelated things.
  People stop reading. Then they miss the real one.
- **Silence.** Match tightly and the recall that mattered is never mentioned.
  Worse, and completely invisible.

So it reports generously and grades honestly.

| grade | what it means |
| --- | --- |
| `exact` | A barcode, PZN or VIN matched, or the register matched it for us. |
| `strong` | Make and model both appear in the notice. |
| `weak` | A distinctive model number appears but the make does not. Check it yourself. |
| `mention` | Only the make appears. Almost always noise. Hidden unless asked for. |

`weak` is included by default. Missing a real recall is worse than showing you
something to dismiss.

Nothing in the output ever says "you are affected". It says what matched and how.

## The registers

| id | register | covers | scope |
| --- | --- | --- | --- |
| `safetygate` | [EU Safety Gate](https://ec.europa.eu/safety-gate-alerts) (formerly RAPEX) | consumer products, toys, appliances, electronics, vehicles | EU |
| `bfarm` | [BfArM](https://anwendungen.pharmnet-bund.de/lieferengpassmeldungen/) | medicine **supply shortages** | DE |
| `nhtsa` | [NHTSA](https://www.nhtsa.gov/recalls) | vehicle safety campaigns | US |
| `endoflife` | [endoflife.date](https://endoflife.date) | software end of support | everywhere |

None of them needs a key.

**Safety Gate** is the one that matters most in Europe. There is no documented
API, but there is a weekly report export in XML, which is better for this
purpose: a report reference like `Report-2026-38` is a stable cursor, so a
refresh only fetches weeks it has not seen. A published week never changes, so
its cache never expires.

**BfArM reports availability, not safety.** A hit means a manufacturer has
declared a delivery shortage, so your pharmacy may not be able to fill a repeat
prescription. It does not mean the medicine is dangerous or being withdrawn.
Every notice from that source carries that sentence with it, because out of
context "shortage" is easily misheard as "unsafe". It is still the most useful
medicine source available without an account: a prescription that cannot be
filled needs a conversation with a doctor weeks before the pack runs out.

## What it cannot see

Stated here rather than buried, because a tool like this is dangerous precisely
when it is trusted more than it deserves.

- **No UK, Swiss, Australian, Canadian or Japanese register.** Not covered at all.
- **German vehicle recalls are not checked.** The KBA register is behind a
  proof-of-work challenge. Vehicle coverage is US campaigns plus whatever the EU
  register happens to carry, which is not the same thing as German coverage.
- **Medicine coverage is German shortages only.** There is no medicine safety
  register wired in.
- **Registers publish late.** Days to weeks after a decision. A recall agreed
  this morning is not here.
- **Matching is text against text.** A regulator who describes your product
  differently from how you wrote it down produces a low grade or nothing at all.
- **It checks your list, not your house.** Anything you did not write down does
  not exist as far as this is concerned.

A source that is unreachable is reported as unreachable, never as clean. If a
register was down, the output says so and says that an empty result cannot be
trusted. That distinction is the single most important thing in the codebase:
"nothing found" and "could not look" must never render the same way.

## MCP

```sh
npm run mcp
```

Five tools: `check_inventory`, `list_inventory`, `notice_history`,
`describe_sources`, `blind_spots`.

Read only, deliberately. It cannot add to your inventory and it cannot
acknowledge a notice. Acknowledging is a person deciding they have dealt with
something, and an assistant should not make that call on your behalf, so it
stays a CLI command.

Every result carries its coverage and the confidence grade of each match, because
a model asked "is my car recalled?" will otherwise turn "no notices found" into
"your car is fine", which is a much stronger claim than the data supports.

Claude Code:

```sh
claude mcp add gledach-recall -- node /absolute/path/to/recall/mcp-server.mjs
```

Any other MCP client: run `node mcp-server.mjs`, stdio, JSON-RPC 2.0.

## Where things are

```
bin/recall.mjs        entry point
cli/                  one file per command
core/
  match.mjs           the grading. the hard part of the tool
  check.mjs           runs sources, combines answers, tracks coverage
  inventory.mjs       loading and validating what you own
  store.mjs           JSONL log, acknowledgements, response cache
  csv.mjs, xml.mjs    small readers, so there are no dependencies
sources/              one file per register
config/               inventory.default.mjs, and your gitignored local copy
test/                 98 offline tests, plus test/live.mjs
data/                 gitignored: cache, notice log, acknowledgements
```

Everything lives on disk as JSON and JSONL. There is no database and nothing
leaves your machine except requests to the four registers above.

## Tests

```sh
npm test         # 98 tests, offline, no network
npm run test:live    # hits all four registers
```

The offline gate decides whether a change ships. `test:live` answers a different
question: does the outside world still look the way the parsers assume. It is
kept separate because a gate that fails when a public API has a bad afternoon
teaches you to ignore the gate.

Run `test:live` after touching anything in `sources/`. The most dangerous bug
this tool can have is a parser that returns zero records from a document full of
them, because that is indistinguishable from good news. It has happened twice
during development, which is why `test/live.mjs` fails on a suspiciously empty
result rather than reporting success.

## Licence

MIT. Data belongs to the European Commission, BfArM, NHTSA and endoflife.date
respectively, and each source carries its own attribution.

This is not legal, medical or safety advice. If a notice concerns you, go to the
register's own page and read the original.
