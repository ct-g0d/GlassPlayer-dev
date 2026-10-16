# Module Governance — Peregrine Lake / 7.3.1

This is the permanent authority for module responsibility, source ownership and access. `MODULE_API.md` owns API contracts; `STATE_OWNERSHIP.md` owns mutable-state detail; `DEPENDENCY_GRAPH.md` owns dependency direction.

## Module: core-platform
Layer: Core
Status: Active
Purpose: Creates the sole registry, contracts, bus, actions, Store, selectors, context and shared pure utilities.
Owned files:
- src/core/module-registry.js
- src/core/runtime-constants.js
- src/core/legacy-module-namespace.js
- src/core/utils.js
- src/core/contracts.js
- src/core/event-bus.js
- src/core/actions.js
- src/core/store.js
- src/core/selectors.js
- src/core/app-context.js
Owned responsibilities: dependency construction contracts, serializable state transitions and read-only snapshots.
Owned mutable state: Store state and Event Bus listener sets only.
May write: all Store paths through dispatch; registry during source registration.
May read: initial state supplied by Bootstrap.
Public interfaces: Registry, Event Bus, Actions, Store, Selectors, App Context.
Emits: events supplied by callers only.
Listens: none.
Allowed dependencies: browser JavaScript primitives.
Forbidden dependencies: DOM Views, IndexedDB, AudioNode, concrete Services.
Authorized callers: Bootstrap, Services, Views through documented APIs.
Forbidden callers or access: direct mutation of Store snapshots or registry entries.
Lifecycle: one registry and one Store; bus listeners must unsubscribe.
Public API document: MODULE_API.md / Core.
Contract tests: tests/contract-tests.ps1 core checks.
Last verified: 2026-07-22; 6.4.0; registry uniqueness, store snapshot and source-order checks.
Notes: `legacy-module-namespace.js` preserves the verified `GP.modules` compatibility name only.

## Module: browser-adapters
Layer: Adapter
Status: Active
Purpose: Isolates IndexedDB, local file selection, PiP, Media Session and clock capabilities behind Browser Ports.
Owned files:
- src/adapters/browser/storage-adapter.js
- src/adapters/browser/storage-port.js
- src/adapters/browser/file-adapter.js
- src/adapters/browser/pip-adapter.js
- src/adapters/browser/media-session-adapter.js
- src/adapters/browser/clock-adapter.js
Owned responsibilities: browser API access and unchanged persistence transactions.
Owned mutable state: IndexedDB connection promise and native transaction lifetime.
May write: existing IndexedDB stores and native browser capability state.
May read: existing IndexedDB stores, selected files and browser capabilities.
Public interfaces: StoragePort, FilePort, PiPPort, MediaSessionPort, ClockPort.
Emits: none directly.
Listens: none.
Allowed dependencies: Core contracts and browser APIs.
Forbidden dependencies: Views, Queue, playback policy, recommendation policy.
Authorized callers: Services and Bootstrap.
Forbidden callers or access: UI direct IndexedDB/localStorage access for new code.
Lifecycle: one storage adapter; file listeners are once-only; native resources are disposed by owning Service.
Public API document: MODULE_API.md / Browser Ports.
Contract tests: storage method/schema and capability guard checks.
Last verified: 2026-07-22; 6.4.0; no database name/version/store/index changes.
Notes: Future Electron replaces adapters, not contracts.

## Module: audio-engine
Layer: Engine
Status: Active
Purpose: Owns the single AudioContext, dual Deck graph, output, analysis tap and crossfade runtime.
Owned files:
- src/engines/audio-engine.js
- src/engines/audio-engine-port.js
Owned responsibilities: media loading, transport execution, volume and crossfade graph control.
Owned mutable state: `audioCtx`, Deck A/B, gains, analyser, active deck and crossfade timers.
May write: engine-private nodes and runtime playback state.
May read: selected track source and settings commands.
Public interfaces: init, loadTrack, play, pause, seek, setVolume, startCrossfade, stop, destroy, getRuntimeSnapshot.
Emits: playback/crossfade events through Playback Service.
Listens: Service commands.
Allowed dependencies: Core contracts, browser media primitives, EQ/Spatial engines.
Forbidden dependencies: View DOM, IndexedDB, History UI.
Authorized callers: Playback and Settings Services.
Forbidden callers or access: raw node/deck access outside the engine.
Lifecycle: lazy one-context initialization; destroy releases timers/nodes.
Public API document: MODULE_API.md / Engines.
Contract tests: one-context and no-raw-node snapshot checks.
Last verified: 2026-07-23; 6.4.4; one static per-deck normalization gain inserted before the existing crossfade gain.
Notes: normalization is user-controlled, fixed per track and bypassed at 0 dB when disabled.

## Module: bionic-engine
Layer: Engine
Status: Active
Purpose: Unifies audio essence recognition (Bionic ID), acoustic spectrum analysis (Signal), listening DNA neural modeling, and fusion queue flow into the central Bionic intelligence engine.
Owned files:
- src/engines/bionic-engine.js
- src/engines/bionic-engine-port.js
Owned responsibilities: audio payload anchors, Spectrum/Bionic ID, audio essence identity, feature record creation, analysis caching, taste modeling, and flow orchestration.
Owned mutable state: transient decode/calculation buffers and analyzer runtime bindings.
May write: feature and cache records through StoragePort callers; returns analysis to services.
May read: audio file bytes, track audio, and existing cache.
Public interfaces: recognizeAudioEssence, detectAudioPayload, extractFileMetadata, extractGenre, analyze, readCached, processPending, getVersion.
Emits: none directly.
Listens: Library, Spectrum, Neural and Queue Service commands.
Allowed dependencies: Core constants, StoragePort, database adapters.
Forbidden dependencies: DOM Views, direct playback execution, native UI manipulation.
Authorized callers: Library, Spectrum, Neural and Queue Services.
Forbidden callers or access: UI direct analysis or essence mutation.
Lifecycle: stateless except runtime binding; transient calculation buffers released after analysis.
Public API document: MODULE_API.md / Bionic Engine.
Contract tests: stable identity/schema, spectrum version and cache hit checks.
Last verified: 2026-10-16; 7.6.1; Bionic Engine consolidates Recognition, Spectrum, Neural and Fusion.
Notes: Non-destructive consolidation of intelligence and flow engines.
## Module: spatial-engine
Layer: Engine
Status: Active
Purpose: Owns fixed EQ filter application, seven-band filter runtime, Spatial 1.1 A/B bus runtime and user-commanded mode transitions.
Owned files:
- src/engines/spatial-engine.js
- src/engines/spatial-runtime-port.js
Owned responsibilities: EQ filter creation, preset/custom gain application, EQ control rendering bridge, true bypass, fixed preset application and 400 ms equal-power switching.
Owned mutable state: filter nodes, active gains, custom gains, selected preset key, Spatial buses, IR bank, current/queued mode and Dreamscape LFO.
May write: EQ AudioParams, Spatial AudioParams and settings persistence through existing Settings bridge.
May read: Data EQ presets, fixed Spatial preset data and explicit settings commands.
Public interfaces: setEQ, buildEQFilters, applyEQPreset, setEnabled, setMode, getSnapshot, destroy.
Emits: settings state via Settings Service.
Listens: explicit user commands only.
Allowed dependencies: Audio Engine, Data presets (EQ and Spatial), shared controls.
Forbidden dependencies: realtime RMS/correlation tuning, Views, Queue, Genre/BPM/MFCC automation.
Authorized callers: Audio, Settings and Sound Views/Services.
Forbidden callers or access: raw bus/filter node access.
Lifecycle: filters follow the one AudioContext; inactive bus disconnected; LFO only in Dreamscape; destroy stops resources.
Public API document: MODULE_API.md / Spatial Engine.
Contract tests: preset count/value, one-chain, true bypass, fixed parameter and one-active-bus checks.
Last verified: 2026-10-16; 7.6.1; Equalizer merged into Spatial Engine.
Notes: Combines 7-band EQ and Spatial A/B bus into unified post-fader DSP engine.
## Module: motion-engine
Layer: Engine
Status: Active
Purpose: Supplies shared view, sector and popover transition primitives.
Owned files:
- src/engines/motion-engine.js
Owned responsibilities: exposes existing Motion lifecycle without owning product state.
Owned mutable state: animation handles owned by Views.
May write: CSS classes/styles through authorized View calls.
May read: rendered geometry.
Public interfaces: transitionView, transitionSector, setPopover, refresh.
Emits: none.
Listens: View commands.
Allowed dependencies: Core clock and UI shared controls.
Forbidden dependencies: Audio, persistence, recommendation.
Authorized callers: Views.
Forbidden callers or access: Services.
Lifecycle: Views cancel animations on destroy.
Public API document: MODULE_API.md / Motion Engine.
Contract tests: transition idempotence and listener-count checks.
Last verified: 2026-07-22; 6.4.0; timing parameters unchanged.
Notes: none.

## Module: playback-service
Layer: Service
Status: Active
Purpose: Owns user playback intent and coordinates Queue with Audio Engine.
Owned files:
- src/services/playback-runtime.js
- src/services/playback-service.js
Owned responsibilities: play/pause/track navigation/seek/volume commands and intent token sequencing.
Owned mutable state: Store playback paths; private intent tokens remain runtime guards.
May write: playback.*, library.currentTrackId.
May read: library tracks, queue resolution and settings playback fields.
Public interfaces: play, pause, toggle, playTrack, next, previous, seek, setVolume, getSnapshot.
Emits: playback events.
Listens: UI, PiP and Media Session commands.
Allowed dependencies: Store, Selectors, Queue Service, Audio Engine, Event Bus.
Forbidden dependencies: concrete View DOM, IndexedDB native API, raw AudioNodes.
Authorized callers: Player View, PiP Service, Media Session Adapter.
Forbidden callers or access: direct mutation of Queue arrays or engine nodes.
Lifecycle: created once; engine lifecycle delegated.
Public API document: MODULE_API.md / Playback Service.
Contract tests: intent routing, next/previous and event emission.
Last verified: 2026-07-22; 6.4.0; existing command runtime moved without reorder.
Notes: compatibility `currentIndex` remains lexical, not global.

## Module: queue-service
Layer: Service
Status: Active
Purpose: Owns manual Queue priority, reorder, bounded Shuffle navigation, user playlists and the liked-songs set.
Owned files:
- src/services/queue-runtime.js
- src/services/queue-service.js
Owned responsibilities: add/play-next/remove/clear/reorder/resolution and restoration; playlist create/rename/delete/member edits; like/unlike derivation.
Owned mutable state: queue.items, manual flags, resume target, shuffle timeline/cursor, playlist record cache, liked-key set, collection mode.
May write: queue.*, the `userPlaylists` recommendations record, `like` behavior events.
May read: library tracks and playback mode/current track.
Public interfaces: add, playNext, remove, clear, reorder, resolveNextTrack, resolvePreviousTrack, getVisibleQueue, restoreLibraryOrder.
Emits: queue-related playback decisions through callers.
Listens: Playback/UI commands.
Allowed dependencies: Store, Selectors, Library summaries, StoragePort behavior/recommendation records.
Forbidden dependencies: DOM, AudioNode, IndexedDB native API, schema/version changes.
Authorized callers: Playback Service and Queue View.
Forbidden callers or access: direct array mutation by Views.
Lifecycle: one queue; drag resources owned by Queue UI and released after pointer end.
Public API document: MODULE_API.md / Queue Service.
Contract tests: duplicate, priority, clear, reorder and shuffle-back tests.
Last verified: 2026-07-22; 6.4.0; one `playQueue` implementation.
Notes: none.

## Module: library-service
Layer: Service
Status: Active
Purpose: Owns import, de-duplication, metadata scheduling, sorting and rescanning.
Owned files:
- src/services/library-runtime.js
- src/services/library-service.js
Owned responsibilities: File ingestion, Track creation, identity association and analysis scheduling.
Owned mutable state: library tracks, import status, reservations and sort mode.
May write: library.*, analysis pending via Spectrum Service commands.
May read: files, Recognition results and Track Cache.
Public interfaces: pickFiles, pickFolder, importFiles, rescan, sort, search, getTracks.
Emits: library:import-completed.
Listens: Library View commands.
Allowed dependencies: FilePort, StoragePort, Recognition Engine, Spectrum Service, Store.
Forbidden dependencies: raw AudioNodes, History View, direct PiP.
Authorized callers: Library View and Bootstrap import hooks.
Forbidden callers or access: direct hidden-input access outside FilePort for new code.
Lifecycle: import reservations released on completion/error.
Public API document: MODULE_API.md / Library Service.
Contract tests: import, duplicate, cache, sort and rescan tests.
Last verified: 2026-07-22; 6.4.0; metadata and identity algorithms unchanged.
Notes: none.

## Module: history-service
Layer: Service
Status: Active
Purpose: Settles true listening time, reconciles identities and supplies listening statistics.
Owned files:
- src/services/history-service.js
- src/services/history-service-port.js
Owned responsibilities: checkpoints, play counts, ranges, favorites, charts, yearly aggregation/report export and history metadata reconciliation.
Owned mutable state: private history cache, revisions and checkpoint timestamps.
May write: existing history persistence and history View output.
May read: playback events, library identity summaries and ClockPort.
Public interfaces: checkpoint, incrementPlayCount, render, getSnapshot, destroy.
Emits: none currently.
Listens: playback events and history filters.
Allowed dependencies: StoragePort, ClockPort, Selectors.
Forbidden dependencies: raw Deck/AudioNode or Queue mutation.
Authorized callers: Playback Service and History View.
Forbidden callers or access: UI direct cache mutation.
Lifecycle: flush checkpoint before pause/end/unload; dispose timers.
Public API document: MODULE_API.md / History Service.
Contract tests: no false time, range and identity reconciliation tests.
Last verified: 2026-07-22; 6.4.0; existing records untouched.
Notes: none.

## Module: neural-service
Layer: Service
Status: Active
Purpose: Records behavior, evolves the local user model and produces confidence-gated recommendations.
Owned files:
- src/services/neural-runtime.js
- src/services/neural-service.js
Owned responsibilities: behavior weighting, decay, confidence, exploration and Daily Mix scoring.
Owned mutable state: behavior/model/recommendation records through StoragePort.
May write: behaviorEvents, userModel, recommendations.
May read: Track features, history aggregates and time context.
Public interfaces: recordBehavior, generateDailyMix, getUserModel.
Emits: none currently.
Listens: user and playback behavior events.
Allowed dependencies: StoragePort, Spectrum features, History summaries, ClockPort and read-only Genre Relations data.
Forbidden dependencies: direct playback control or manual Queue reorder.
Authorized callers: UI behavior bridge and History Service.
Forbidden callers or access: algorithm intervention before confidence gate.
Lifecycle: no permanent analysis timer.
Public API document: MODULE_API.md / Neural Service.
Contract tests: decay, skip ratio, confidence fallback and queue isolation.
Last verified: 2026-07-23; 6.4.4; confidence gate 0.70, offline Genre proximity scoring and bounded transient caches verified.
Notes: pre-gate Shuffle remains uniform random.

## Module: spectrum-service
Layer: Service
Status: Active
Purpose: Coordinates feature cache, analysis queue, persistence and completion events.
Owned files:
- src/services/spectrum-service.js
Owned responsibilities: analyzer scheduling and success/failure notification.
Owned mutable state: analysis Store paths.
May write: analysis.* and feature cache via StoragePort.
May read: track summaries and cached features.
Public interfaces: analyze, readCached, processPending.
Emits: analysis:completed, analysis:failed.
Listens: Library import completion.
Allowed dependencies: Store, Event Bus, Spectrum Analyzer, StoragePort.
Forbidden dependencies: View DOM, Queue mutation, playback control.
Authorized callers: Library and Neural Services.
Forbidden callers or access: UI direct Analyzer internals.
Lifecycle: pending work releases buffers after completion.
Public API document: MODULE_API.md / Spectrum Service.
Contract tests: cache-hit, success/failure events and no duplicate analysis.
Last verified: 2026-07-22; 6.4.0; feature schemas unchanged.
Notes: none.

## Module: settings-service
Layer: Service
Status: Active
Purpose: Owns settings load/save commands and Engine synchronization.
Owned files:
- src/services/settings-service.js
Owned responsibilities: theme, language, typography, EQ, Spatial and background preference commands.
Owned mutable state: settings.* and unchanged preference record.
May write: settings.* and existing `glassPlayerPrefs` key.
May read: settings snapshot.
Public interfaces: load, save, setTheme, setLanguage, setSpatialEnabled, setSpatialMode, getSnapshot.
Emits: settings:changed.
Listens: Settings View commands.
Allowed dependencies: Store, Event Bus, Audio/Spatial Engines, i18n.
Forbidden dependencies: Queue, History cache, raw IndexedDB.
Authorized callers: Settings View and Bootstrap.
Forbidden callers or access: direct engine-private mutation.
Lifecycle: one settings subscription; auto-theme timer released on unload.
Public API document: MODULE_API.md / Settings Service.
Contract tests: restore, theme/language and Spatial memory checks.
Last verified: 2026-07-22; 6.4.0; keys unchanged.
Notes: none.

## Module: pip-service
Layer: Service
Status: Active
Purpose: Owns traditional PiP creation, rendering synchronization and cleanup.
Owned files:
- src/services/pip-runtime.js
- src/services/pip-service.js
Owned responsibilities: Canvas/Video/stream lifecycle, redraw scheduling and playback command bridge.
Owned mutable state: PiP canvas, context, video, stream track, observers and frames.
May write: PiP native state and PiP-private DOM nodes.
May read: playback/settings snapshots and current track artwork.
Public interfaces: open, close, sync, destroy, getSnapshot.
Emits: pip:opened, pip:closed.
Listens: playback/settings events and PiP controls.
Allowed dependencies: PiPPort, Playback Service, ClockPort, PiP renderer.
Forbidden dependencies: second Audio object, raw IndexedDB, Queue mutation.
Authorized callers: Player View.
Forbidden callers or access: direct Canvas/Video handles.
Lifecycle: destroy removes nodes/listeners/observers/timers and stops stream track.
Public API document: MODULE_API.md / PiP Service.
Contract tests: open/close/sync/resize/cleanup tests.
Last verified: 2026-07-22; 6.4.0; one PiP lifecycle.
Notes: none.

## Module: product-data
Layer: Data
Status: Active
Purpose: Owns read-only language, releases, EQ and Spatial preset definitions.
Owned files:
- src/data/i18n.js
- src/data/releases.js
- src/data/genre-relations.js
- src/data/eq-presets.js
- src/data/spatial-presets.js
Owned responsibilities: bilingual copy, changelog records, immutable presets and the offline Genre/Style relationship graph.
Owned mutable state: i18n original-text WeakMaps only; release/preset data immutable.
May write: translated DOM text through i18n; changelog export Object URL lifecycle.
May read: current language and static data.
Public interfaces: GP.i18n, GP.changelog, GP.genreRelations, GP.eqPresets, GP.spatialPresets.
Emits: none.
Listens: Settings/View commands.
Allowed dependencies: Core utilities and browser DOM for rendering/export.
Forbidden dependencies: AudioNode, Queue mutation, IndexedDB schema.
Authorized callers: Views, Settings and Spatial/EQ Engines.
Forbidden callers or access: mutation of returned release/preset objects.
Lifecycle: export URLs revoked; WeakMaps live with the page.
Public API document: MODULE_API.md / Data and UI.
Contract tests: freeze, bilingual, export and fixed-preset tests.
Last verified: 2026-07-23; 6.4.4; bilingual release history and offline Genre graph retained without rewriting history.
Notes: Shared Read-Only ownership; product-data is primary maintainer.

## Module: ui-platform
Layer: UI
Status: Active
Purpose: Owns shared controls, generic View factories, responsive layout and reusable Motion/SSE wiring.
Owned files:
- src/ui/shared-controls.js
- src/ui/view-factories.js
- src/ui/window-layout.js
Owned responsibilities: gliders, SSE, held press, view transitions, viewport fitting and mount/destroy contracts.
Owned mutable state: DOM references, observer/listener registration, pointer/animation handles.
May write: UI DOM/classes/styles only.
May read: Selector snapshots and rendered geometry.
Public interfaces: View factories and Shared Controls mount/refresh/destroy.
Emits: user commands through Services.
Listens: Store selectors and resize/pointer events.
Allowed dependencies: Core, Motion Engine, Services through public APIs.
Forbidden dependencies: raw AudioNode or IndexedDB.
Authorized callers: Bootstrap and concrete Views.
Forbidden callers or access: Services manipulating View DOM.
Lifecycle: every mounted resource must have one destroy path.
Public API document: MODULE_API.md / Data and UI.
Contract tests: idempotent mount, destroy and no-duplicate-listener checks.
Last verified: 2026-07-22; 6.4.0; original Motion/SSE order and parameters preserved.
Notes: none.

## Module: player-views
Layer: UI
Status: Active
Purpose: Owns Player artwork/background, Sound, Library and Settings DOM behavior.
Owned files:
- src/ui/player-visuals.js
- src/ui/sound-view.js
- src/ui/library-view.js
- src/ui/settings-view.js
Owned responsibilities: render and bind only the corresponding visible surfaces.
Owned mutable state: View DOM references and animation/input state.
May write: ui.* through commands and its own DOM.
May read: Store selectors and frozen Service snapshots.
Public interfaces: mount, render, refresh, destroy through View factories.
Emits: user commands to Playback, Library and Settings Services.
Listens: selector changes and authorized DOM events.
Allowed dependencies: UI Platform, Motion Engine, Services, Data.
Forbidden dependencies: raw AudioNode, native IndexedDB and Service private state.
Authorized callers: Bootstrap.
Forbidden callers or access: Engines calling Views.
Lifecycle: release listeners/observers/timers on destroy.
Public API document: MODULE_API.md / Views.
Contract tests: all View smoke, language/theme and resize tests.
Last verified: 2026-07-22; 6.4.0; DOM and CSS unchanged.
Notes: source was split at existing comment boundaries without declaration reordering.

## Module: changelog-view
Layer: UI
Status: Active
Purpose: Owns release navigation, detail transitions and export-button binding.
Owned files:
- src/ui/changelog-view.js
Owned responsibilities: Changelog glider, release rendering lifecycle and export action.
Owned mutable state: glider timers and View transition handles.
May write: Changelog DOM and ui.activeView.
May read: read-only releases and language.
Public interfaces: refresh/destroy through View factory.
Emits: none.
Listens: release selection and export clicks.
Allowed dependencies: Product Data, Motion Engine, UI Platform.
Forbidden dependencies: Audio, Queue, IndexedDB.
Authorized callers: Bootstrap.
Forbidden callers or access: Services.
Lifecycle: timers canceled on teardown.
Public API document: MODULE_API.md / Views.
Contract tests: release selection/export/glider tests.
Last verified: 2026-07-23; 6.4.4; current release retains the localized project-origin modal and right-aligned signature.
Notes: none.

## Module: pip-renderer
Layer: UI
Status: Active
Purpose: Supplies pure PiP geometry, text-fit and cover drawing helpers.
Owned files:
- src/ui/pip-renderer.js
Owned responsibilities: stateless canvas drawing helpers only.
Owned mutable state: none.
May write: caller-provided Canvas context.
May read: passed dimensions/text/image.
Public interfaces: roundedRect, fitText, drawCover, calculateLayout.
Emits: none.
Listens: none.
Allowed dependencies: Canvas 2D API.
Forbidden dependencies: PiP lifecycle, playback, Store, persistence.
Authorized callers: PiP Service.
Forbidden callers or access: none beyond API.
Lifecycle: none.
Public API document: MODULE_API.md / GP.pipRenderer.
Contract tests: pure layout and truncation tests.
Last verified: 2026-07-22; 6.4.0; implementation unchanged.
Notes: Shared Read-Only helper.

## Module: bootstrap
Layer: Bootstrap
Status: Active
Purpose: Performs the one application initialization and dependency injection sequence.
Owned files:
- src/bootstrap/main.js
Owned responsibilities: existing UI init, one Context creation and GP compatibility/public facade publication.
Owned mutable state: none after construction.
May write: one-time module instances and read-only facade properties.
May read: all factory contracts and initial runtime snapshots.
Public interfaces: read-only `window.GP`; App Context remains Bootstrap-private.
Emits: startup through constructed modules.
Listens: none directly.
Allowed dependencies: all lower layers through factories.
Forbidden dependencies: creating duplicate Store, AudioContext, Queue, listener set or persistence runtime.
Authorized callers: script load only.
Forbidden callers or access: repeated manual bootstrap.
Lifecycle: executes once at body-end synchronous script load.
Public API document: MODULE_API.md / Compatibility policy.
Contract tests: single-IIFE, single-bootstrap and facade freeze checks.
Last verified: 2026-07-22; 6.4.0; one initialization path.
Notes: `build/app.js` is the only runtime script.

## Architecture Change Log

- Date: 2026-10-16
- Version: 7.6.1 ENGINE RESTRUCTURING / GP Core 4.3 / GP Bionic Engine 1.0
- Modification: consolidated engines: merged Equalizer into Spatial Engine; consolidated Recognition Engine, Spectrum Analyzer, Neural Engine, and Fusion Engine into unified Bionic Engine; preserved Motion Engine.
- Modules: equalizer-engine retired into spatial-engine; recognition-engine and spectrum-analyzer retired into bionic-engine.
- State ownership change: none; audio graph, IndexedDB stores, and feature records preserved without schema drift.
- API change: Spatial Engine adds setEQ; Bionic Engine provides unified recognition, spectrum analysis, neural taste modeling, and flow orchestration.
- Dependency change: source fragments consolidated from 55 to 52; governance modules consolidated from 22 to 20.
- Compatibility: Web Audio graph order, EQ curve geometry, presets, True Bypass, Spectrum ID, Neural model token v4, and 120Hz motion preserved.
- Verification: build, architecture validation (52 sources / 20 modules), contract tests (261 contracts), and node regression test suites all pass.
- Date: 2026-09-18
- Version: 7.4.0 典藏更新 / GP Core 4.2 / GP Fusion Engine 4.1
- Modification: added Queue-owned user playlists plus like/unlike signals, History-owned yearly report with windowed auto-open and standalone HTML export, a Player lossless badge and missing-font fallback feedback.
- Modules: queue-service, history-service, neural-service, player-views, product-data and bootstrap.
- State ownership change: playlists live in one `userPlaylists` recommendations record; likes derive from `like` behavior events. No IndexedDB version/store/index change.
- API change: none to the formal module facades; legacy runtime gains playlist/like/annual helpers under existing owners.
- Dependency change: none new; Queue reads behavior/recommendation records through the existing storage boundary.
- Compatibility: IndexedDB, localStorage, Spectrum identity/algorithm token, Neural model token, history, Queue, events and the one audio graph remain unchanged.
- Verification: build, architecture validation and contract tests were run for this change; browser, audio, 4K and 120 Hz checks remain user-verified.

- Date: 2026-09-17
- Version: 7.3.2 STABILITY UPDATE / GP Core 4.2 / GP Fusion Engine 4.1
- Modification: removed the Music Galaxy Service and Galaxy View; Daily Mix uses local cached-feature similarity plus offline Genre Relations. Playback keeps natural-ended intent so tracks advance; import closes the dialog before background spectrum analysis completes.
- Modules: music-galaxy-service removed; neural-service, player-views, product-data and bootstrap updated.
- State ownership change: none.
- API change: Candidate `featureVector`, `compareTracks`, `buildLayout` and `recommendationSimilarity` interfaces are retired with the service.
- Dependency change: Neural/Daily Mix no longer consumes Galaxy similarity; offline Genre Relations remain its only data dependency.
- Compatibility: IndexedDB, localStorage, Spectrum identity/algorithm token, Neural model token, history, Queue, events and the one audio graph remain unchanged.
- Verification: build, architecture validation and contract tests were run for this change; browser, audio, 4K and 120 Hz checks remain user-verified.

- Date: 2026-08-25
- Version: 7.3.1 GALAXY UPDATE / GP Fusion Engine 4.0 / GP Spectrum Engine 2.3 / GP Neural Engine 2.2
- Modification: documented the already-implemented pure Music Galaxy Service and its shared similarity use by Galaxy View and Neural/Daily Mix.
- Modules: music-galaxy-service, neural-service, player-views, product-data and bootstrap.
- State ownership change: none; the service is stateless and consumes cached track snapshots without becoming a Store or persistence owner.
- API change: Candidate `featureVector`, `compareTracks`, `buildLayout` and `recommendationSimilarity` interfaces are documented with deterministic fallback compatibility.
- Dependency change: Music Galaxy Service may feed Galaxy View and Neural/Daily Mix and may read bundled offline Genre Relations; DOM, storage, audio and network access remain forbidden.
- Compatibility: IndexedDB, localStorage, Spectrum identity/algorithm token, Neural model token, history, Queue, events and the one audio graph remain unchanged.
- Verification: Task 7 ran the release/documentation contract and focused static searches only; build, architecture, browser, audio, 4K and 120 Hz checks were not run.

- Date: 2026-07-31
- Version: 7.0.2 HOTFIX BUILD / GP Motion Engine 4.0
- Motion refresh contract: all visual motion must use CSS transitions/animations, Web Animations API, or `requestAnimationFrame`; it must follow the display refresh cadence up to 120 Hz and must not emulate frames with fixed 60 Hz `setInterval`, `setTimeout(16.67)`, or frame-skipping counters.
- Timing contract: animation duration is expressed in elapsed time, never in frame counts. A 500 ms motion therefore keeps the same path and duration at 60 Hz, 90 Hz and 120 Hz while receiving the native number of presentation frames.
- Performance contract: visual work scheduled by `requestAnimationFrame` must remain bounded and avoid synchronous layout loops. Audio diagnostics and persistence timers are not visual-animation schedulers and remain outside this contract.
- Verification: contract tests scan known visual-motion modules for fixed 60 Hz schedulers and require the Core `GP_MOTION_CONTRACT`.

- Date: 2026-07-23
- Version: 6.4.4 HOTFIX BUILD / GP Spectrum Engine 2.1 / GP Neural Engine 2.1
- Modification: added a read-only offline Genre graph, fixed cached loudness normalization, stricter recommendation confidence and small History/UI repairs.
- Modules: product-data, neural-service, spectrum-analyzer, audio-engine, history-service, player-views and changelog-view.
- State ownership change: one boolean preference is added to the existing `glassPlayerPrefs`; no new store, database or runtime owner is created.
- API change: `GP.genreRelations` is Candidate read-only data; existing public playback and data keys remain compatible.
- Dependency change: Neural Service may read Product Data genre relationships; no runtime network dependency is introduced.
- Compatibility: Spectrum ID, original Loudness, MFCC/BPM/Energy, Queue, listening history and IndexedDB schema remain in place.

- Date: 2026-07-22
- Version: 6.4.4 HOTFIX BUILD / GP Core 4.0
- Modification: established Peregrine Lake formal source layers, factories, Ports, Services, Store and permanent governance.
- Modules: all modules listed above.
- Files: moved verified source from `src/js` and `src/modules`; created formal Core/Adapter/Engine/Service/UI/Data/Bootstrap files; removed emptied legacy directories.
- Responsibility change: environment access and public commands now have explicit Port/Engine/Service facades; original runtime remains the single implementation.
- State ownership change: serializable public snapshot belongs to the one Store; runtime resources stay private to their existing owner.
- API change: new APIs are Experimental/Candidate; existing GP data interfaces remain Stable; `GP.public` and `GP.context` added compatibly.
- Dependency change: formal upward-only dependency direction documented; no known factory cycle.
- Compatibility: `window.GP`, data keys, schemas, audio graph, DOM/CSS and file:// build path retained.
- Tests: architecture validation, deterministic build, JavaScript syntax, contract/static regression; automated file:// browser launch was blocked by browser policy and is recorded in reports.
- Migration bridges pending deletion: lexical compatibility aliases and index-based playback lookup remain one implementation, not dual state; deletion requires a later behavior-tested migration.



