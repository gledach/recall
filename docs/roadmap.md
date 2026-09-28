# Roadmap

What is missing, in the order it is worth adding. Each entry says what blocks it,
because a list of wishes is not useful and a list of obstacles is.

## Registers worth adding

### CPSC (US consumer products)
Open API, no key, straightforward JSON. The reason it is not in yet is that it
overlaps Safety Gate for anyone in Europe while adding a second set of American
product names to match against, which raises the false-positive rate for no gain
in the jurisdiction this was built for. Worth adding behind an explicit
`sources: ['cpsc']` opt-in rather than as a default for `appliance` and `device`.

### KBA (German vehicle recalls)
**The most valuable missing source, and the hardest.** This is the authoritative
register for cars in Germany, and its absence is the largest hole in coverage:
right now a German car is checked against US campaigns and whatever the EU
product register happens to carry.

Blocked on an Altcha proof-of-work challenge (SHA-256, solved client side) in
front of the search endpoint. Solving it is mechanically easy and about ten lines,
but doing so deliberately circumvents an access control the operator put there.
That needs a decision from a person, not an agent, so it stays out until someone
makes it. A per-user API arrangement would be the clean route.

### openFDA (US drug and device recalls)
Actual medicine *safety* recalls, which is the thing `bfarm` explicitly is not.
Open API, no key for modest volumes. US only, so a German user gets little from
it, but it would close the gap where `medicine` currently means availability and
nothing else. Needs a way to express "this register is about a different question
than the one you asked", which the `reports` field on a source starts but does not
finish.

### UK OPSS and Swiss BFK
Both publish recalls. Neither has a machine-readable feed that has been checked.
Requires a look at whether the HTML is stable enough to be worth parsing, and the
answer is usually no.

## Matching

### GTIN normalisation
A UPC-A (12 digits) and the EAN-13 for the same product differ by a leading zero,
and a GTIN-14 adds a packaging digit on top. Two barcodes for one product
therefore do not compare equal today. Pad to 14 and compare, which would be a
handful of lines and would improve the strongest signal the tool has.

### Batch and serial ranges
Safety Gate often narrows an alert to a batch number or a production date range.
The field is parsed and carried but not used, so an alert about one batch is
reported to everyone who owns the model. Using it would turn some `strong` matches
into `exact` and, more usefully, let others be correctly dismissed. Needs an
inventory field for a batch number, which most people will not have.

### Explaining a near miss
When an item matched nothing, it is sometimes because one word differed. Showing
the closest thing that did not quite match would help people fix their inventory,
which is the highest-leverage improvement available: matching quality is limited
by what people wrote down, not by the algorithm.

## Operational

### Scheduled runs
There is no daemon and no cron entry. `recall check --json` is script-friendly and
that is currently the whole story. A once-daily run is the sane cadence, since the
registers publish weekly. Anything that runs unattended has to decide how to
notify, which is a real design question rather than a missing flag.

### Notifications
Deliberately absent. Email or push means credentials, an outbound service, and a
tool that can wake someone at 03:00 about a toy. Exit codes and `--json` are
enough to build on for now.

## Not planned

**Guessing what you own.** Reading purchase history from a mailbox, or a bank
feed, would improve coverage enormously and is not going to happen here. The
inventory is a file a person writes, which is the only version of this where the
data stays on one machine.

**Scoring overall risk.** A single number across unrelated notices ("your house is
82% safe") would be invented precision, and precision is the one thing this tool
must not fake.

**Telling you what to do.** Every finding links to the register's own page. A
recall notice says what the remedy is, in the regulator's words, and paraphrasing
that is how details get lost.
