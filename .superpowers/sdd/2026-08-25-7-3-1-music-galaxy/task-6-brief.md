# Task 6: Synchronize 7.3.1 identity and engine names

Task 5 delivered the Music Galaxy surface. This task updates every current
identity/diagnostic surface to 7.3.1 and the requested visible engine names:
Fusion 4.0, Spectrum 2.3 and Neural 2.2. It must preserve the existing
analysis/cache compatibility token and stored Neural model compatibility.

## Files

Modify only:

- `src/core/runtime-constants.js`
- `src/engines/spectrum-analyzer.js`
- `src/services/neural-runtime.js`
- `src/bootstrap/main.js`
- `src/engines/audio-engine.js`
- `index.html`
- `src/data/i18n.js`
- `tests/contract-tests.ps1`

Do not edit `build/app.js`; Task 8 owns regeneration.

## Required visible identity

Add and use these centralized visible constants in
`src/core/runtime-constants.js`:

```js
const GP_FUSION_ENGINE_VERSION = "4.0";
const GP_SPECTRUM_ENGINE_VERSION = "2.3";
const GP_NEURAL_ENGINE_VERSION = "2.2";
```

Update current public/diagnostic/UI identity to 7.3.1, `GALAXY UPDATE`,
`GP Fusion Engine 4.0`, `GP Spectrum Engine 2.3`, and `GP Neural Engine 2.2`.
The visible strings must remain bilingual where the existing surface is
bilingual. Keep `GP_SPECTRUM_ALGORITHM_VERSION` unchanged and keep
`NEURAL_MODEL_VERSION` unchanged; no cache/schema/model migration is allowed.

## RED contracts first

Strengthen `tests/contract-tests.ps1` before production edits. The contracts
must require current identity surfaces to contain 7.3.1, `GALAXY UPDATE`, the
three requested engine names, and the unchanged cache/model compatibility
tokens. Run the contract script and record the intended RED result before
implementation.

## Scope

- Update `index.html` title, cache-busting query strings, settings build card,
  current-version button and any current visible version labels.
- Use centralized constants in the early analyzer facade, bootstrap facade and
  audio diagnostics rather than creating a second literal version owner.
- Update localized current-version/build strings in Chinese, English and
  Russian as applicable.
- Update comments only when they identify the changed visible engine version.
- Preserve all Task 3 Galaxy wiring, Neural algorithm/model behavior, Store,
  persistence, history, queue, audio graph and cache identity contracts.

## Checks

Run targeted syntax/static checks, residue scans and the contract script. The
full contract script should still be allowed to remain RED only for Task 7
release/governance entries until that task is complete. Do not run build or
architecture-wide final gates in this task.

## Boundaries

Do not change `GP_SPECTRUM_ALGORITHM_VERSION`, `NEURAL_MODEL_VERSION`,
IndexedDB names/versions/stores, localStorage keys, track identity, event or
model schema, engine behavior, or generated output. Do not change unrelated
7.3.0 historical release entries; Task 7 owns the durable release record.

## Report

Write `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-6-report.md` with
RED/GREEN evidence, files changed, identity/cache-safety checks, and any
downstream concerns. Return only status, changed files, tests and concerns.
