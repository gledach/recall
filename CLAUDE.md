# recall

Watches public safety registers for the specific things a person owns.

Node 22+, ESM, **zero runtime dependencies**. No build step. State is JSON and
JSONL on disk under `data/` (gitignored). Do not add a dependency; if something
seems to need one, the answer is a smaller version of the feature.

## The one rule everything else follows from

**"Nothing found" and "could not look" must never render the same way.**

This tool is dangerous exactly when it is trusted more than it deserves. A person
who runs it, sees a clean screen and concludes their child's toy is safe has been
actively misled if a register was unreachable. So:

- A source that throws is recorded as `reachable: false` with its error, and
  `coverageOf()` sets `trustEmptyResult: false`. One source failing never hides
  another source's findings.
- Every output path prints the coverage block whether or not anything was found.
- Every match carries a confidence grade, and the grade is always shown.
- Nothing ever says "you are affected". It says what matched and how.
- Refuse rather than skip. A malformed inventory entry is a startup error, because
  a silently skipped entry looks identical to an entry with nothing wrong.

When adding a feature, ask what it prints when the network is down. If the answer
is "the same thing as when everything is fine", it is wrong.

## Layout

```
bin/recall.mjs      arg dispatch only
cli/<command>.mjs   one per command, each exports run(flags, positional) -> exit code
core/match.mjs      confidence grading. the hard part
core/check.mjs      runs sources, dedupes, tracks coverage
core/inventory.mjs  KINDS, validation
core/store.mjs      notice log, acknowledgements, response cache
core/csv.mjs        RFC-4180-ish reader: quotes group, newlines inside them are data
core/xml.mjs        flat-tag reader. NOT a parser, and says so
sources/<id>.mjs    one per register
mcp-server.mjs      hand-rolled JSON-RPC 2.0 over stdio, read only
```

## Adding a source

A source module exports:

```js
export const id, label, handles, jurisdiction;   // all required
export const needsKey, attribution, reports;     // reports = what it is about
export async function check(item, opts);         // per item
export async function recentNotices(opts);       // optional: bulk
```

Register it in `SOURCES` in `core/check.mjs` or it does not run. Add it to
`test/live.mjs` in the same commit.

**If it publishes one register covering everything, export `recentNotices()`.**
`runCheck` calls it once per run and matches every item against the result.
Without it, `check(item)` is called per item, which re-downloaded twelve weeks of
European alerts for each thing in the inventory and turned a two-second run into
a timeout.

A notice is a plain object. `severity` is one of `critical | high | medium | low |
info`. Required: `source`, `id`, `severity`, `title`, `date`. Set
`matchedIdentifier` when the register itself matched on an identifier, so grading
can return `exact` without doing its own text matching. Use `kindOfNotice` and
`jurisdictionNote` when an answer needs a caveat that must travel with the record
rather than sitting in a header the caller may not print.

`notice.id` must be stable across runs. It becomes part of the acknowledgement
key, and an unstable one re-reports something the owner has already dismissed.

## Traps that have already cost time

**Substring tests on register vocabularies.** The German shortage export writes
the negative case as `"weder versrel noch verskri"`, German for *neither one*. It
contains both keywords, so `includes('verskri')` graded 420 of 967 harmless
reports as high severity. Rule out the negation first.

**Assuming the record wrapper.** Safety Gate wraps each alert in
`<notifications>`. `<order>` is a field inside it. Treating `<order>` as the
wrapper returned zero alerts from a document containing 86, silently, which is
the exact failure mode this tool exists to prevent. `test/live.mjs` therefore
fails on a suspiciously empty result rather than passing.

**Legacy encodings.** The BfArM CSV is cp1252. Decoded as UTF-8 every umlaut
becomes a replacement character and stops matching anything a user typed.

**Splitting CSV on the delimiter.** 65 of 967 live records contain a quoted field
with a semicolon or newline inside it. Splitting shifts every later column in
those records and raises nothing. Use `core/csv.mjs`.

**`try { return fn() } finally { cleanup() }` with an async `fn`.** The finally
runs as soon as the body hits its first `await`. This is what made the
`withSource` test helper tear down a fake source mid-test. `return await fn()`.

**Windows and paths.** Git Bash rewrites `/tmp/...` arguments while Node resolves
`/tmp` to `D:\tmp`. Use `os.tmpdir()` or relative paths. Environment variables
like `RECALL_INVENTORY=./x.mjs` resolve against the process cwd, not the repo, so
a stale shell cwd silently falls back to the default inventory rather than erroring.

**Heredocs collapse backslashes.** Writing test files through `cat <<EOF` has
corrupted regexes more than once. Use the editor tools, or extract from a file
with Python.

## Tests

```sh
npm test         # 98 tests, offline. the gate
npm run test:live    # all four registers. run after touching sources/
```

`test/run.mjs` builds the file list explicitly because `node --test test/`
resolves the directory as a module on Windows. New `*.test.mjs` files are picked
up automatically.

Offline and live are separate on purpose: a gate that fails when a public API has
a bad afternoon teaches people to ignore the gate. Never add a network call to a
`*.test.mjs` file.

Fixtures in `test/fixtures/` are cut from real downloads and keep the quirks
deliberately, including the cp1252 encoding and the awkward quoted records. Do
not tidy them.

## Writing

Comments explain **why**, especially where the obvious implementation is wrong.
Where a comment describes a bug that was fixed, keep the specifics: the numbers
are what make it believable enough not to be undone. No em dashes anywhere in the
repository.

User-facing text is plain and never reassuring. It does not congratulate the
reader on a clean result.
