# Task 3: Share the Galaxy metric with Neural Daily Mix

Task 2 has produced the pure `createGalaxyService` facade. Integrate that
single service into the existing legacy Neural runtime so Daily Mix uses the
same MFCC/BPM/genre similarity metric. Keep ordinary immature-model Shuffle,
history, model persistence, freshness, artist diversity and Queue behavior
unchanged.

## Files

- Modify `src/services/neural-runtime.js`.
- Modify `src/bootstrap/main.js`.
- Modify `src/services/neural-service.js` only as the existing registration
  bridge for the injected runtime service; this is explicitly allowed because
  the actual `createNeuralService` boundary is there.
- Modify `tests/contract-tests.ps1`.
- You may add a focused assertion to `tests/galaxy-runtime.test.js` only if
  needed; preserve all existing pure-service assertions.

## RED contract first

Add this structural assertion to `tests/contract-tests.ps1` before production
integration and run the contract script to observe the named RED failure:

```powershell
Expect ($bootstrapSource -match 'createGalaxyService' -and $bootstrapSource -match 'galaxy:galaxyService' -and $neuralSource -match 'galaxy.*recommendationSimilarity') 'Neural must consume the shared Galaxy similarity service'
```

Load `$bootstrapSource` near the other source reads if it is not already
loaded. The static contract must prove both bootstrap injection and the
Neural shared call site.

## Bootstrap injection

Create one `const galaxyService=GPModules.createGalaxyService()` in
`src/bootstrap/main.js` before `createNeuralService`. Pass it through the
existing Neural service construction as:

```js
const neuralService=GPModules.createNeuralService({
  recordBehavior:recordBehaviorEvent,
  generateDailyMix,
  getUserModel:()=>GPDatabase.getUserModel("default"),
  galaxy:galaxyService
});
```

Preserve one service instance. Do not create another Galaxy factory in Neural,
do not put the service in Store state, do not add an Event Bus event, and do
not change the public `createNeuralService` methods.

Because the existing `createNeuralService` registration facade is in
`src/services/neural-service.js` while the Daily Mix closure is in
`src/services/neural-runtime.js`, use the smallest existing-boundary bridge to
make `runtime.galaxy` available to that closure. A runtime-local injected
reference or the existing `GP` namespace is acceptable only if it remains one
reference to the same frozen service, is not persisted, and does not create a
second owner or public API family. Keep the bridge documented in code.

## Shared Daily Mix similarity

Change `dailyFeatureSimilarity(anchor, candidate)` so its MFCC/BPM/genre
similarity comes from the injected Galaxy service:

```js
const shared=GP.neuralGalaxyService?.recommendationSimilarity?.(anchor,candidate);
const sharedScore=Number.isFinite(shared?.overall)?shared.overall:.28;
```

Use the actual existing bridge name if you choose a runtime-local reference,
but the source must contain a call matching `galaxy.*recommendationSimilarity`.
Do not copy the old Daily Mix MFCC/BPM/genre weighting block into a second
formula. The old `.54` genre / `.34` MFCC / `.07` BPM weighting must be removed
from `dailyFeatureSimilarity`; shared Galaxy `overall`, `mfcc`, `tempo` and
`genre` values are the single acoustic basis. If energy remains a small
secondary tie-breaker, keep it separate and bounded; do not reimplement the
Galaxy metric.

Retain these existing Neural policies:

- Daily Mix anchor/cluster blending (`.76` / `.24`) and bounded completeness;
- freshness/recent recommendation exclusion;
- artist counts, repeat penalty and shortlist ratio/exponent;
- mature-model preference scoring and persistence record shape;
- incomplete-feature fallback and no runtime Internet dependency;
- ordinary immature-model Shuffle's original random-safe behavior.

`NEURAL_MODEL_VERSION` and the stored user-model/recommendation schema must not
change. The broader `mfccSimilarity` used by mature preference/session scoring
may remain where it is not the Daily Mix coherence metric; only Daily Mix's
duplicated MFCC/BPM/genre block is replaced by Galaxy.

## Checks

Run the contract script after the RED assertion and after implementation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\contract-tests.ps1
```

The new Neural assertion must pass after implementation. Later DOM/View,
version, governance and release assertions may remain RED. Run source syntax
checks for every changed JavaScript source file with the bundled Node runtime.
Use a focused static or VM probe to confirm the Daily Mix source calls the
shared `recommendationSimilarity` and retains the artist/freshness logic.

## Boundaries

- Do not modify `src/services/galaxy-runtime.js`, `SOURCE_ORDER.txt`,
  `index.html`, `app.css`, `build/app.js`, release files, governance docs, or
  persistence/schema files in this task.
- Do not alter `NEURAL_MODEL_VERSION`, behavior-event weights, history records,
  Queue ownership, ordinary Shuffle fallback, or the existing Neural public
  method shape.
- Do not add a second Galaxy service, Store field, Event Bus event, network
  request, audio analysis/decode, timer, Worker, or fixed-frame loop.
- Do not dispatch subagents.
- The project has no usable Git metadata; do not initialize Git or create
  commits.

## Report

Write the full report to:
`.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-3-report.md`

Include RED/GREEN contract evidence, changed files, the injection bridge,
exact commands and outputs, preservation checks, self-review and concerns.
Return only status, changed files, one-line tests, and concerns after writing
the report.
