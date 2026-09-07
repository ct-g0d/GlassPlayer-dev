# Task 5 Report — Canvas Music Galaxy View and lifecycle

Date: 2026-08-25 (Pacific/Auckland)

## Status

Task 5 is implemented within its assigned source boundary. All Task 5
View/source-order/shared-lifecycle/bootstrap/title contracts are GREEN. The
full contract script remains RED only for Task 6's future 7.3.1 engine
identity, and architecture validation remains RED only for Task 7's future
Galaxy source-ownership entries.

The generated runtime was not rebuilt: `build/app.js` is explicitly protected
in this task and Task 8 owns generation. Consequently, this report does not
claim an executable Edge/file:// visual result for the new Canvas surface.

## Classification, owner and boundaries

- Classification: view layout / DOM-only Canvas presentation, interaction and
  refresh scheduling.
- Primary owner: `src/ui/galaxy-view.js`.
- Allowed consumers and collaborators:
  - the frozen Task 2 `galaxyService` facade supplies feature vectors and
    deterministic layout;
  - Bootstrap supplies frozen playlist snapshots;
  - Shared Controls calls the narrow refresh hook from the existing primary
    view lifecycle;
  - Player Visuals remains the owner of adaptive title contrast.
- Public boundary: one frozen `{mount,refresh,destroy,isMounted}` controller
  registered as `createGalaxyView`.
- State boundary: all Canvas references, cached layers, listeners, observers,
  animation handles, pointer state, spatial hash and transient pin/hover state
  are private View runtime state. No new canonical application state exists.
- Persistence/schema/event/audio/queue impact: none.
- Version/changelog impact: none; Tasks 6 and 7 own those changes.

## Changed files

- Created `src/ui/galaxy-view.js`.
- Modified `src/ui/shared-controls.js` with one Galaxy-only refresh call inside
  the existing `requestAnimationFrame` primary-view branch.
- Modified `src/bootstrap/main.js` to create one View controller, provide
  frozen nested track snapshots, mount it after shared UI initialization and
  expose `window.refreshMusicGalaxy=galaxyView.refresh`.
- Modified `src/ui/player-visuals.js` only by replacing
  `.galaxy-coming-soon` with `.galaxy-title` in the existing adaptive-title
  selector.
- Modified `SOURCE_ORDER.txt` with one insertion between Library View and
  Settings View.
- Modified `tests/contract-tests.ps1` with the five exact Task 5 contracts.
- Created this report.

Task 2's `src/services/galaxy-runtime.js` and Task 4's `index.html`, `app.css`
and `src/data/i18n.js` were inspected as authority and not edited. No release,
governance, generated, persistence, audio, queue, Neural or historical source
file was changed.

## RED evidence

The five Task 5 contracts were added before production View code. Command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\contract-tests.ps1
```

Output before production changes (exit code 1):

```text
FAIL
- Galaxy View must use one Canvas lifecycle, speed-gated hover and spatial hit testing
- Galaxy View must be registered in source order
- Primary-view layout must refresh Music Galaxy through the shared lifecycle
- Bootstrap must mount one Galaxy View controller
- Adaptive title contrast must target the real Galaxy title
- Music Galaxy interaction/render contract is missing
- 7.3.1 engine identity is missing
```

The first six failures were the intended Task 5 RED set. The final identity
failure was already assigned to Task 6.

## Rendering implementation

- Canvas CSS dimensions are read from `.galaxy-canvas-shell`; backing width and
  height cap `devicePixelRatio` at 2 and install a matching transform.
- The main Canvas obtains one 2D context for its complete lifecycle.
- One deterministic cached atmosphere layer combines:
  - a transparent background-aware radial field;
  - a restrained curved diagonal density band;
  - deterministic hazy regions;
  - area-bounded tiny dim stars.
- Three cached deterministic radial sprites provide dim, normal and selected
  song glows. Replaced sprites and all offscreen layers are released.
- Local seeded generation is used throughout; there is no `Math.random`.
- Song sprites are drawn with `globalCompositeOperation="lighter"`; normal
  source-over composition is restored before cluster labels.
- The per-point loop uses cached gradients and no `shadowBlur`. Low-alpha
  cluster labels use theme-derived text and Accent colors above each region.
- Atmosphere and sprite cache keys include only the relevant DPR, viewport,
  theme/Accent/text and layout signatures, so they do not rebuild on every
  frame, refresh or pointer event.
- Empty and partial libraries retain the atmospheric field and use the
  existing localized status node. Rendering never decodes or analyzes audio.

## Refresh and motion lifecycle

- `mount(root)` is idempotent and resolves the existing Galaxy View, Canvas,
  tooltip and status once per mount lifecycle.
- `refresh()` calls the frozen getter once, derives stable feature signatures,
  and skips `buildLayout` when both track-feature and CSS viewport signatures
  are unchanged.
- Layout output is matched to previous visible points by stable key. Only
  existing points whose coordinates changed interpolate; new points appear at
  deterministic target positions.
- One elapsed-time, 360 ms cubic-out `requestAnimationFrame` scheduler drives
  interpolation and pointer dwell, then stops. There is no frame-count model,
  fixed refresh assumption or `setInterval`.
- Reduced motion commits target geometry immediately.
- A refresh during motion first samples the current interpolated geometry, so
  cancellation/re-entry continues from deterministic current positions.
- One window resize listener plus one optional `ResizeObserver` cover viewport
  and DPR changes. One optional `MutationObserver` wakes a frame after theme,
  Accent or language changes; signature checks decide whether cached visual
  assets actually need rebuilding.
- `destroy()` removes all installed listeners, disconnects both observers,
  cancels the pending frame, clears tooltip/transient state and releases all
  offscreen Canvas layers. Remount starts with clean signatures and maps.

## Interaction and spatial ownership

Exact constants:

```js
const GALAXY_HOVER_SPEED_LIMIT = 900;
const GALAXY_HOVER_DWELL_MS = 90;
const GALAXY_SPATIAL_CELL = 32;
```

- Pointer handlers only record CSS coordinates, movement time/speed and an
  interaction intent; no handler scans layout points or calls layout refresh.
- The single frame scheduler performs all hit testing through a `Map`-based
  32 px spatial hash and only checks neighboring cells.
- Movement above 900 CSS px/s clears transient hover and cannot pin a new
  point. After pointer settling, the same candidate must remain for 90 ms
  before hover details appear.
- Click pins the existing point details; a background click clears the pin.
  Escape clears pin and tooltip. Pointer leave clears transient hover while
  preserving a legitimate pin.
- The existing tooltip node is reused. It receives `textContent` only and is
  limited to localized labels for title, artist, genre and rounded BPM.
- No song starts playing and no DOM node is created by Galaxy interaction.

## Bootstrap snapshot contract

Bootstrap provides a new frozen array on each refresh and freezes every track
snapshot. The MFCC mean array and its wrapper are also frozen. Snapshots expose
stable `id`/`spectrumId` plus compatible `audioEssenceKey`/`contentKey`, and
the requested title, artist, album, genre, secondary/inferred genre, BPM,
BPM confidence, MFCC, Energy, Loudness and duration fields when available.
No playlist object is returned to or mutated by the View.

## GREEN and targeted verification

### Required syntax checks

```powershell
$nodeRuntime='C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $nodeRuntime --check .\src\ui\galaxy-view.js
& $nodeRuntime --check .\src\services\galaxy-runtime.js
```

Final result: both exit code 0 with no output.

The complete ordered source was also concatenated in memory, without writing
`build/app.js`, and checked as one runtime:

```powershell
$source=(Get-Content -LiteralPath .\SOURCE_ORDER.txt | ForEach-Object {Get-Content -Raw -LiteralPath $_}) -join "`r`n"
$source | & $nodeRuntime --check -
```

Result: exit code 0 with no output. A standalone check of
`src/bootstrap/main.js` is not a valid project gate because this fragment
closes the IIFE opened by an earlier ordered fragment; the untouched Task 5
baseline snapshot produces the same standalone end-of-file parse error.

### Pure service regression

```powershell
& $nodeRuntime .\tests\galaxy-runtime.test.js
```

Output, exit code 0:

```text
PASS galaxy-runtime pure behavior
```

### Contract GREEN evidence

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\contract-tests.ps1
```

Final output, exit code 1:

```text
FAIL
- 7.3.1 engine identity is missing
```

All Task 5 and pre-existing non-identity contracts are therefore GREEN. The
remaining named failure belongs exclusively to Task 6; this task did not
expand scope to alter engine/version identity.

### Architecture validation

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\validate-architecture.ps1
```

Output, exit code 1:

```text
FAIL
- Source ownership must occur once: src/services/galaxy-runtime.js (found 0)
- Source ownership must occur once: src/ui/galaxy-view.js (found 0)
```

No runtime architecture invariant failed. Both missing documentation entries
are the explicit Task 7 governance work; Task 5's brief protects governance
files.

### View lifecycle VM probe

A no-write Node `vm` probe loaded the real `galaxy-view.js` with deterministic
DOM/Canvas stubs. It asserted a frozen controller, idempotent mount, one main
context, one resize registration, DPR 3 capped to a 2x backing width, one
layout build across an unchanged refresh, one getter call per refresh,
speed-gated click behavior, listener cleanup and tooltip cleanup.

Output, exit code 0:

```text
PASS galaxy-view lifecycle probe
{"buildCalls":1,"getTrackCalls":2,"contextCalls":1,"backingWidth":1600,"listenerCleanup":true,"fastPointerDidNotPin":true}
```

### Residue and duplicate-owner scans

Commands:

```powershell
rg -n 'galaxy-coming-soon' src\ui src\bootstrap SOURCE_ORDER.txt index.html app.css
rg -n 'setInterval|Math\.random|localStorage|indexedDB|IndexedDB|AudioContext|AudioNode|playQueue|EventBus|createStore|decodeAudio|Worker\(' src\ui\galaxy-view.js
rg -n 'src/ui/(library-view|galaxy-view|settings-view)\.js|createGalaxyView|refreshMusicGalaxy|\.view-header h2,\.galaxy-title' SOURCE_ORDER.txt src\bootstrap\main.js src\ui\shared-controls.js src\ui\player-visuals.js
```

Measured results:

```text
placeholderProductMatches=0
forbiddenViewMatches=0
factoryRegistrations=1
mainContextAcquisitions=1
rafSchedulers=1
canvasIds=1
tooltipIds=1
statusIds=1
SOURCE_ORDER: library-view.js -> galaxy-view.js -> settings-view.js
```

The three `spatialHash=new Map()` assignments are one private variable's
initialization, rebuild and destroy reset, not three owners.

Snapshot comparison against `snapshots/task-5-base` confirmed that existing
shared files changed only by the exact insertion/replacement blocks described
above; no adjacent baseline line changed.

## Delivery-checklist self-review

- PASS — intended root, Task 5 brief, ledger ruling, project contracts,
  current-state and required handoff sections were read before editing.
- PASS — one UI owner, frozen service/snapshot consumers and protected files
  were recorded before editing.
- PASS — Task 2 service and Task 4 DOM/CSS/i18n remained authoritative and
  untouched.
- PASS — no Store, Event Bus, queue, playback, persistence, schema, cache
  identity, history or user-model owner was added or changed.
- PASS — no duplicate Canvas hook, main context, controller, scheduler,
  handler set, observer lifecycle, shell, backdrop, popover or transition
  engine was introduced.
- PASS — animation is elapsed-time rAF with reduced-motion and deterministic
  cancellation/re-entry behavior.
- PASS — title contrast remains with Player Visuals and targets the real title.
- NOT APPLICABLE — audio graph/headroom/device checks; no audio path changed.
- NOT APPLICABLE — SSE checks; Galaxy is a contained Canvas, not a scroll
  surface.
- NOT RUN — `build.ps1`; the brief protects generated output and assigns the
  first build to Task 8.
- FAIL (expected downstream) — architecture validation, only because Task 7
  has not yet recorded the two Galaxy source owners.
- FAIL (expected downstream) — full contract exit, only because Task 6 has not
  yet supplied 7.3.1 engine identity.
- NOT RUN — real Edge/file://, screenshot, 100%/110%, 4K and 120 Hz hardware
  QA. `index.html` still loads the intentionally stale generated build, so a
  real browser run cannot exercise Task 5 until Task 8 regenerates it.
- NOT RUN — audible-device testing; unrelated to this non-audio task.

## Concerns and downstream work

1. Task 6 must update the 7.3.1 visible engine/version identity so the final
   contract failure can turn GREEN.
2. Task 7 must register `src/services/galaxy-runtime.js` and
   `src/ui/galaxy-view.js` exactly once in governance documentation so
   architecture validation can turn GREEN.
3. Task 8 must run `build.ps1`, re-run architecture/contracts against the
   generated runtime and perform the first real Edge/file:// Canvas visual QA.
   Until then, atmosphere, label contrast, tooltip placement and perceived
   motion at Edge 100%/110%, 4K and 120 Hz remain visually unverified.

## Review fix round — 2026-08-25

### Scope and changed files

The four reviewer findings were reproduced and fixed without changing Task 2,
Task 4, generated output, governance, release identity or any runtime owner.
This fix round changed only:

- `src/ui/galaxy-view.js`;
- this Task 5 report.

The existing one Canvas, one main 2D context, one listener set, one observer
pair and one requestAnimationFrame scheduler lifecycle remains unchanged.

### Fixes

1. The existing `parseRgb` helper now accepts deterministic three- and
   six-digit hexadecimal CSS colors before using its existing numeric RGB
   parsing path. `--text-primary: #000000` therefore supplies black label and
   atmospheric-star RGB values in light mode; no theme or color owner was
   added.
2. The stable layout signature now includes `mfccComplete`, `coverage` and
   `confidence` in addition to the existing stable key, BPM, genre and MFCC
   values. A completeness-only change therefore rebuilds point geometry,
   opacity and coverage/status data while unchanged snapshots still skip the
   layout build.
3. Tooltip content is assembled once and compared with the existing node's
   `textContent`. A pinned stable identity now refreshes when title, artist,
   genre, BPM or language-derived labels change. The node remains
   `textContent`-only and retains the same concise fields.
4. A background click now clears `pinnedKey` regardless of current pointer
   speed. The 900 CSS px/s gate remains in force only when a point candidate
   would create or replace a pin.

### RED evidence

A no-write Node `vm` probe loaded the real View source with deterministic
DOM/Canvas stubs. Before the fix it returned exit code 1:

```text
FAIL light-theme label color: hex --text-primary was not rendered as black
FAIL MFCC completeness refresh: layout was skipped when completeness changed
FAIL pinned tooltip metadata refresh: tooltip kept stale metadata
FAIL fast background click clears pin: background click left pin active
```

### GREEN and targeted verification

The same behavior probe plus one lifecycle assertion returned exit code 0:

```text
PASS light-theme label color
PASS MFCC completeness refresh
PASS pinned tooltip metadata refresh
PASS fast background click clears pin
PASS single lifecycle cleanup
```

The lifecycle assertion verifies idempotent mount, one main context, one
window listener plus the existing four Canvas listeners, observer disconnect,
frame cancellation and listener cleanup on destroy.

Targeted syntax and service checks:

```powershell
& $nodeRuntime --check .\src\ui\galaxy-view.js
$source=(Get-Content .\SOURCE_ORDER.txt | ForEach-Object {Get-Content -Raw $_}) -join "`r`n"
$source | & $nodeRuntime --check -
& $nodeRuntime .\tests\galaxy-runtime.test.js
```

Results: both syntax checks exited 0 with no output; the service regression
exited 0 with `PASS galaxy-runtime pure behavior`.

The existing contract command was also rerun. All Task 5 contracts remain
GREEN; its sole exit-code-1 result remains the downstream Task 6 item:

```text
FAIL
- 7.3.1 engine identity is missing
```

Per the fix-round instruction, no build, architecture-wide rerun, browser,
visual, 4K, 120 Hz or audio-device QA was performed. `build/app.js` was not
edited or regenerated.
