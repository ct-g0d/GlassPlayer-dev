# Task 5 review package — Canvas Music Galaxy View

This workspace has no usable Git metadata. Review the current implementation
against the Task 5 base snapshots and the task brief; do not assume a Git diff.

## Required reading

- Task brief: `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-5-brief.md`
- Implementer report: `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-5-report.md`
- Current new View: `src/ui/galaxy-view.js`
- Current integration files: `src/bootstrap/main.js`, `src/ui/shared-controls.js`,
  `src/ui/player-visuals.js`, `SOURCE_ORDER.txt`, `tests/contract-tests.ps1`
- Task 5 base snapshots:
  `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-5-base/`

## Review method

Compare each modified integration file with its corresponding base snapshot.
Inspect the complete current `src/ui/galaxy-view.js`; do not review only the
reported contract strings. Check the actual lifecycle and runtime behavior.

## Review questions

1. Does the View keep one Canvas/2D context, one listener/observer lifecycle,
   one elapsed-time rAF scheduler, and idempotent mount/destroy behavior?
2. Are cached atmosphere/sprites deterministic, background-aware, DPR-capped,
   composite-safe, and free of per-point large shadowBlur or Math.random?
3. Does refresh use frozen snapshots and the shared pure Galaxy service,
   avoid unnecessary layout rebuilds, preserve stable identities, and handle
   empty/partial libraries without decoding or analysis?
4. Does pointer interaction really use a 32px Map spatial hash, the exact
   900 CSS px/s gate and 90ms dwell, concise textContent-only tooltip, click
   pin/background clear/Escape clear, and no playback or DOM creation?
5. Is the bootstrap/shared-controls/player-visuals/source-order integration
   narrow, single-owner, and compatible with existing view transitions?
6. Are there Important or Critical regressions hidden by the static contracts,
   including malformed metadata, viewport/DPR/theme changes, tooltip timing,
   animation cancellation, stale pin state, and remount behavior?

## Global constraints

One Store, Event Bus, queue, shuffle timeline, AudioContext, Deck A/B graph,
Spatial A/B pair and IndexedDB schema remain authoritative. The View must not
access Store/Event Bus/IndexedDB/localStorage/AudioNode/AudioContext, add
runtime network, add a second transition/material/SSE system, mutate playlist
objects, use a fixed-frame loop, edit generated `build/app.js`, or change
protected files outside the Task 5 brief. Existing DOM/class/id/API contracts
must remain stable. Source ownership and SOURCE_ORDER are mandatory. Do not
initialize Git or create commits.

## Reported evidence (verify independently)

The implementer reports syntax checks, pure Galaxy service tests, a VM
lifecycle probe, and Task 5 contract checks passing; final contract and
architecture failures are expected downstream Task 6/7 identity/governance
work. Build and real Edge/file:// visual QA are intentionally deferred to
Task 8. Treat these as claims to audit, not as proof.
