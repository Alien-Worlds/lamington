# Lamington: prioritised improvement requirements

## Purpose

Requirements for a new version of Lamington, derived from defects and friction
observed while using it to compile contracts, stand up a test chain, and run the
suite for a security fix on `eosdac-contracts` (~15 full and targeted runs,
including deliberate failure and control runs).

Everything below was observed in practice, not inferred from reading code alone.
File references are to the published `lib` output of the current `master`; the
corresponding sources are under `src/`.

The organising principle for the priorities: **a test framework's worst failure
mode is reporting success for something it did not test.** Everything that can
produce a false green is P0, regardless of how rarely it fires. Speed and
ergonomics come after.

---

## Issue index

| Item | Issue | Priority |
|---|---|---|
| Build cache ignores headers | #32 | P0 |
| Staleness compares millisecond component | #33 | P0 |
| Empty run exits 0 | #34 | P0 |
| `--skip-build` cannot detect a stale binary | #35 | P0 |
| Fixture failure cascades | #36 | P1 |
| Deploys on the chain CPU ceiling, no retry | #37 | P1 |
| Reporter and bail not overridable per run | #38 | P1 |
| No machine-readable results | #39 | P1 |
| Contracts build serially | #40 | P1 |
| One broken contract blocks all tests | #41 | P1 |
| Docker network lifecycle | #42 | P1 |
| Ergonomics backlog | #43 | P2 |

---

## P0 — Silent false results

### P0-1. A changed header does not trigger recompilation

**Symptom.** Editing a `.hpp` leaves the previously compiled `.wasm` in place.
The suite then runs against a binary that does not contain the change, and
reports a pass.

**Root cause.** `contractCompiling.js`, `FileModTracker` tracks the mtime of the
`.cpp` only:

```js
static create(outputPath, contractPath) {
    const sourceStats = await statFile(contractPath);   // the .cpp, nothing else
    return new FileModTracker(outputPath, sourceStats.mtime);
}
```

Headers are invisible to it. This matters well beyond the obvious case, because
contracts include each other's headers — `dacproposals.cpp` includes
`dacescrow.hpp` for the action wrapper, and everything includes
`contract-shared-headers/`. A change to a shared header should invalidate every
dependent contract and currently invalidates none.

**Requirement.** Build invalidation must consider the full translation unit, not
one file. Preferred approach: have `eosio-cpp` emit a depfile (`-MD -MF`) and use
the header list it produces, which is exact and free. Failing that, hash every
`.hpp` on the include path along with the `.cpp`.

**Acceptance.** Touching any header that a contract transitively includes causes
that contract, and only the contracts that include it, to rebuild on the next run.

### P0-2. The staleness comparison is wrong

**Symptom.** Occasionally a genuinely changed contract is reported as
`Source unchanged. Skipping Compile` and is not rebuilt.

**Root cause.** `contractCompiling.js`, `hasChanged()` compares the
*milliseconds component* of two timestamps rather than the timestamps:

```js
return prevModTime.getUTCMilliseconds() != this.modDate.getMilliseconds();
```

`getMilliseconds()` returns 0-999. Two edits whose mtimes happen to share a
millisecond component — roughly one time in a thousand — compare equal and the
rebuild is skipped. The mixed `getUTC…`/non-UTC accessors are harmless here only
because the millisecond component is timezone independent, which suggests the
intent was a timestamp comparison that was never completed.

**Requirement.** Compare timestamps (`getTime()`), or better, content hashes,
which are immune to mtime churn from checkouts and `touch`.

**Acceptance.** A rebuild happens whenever content changed and is skipped
whenever it did not, with no dependence on clock alignment. Also remove the
`console.log(prevModTime, this.modDate)` debug line in that function.

### P0-3. A run that matched no tests exits 0

**Symptom.** A `--grep` typo runs zero tests and reports success. Observed with
`-g Dacescrow` when the suite is `DACEscrow` — grep is case sensitive, nothing
matched, exit code 0, and the output is indistinguishable from a clean run.

**Root cause.** `runTests.js` resolves on `failures === 0` without considering
whether anything ran.

**Requirement.** Zero executed tests must be a failure, with a message saying the
filter matched nothing and how to list the available suites. An explicit opt-out
flag (`--allow-empty`) is acceptable for pipelines that legitimately filter to
nothing.

**Acceptance.** `lamington test -g DoesNotExist` exits non-zero and says why.

### P0-4. `--skip-build` cannot detect that it is testing a stale binary

**Symptom.** `-s` after a source change tests the previous wasm and reports a
pass. The flag is genuinely useful — it removes the largest part of a run's wall
clock when only tests changed — so the answer is not to remove it.

**Requirement.** With `--skip-build`, compare source state against what was last
built (same mechanism as P0-1/P0-2) and refuse with a distinct exit code if any
contract source is newer, naming the offending files.

**Acceptance.** `-s` after touching a `.cpp` or `.hpp` refuses; `-s` after
changing only a `.test.ts` proceeds.

---

## P1 — Misleading diagnostics and lost time

### P1-1. One setup failure presents as a dozen unrelated failures

**Symptom.** A contract deploy failing in the first `before all` hook produced 14
failures across unrelated suites, 12 of them `Cannot read properties of undefined
(reading 'account')`, and the reported "real" failure was a `Dacdirectory` test
that had nothing to do with the cause.

**Root cause.** The shared test fixture is a singleton built in the first hook.
When construction fails it is left half-built, and every later suite fails
against the wreckage. Nothing distinguishes the originating failure from the
knock-on ones.

**Requirement.** A failure during shared fixture construction should be reported
once, as a fixture error, and should abort the run rather than letting every
subsequent suite fail against a broken object. If aborting is too blunt, the
reporter must at minimum mark knock-on failures as caused by the earlier fixture
failure.

**Acceptance.** A forced deploy failure yields one clearly-attributed error, not
a cascade.

### P1-2. Contract deploys sit on the chain's CPU limit

**Symptom.** Intermittent `created dacproposals: Error: deadline ... exceeded by
11435us` during setup, reproducing several times in a row under machine load and
clearing when the machine is quiet. Each occurrence costs a full run.

**Root cause.** The dev chain's genesis sets `max_transaction_cpu_usage` to
150000µs, and deploying the larger contracts approaches that ceiling. The
`setcode`/`setabi` transaction in `contracts/contractDeployer.js` has no retry.

**Requirement.** Two independent changes: raise the dev chain's transaction CPU
ceiling substantially — it is a single-producer test chain with no reason to
enforce mainnet limits — and retry deploy transactions with backoff on deadline
errors, since deploys are idempotent enough to make retry safe (the deployer
already tolerates "Contract is already running this version of code").

**Acceptance.** Deploying the largest contract in the repo succeeds on a loaded
machine, and a transient deadline does not fail the run.

### P1-3. Reporter and bail cannot be set per run

**Symptom.** Getting machine-readable results, or turning off `bailOnFailure` for
one survey run, requires editing `.lamingtonrc` and restoring it afterwards. Any
tooling around Lamington has to mutate the user's config file and hope it gets to
restore it.

**Root cause.** `runTests.js` reads `ConfigManager.testReporter` and
`ConfigManager.bailOnFailure` with no CLI override. `mocha.reporter()` is called
with a name only — `reporterOptions` is never passed, so even mocha's own JSON
reporter cannot be told where to write.

**Requirement.** `--reporter`, `--reporter-option` and `--bail`/`--no-bail` on
`lamington test`, overriding config. Pass `reporterOptions` through to mocha.

**Acceptance.** `lamington test --reporter json --reporter-option output=r.json
--no-bail` produces a results file without touching `.lamingtonrc`.

### P1-4. There is no machine-readable result output

**Symptom.** Determining what failed means parsing thousands of lines of ANSI
console output. We ended up shipping a custom mocha reporter to get structured
results.

**Requirement.** A first-class `--json <path>` that writes per-test title, state,
duration, and for failures both the error and, where the error is an eosio
assertion, the extracted `ERR::...` message. The last point matters: assertion
failures currently arrive as a JSON blob with a wasm stack trace, and the useful
part is one line inside it.

**Acceptance.** A consumer can answer "what failed and why" from the file alone.

### P1-5. Contracts build serially

**Symptom.** Building 11 contracts is a large fraction of a ~10 minute run, and
it is the part that repeats on every iteration that touches a contract.

**Root cause.** `contactBuilding.js` awaits each build in a `for...of` loop.

**Requirement.** Build independent contracts concurrently, bounded by CPU count.
Compilation is per-contract and already isolated, so this is mostly scheduling.
Combined with correct incremental builds (P0-1) it is the single biggest
wall-clock win available.

**Acceptance.** A cold build of the repo is materially faster with no change in
output; a warm build with one changed contract compiles exactly that contract and
its dependents.

### P1-6. One broken contract blocks every unrelated test

**Symptom.** An uncommitted `#include <iostream>` in `msigworlds.cpp` — rejected
by eosio.cdt with `"iostreams currently clash with eosio::datastream"` — stopped
the entire suite, including every test for contracts that compiled fine. Working
around it meant editing `.lamingtonrc` to exclude the contract.

**Root cause.** `contactBuilding.js` collects errors then throws, aborting the run.

**Requirement.** A `--keep-going` mode that runs the suites whose contracts built,
reports clearly which contracts failed and which suites were therefore skipped,
and still exits non-zero. Aborting should remain the default.

**Acceptance.** With one contract broken, unrelated suites still run and the
summary states plainly what was skipped and why.

### P1-7. Docker network lifecycle is fragile

**Symptom.** `Error response from daemon: network with name lamington already
exists` appearing in run output, and a container left in a state where the chain
came up but shared setup could not use it.

**Root cause.** `dockerImageManagement.js` creates the network inside a
try/catch that swallows the error only when stderr matches an exact English
string:

```js
if (e.stderr != 'Error response from daemon: network with name lamington already exists\n') { throw e; }
```

Any change in Docker's wording or locale turns a benign condition into a hard
failure. `stopContainer` kills the container but never removes the network, so
the orphan persists.

**Requirement.** Check for the network with `docker network inspect` rather than
pattern-matching an error string, and clean up the network on stop. Add a
`lamington doctor` that reports and optionally repairs container, network, and
chain-data state.

**Acceptance.** Repeated stop/start cycles leave no orphaned resources, and a
pre-existing network is handled without an error surfacing in output.

---

## P2 — Ergonomics

- **`--list-suites`.** Suite names are not guessable (`DACEscrow`, `EOSDacTokens`)
  and a near miss silently runs nothing. Listing them removes the guesswork that
  P0-3 currently punishes.
- **Target by file.** `--grep` is the only selector; `--file <path>` would avoid
  loading every test file to run one.
- **Configurable timeouts.** `TEST_EXPECTED_DURATION` (5s) and
  `TEST_TIMEOUT_DURATION` (30min) are hardcoded in `runTests.js`.
- **Document the CLI.** `-s`, `-c`, `-p`, `-f`, `-D` are all useful and all
  undocumented; we found them by reading `lamington-test.js`.
- **Chain state between runs.** With `keepAlive`, state persists across runs and
  can silently change outcomes. A `--fresh-chain` flag, and a note in output
  saying which mode is active, would make that visible.
- **Slowest-test reporting.** Duration is already captured; surfacing the slowest
  tests would help target the 10-minute suite.

---

## Non-goals

- Parallel test execution. The suites share one chain and sequence state across
  contexts; parallelising them is a much larger change than anything above and
  should not be bundled with these fixes.
- Replacing mocha.
- Changing the contract-facing test API. Every requirement here is about the
  build, the chain, and reporting, so existing suites should need no edits.

---

## Suggested sequencing

1. **P0-1 and P0-2 together** — same file, same mechanism, and the pair is what
   makes incremental builds trustworthy. Everything else that touches the build
   depends on this being right.
2. **P0-3 and P0-4** — small, independent, each removes a way to get a false green.
3. **P1-3 and P1-4** — unblocks external tooling and removes the need to mutate
   `.lamingtonrc`.
4. **P1-2 and P1-7** — reliability of the chain and container, the main source of
   lost runs.
5. **P1-5 and P1-6** — build throughput and isolation, once invalidation is correct.
6. **P1-1** — fixture failure attribution.
7. **P2** as capacity allows.

## Verification

Each P0 needs a regression test that fails against the current version:

- P0-1: touch a shared header, assert dependent contracts rebuild.
- P0-2: two edits with the same millisecond component, assert both rebuild.
- P0-3: a grep matching nothing, assert non-zero exit.
- P0-4: `-s` with a newer source, assert refusal.

`eosdac-contracts` is a reasonable integration target: 11 contracts, ~563 tests,
heavy inter-contract header use, and a suite that already exercises the failure
modes above.
