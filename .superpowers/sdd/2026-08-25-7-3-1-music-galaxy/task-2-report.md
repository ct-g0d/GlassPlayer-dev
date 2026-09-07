# Task 2 Report — Pure Music Galaxy Service

Date: 2026-08-25 (Pacific/Auckland)

## Status

Task 2 production behavior is implemented and the authoritative pure Galaxy
test is GREEN. The implementation is intentionally not integrated into
Bootstrap, Neural, the DOM, Canvas, release identity, or generated output.

## Changed files

- `src/services/galaxy-runtime.js` — new pure `createGalaxyService` factory.
- `SOURCE_ORDER.txt` — one new entry immediately before
  `src/services/neural-runtime.js`.

No test assertions were changed. No other files were modified.

## Service and API decisions

- Registered exactly one `GPModules.register("createGalaxyService", ...)`
  factory.
- Returned exactly `featureVector`, `compareTracks`, `buildLayout`, and
  `recommendationSimilarity` on a frozen facade.
- `featureVector` copies 13 MFCC values, zero-fills missing values while
  marking incomplete input, represents missing BPM as `null`, bounds
  confidence/coverage, retains genre fields, and derives identity from the
  stable spectrum identity chain. Title and artist are never used as identity.
- `compareTracks` is the shared bounded metric for MFCC, tempo, offline genre,
  coverage, confidence, and overall similarity. It uses `GP.genreRelations`
  only when available and otherwise uses bounded equality/lexical fallback.
- `buildLayout` sorts internal work by stable key, uses normalized cached
  features, a fixed 12-iteration deterministic power method, seeded
  farthest-point centers, bounded refinement, spiral cluster centers, stable
  identity jitter, bounded points/radii, labels, coverage, and a deterministic
  signature.
- The service has no DOM, Canvas, AudioContext, File, IndexedDB, Store, Event
  Bus, timer, network, or random dependency.

## Commands and outputs

### TDD RED baseline

Command:

```powershell
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\tests\galaxy-runtime.test.js
```

Output: failed with `ENOENT` for the absent
`src/services/galaxy-runtime.js` (exit code 1).

### Pure test

Command:

```powershell
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\tests\galaxy-runtime.test.js
```

Output:

```text
PASS galaxy-runtime pure behavior
```

Exit code: 0.

### Syntax checks

Commands:

```powershell
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check .\src\services\galaxy-runtime.js
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check .\tests\galaxy-runtime.test.js
```

Both exited with code 0. The first command was run before the pure test; the
second printed `EXIT=0`.

### Architecture validation

Command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\validate-architecture.ps1
```

Result: exit code 1. The only reported issue was:

```text
Source ownership must occur once: src/services/galaxy-runtime.js (found 0)
```

Adding the ownership entry would require changing `MODULE_GOVERNANCE.md`,
which the Task 2 brief explicitly protects. This is recorded as a follow-up
integration/documentation concern, not fixed by expanding the Task 2 write set.

### Contract validation

Command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\contract-tests.ps1
```

Result: exit code 1. The four reported failures were the expected later-task
contracts for replacing the placeholder, adding the Canvas surface, adding
Galaxy interaction/rendering, and updating 7.3.1 engine identity. No unrelated
contract failure was reported.

### Targeted pure self-check

The service was loaded in a VM and checked for the exact four facade keys,
frozen feature vectors, JSON serialization, bounded comparison output, finite
layout points, and absence of forbidden runtime dependencies. The check
completed without output indicating a forbidden dependency; the pure test
also confirmed caller-order-independent coordinates for the required fixture.

## Self-review

- Source order has one new line and places Galaxy directly before
  `src/services/neural-runtime.js`; existing lines were not reordered.
- The production file is source-authoritative; `build/app.js` was not edited
  or regenerated because the brief explicitly forbids changing it in this
  task.
- The authoritative Task 1 assertions remain byte-for-byte untouched.
- No persistence, schema, cache identity, Spectrum algorithm version, Neural
  model version, Store state, event, or release identity was changed.
- No `Math.random`, timers, network calls, browser objects, or audio/runtime
  resources are used by the service.

## Concerns / follow-up

1. The architecture validator will remain RED until the later task that owns
   governance documentation adds `src/services/galaxy-runtime.js` exactly once
   to `MODULE_GOVERNANCE.md`.
2. The full contract script will remain RED until later Galaxy DOM/View and
   7.3.1 release-identity tasks are implemented.
3. Browser/file://, Canvas, audio, and visual QA were not applicable to this
   pure-service-only task and were not claimed.

## Fix round 1 — reviewer issues

### Changed files

- `src/services/galaxy-runtime.js`
- `tests/galaxy-runtime.test.js`
- This report file

`SOURCE_ORDER.txt` was unchanged in this fix round. No integration files,
generated files, governance files, release files, or persistent-data contracts
were changed.

### Root causes and fixes

1. Missing stable identities now receive a deterministic fallback key derived
   from a canonical snapshot of the available track data, instead of the
   shared `unidentified-track` key. This removes tied-key dependence on caller
   order while keeping real `spectrumId` identity authoritative whenever it is
   present.
2. Means, scales, covariance, and PCA now use only vectors with complete
   13-value MFCC data. Incomplete vectors remain in layout placement but are
     zero-projected and cannot form an acoustic cluster signal.
3. K-means refinement now stores centroids in a separate `centroidPoints`
   array. The original projected local vectors, including selected center
   tracks, are never overwritten.
4. Cluster-arm radius now follows `r = 0.08 * exp(0.30 * |theta|)` with two
   deterministic arm signs, giving logarithmic spiral placement rather than
   linear Archimedean growth.
5. Added focused test assertions for incomplete MFCC coverage and missing-ID
   caller-order independence; existing assertions were preserved.

### Exact commands and outputs

#### RED after adding focused assertions

```powershell
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\tests\galaxy-runtime.test.js
```

The first run exposed a test expectation mistake (`0.15 !== 0`) because genre
coverage is intentionally retained for an incomplete acoustic vector. The
assertion was narrowed to the intended acoustic/incomplete boundary
(`coverage < .2`), then the next run failed at the missing-ID signature
assertion with:

```text
actual:   galaxy-2911065820
expected: galaxy-2241709643
exit code: 1
```

#### Covering pure test and source syntax

```powershell
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check .\src\services\galaxy-runtime.js
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check .\tests\galaxy-runtime.test.js
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\tests\galaxy-runtime.test.js
```

Outputs:

```text
SYNTAX=0
PASS galaxy-runtime pure behavior
TEST=0
```

The test-file syntax check was also run separately and exited with code 0.

#### Focused regression probe

The VM probe checked three missing-ID tracks under two input orders, compared
two complete tracks with and without an incomplete track, and generated a
32-track layout. Output:

```text
{"anonymousSignature":"galaxy-2458603252","anonymousKeys":["spectrum:fallback-490cec9","spectrum:fallback-4f4bc30d","spectrum:fallback-50c3a415"],"incompleteRadius":3.2,"relativeCompleteDelta":{"base":[473.1571764705883,79.56643441976485],"withMissing":[473.1571764705883,79.56643441976485]},"spiralClusters":[[626.2809518496531,422.3638678220117],[626.2809518496531,277.6361321779883],[502.1948611982363,426.9093475946712],[502.1948611982363,273.0906524053288]]}
```

The probe assertions completed without throwing; the relative complete-track
delta is unchanged when the incomplete vector is added.

### Fix-round self-review

- Existing stable spectrum identities still produce `spectrum:<id>` keys;
  fallback identity is used only when no stable identity field exists.
- Incomplete vectors cannot affect normalization statistics or covariance, and
  their missing acoustic values are not treated as measured zero features.
- Refined centroids and per-track projected vectors are now separate storage.
- Spiral radius is exponential in angular distance and arm selection remains
  deterministic; points remain clamped to the useful canvas region.
- Existing Task 1 assertions were not weakened or deleted.
- No DOM, Canvas, audio, Store, event, persistence, network, timer, random,
  generated-runtime, governance, or release changes were introduced.

### Fix-round concerns

- The previously recorded architecture-validator concern remains unchanged:
  the new source is not yet listed in the protected governance ownership
  document, which is outside this task's write set.
- Browser/file://, Canvas, audio, and visual QA remain not applicable to this
  pure-service fix round.

## Fix round 2 — fallback identity metadata stability

### Changed files

- `src/services/galaxy-runtime.js`
- `tests/galaxy-runtime.test.js`
- This report file

No integration, governance, generated-output, release, persistence, or source
order files were changed.

### Issue and fix

The round-1 fallback fingerprint incorrectly included `title` and `artist`,
so metadata edits changed the fallback key and layout identity. The fallback
now follows this order:

1. If stable source snapshot fields are available, fingerprint the fixed
   ordered set of file/path/locator, size, duration, and last-modified
   equivalents.
2. Otherwise use a deterministic content/feature fingerprint from BPM
   confidence, energy, loudness, duration, size, and the 13-value MFCC data.

Mutable title, artist, genre, and secondary genre are excluded from fallback
identity. Existing `spectrumId`, `audioEssenceKey`, `contentKey`, and `id`
fields remain authoritative before fallback processing.

### Exact commands and outputs

#### RED reproduction before the fix

The focused title/artist probe showed different identities and signatures:

```text
spectrum:fallback-83129de4 spectrum:fallback-5fc77e30 galaxy-731863378 galaxy-2742520603
```

After adding the regression assertion, the covering test failed as expected:

```text
actual:   spectrum:fallback-b2eb5f29
expected: spectrum:fallback-e7947d0b
exit code: 1
```

#### Covering pure test and syntax checks

```powershell
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check .\src\services\galaxy-runtime.js
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check .\tests\galaxy-runtime.test.js
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\tests\galaxy-runtime.test.js
```

Output:

```text
SYNTAX=0
TEST_SYNTAX=0
PASS galaxy-runtime pure behavior
PURE=0
```

#### Focused fallback-identity probe

```powershell
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' -e "<VM probe for title/artist mutation, stable source fields, and anonymous reorder>"
```

Output:

```text
PASS fallback identity probe
{"stableKey":"spectrum:fallback-311047c5","signature":"galaxy-231147753","anonymousKeys":["spectrum:fallback-65813b09","spectrum:fallback-7e6a7bf8","spectrum:fallback-cdabc6a0"]}
```

The probe asserted unchanged key and layout signature after title/artist
changes, and asserted identical signatures for the two anonymous input orders.

### Self-review

- Real stable identity fields remain the first and authoritative branch.
- Fallback identity no longer reads title, artist, genre, or genreSecondary.
- Stable source fields are preferred over feature fingerprinting.
- Distinct anonymous fixtures still receive distinct deterministic keys from
  their available acoustic/feature values and remain caller-order independent.
- The new regression assertion does not weaken or delete any prior assertion.
- No unrelated integration or persistent state was touched.

### Concerns

- If a snapshot has neither stable source fields nor distinguishing content or
  feature data, identical fallback keys are unavoidable because the input does
  not expose an identity-bearing distinction; identical points remain
  deterministic and caller-order independent.
- Browser/file://, Canvas, audio, and visual QA remain outside this pure
  service fix round.
