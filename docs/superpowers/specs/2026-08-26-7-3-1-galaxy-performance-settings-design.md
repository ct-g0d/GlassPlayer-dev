# Glass Player 7.3.1 Galaxy, Import and Settings Repair

## Goal

Repair the reported 7.3.1 runtime bugs without creating a second runtime,
changing user-data schemas, or weakening cached audio identity.

## Scope and owners

- Music Galaxy: `src/ui/galaxy-view.js` owns interaction, viewport transform,
  density and label presentation; `src/services/galaxy-runtime.js` owns only
  deterministic layout data.
- Import and analysis: `src/services/library-runtime.js` owns scheduling and
  cache-first analysis; `src/services/neural-runtime.js` owns Resonance Boost
  and Daily Mix policy; `src/adapters/browser/file-adapter.js` owns folder
  picking; `src/bootstrap/main.js` wires the existing Settings and library
  services.
- Typography and settings: `src/ui/settings-view.js`, `src/ui/player-visuals.js`,
  `src/data/i18n.js`, `app.css` and the existing Settings DOM own presentation.
- About/EQ/Spatial/file information: existing Settings/Sound view owners and
  the existing `index.html`/`app.css` blocks only.

## Design

Galaxy keeps the existing Canvas and service contracts. The View adds one
screen-space viewport transform with bounded zoom and pan, recalculates its
visible point radius from the transform, and uses deterministic grid-backed
hit testing. Labels are rendered only for sufficiently separated cluster
anchors and are truncated to a bounded single line; the full song catalog is
never drawn as text. Tooltip content becomes the localized song title only and
uses the shared `--gp-popover-*` material with the same opacity rules as other
Snooze popovers.

Import scheduling will yield through `scheduler.yield()` or a zero-delay task
before falling back to a frame, so analysis does not depend on the active tab's
paint cadence. Resonance Boost refresh remains policy-owned but is skipped or
coalesced when a refresh is already represented by the current import batch.
Daily Mix keeps its freshness/diversity rules while caching each candidate's
feature vector and rendering once per completed batch. Default-folder import
uses the existing File System Access capability when supported and stores only
an optional handle record in the existing compatible storage boundary; when the
browser cannot persist permission, the UI reports that a folder must be chosen
again rather than claiming silent access.

Typography uses one language-aware font stack and equal preview geometry for
Chinese, English and Russian. Font weight labels show names rather than raw
numeric values. The preview is the first centered Typography control. About
adds existing build, architecture, engine and data-safety information without
new state. EQ, Spatial and Track Information receive only local geometry/text
corrections.

## Protected contracts

IndexedDB name/version/stores/keys, localStorage existing keys, Spectrum ID,
audio essence/cache identity, behavior events, user model schema, history,
queue, Store, Event Bus, AudioContext, Deck A/B graph, Spatial A/B buses,
`SOURCE_ORDER.txt`, `build/app.js`, root `app.js`, and the historical HTML are
protected. No runtime network, fixed-frame loop, second overlay system or
second queue is introduced.

## Acceptance criteria

1. Galaxy occupies the available primary surface, responds to resize, scrolls
   and zooms with bounded pan, stays readable with many tracks, and shows only
   the song title in a Snooze-material tooltip.
2. Import scheduling no longer waits on every visible animation frame;
   Resonance Boost and Daily Mix execute once per import batch with one final
   render, preserving cache-first behavior and diversity/freshness policy.
3. A supported persisted default folder is attempted at startup; unsupported
   permission is reported honestly and remains manually recoverable.
4. English/Russian typography has the same intentional preview width/line box
   as Chinese; preview is centered at the top and font weight has no numeric
   suffix.
5. About, EQ, Spatial and Track Information match the requested geometry and
   copy without changing their owners.
6. Build, architecture, contracts, targeted tests and generated syntax pass.
