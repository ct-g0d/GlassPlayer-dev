# Task 3 Report — Share Galaxy Metric with Neural Daily Mix

Date: 2026-08-25 (Pacific/Auckland)

## Status

Implemented the bounded Task 3 integration. Daily Mix now calls the single
injected Galaxy facade for its MFCC/BPM/genre coherence metric. The existing
Neural service public methods, model version, model/recommendation record
shapes, ordinary immature Shuffle, history, freshness, artist diversity and
Queue behavior remain unchanged.

## Scope, ownership and protected areas

- Primary owner: `src/services/neural-runtime.js` (Daily Mix coherence).
- Allowed consumers: `src/bootstrap/main.js` constructs the one Galaxy
  instance; `src/services/neural-service.js` is the already-authorized legacy
  registration bridge.
- Injection bridge: `neuralGalaxyService` is runtime-local state declared by
  Neural runtime. The existing `createNeuralService(runtime)` facade assigns
  the same `runtime.galaxy` reference once and documents that it neither
  creates nor persists the service. No public method was added or changed.
- Protected and untouched: `src/services/galaxy-runtime.js`, `SOURCE_ORDER.txt`,
  `index.html`, `app.css`, `build/app.js`, release/governance/persistence
  documents, IndexedDB/localStorage, model/recommendation schemas, queue and
  audio paths.
- Persistence/schema/event/version impact: none.

## Changed files

- `src/services/neural-runtime.js`
  - Added the runtime-local injected `neuralGalaxyService` reference.
  - Replaced Daily Mix's duplicate `.54` genre / `.34` MFCC / `.07` BPM
    weighting block with one bounded `recommendationSimilarity(...).overall`
    read and the specified `.28` incomplete-service fallback.
- `src/services/neural-service.js`
  - Used the existing registration facade as the documented one-reference
    bridge from `runtime.galaxy` to the legacy Daily Mix closure.
- `src/bootstrap/main.js`
  - Creates exactly one `galaxyService` immediately before Neural service
    construction and supplies it as `galaxy:galaxyService`.
- `tests/contract-tests.ps1`
  - Loads `$bootstrapSource` and adds the required static Neural/Galaxy
    injection assertion.
- `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-3-report.md`
  - This implementation report.

## RED/GREEN evidence

### RED — contract added before production integration

Command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\contract-tests.ps1
```

Output included the required named failure:

```text
FAIL
- Neural must consume the shared Galaxy similarity service
- Music Galaxy placeholder must be replaced
- Music Galaxy Canvas surface is missing
- Music Galaxy interaction/render contract is missing
- 7.3.1 engine identity is missing
```

### GREEN — Task 3 structural contract

Same command after integration:

```text
FAIL
- Music Galaxy placeholder must be replaced
- Music Galaxy Canvas surface is missing
- Music Galaxy interaction/render contract is missing
- 7.3.1 engine identity is missing
```

`Neural must consume the shared Galaxy similarity service` is absent, proving
the Task 3 bootstrap injection and Neural shared call-site assertion passed.
The remaining four failures are downstream Task 4–6 DOM/View/identity work,
not Task 3 failures.

## Exact verification commands and results

### Source syntax

```powershell
$nodeRuntime='C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$orderedSources=Get-Content -LiteralPath 'SOURCE_ORDER.txt' | Where-Object {$_ -and -not $_.StartsWith('#')}
$combinedSource=($orderedSources | ForEach-Object {[System.IO.File]::ReadAllText((Join-Path $PWD $_),[System.Text.Encoding]::UTF8)}) -join "`n"
$combinedSource | & $nodeRuntime --check -
& $nodeRuntime --check '.\src\services\neural-runtime.js'
& $nodeRuntime --check '.\src\services\neural-service.js'
```

Output:

```text
PASS syntax SOURCE_ORDER in-memory assembly
PASS syntax src\services\neural-runtime.js
PASS syntax src\services\neural-service.js
```

`src/bootstrap/main.js` is a concatenated-runtime tail that ends an IIFE and
cannot parse as an isolated file; the pre-change snapshot has the same tail.
The no-write in-memory SOURCE_ORDER assembly validates it in its real runtime
context without changing the protected generated `build/app.js`.

### Existing pure Galaxy service regression

```powershell
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\tests\galaxy-runtime.test.js
```

Output:

```text
PASS galaxy-runtime pure behavior
```

### Focused integration and preservation probe

The probe asserted exactly one `createGalaxyService()` factory call, the
bootstrap injection, the runtime bridge, the shared `recommendationSimilarity`
call and `overall` fallback, absence of the legacy Daily Mix weighting terms,
and retention of immature Shuffle, freshness, artist counts and `.76/.24`
cluster blending.

Output:

```text
PASS focused Daily Mix injection, shared metric, freshness, artist-diversity, cluster and immature-Shuffle probe
```

### Architecture validation

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\validate-architecture.ps1
```

Output:

```text
FAIL
- Source ownership must occur once: src/services/galaxy-runtime.js (found 0)
```

This is the pre-existing Task 2 governance gap: the protected
`MODULE_GOVERNANCE.md` does not yet own the Task 2 source. Task 3 does not
change governance files, so this remains a downstream concern.

### Build and real runtime checks

- NOT RUN — `build.ps1`; its only output is protected `build/app.js`, and this
  task explicitly forbids modifying that generated file. Task 8 owns final
  generation.
- NOT RUN — Edge/file://, local-library/audio, 4K and 120 Hz checks; this is
  Neural policy integration with no permitted generated runtime update, and no
  browser/audio scenario was run.

## Preservation review

- `NEURAL_MODEL_VERSION` remains `4`; no model or recommendation persistence
  code was changed.
- `weightedPickIndex` still returns `uniformPick(candidates)` for an immature
  model.
- Daily Mix retains cached-feature completeness, recent recommendation
  exclusion, artist repeat penalty, shortlist ratio/exponent, mature-model
  preference scoring, import time-slicing and the unchanged recommendation
  persistence shape.
- No second Galaxy instance, Store field, Event Bus event, network request,
  decode, timer, Worker, queue, or audio resource was added.
- `dailyFeatureSimilarity` now delegates the acoustic basis to Galaxy only;
  no replacement MFCC/BPM/genre formula was introduced.

## Self-review and concerns

1. The bridge depends on the existing concatenated SOURCE_ORDER runtime scope;
   this is intentional and documented, and no new public API family was
   created.
2. The full contract suite is not green until Tasks 4–6 add the Galaxy
   DOM/Canvas/view and 7.3.1 identity work.
3. Architecture validation remains red until the later governance task adds
   the source-ownership entry for `src/services/galaxy-runtime.js`.
4. No browser, audio or visual completion claim is made.
