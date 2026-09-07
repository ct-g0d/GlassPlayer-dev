# Task 6 — 7.3.1 identity and engine-name synchronization

## Status

Implemented the source-level 7.3.1 identity synchronization requested for
Task 6. The owner is `src/core/runtime-constants.js`; the early Spectrum
facade, public Bootstrap facade, audio diagnostics and localized UI consume
the centralized visible engine constants. No persistence, audio-graph or
Neural/Spectrum behavior changed.

## RED evidence

Before production edits, `powershell -NoProfile -ExecutionPolicy Bypass -File
.\tests\contract-tests.ps1` failed with the intended Task 6 gaps:

- missing 7.3.1 title/cache/version surfaces;
- missing `GALAXY UPDATE` current badge;
- missing centralized Fusion 4.0, Spectrum 2.3 and Neural 2.2 identities;
- missing localized current-version strings; and
- missing 7.3.1 release data, explicitly owned by Task 7.

## Changed files

- `src/core/runtime-constants.js` — added visible-only centralized constants:
  `GP_FUSION_ENGINE_VERSION="4.0"`, `GP_SPECTRUM_ENGINE_VERSION="2.3"` and
  `GP_NEURAL_ENGINE_VERSION="2.2"`.
- `src/engines/spectrum-analyzer.js` — updated the early public facade to
  7.3.1 and consumes the three visible engine constants.
- `src/services/neural-runtime.js` — updated only the visible Engine 2.2
  comment; `NEURAL_MODEL_VERSION` remains `4`.
- `src/bootstrap/main.js` — updated the public facade to 7.3.1 and consumes
  the three visible engine constants.
- `src/engines/audio-engine.js` — diagnostics now use
  `GP_FUSION_ENGINE_VERSION`, with no graph/runtime change; its frozen public
  diagnostic surface now exposes that version through a read-only getter.
- `SOURCE_ORDER.txt` — recorded Task 6 ruling applied: moved only
  `src/core/runtime-constants.js` immediately after `src/core/module-registry.js`
  and immediately before `src/engines/audio-engine.js`.
- `index.html` — title, CSS/JS cache query revisions, build card, badge and
  current-version label now identify 7.3.1 / `GALAXY UPDATE`.
- `src/data/i18n.js` — current version/build strings updated for English and
  Russian; Chinese source labels were updated in `index.html`.
- `tests/contract-tests.ps1` — added source-level identity, localized-string
  and compatibility-token contracts. Unicode regex checks use escaped code
  points so Windows PowerShell 5.1 does not depend on the script code page.

## Verification

- PASS — RED contract run was observed before production edits.
- EXPECTED RED — final contract run:
  `7.3.1 GALAXY UPDATE release record is pending Task 7`.
  No Task 6 identity, localization or compatibility contract remains failing.
- PASS — targeted identity residue scan found no `7.3.0`, `HOTFIX BUILD`,
  `GP Fusion Engine 3.0`, `GP Spectrum Engine 2.2`, or
  `GP Neural Engine 2.1` in the seven permitted production files.
- PASS — centralized usage scan confirms all three new constants are used by
  the early facade and Bootstrap; audio diagnostics use Fusion 4.0.
- PASS — cache/model safety scan confirms
  `GP_SPECTRUM_ALGORITHM_VERSION = "2.1.0"` and `NEURAL_MODEL_VERSION=4`
  exactly. Existing feature/cache/recognition schema constants remain 4, 7
  and 2. No storage, model or audio-graph files outside the allowed write set
  changed.
- PASS — comparison against `snapshots/task-6-base` shows changes only in the
  eight original Task 6 source/test files above.
- PASS — Node v24.19.0 ran a no-write `--check` over the full in-memory
  SOURCE_ORDER assembly and the standalone Task 6 fragments that are complete
  JavaScript units. `audio-engine.js` starts the runtime IIFE and
  `bootstrap/main.js` closes it, so the ordered assembly is their syntax
  authority rather than isolated parsing.
- NOT RUN — build.ps1 and validate-architecture.ps1, by Task 6 instruction.
- NOT RUN — Edge/file://, audio, 4K and 120 Hz checks; this task changes
  identity strings only and generated output is intentionally deferred.

## Fix round 1 — reviewer findings

- PASS — reproduced the TDZ risk: `audioDiagnosticState` consumed
  `GP_FUSION_ENGINE_VERSION` before `runtime-constants.js` ran in the prior
  source order.
- PASS — moved `runtime-constants.js` to source-order index 1, after the
  module registry and before Audio (2), Spectrum (5) and Bootstrap (56).
  Removing the moved line from both the current order and the Task 5 review
  baseline leaves every other entry identical.
- PASS — the identity contract now asserts all three required order relations.
- PASS — `window.__GP_AUDIO_DIAGNOSTICS__` remains frozen and now exposes the
  centralized Fusion version as `version`; the contract asserts that public
  getter rather than only the private diagnostic state.
- PASS — targeted Node v24.19.0 syntax check passed for the ordered assembly,
  `runtime-constants.js`, `spectrum-analyzer.js` and `neural-runtime.js`.
- EXPECTED RED — the contract script now fails only for the Task 7 release
  record: `7.3.1 GALAXY UPDATE release record is pending Task 7`.
- PASS — residue scan found no old current 7.3.0/HOTFIX/engine strings in the
  Task 6 identity sources; compatibility tokens remain exactly
  `GP_SPECTRUM_ALGORITHM_VERSION = "2.1.0"` and `NEURAL_MODEL_VERSION=4`.

## Concerns / downstream work

1. Task 7 must add the durable 7.3.1 / `GALAXY UPDATE` release record in
   `src/data/releases.js` (and its governance surfaces); that is the only
   remaining contract RED.
2. Task 8 must regenerate `build/app.js`. Until then, `index.html` has the
   7.3.1 cache revision while the generated runtime remains the prior build,
   intentionally outside Task 6's write set.
3. A JavaScript parser check should be rerun in an environment with Node (or
   equivalent) before final release delivery.
