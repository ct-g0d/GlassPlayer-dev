# Task 5: Implement the Canvas Music Galaxy View and lifecycle

Task 2 supplies the pure deterministic layout/similarity service, Task 3
injects that same service into Daily Mix, and Task 4 supplies the localized
Canvas shell. Implement the actual high-fidelity star map and its interaction
lifecycle without creating a second state owner or view transition system.

## Files

- Create `src/ui/galaxy-view.js`.
- Modify `src/ui/shared-controls.js`.
- Modify `src/bootstrap/main.js`.
- Modify `src/ui/player-visuals.js` only for the existing adaptive title query,
  changing `.galaxy-coming-soon` to `.galaxy-title`.
- Modify `SOURCE_ORDER.txt` by inserting `src/ui/galaxy-view.js` immediately
  after `src/ui/library-view.js` and before `src/ui/settings-view.js`; do not
  reorder any existing line.
- Modify `tests/contract-tests.ps1`.

The two extra allowed files are required by the recorded Task 5 rulings:
source-order is mandatory for any new source fragment, and Player Visuals is
the existing owner of background-aware title contrast.

## RED contracts first

Before production View code, strengthen the existing Galaxy contracts and run
the contract script to observe RED:

```powershell
Expect ($galaxyViewSource -match 'createGalaxyView|function mount|function refresh|function destroy' -and $galaxyViewSource -match 'GALAXY_HOVER_SPEED_LIMIT' -and $galaxyViewSource -match 'requestAnimationFrame' -and $galaxyViewSource -match 'spatialHash|spatial-hash|Map\(' -and $galaxyViewSource -notmatch 'setInterval') 'Galaxy View must use one Canvas lifecycle, speed-gated hover and spatial hit testing'
Expect (($order -contains 'src/ui/galaxy-view.js') -and ($order.IndexOf('src/ui/galaxy-view.js') -gt $order.IndexOf('src/ui/library-view.js')) -and ($order.IndexOf('src/ui/galaxy-view.js') -lt $order.IndexOf('src/ui/settings-view.js'))) 'Galaxy View must be registered in source order'
Expect ($sharedControlsSource -match 'viewName==="galaxy"' -and $sharedControlsSource -match 'refreshMusicGalaxy') 'Primary-view layout must refresh Music Galaxy through the shared lifecycle'
Expect ($bootstrapSource -match 'createGalaxyView' -and $bootstrapSource -match 'refreshMusicGalaxy') 'Bootstrap must mount one Galaxy View controller'
Expect ($playerVisualsSource -match '\.view-header h2,\.galaxy-title' -and $playerVisualsSource -notmatch '\.galaxy-coming-soon') 'Adaptive title contrast must target the real Galaxy title'
```

The existing placeholder/Dom contracts from Tasks 1/4 must remain GREEN. The
new View/source-order/bootstrap/title contracts must be the intended RED set.

## Public View boundary and ownership

Register one factory through the concatenated runtime:

```js
GPModules.register("createGalaxyView", function createGalaxyView({galaxy,getTracks}) {
  // one mount/refresh/destroy controller
  return Object.freeze({mount,refresh,destroy,isMounted});
});
```

The View consumes only the frozen `galaxy` facade, `getTracks:()=>frozen track
snapshots`, existing `tr`, `matchMedia`, browser clock and DOM hooks. It may
own DOM references, Canvas layers, observers, listeners and animation handles.
It must not access IndexedDB/localStorage, Store, Event Bus, AudioNode,
AudioContext, playback state, Queue state, or create a second router.

`mount(root)` is idempotent. Resolve the existing `.galaxy-view`,
`#galaxyCanvas`, `#galaxyTooltip` and `#galaxyStatus` exactly once. Obtain one
2D context. Install one resize listener, one pointer listener set, and one
Escape/key listener. Return a frozen controller. `destroy()` removes every
listener, cancels the pending animation frame, clears the tooltip, disconnects
the ResizeObserver if used, and releases offscreen Canvas layers. Repeated
mount/refresh/destroy calls must not stack handlers or observers.

## Bootstrap and shared view lifecycle

In `src/bootstrap/main.js`, use the existing `galaxyService` from Task 3 and
create exactly one View controller. Pass a getter that returns frozen track
snapshots with stable id/spectrumId, title, artist, album, genre,
genreSecondary, bpm, bpmConfidence, mfcc, energy, loudness and duration where
available; never let the View mutate playlist objects. Mount it after the
existing shared UI mount is available and expose only the narrow existing hook:

```js
window.refreshMusicGalaxy=galaxyView.refresh;
```

In `refreshPrimaryViewLayout(viewName)`, inside the existing
`requestAnimationFrame` branch, call `refreshMusicGalaxy()` only for
`viewName === "galaxy"`. Do not add another transition engine or call it from
pointer events.

Update `src/ui/player-visuals.js`'s existing title query from
`.view-header h2,.galaxy-coming-soon` to `.view-header h2,.galaxy-title`; do
not refactor the ambient/title algorithm.

## Canvas sizing, layers and atmosphere

The renderer must look like a real, restrained Milky Way: a dark transparent
background-aware field, a soft diagonal/curved density band, many tiny dim
stars, hazy clusters, and song points that read as slightly foggy glowing
stars. Preserve the player background behind the transparent shell.

- Measure CSS pixels from the Canvas shell. Backing dimensions use
  `Math.min(devicePixelRatio,2)` and a matching transform; no fixed 1x or
  unbounded DPR.
- Keep one 2D context. Create one cached offscreen starfield/density layer and
  three cached radial point-glow sprites (dim/normal/selected or equivalent).
  Invalidate/rebuild layers only on resize/theme/layout signature changes.
- Starfield and density generation must be deterministic from a local seed or
  stable point key; do not use `Math.random`.
- Draw sprites with `globalCompositeOperation="lighter"`, restore the normal
  composite mode before labels/status-adjacent rendering, and do not use a
  large `shadowBlur` inside the per-point loop.
- Draw cluster labels a little above their region with low-alpha glow text;
  labels show concise style/tempo names from the layout. They must remain
  legible at Edge 100%, 110% and 4K without widening the page.
- Draw empty/partial libraries as atmospheric states; never decode audio or
  trigger analysis from render/resize/hover.

## Layout refresh and motion

`refresh()` obtains the current frozen tracks, calls
`galaxy.buildLayout(tracks,{width,height})`, keeps the previous point map by
stable key, and interpolates only changed points. It must not rebuild layout
when the stable track signature and CSS viewport are unchanged.

Use one elapsed-time `requestAnimationFrame` scheduler. It may draw a frame
while a layout interpolation or pointer/tooltip transition is active, then
stops. No `setInterval`, fixed 60/120-frame loop, or frame-count assumption.
Use a short smooth duration and reduced-motion behavior that presents the
target layout immediately. Cancellation leaves the target or current
deterministic state; repeated view switches are idempotent.

Status uses concise localized text from `tr`: empty-library instruction,
point/song count and feature coverage. Tooltip content uses `textContent`
only and is limited to title, artist, genre and rounded BPM. Never inject
unsanitized HTML or raw MFCC arrays.

## Speed-gated interaction and spatial hash

Use these exact interaction values:

```js
const GALAXY_HOVER_SPEED_LIMIT = 900; // CSS px/s
const GALAXY_HOVER_DWELL_MS = 90;
const GALAXY_SPATIAL_CELL = 32;
```

Pointer handlers only update the latest CSS coordinate, timestamp and speed.
The single frame scheduler performs the screen-space spatial-hash query. Build
or refresh a `Map`-based hash from visible layout points using 32 px cells and
query neighboring cells; do not scan the full library on every pointer move.

- Speed above 900 CSS px/s clears transient hover text; it must not create DOM
  nodes, start playback or pin a new track.
- Speed below the limit plus 90 ms dwell shows only the four concise fields.
- Click on a point pins the same concise information; background click clears
  the pin. Escape clears the pin/tooltip.
- Pointer leave clears transient hover but does not corrupt the layout.
- Use `pointer-events:none` for the tooltip; Canvas remains keyboard-focusable
  through the existing `tabindex`/focus-visible contract.

## Checks

Run syntax and targeted contracts:

```powershell
$nodeRuntime='C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $nodeRuntime --check .\src\ui\galaxy-view.js
& $nodeRuntime --check .\src\services\galaxy-runtime.js
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\contract-tests.ps1
```

Expected: View/DOM/source-order/bootstrap/title contracts pass; only version,
release, governance and final-build contracts remain later RED. Run residue
and ownership scans for `galaxy-coming-soon`, `setInterval`, direct storage or
audio access in the new View, and duplicate Canvas/handler registration.

## Boundaries

- Do not modify `src/services/galaxy-runtime.js`, `src/services/neural-runtime.js`,
  `src/services/neural-service.js`, `src/ui/view-factories.js`, `index.html`,
  `app.css`, release files, governance docs, or `build/app.js`.
- Do not add Store state, Event Bus events, IndexedDB/localStorage, a second
  AudioContext/graph, Queue state, runtime network, Worker or new material/
  popover system.
- Do not change existing navigation order or Accent selected-state behavior.
- Do not dispatch subagents.
- The project has no usable Git metadata; do not initialize Git or create
  commits.

## Report

Write the full report to:
`.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-5-report.md`

Include RED/GREEN contract evidence, source-order and owner decisions,
rendering/lifecycle/interaction details, exact commands and outputs, static
residue scans, self-review and any browser/visual limitations. Return only
status, changed files, one-line tests, and concerns after writing the report.
