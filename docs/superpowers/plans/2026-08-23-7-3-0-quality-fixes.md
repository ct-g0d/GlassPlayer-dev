# Glass Player 7.3.0 Quality Fixes Implementation Plan

> **Execution rule:** implement this plan step by step, with a failing
> regression check before each production-code change and fresh verification
> before any completion claim.

## Goal

Ship Glass Player 7.3.0 with clearer Spatial Audio, lower recommendation
repetition, user-intent-gated liquid scrollbars, nonlinear EQ curve dragging,
atomic ambient transitions, unchanged 7.2.2 Accent selection states, a real
seven-card high-resolution Library Grid, and an Apple-style bilingual release
log.

## Constraints

- Work only in `D:\GlassPlayer-dev`.
- Source authority remains `src/**`, `SOURCE_ORDER.txt`, `index.html` and
  `app.css`; never edit `build/app.js` directly.
- Preserve one Store, Event Bus, playlist, manual queue, shuffle timeline,
  AudioContext, Deck A/B graph, EQ graph, Spatial A/B pair and existing public
  interfaces.
- Do not change IndexedDB name/version/stores/indexes, localStorage keys,
  Spectrum ID, cover/cache identity, history records or stored EQ dB values.
- Keep all changes inside the owners recorded in the approved design spec.

## Steps

### 1. Establish the baseline and add RED regression contracts

Files: `tests/contract-tests.ps1`, optionally one focused helper test file only
if the existing PowerShell contract runner cannot express a behavior.

- Run the current `build.ps1`, `validate-architecture.ps1` and
  `tests/contract-tests.ps1`; record the 7.2.2 baseline.
- Add 7.3.0 contract assertions before changing source. They must initially
  fail against the current build and cover:
  - all version identity surfaces and the new bilingual release entry;
  - Spatial clarity parameters/diagnostic ownership and unchanged single-path
    graph rules;
  - recommendation cooldown, artist-diversity accounting and immature-model
    uniform fallback;
  - explicit scrollbar intent events and absence of pointer-move reveal;
  - named nonlinear EQ transfer helper, exponent and ±12/0.5dB bounds;
  - ambient bridge-color commit occurring in the presentation path rather than
    in raster draw functions;
  - shared Accent selection variables and stronger Changelog/PiP active rules;
  - Grid seven-column final CSS rule and `coverUrl` preference for Grid rows;
  - the durable Apple-style release-note contract in `AGENTS.md` and the
    matching current-state note.
- Run the focused contract checks and capture the expected RED failures.

Verification: only the new 7.3.0 expectations fail; no unrelated baseline
contract is altered.

### 2. Repair Spatial Audio clarity without changing graph topology

Owners: `src/engines/spatial-engine.js`, `src/data/spatial-presets.js`.

- Add a deterministic, bounded diagnostic around the existing Spatial bus
  levels/frequency path using the project’s existing first-exceed diagnostics;
  do not connect the currently disconnected safety compressor as a shortcut.
- Compare the direct M/S path, HRTF path and common entry/output trims for the
  affected presets. Rebalance the existing fixed preset values, starting with
  Orbit’s direct/HRTF mix, only where the evidence shows the clarity loss.
- Preserve fixed parameters, true dry bypass, equal-power 400ms A/B transition,
  one active bus after transition and no runtime RMS/genre/BPM/MFCC tuning.
- Add/update static checks for one Spatial A/B pair, one output path and no
  duplicate AudioContext or compressor connection.
- Run the focused Spatial contract and `node --check` on the generated build
  after the source is rebuilt.

Verification: the focused diagnostic shows improved high-band/center balance
without an over-limit first-exceed, click, gain jump or graph-topology change.

### 3. Reduce recommendation repetition while preserving model maturity rules

Owner: `src/services/neural-runtime.js`.

- Extend the existing recent recommendation set with the previous generated
  mix, using the existing “only apply freshness when enough candidates exist”
  fallback so small libraries still produce a result.
- Introduce bounded per-generation artist counts and a soft artist cooldown in
  `generateDailyMix` and `generateDailyMixForImport`; relax it automatically
  when the remaining pool cannot satisfy the target count.
- Replace the seventh-power concentration with a named lower exponent and a
  wider shortlist. Keep feature coherence and preference weighting, but prevent
  one high-scoring cluster from dominating every selection.
- Keep `weightedPickIndex` uniform for an immature model after eligibility
  filtering. Do not let the new diversity guard become a hidden long-term
  preference model.
- Add tests for no duplicate stable IDs in a mix, prior-mix cooldown when the
  pool is sufficient, artist spread when alternatives exist, and graceful
  fallback for a two- or three-track library.

Verification: repeated generation with the same fixture produces varied
eligible artists/tracks, while mature scoring and immature uniform behavior
remain distinguishable.

### 4. Gate scrollbar reveal on real user scroll intent

Owner: `src/ui/shared-controls.js`; style owner: `app.css`.

- Use the existing `GP_SCROLLBAR_SELECTOR` to resolve only registered scroll
  surfaces.
- Add a short-lived per-surface intent marker for wheel, touch, keyboard
  navigation and pointer-down/drag. A scroll event reveals only when that marker
  is active; pointermove and pointerover never reveal it.
- Keep the existing 500ms fade and all SSE endpoint calculations unchanged.
- Ensure native scrollbar dragging still works, and ensure programmatic Queue
  alignment does not activate the scrollbar by itself.
- Add contract checks for user-intent listeners, no pointer-move reveal path,
  separate History viewports and the existing 500ms cleanup.

Verification: pointer movement alone leaves `gp-scrollbar-active` absent;
wheel/keyboard/touch/native drag reveal the correct surface and then remove the
class after 500ms.

### 5. Implement nonlinear EQ curve dragging

Owner: `src/engines/equalizer-runtime.js`.

- Add a pure named transfer helper with exponent `1.7`, symmetric sign,
  clamping to `-12..12` and rounding to the existing `0.5` dB step.
- Use it only in `updateFromPointer`; keep `eqCurvePoints` linear so the drawn
  curve remains an honest representation of the stored dB values.
- Keep range sliders, `setManualEQBand`, smooth AudioParam ramps, preamp
  headroom and persistence unchanged.
- Add a test fixture/check that verifies 0.5dB requires materially more curve
  travel than the current linear mapping, ±12dB remains reachable and values
  stay within bounds.

Verification: curve dragging produces the intended slow center/fast-edge
response and no audio parameter jump or saved-value migration.

### 6. Make ambient transitions atomic

Owners: `src/ui/player-visuals.js`, `src/ui/settings-view.js`.

- Remove bridge-color writes from `drawAmbientPalette`, `drawEmptyAmbient602`
  and any pre-presentation branch of `updateAmbient`.
- Compute the incoming bridge from the already prepared raster input and commit
  it from `presentAmbientCanvas` in the same frame that the incoming Canvas is
  made visible.
- Keep the completed outgoing raster visible under the incoming raster, retain
  token checks for stale async work, and reserve the existing transition window
  for direct background-mode changes.
- Keep zoom’s instant atomic swap behavior and adaptive title/control contrast
  refreshes intact.
- Add checks that no stale token can commit a bridge and that both normal
  crossfade and instant resize swap preserve the old surface until commit.

Verification: rapid track/theme/background-mode changes do not expose base
white/gray/black flashes or a blank Canvas; old and incoming rasters overlap
for normal transitions.

### 7. Keep shared Accent selection states unchanged

Style owner: `app.css`; the final user correction removes this implementation
from the 7.3.0 scope.

- Preserve the original 7.2.2 active/glider selectors and final overrides.
- Do not add `--gp-selection-fill`, `--gp-selection-border` or new selection
  emphasis rules.

Verification: the 7.3.0 CSS contains no new selection variables or selection
emphasis block, while the existing Accent rules remain present.

### 8. Fix Library Grid geometry and use original artwork

Owners: `src/services/queue-runtime.js`, `app.css`.

- Add a Grid-only artwork choice in `trackRowHTML`: use `coverUrl` first for
  non-compact Library rows, while all compact/list/Queue/recommendation/history
  rows continue to prefer `thumbUrl`.
- Make the final Grid rule seven columns at the wide breakpoint and place the
  responsive six/five/four-column fallbacks after that final rule.
- Preserve the existing card layout, lazy decoding and Blob URL lifecycle; do
  not re-import tracks or change `thumbBlob`/`coverBlob` storage.
- Add checks that the final CSS rule is not `auto-fill` and that Grid HTML uses
  original cover URLs.

Verification: a wide Library Grid renders seven cards per row with sharp
original artwork; Queue and list surfaces retain compact thumbnails.

### 9. Publish 7.3.0 identity and durable release-note rules

Owners: `index.html`, `src/bootstrap/main.js`, `src/data/releases.js`,
`AGENTS.md`, `CURRENT_STATE.md`, `tests/contract-tests.ps1`.

- Update all identity surfaces to `7.3.0`, including cache-busting URLs,
  settings build card, current-version button, public facade and generated
  release text.
- Add the 7.3.0 Chinese/English release entry using a one-sentence user-facing
  summary and concise sections: Spatial Audio, Daily Mix, Controls, Ambient
  Transitions, Library and Artwork.
- Add the permanent Apple-style release-note contract to `AGENTS.md` and the
  current-state snapshot without changing historical architecture docs.
- Keep the Unreleased roadmap separate from implemented 7.3.0 changes.

Verification: every current-version surface agrees on 7.3.0; Changelog UI and
TXT export use the same bilingual release data; no unfinished item is claimed.

### 10. Build, architecture validation and delivery QA

- Search for duplicate handlers, duplicate AudioNode connections, stale 7.2.2
  identity strings and direct UI-to-storage/audio access.
- Run `build.ps1` to regenerate `build/app.js`.
- Run `validate-architecture.ps1`.
- Run `tests/contract-tests.ps1` and all focused 7.3.0 tests.
- Run `node --check build/app.js` and targeted source checks for every changed
  owner.
- Read `DELIVERY_CHECKLIST.md`, complete its PASS/NOT RUN/BLOCKED entries, and
  report static, runtime, audio and visual verification separately.
- If Edge/file:// runtime or real audio output cannot be exercised in this
  environment, mark those checks explicitly rather than inferring success from
  static output.

## Handoff format

The final handoff must include:

- changed source and governance files;
- generated build hash;
- contract/architecture/test results;
- audio verification result for Spatial Audio;
- visual verification result for scrollbar, ambient, selection and Grid;
- explicit remaining NOT RUN or BLOCKED checks;
- confirmation that no persistence/schema/cache identity was changed.
