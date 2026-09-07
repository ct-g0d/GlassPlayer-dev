# Glass Player — Current State

Last documentation update: 2026-08-26 (Pacific/Auckland)

The last full build/architecture checkpoint is 2026-08-26 for 7.3.1. The
generated build, architecture, ordered-source syntax and 161 contract checks
pass. Galaxy/import regression tests pass. Browser, audio, 4K and 120 Hz
checks remain unrun.

This file is the short operational snapshot. Read it after AGENTS.md at the
start of every new conversation. It intentionally records current facts, not
the complete historical reasoning; use AI_WORKSPACE_HANDOFF.md for that.

## 1. Release identity

| Field | Current value |
| --- | --- |
| Product | Glass Player Gen 7 |
| Version | 7.3.1 |
| Release name | GALAXY UPDATE |
| Architecture | Peregrine Lake |
| GP Core | 4.1 |
| GP Fusion Engine | 4.0 |
| GP Motion Engine | 4.1 |
| GP Spatial Engine | 1.1 |
| GP Spectrum Engine | 2.3 |
| GP Neural Engine | 2.2 — Resonance Boost |
| Runtime entry | index.html |
| Generated JavaScript | build/app.js |
| Source fragments | 57 |
| Governance modules | 23 |

Current identity must be confirmed in index.html and src/bootstrap/main.js
before a release is described as current. The visible settings card,
changelog data, document title and public facade must not drift.

## 1A. First-read and new-feature gate

Every new conversation reads AGENTS.md, this file and the relevant sections of
AI_WORKSPACE_HANDOFF.md before touching source. Every new feature or fix first
records one canonical owner, allowed consumers, protected blocks/data, API or
event impact, persistence/schema impact and a success criterion. If it does not
fit an existing owner, stop and define a new boundary before implementation.
Before any delivery claim, read and complete DELIVERY_CHECKLIST.md.

Use the short routing rule:

- playback/queue -> Playback or Queue Service plus Audio Engine where needed;
- import/metadata/identity -> Library and Recognition;
- MFCC/BPM/Energy/loudness -> Spectrum Analyzer/Service;
- history/behavior/recommendation -> History and Neural Services;
- EQ/Spatial -> their Engines and data presets;
- theme/layout/motion/SSE/popovers -> Settings, Player Visuals, Motion and
  Shared Controls;
- language/version/changelog -> i18n, releases and all identity surfaces.

## 2. Source map

The active source is assembled in exactly the order listed by SOURCE_ORDER.txt.

| Area | Owner files |
| --- | --- |
| Core state/contracts | src/core/* |
| Browser capability ports | src/adapters/browser/* |
| Audio/EQ/Spatial/Spectrum/Recognition engines | src/engines/* |
| Playback/Queue/Library/History/Neural/Music Galaxy/Settings/PiP services | src/services/* |
| i18n, releases, genre/EQ/Spatial constants | src/data/* |
| Views, shared controls, layout, PiP renderer | src/ui/* |
| Bootstrap and public facade | src/bootstrap/main.js |

Do not edit build/app.js, root app.js or original/Glass Player 6.2.2.html.

## 3. Runtime architecture

There is one runtime implementation with one:

- GPModules registry;
- Store and Event Bus;
- playlist runtime array;
- manual queue;
- shuffle timeline and cursor;
- AudioContext;
- Deck A/B and Crossfade graph;
- EQ graph;
- Spatial A/B bus pair;
- IndexedDB access path;
- Motion/SSE/shared-control system.
- pure deterministic Music Galaxy feature/layout service.

The current Music Galaxy View has a bounded Canvas viewport with wheel zoom,
pointer panning and reset; dense cluster labels are truncated and separated,
and its hover surface uses the shared popover material with title-only copy.
Import cooperative work prefers scheduler/task yields over visible-frame waits.
Resonance Boost and Daily Mix import work share in-flight batch promises and
cache candidate feature/preference scores within a mix build.

The public facade is exposed as window.GP. Services coordinate policy; engines
own technical resources; adapters own browser capabilities; views render and
dispatch commands.

Music Galaxy Service owns `featureVector`, `compareTracks`, `buildLayout` and
`recommendationSimilarity`. Bootstrap supplies frozen cached track snapshots
to Galaxy View, and Galaxy View passes its frozen track snapshots through the
service. Neural/Daily Mix may instead provide caller-owned feature projections
to the same pure comparison API; those projections are inputs, not service
state or a second cache. The service may read bundled offline Genre Relations
only. Galaxy View and Neural/Daily Mix are its allowed consumers; DOM, storage,
audio and network dependencies are forbidden, and the service never mutates
caller inputs.

## 3A. Protected blocks

Existing panels, sectors, shells, sidebars, queue surfaces, history panes,
popovers and player surfaces are protected blocks. A feature must attach to the
existing owner/component contract. Do not reorder their DOM, rename their
selectors, change unrelated dimensions/overflow/stacking, duplicate a shell
or backdrop, or use a global style to fix one local block. A cross-panel change
requires an explicit contract and regression checks for every affected block.

## 4. Persistence facts

IndexedDB:

- name: glass-player-gen4;
- version: 5;
- existing stores: trackFeatures, behaviorEvents, userModel,
  recommendations and trackCache;
- existing indexes and key paths are part of the compatibility contract.

localStorage keys:

- glassPlayerHistory;
- glassPlayerPrefs;
- glassPlayerSidebarCollapsed.

The browser's IndexedDB/localStorage and the user's music files are not stored
inside this project directory. Access to the folder does not migrate them.
Never clear, reset, rename or silently migrate them.

Track identity is based on stable audio recognition/cache fields, not merely
the mutable title or artist string. A metadata rescan must preserve old
history linkage.

## 5. Audio and analysis

Pipeline:

Audio source -> Deck A/B -> Crossfade -> EQ -> Loudness normalization ->
Spatial -> final protection -> master output.

The Audio Engine owns one AudioContext and the two decks. Spatial is fixed and
user-commanded; it must not tune Width, HRTF, Reverb, Chorus or gain from
realtime RMS, correlation, Genre, BPM or MFCC.

Spectrum data is cached locally:

- Spectrum ID/audio essence identity;
- metadata and cover;
- MFCC;
- BPM;
- Energy;
- original loudness;
- derived normalization gain where applicable.

Read cache before decoding. Analyze only missing or stale records.

## 6. Queue and playback

Playback modes:

- Sequential;
- Shuffle;
- Repeat One.

The normal queue view follows the library order and locates the current track.
Manual queue has its own priority/resume behavior. Shuffle preserves its
timeline/cursor semantics. Do not add another queue array in a view or feature.

Keyboard contract:

- Space and F10: play/pause;
- F9/F11 bindings were removed;
- Media Session actions remain supported.

## 7. History and Resonance Boost

Listening completion uses accumulated progress reaching 75% of the track. Skip
penalties depend on listened fraction. History ranges must distinguish today,
calendar week/month/year and all-time where the UI requests those ranges.

Neural state separates:

1. long-term preference;
2. session preference;
3. exploration;
4. recommendation score.

The model uses cached audio features, behavior events and time context. It
decays, requires confidence, and must not influence shuffle until mature. An
immature model preserves the original random behavior.

## 8. Motion and SSE snapshot

Motion target is refresh-driven with a 120 Hz ceiling contract. No fixed frame
count loops are allowed.

SSE is implemented by Shared Controls:

- stationary gp-sse-shell owns background, border, radius, shadow and isolation;
- transparent gp-sse-viewport owns scroll;
- top/middle/bottom are detected from scrollTop/clientHeight/scrollHeight;
- endpoint masks disappear when that endpoint is not clipped;
- updates are scheduled through requestAnimationFrame after scroll, resize,
  mutation and view changes;
- no guessed color, white/black strip, second blur layer or view-specific SSE.

New scroll surfaces must use the existing selector registration and shell
mapping. The full SSE contract is in AGENTS.md and the detailed handoff.

## 9. Current changelog and UI contracts

- Changelog data source: src/data/releases.js.
- Current hierarchy: Gen -> minor -> patch.
- The font picker offers Apple System Font, Mi Sans, Cascadia Code, Trebuchet MS,
  Quicksand and New York; Microsoft System Font is not offered. Apple System
  Font is a role-based profile using SF Pro, SF Pro Display, SF Pro Text,
  PingFang SC/TC/HK and SF Mono; other choices remain single font stacks.
- Changelog keeps the Gen -> minor -> patch hierarchy without a selected leaf
  sidebar glider.
- Apple-style release notes use one short overview, named user-facing areas,
  concise Chinese/English parity and newest-first ordering; implementation
  details stay out of the user-facing log.
- 7.3.1 adds the Music Galaxy exploration surface, shares cached acoustic and
  tempo similarity with Daily Mix, and updates visible engine identity to
  Fusion 4.0, Spectrum 2.3 and Neural 2.2. It adds no state, schema, event,
  history, queue, persistence or audio-graph change.
- 7.3.0 improves spatial clarity, recommendation diversity, scroll intent,
  nonlinear EQ control, atomic ambient transitions and seven-column
  high-resolution Library artwork. 7.2.2 remains in the
  historical release list.
- 7.2.2 made import and foreground Spectrum waits safe when the document is
  hidden or minimized, reuses per-file probe reads for slow storage, time-slices
  import-time Daily Mix scoring, and continues the same version with a compact
  Queue-like Daily Mix, a wider Player, matching Library list/Grid controls,
  unified 1360px primary-view widths, independent left/right History scroll
  viewports, scroll-only scrollbar reveal, a stronger active floating-player
  Accent and no Changelog selected-item mask. The Library filter is removed;
  Russian is available beside Chinese and English, language segments are equal
  width, helper microcopy is hidden, font-picker rows use a Chinese-baseline
  height, the wide Grid targets seven cards per row, and Ambient Glow/Cover
  Color use stronger distinct surfaces. PiP visual refresh is isolated at 30Hz;
  playback progress, dragging and page scrolling retain the 120Hz motion
  contract. Delayed media events now honor a paused playback intent across view
  changes, so they cannot trigger an automatic crossfade or next-track resume.
  No persistence, schema, queue or audio graph contract changed.
- 7.2.1 keeps the 7.2 constrained Library and Settings layout, moves the complete
  EQ, Spatial, Loudness and Track Information surface into Settings > Audio,
  normalizes taskbar icon strokes, and splits Listening History into a non-scrolling
  left Top 1–10 column plus a scrollable right ranks 11–50 column. History ranking
  rows no longer display play counts. No persistence, schema, queue or audio graph
  contract changed.
- Scrollbar fade timing is 500 ms.
- Popovers use the shared Snooze material.
- Chinese, English and Russian strings must be complete; Russian may use the
  English fallback for dynamic release or analysis copy, but must not fall back
  to Chinese explanatory copy.
- Titles and controls derive readable text from the surface behind them.

## 10. Known regression-sensitive areas

Treat these as high-risk and test them directly after adjacent changes:

1. Import initialization and first-play responsiveness.
2. Audio clicks/explosions, especially low-frequency transients and Poly Sync.
3. 4K/120 Hz background texture or moire during transitions.
4. Queue auto-positioning after first play, pause/play, seek, next/previous and
   leave/return.
5. View settle twitch and duplicate transition scheduling.
6. EQ/Font/Sort/Speed/Snooze popover material consistency.
7. Light-dark-light accent recalculation.
8. History identity after metadata rename/rescan.
9. Changelog hierarchy/branch motion and release selection behavior.
10. Collapsed sidebar geometry and hover/click state.

These are risk labels, not proof that every listed issue is currently open.
Check the current source and user report before describing a bug as present.

## 11. Required change checklist

Before code:

- classify feature;
- choose one owner module;
- name allowed dependencies;
- list protected modules/data;
- decide whether schema, API, event, UI, version or changelog changes;
- write success criteria.

After code:

- search for duplicate listeners/connections/observers;
- build;
- validate architecture;
- run contract tests;
- run targeted static tests;
- separate unverified Edge/audio/4K claims from verified checks.

## 12. Immediate handoff instruction

For the next task, read:

1. AGENTS.md;
2. this file;
3. DELIVERY_CHECKLIST.md;
4. AI_WORKSPACE_HANDOFF.md sections 5, 6, 8, 9, 12, 13 and 20;
5. SOURCE_ORDER.txt;
6. the actual owner source files.

Do not start by reading every source file. Do not start by modifying generated
output. Do not treat a historical report as current runtime truth.

## 16. 7.3.1 repair checkpoint — 2026-08-26

- PASS — `build.ps1` regenerated `build/app.js` from the authoritative source
  order. Generated build SHA-256:
  `D18B8F1861891ECC84539E0974EBE3AE189E009DF0A50AD6140331DC6B4D3836`.
- PASS — `validate-architecture.ps1`: 57 sources / 23 modules.
- PASS — `tests/contract-tests.ps1`: `PASS`, `Contracts checked: 161`.
- PASS — `tests/galaxy-runtime.test.js` and
  `tests/import-performance.test.js`.
- PASS — Generated `build/app.js` syntax with Node v24.19.0.
- PASS — Galaxy now has bounded zoom/pan, responsive relayout, dense-label
  collision spacing, title-only shared-material hover and a larger responsive
  stage. Typography preview/weights, About details, EQ geometry, Spatial strip
  width and bitrate copy are synchronized with the requested UI.
- PASS — Settings exposes a default Music folder action. Supported browsers
  persist an already-authorized `FileSystemDirectoryHandle` through the
  existing `recommendations` store record; unsupported or ungranted access
  falls back to explicit folder selection without schema/version changes.
- PASS — Import scheduling no longer waits on every visible animation frame;
  Neural/Daily Mix work is coalesced and candidate feature scoring is cached
  within each generated mix.
- NOT RUN — Edge/file:// interaction with real local music, screen-size
  screenshots, audible-device verification, 4K/110% visual comparison and
  120 Hz hardware profiling.
