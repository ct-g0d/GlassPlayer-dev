# Task 2: Implement the pure Music Galaxy Service

Task 1 has established `tests/galaxy-runtime.test.js`, which is currently
RED because this production source file is absent. Make only the pure service
GREEN and add it to source order. Do not integrate it into Bootstrap, Neural,
the DOM, Canvas, or release identity yet.

## Files

- Create `src/services/galaxy-runtime.js`.
- Modify `SOURCE_ORDER.txt` by inserting the new source immediately before
  `src/services/neural-runtime.js`; do not reorder existing lines.
- You may adjust `tests/galaxy-runtime.test.js` only if a focused assertion is
  needed for a real service edge case; do not weaken or delete any existing
  assertion.

## Required registration and public API

The source is loaded in a concatenated browser runtime and must register one
factory through the existing boundary:

```js
GPModules.register("createGalaxyService", function createGalaxyService() {
  // pure feature, distance and layout functions only
  return Object.freeze({
    featureVector,
    compareTracks,
    buildLayout,
    recommendationSimilarity
  });
});
```

The returned facade exposes exactly the four required methods. It must not
touch DOM, Canvas, AudioContext, File, IndexedDB, Store, timers, user history,
or random nondeterminism.

## Input and feature vector

Consume plain track snapshots containing existing fields such as:
`spectrumId`, `title`, `artist`, `genre`, `genreSecondary`, `bpm`,
`bpmConfidence`, and `mfcc`. Track identity must remain the stable spectrum
identity; never replace it with mutable title or artist.

`featureVector(track)` returns a frozen, serializable vector with:

- a copied, finite 13-value MFCC array (zero-filled/marked incomplete only
  when source values are absent);
- finite BPM or an explicit missing representation;
- bounded confidence and feature coverage;
- a stable key derived from the track's stable identity;
- enough genre information for the offline similarity fallback.

Use fixed safe scales for pairwise comparison and a robust per-layout
normalization pass for projection. Existing cached MFCC/BPM values are the
only data source; no decoding or analysis starts here.

## Similarity

Implement one shared `compareTracks(left, right)` path returning:
`{ mfcc, tempo, genre, overall, coverage, confidence }`. Every score is
clamped to `[0, 1]`; identical complete vectors must return `overall: 1`.
Use this central shape:

```js
const mfccScore = mfccDistance <= 0 ? 1 : Math.exp(-mfccDistance / 13);
const tempoScore = bothBpm ? Math.exp(-Math.abs(left.bpm - right.bpm) / 24) : .28;
const genreScore = offlineGenreSimilarity(left, right);
const overall = clamp(mfccScore * .60 + tempoScore * .25 + genreScore * .15, 0, 1);
```

Use existing `GP.genreRelations` only when available. Unknown labels receive a
bounded lexical/equality fallback. Do not copy the Neural distance formula
into this file later. `recommendationSimilarity` must use the same central
metric and return the same bounded similarity shape.

## Deterministic layout

Implement `buildLayout(tracks, options)` in bounded stages:

1. derive vectors and feature coverage;
2. calculate normalized means and covariance for usable vectors;
3. derive two principal directions with a fixed 12-iteration power method and
   deterministic sign selection;
4. choose `k = clamp(Math.round(Math.sqrt(trackCount / 2)), 1, 8)` and use
   stable-key seeded farthest-point centers followed by at most 12 refinement
   passes;
5. place cluster centers along two logarithmic spiral arms and place each
   point from its projected local vector plus stable identity jitter;
6. calculate concise genre/tempo labels and return finite point radii,
   opacity, color-family index, clusters, labels, coverage and a signature.

The returned layout must be serializable and caller-order independent. Sort
only internal calculations by stable key, then return points in stable-key
order. For `{ width: 1200, height: 700 }`, every point coordinate must be
finite and inside a useful bounded canvas region. Point radii must be positive
and no larger than 6. Empty and incomplete libraries must return bounded,
serializable layouts without throwing.

## Checks

Run the pure test and verify it turns GREEN:

```powershell
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\tests\galaxy-runtime.test.js
```

Run syntax and the contract script:

```powershell
& 'C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check .\tests\galaxy-runtime.test.js
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\contract-tests.ps1
```

The pure test must print `PASS galaxy-runtime pure behavior`. The contract
script may still fail DOM/View/version/release assertions because those belong
to later tasks; do not make unrelated changes to make them pass.

## Boundaries

- Do not modify `index.html`, `app.css`, `src/bootstrap/main.js`,
  `src/services/neural-runtime.js`, `build/app.js`, release files, or
  governance docs.
- Do not change `GP_SPECTRUM_ALGORITHM_VERSION`, IndexedDB schema, cache
  identity, `NEURAL_MODEL_VERSION`, or any persistent field.
- Do not add Event Bus events, Store state, runtime network calls, WebGL,
  Workers, fixed-FPS loops, or random calls.
- Preserve all existing source-order lines and place only the new service
  before the Neural runtime.
- Do not dispatch subagents.
- The project has no usable Git metadata; do not initialize Git or create
  commits.

## Report

Write the full report to:
`.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-2-report.md`

Include changed files, service/API decisions, exact commands and outputs,
self-review, and concerns. Return only status, changed files, one-line test
summary, and concerns after writing the report.
