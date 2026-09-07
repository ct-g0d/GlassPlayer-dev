# Glass Player 7.3.0 Quality Fixes Design

## Status

Approved direction from the user on 2026-08-23. This document freezes the
design before implementation; it is not a claim that the fixes are complete.

## Goal

Deliver Glass Player 7.3.0 with the requested user-visible fixes:

1. Make Spatial Audio clearer instead of muffled, while preserving the single
   AudioContext, Deck A/B graph, Spatial A/B buses, fixed preset policy and
   true dry bypass.
2. Reduce repeated artists, genres and recently recommended tracks without
   turning the immature Neural model into a preference-driven player.
3. Stop pointer movement from revealing liquid scrollbars; real wheel, touch,
   keyboard and scrollbar-drag scrolling must still reveal them briefly.
4. Make EQ curve dB dragging nonlinear: small changes use more vertical travel,
   while large dB changes are reached with less additional travel. Stored dB
   values remain unchanged and symmetric from -12 to +12.
5. Make ambient background mode, theme and track changes crossfade without
   exposing a transient bridge-color flash.
6. Keep selected-control Accent styling unchanged from 7.2.2; no new selection
   emphasis is part of the final 7.3.0 scope.
7. Make the Library Grid actually use seven cards per wide row and render the
   original cached cover rather than the 192px list thumbnail.
8. Establish an Apple-style release-note contract for all future Changelog
   entries and publish the 7.3.0 entry in Chinese and English.

## Evidence and root-cause hypotheses

These are source-backed hypotheses to verify with focused tests and runtime
checks before declaring an audio or visual fix complete:

- `src/data/spatial-presets.js` gives Orbit `mainGain:.46` and HRTF wet `.72`,
  while `src/engines/spatial-engine.js` applies a shared entry gain of `.72`.
  This can reduce direct center clarity while adding a coloured HRTF path.
  Other presets also reduce low-side energy and add HRTF, reflection or reverb.
- `src/services/neural-runtime.js` raises Daily Mix coherence to the seventh
  power and samples only the top 22 percent of candidates. The short-term set
  protects only a limited session/shuffle window and does not consistently
  include the previous generated mix.
- `src/ui/shared-controls.js` reveals a surface for every captured `scroll`
  event, including programmatic alignment scrolls. Its scrollbar selector is
  declared but not used to gate user intent.
- `src/engines/equalizer-runtime.js` maps the SVG pointer position linearly to
  the -12..12 dB range.
- `src/ui/player-visuals.js` writes `--ambient-transition-color` while the
  standby raster is being drawn, before the raster is committed by the
  crossfade. Overlapping asynchronous mode changes can therefore expose a
  transient fallback.
- `app.css` first declares seven Grid columns, then overrides them with
  `auto-fill`; `src/services/queue-runtime.js` always chooses `thumbUrl` first,
  so a 192px thumbnail is enlarged into the Grid card.
- The final `.release-button.active` rule makes the Changelog selection
  transparent, and several other active states use low-opacity Accent fills.

## Design

### Spatial clarity

Keep one existing Spatial graph and fixed preset parameters. First add a small,
deterministic diagnostic/contract around the existing bus path so the first
over-limit or attenuated stage is identifiable. Then rebalance the existing
Orbit direct/HRTF mix and any common attenuation only where the measured result
supports it. Do not add a limiter to conceal an unknown graph problem, add
RMS/genre/BPM/MFCC modulation, or create a second dry/processed graph.

The acceptance target is clearer high-frequency and center content in Orbit
and the affected presets, no click or gain jump during A/B transitions, no
additional AudioContext or connection, and no regression of the true dry
bypass. Exact preset numbers are selected only after the focused audio test
and real playback check.

### Recommendation diversity

Keep `recommendationScore` and the mature-model gate intact as separate policy.
Use a bounded soft diversity guard in both automatic Shuffle and Daily Mix:

- protect recently played/recommended stable identities when enough candidates
  exist;
- include the previous generated mix in the same cooldown only when the pool
  can satisfy the requested count;
- apply a soft artist repetition penalty and prefer a different artist after a
  recent selection, relaxing automatically for small libraries;
- reduce the Daily Mix concentration exponent and widen its candidate
  shortlist so coherence remains useful without repeatedly selecting one
  cluster;
- do not introduce hard genre/artist caps that make a small library fail, and
  keep immature Shuffle selection uniform among eligible candidates.

No recommendation schema or stable identity changes are required.

### User-intent-gated scrollbars

Retain the existing shared scrollbar owner and 500ms fade. Track a short-lived
user-scroll intent per registered surface from wheel, touch, keyboard navigation
and pointer-down/drag signals. A captured `scroll` event reveals the scrollbar
only when the surface has that intent; pointermove, pointerover and unrelated
programmatic scrolls do not reveal it. Keep SSE endpoint measurement separate
from scrollbar visibility.

### Nonlinear EQ pointer mapping

Keep the displayed EQ curve linear in actual dB so the visualization remains
truthful. Change only the SVG pointer-to-dB transfer function to a symmetric
power curve with exponent 1.7, snap to the existing 0.5 dB step, and clamp to
-12..12 dB. At the center, a small dB change takes more vertical travel; near
the limits, more dB is covered per pixel. Range sliders retain their existing
native mapping and saved values remain real dB values.

### Atomic ambient transitions

Keep the active Canvas visible beneath the incoming Canvas throughout the
transition. Drawing functions must not commit the CSS bridge color. Compute
the incoming bridge from the prepared palette/cover and commit it only when the
incoming raster is made visible in the same animation frame. A stale async
render must not commit either a raster or a bridge color. Mode changes should
reserve the existing transition window and remain idempotent.

### Accent selection behavior

The user's final correction keeps all selected-control Accent styling at its
7.2.2 behavior. Do not add shared selection-strength variables or change the
existing active/glider selectors, Changelog release buttons or floating-player
control.

### Library Grid artwork and geometry

Keep the existing `thumbBlob` and original `coverBlob` cache contract. In the
Library Grid only, choose `coverUrl` first and keep list, Queue, recommendation
and history rows on `thumbUrl` first. Replace the later Grid `auto-fill`
override with the seven-column wide breakpoint contract and place responsive
fallbacks after the final Grid rule so they are not overridden by source order.
No re-import or cover-cache migration is needed.

### Release-note contract and 7.3.0 identity

Update the root project contract and current-state snapshot to require:

- one plain-language release summary focused on user benefit;
- short, user-facing sections grouped by product area;
- concise bullets describing the result, not internal file names or algorithms;
- Chinese and English parity without invented or unfinished features;
- the same release data driving the Changelog UI and exported text.

This follows the structure of Apple's public OS update pages without copying
their text: a short update overview followed by categorized feature and fix
items. The 7.3.0 entry will use this format and describe only implemented
changes.

## Ownership and expected files

Primary owners and expected source consumers:

| Area | Primary owner | Expected files |
| --- | --- | --- |
| Spatial clarity | Spatial Engine + spatial presets | `src/engines/spatial-engine.js`, `src/data/spatial-presets.js` |
| Recommendation diversity | Neural Service | `src/services/neural-runtime.js` |
| Scrollbar intent | Shared Controls | `src/ui/shared-controls.js`, `app.css` |
| EQ transfer | Equalizer Engine | `src/engines/equalizer-runtime.js` |
| Ambient transition | Player Visuals + Settings | `src/ui/player-visuals.js`, `src/ui/settings-view.js` |
| Accent selected states (unchanged) | Shared UI material | `app.css` |
| Library Grid | Queue/Library row renderer | `src/services/queue-runtime.js`, `app.css` |
| Version and release notes | Releases + bootstrap/index | `src/data/releases.js`, `index.html`, `src/bootstrap/main.js`, `AGENTS.md`, `CURRENT_STATE.md` |
| Regression contracts | Contract tests | `tests/contract-tests.ps1` |

`build/app.js` is generated only by `build.ps1` after source edits.

## Protected boundaries

Do not edit `build/app.js` directly, root `app.js`, or
`original/Glass Player 6.2.2.html`. Do not change `SOURCE_ORDER.txt`, DOM ids,
IndexedDB name/version/stores/indexes, localStorage keys, Spectrum ID/cache
identity, historical records, AudioContext count, Deck A/B graph topology,
queue ownership, shuffle timeline ownership or public service interfaces.

## Verification gates

Before completion, run and report separately:

1. failing focused tests first, then passing focused tests;
2. `build.ps1`;
3. `validate-architecture.ps1`;
4. `tests/contract-tests.ps1`;
5. targeted static source checks for each owner;
6. Edge/file:// runtime checks for spatial audio, recommendation variety,
   pointer movement/scrolling, EQ dragging, background switching, active-state
   contrast and 7-card high-resolution Grid rendering when available;
7. `DELIVERY_CHECKLIST.md` results, with any unavailable audio or visual checks
   explicitly marked NOT RUN or BLOCKED.
