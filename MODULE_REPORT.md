# Glass Player 6.3.2 Module Report

> Historical third-stage report. The current 6.4.4 authority is `MODULE_GOVERNANCE.md`; current API and validation results are in `MODULE_API.md` and `ARCHITECTURE_VALIDATION_REPORT.md`.

## Release identity

- Product: Glass Player Gen 6
- Release: 6.3.2
- Release name: HARMONIC ENHANCE
- Engine: GP Core 3.2
- Date: 2026-07-22
- Previous architecture release added to Changelog: 6.3.1 / HARMONIC ENHANCE / GP Core 3.1

## 1. Input baseline

- Continued directly from the existing second-stage `GlassPlayer-dev` project.
- Did not recreate `GlassPlayer-dev`.
- Did not restart from the original single-file HTML.
- Did not rerun the first-stage physical split.
- Did not rerun the second-stage mechanical source slicing.
- Did not modify the immutable first-stage `app.js` baseline.
- Did not modify `original/Glass Player 6.2.2.html`.
- Did not modify `app.css`.
- Source of truth for this stage was the existing `src/js` tree plus implementations migrated from it into `src/modules`.

Immutable baseline hashes after completion:

- `app.js`: `D51344E628426EC85ED257FB6E321205F999437950F21D5D2C061CF214BA33B6`
- `app.css`: `079BD1955BEF707A572456B5CBCD097B5B382DD74688482732C4C05FD5424475`
- `original/Glass Player 6.2.2.html`: `B85F8F8D5D944645BD2B79334E40F3F485E8E92748F81B189CF6105925670625`

## 2. Added modules

| Module | Public API | Private data |
|---|---|---|
| `src/modules/00-module-namespace.js` | `GP.modules` | None |
| `src/modules/utils.js` | `clamp`, `formatTime` | None |
| `src/modules/i18n.js` | `tr`, `translateTree`, `applyLanguage`, `getLanguage`, `setLanguage` | `UI_EN`, `i18nTextOriginal`, `i18nAttrOriginal`; the existing outer `uiLanguage` remains the only language state |
| `src/modules/changelog.js` | `getReleases`, `getRelease`, `render`, `exportLog` | `RELEASES`, `RELEASE_EN`, `RELEASE_EN_DETAIL`, selection/render/export helpers |
| `src/modules/spatial-presets.js` | `getPreset`, `getAllPresets`, `getDescription` | Deep-frozen preset table and freeze helper |
| `src/modules/pip-renderer.js` | `roundedRect`, `fitText`, `drawCover`, `calculateLayout` | None |

`ui-static.js` was not created. The current source did not contain a boundary-clear, reusable static UI implementation with a real caller; creating an empty or speculative API would violate this stage's contract.

## 3. Migration map

### GP.utils

- `clamp`
  - Old implementation: `src/js/70-spatial-and-eq.js`, original stage-two line 15.
  - New implementation: `src/modules/utils.js`.
  - Callers: recommendation confidence/score normalization and acoustic inference in `src/js/70-spatial-and-eq.js` (14 call sites).
  - Compatibility alias: `const clamp=(...args)=>GP.utils.clamp(...args)` at `src/js/70-spatial-and-eq.js:15`.
- `formatTime`
  - Old implementation: `fmtTime` in `src/js/60-playback-and-queue.js`, original stage-two line 389.
  - New implementation: `GP.utils.formatTime` in `src/modules/utils.js`.
  - Callers: track duration rendering in `src/js/70-spatial-and-eq.js` and player/PiP time rendering in `src/js/90-ui-motion-and-pip.js` (8 call sites total).
  - Compatibility alias: `const fmtTime=(...args)=>GP.utils.formatTime(...args)` at `src/js/60-playback-and-queue.js:389`.

The aliases contain no state and no duplicate logic. They may be removed only after every remaining direct `clamp(...)` / `fmtTime(...)` caller is intentionally converted and regression-tested.

### GP.i18n

- Old implementation: `UI_EN`, both original-text WeakMaps, `tr`, `translateTree`, and `applyLanguage` in original `src/js/40-spectrum-analysis.js:22-88`.
- New implementation: `src/modules/i18n.js`.
- State ownership: `uiLanguage` remains the single existing state in `src/js/00-preamble.js`; the module does not cache or mirror a second language value.
- Direct public API callers:
  - `GP.i18n.setLanguage`: language segmented control in `src/js/90-ui-motion-and-pip.js`.
  - `GP.i18n.getLanguage`: Spatial information rendering in `src/js/90-ui-motion-and-pip.js`.
  - `GP.i18n.translateTree`: `applyLanguage` inside the module.
  - `GP.i18n.applyLanguage`: the compatibility forwarder used by the existing final initialization flow.
  - `GP.i18n.tr`: the compatibility forwarder used by playback, library/queue, history/neural, settings, PiP and Changelog rendering.
- Compatibility aliases:
  - `tr`: calls from `src/js/60-playback-and-queue.js` (3), `70-spatial-and-eq.js` (26), `80-history-and-neural.js` (22), `90-ui-motion-and-pip.js` (32), plus Changelog internals.
  - `applyLanguage`: final initialization in `src/js/99-init-and-epilogue.js`.
- `translateTree` has no compatibility alias; its real caller now uses the public module API directly.

The `tr` and `applyLanguage` aliases may be removed only after all listed callers are migrated together without changing initialization or dynamic-render semantics.

### GP.changelog

- Old data implementation: `RELEASES`, `RELEASE_EN`, and `RELEASE_EN_DETAIL` in original `src/js/50-i18n-and-changelog.js:2-2726`.
- Old behavior implementation: `selectRelease`, `renderChangelog`, `buildChangelogText`, and `exportChangelog` in original `src/js/50-i18n-and-changelog.js:2800-2853`.
- New implementation: `src/modules/changelog.js`.
- Callers:
  - `getReleases`: the module's render path builds the version index from a frozen, non-mutating view.
  - `getRelease`: the module's selection path resolves the requested version through the read-only API.
  - `render`: language application, build badge navigation, and final initialization.
  - `exportLog`: existing `#exportChangelogBtn` listener in `src/js/50-i18n-and-changelog.js`.
- No RELEASES compatibility copy or dual-write state exists.
- The Changelog glider, Motion sector transition and DOM material remain in their original runtime file and retain their original parameters.

### GP.spatialPresets

- Old implementation: `SPATIAL_MODES` and `SPATIAL_COPY` in original `src/js/90-ui-motion-and-pip.js:92-110`.
- New implementation: `src/modules/spatial-presets.js`.
- Callers:
  - `getPreset`: Spatial Bus configuration, target validation, mode selection, enable/restore validation.
  - `getAllPresets`: Spatial information list rendering.
  - `getDescription`: localized Spatial information descriptions.
- All eight IDs remain: `none`, `desktop`, `studio`, `wide`, `front`, `hall`, `cinema`, `dream`.
- Every Low Side, Mid/High Width, Crossfeed, HRTF, Reflection, Reverb, Chorus and Output Trim value is unchanged.
- AudioNode construction, IR generation, A/B Bus switching, True Bypass, LFO lifecycle and AudioParam automation remain in the original runtime.

### GP.pipRenderer

- Old implementations:
  - `gpPipRoundedRect`: original `src/js/90-ui-motion-and-pip.js:310-312`.
  - `gpPipFitText`: original `src/js/90-ui-motion-and-pip.js:313-315`.
  - `gpPipDrawCover`: original `src/js/90-ui-motion-and-pip.js:316-320`.
  - Inline responsive layout formulas in original `renderTraditionalPiPFrame`.
- New implementation: `src/modules/pip-renderer.js`.
- Callers: the existing `renderTraditionalPiPFrame` uses `calculateLayout`, `drawCover`, `roundedRect`, and `fitText` directly.
- The module accepts complete drawing/layout arguments and does not read playlist, currentIndex, audio, current track, DOM, settings or storage.
- PiP Canvas/Video creation, resize observer, motion frame, cover loading, Media Session, playback control, timers, open/close and cleanup remain in the original runtime.

## 4. SOURCE_ORDER.txt

1. `src/js/00-preamble.js`
2. `src/js/10-state-and-audio-context.js`
3. `src/js/20-database-and-storage.js`
4. `src/js/30-recognition-and-metadata.js`
5. `src/js/40-spectrum-analysis.js`
6. `src/modules/00-module-namespace.js`
7. `src/modules/utils.js`
8. `src/modules/i18n.js`
9. `src/modules/changelog.js`
10. `src/js/50-i18n-and-changelog.js`
11. `src/js/60-playback-and-queue.js`
12. `src/js/70-spatial-and-eq.js`
13. `src/js/80-history-and-neural.js`
14. `src/modules/spatial-presets.js`
15. `src/modules/pip-renderer.js`
16. `src/js/90-ui-motion-and-pip.js`
17. `src/js/99-init-and-epilogue.js`

The existing `GP` product facade is created once in `40-spectrum-analysis.js`; the compatibility namespace and modules are then established before their callers. Changelog rendering functions may close over later-declared Motion helpers, but they are not executed until all source files and declarations have initialized. No module accesses AudioContext, AudioNode, IndexedDB, Queue, current track or DOM during module creation.

## 5. Removed old implementations and duplicate search

- Removed the original UI_EN dictionary, translation WeakMaps and translation functions from `src/js/40-spectrum-analysis.js`.
- Removed the original RELEASES/English data and Changelog render/export functions from `src/js/50-i18n-and-changelog.js`.
- Removed the original Spatial preset/copy tables from `src/js/90-ui-motion-and-pip.js`.
- Removed the original PiP rounded-path, text-fit and cover-draw functions from `src/js/90-ui-motion-and-pip.js`.
- Removed the original clamp and fmtTime logic; only stateless forwarders remain at their old call boundaries.
- Searches confirm one formal `UI_EN`, one set of i18n WeakMaps, one RELEASES dataset, one fixed Spatial preset table, one PiP geometry implementation and one utility implementation.
- `window.GP` is still assigned once. `00-module-namespace.js` uses compatible extension and never overwrites it.
- No parallel, new, refactor, v2 or legacy-copy source tree was created.

## 6. Checkpoint results

| Checkpoint | Result |
|---|---|
| 1 — baseline, plan, namespace, build | Passed |
| 2 — GP.utils | Passed; clamp/formatTime boundary tests match previous behavior |
| 3 — GP.i18n | Passed; one language state, Chinese/English runtime switching and dynamic refresh verified |
| 4 — GP.changelog | Passed; current/history selection, bilingual details and export-success feedback verified |
| 5 — GP.spatialPresets | Passed; eight IDs and representative exact parameters verified; seven visible descriptions rendered |
| 6 — GP.pipRenderer | Passed; layout, clipping and frozen layout result smoke tests passed; lifecycle was not migrated |
| 7 — GP.uiStatic | Not created by design; no eligible implementation with a real caller exists |
| 8 — cleanup and full checks | Passed |

Final automated checks:

- `build.ps1` completed successfully.
- Final `build/app.js` SHA-256: `4BE89CFDCB530B5DE3E3BE62CD574B287BD206291BD329F9BF10E3B9D7961BA8`.
- Node syntax check passed.
- Module smoke tests passed for utils, read-only Changelog data, all Spatial IDs/representative exact values, and PiP layout geometry.
- `build/app.js` contains one outer player IIFE.
- `index.html` loads only `./build/app.js`.
- Local HTTP browser startup reached `Glass Player 6.3.2` with no captured console errors.
- Browser checks verified the 6.3.2 default entry, 6.3.1 history entry, English UI/log details, `Ver. 3.2`, `Current Version 6.3.2`, seven Spatial descriptions and `Complete changelog exported` feedback.
- Direct automated `file://` navigation remains unavailable in the controlled browser environment; relative file loading was preserved and no server-only code, network request or module loader was introduced.

## 7. Product metadata changes

- Product display name changed: No (`Glass Player Gen 6` remains).
- Version changed: Yes, `6.3.0` to `6.3.2`.
- Build card changed: `版本/Ver. 3.0` to `版本/Ver. 3.2`.
- Engine changed: `GP Core 3.0` to `GP Core 3.2`.
- Release name changed: `HARMONIC UPDATE` to `HARMONIC ENHANCE`.
- Changelog entries added: Yes, complete Chinese and English records for 6.3.1 and 6.3.2.
- HTML title, visible release tag, Build Card, `window.GP.version`, `window.GP.engines.core`, current release, export heading and export filename use the 6.3.2 identity.
- Historical release names and entries were not deleted or rewritten.

## 8. Untouched high-risk areas

- Dual Deck and deck ownership
- AudioContext, AudioNode graph, mix bus, master gain and limiter paths
- Playback state, intent tokens, load/next/previous and pause/resume behavior
- Crossfade and deck swap timing
- Queue, manual queue, queue resume and drag behavior
- Shuffle history/timeline
- IndexedDB adapter, database version, object stores and indexes
- Spectrum ID, audioEssenceKey and Track ID
- Metadata import, recognition and file deduplication pipelines
- Spectrum/MFCC/BPM/Energy analysis queues and algorithms
- behaviorEvents, listening-time settlement, userModel and recommendation scoring
- Spatial Bus Runtime, IR generation, A/B transitions and True Bypass
- PiP lifecycle, Canvas/Video ownership, Media Session and playback controls
- Motion parameters, SSE, CSS and visual layout

## 9. Contract declarations

- Changed product functionality: **No**.
- Changed Audio Graph: **No**.
- Changed data schema: **No**.
- Changed user data: **No**.
- Changed IndexedDB or localStorage keys: **No**.
- Changed Spectrum ID or metadata behavior: **No**.
- Changed UI: **No**, except explicitly authorized version/name/Changelog text.
- Created a second source implementation: **No**.
- Created a second state owner: **No**.
- Changed initialization order: **No**, except module definitions are placed before their callers.
- Entered fourth-stage architecture work: **No**.

## 10. Next-stage recommendations — not implemented

The fourth stage should continue from this exact completed `GlassPlayer-dev` project. It must not restart from the original HTML and must not preserve old `src/js` implementations while copying a second formal architecture. Continue one module at a time with build and regression checkpoints.

Suggested order:

1. Event Bus / Store / Contracts
2. Browser Adapter boundaries
3. Spatial Runtime
4. PiP Lifecycle
5. History Rendering
6. Neural Model
7. Spectrum Service
8. Playback Service
9. Library Service
10. Audio Core
11. Queue
12. Storage

Audio Core, Queue and Storage remain the highest-risk areas and should be migrated last.
