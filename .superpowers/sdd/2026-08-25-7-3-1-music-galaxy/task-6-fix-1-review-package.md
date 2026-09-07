# Task 6 fix-round 1 review package

The first Task 6 review found one Critical startup failure and two Important
findings. The original implementer resumed and reports fixes in the current
workspace.

## Read and compare

- Updated report: `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-6-report.md`
- Current files: `SOURCE_ORDER.txt`, `src/engines/audio-engine.js`,
  `tests/contract-tests.ps1`
- Pre-fix snapshots: `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-6-review-base/`
- Original Task 6 brief/review package for all other identity/cache constraints

## Required fix verification

1. `src/core/runtime-constants.js` must now precede `audio-engine.js`,
   `spectrum-analyzer.js` and `bootstrap/main.js` in `SOURCE_ORDER.txt`, with
   no unrelated order changes; ordered source execution must not hit a TDZ.
2. `window.__GP_AUDIO_DIAGNOSTICS__` must expose an observable frozen
   `version` sourced from `audioDiagnosticState.version`.
3. `tests/contract-tests.ps1` must assert both the order boundary and the
   observable diagnostic export, not merely private assignment text.

## Scoped regression review

Do not edit files or run the broad repository suite. Use the configured Node
runtime for ordered-source syntax and a small runtime probe if useful. Verify
that all Task 6 identity/localization/cache/model constraints remain intact,
that no AudioContext/graph behavior or Galaxy/Neural wiring changed, and that
the only remaining expected RED is Task 7 release/governance work. Report
Critical/Important/Minor findings with exact locations and explicitly state
whether any remain.
