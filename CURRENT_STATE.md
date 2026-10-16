# Glass Player — Current State

Last documentation update: 2026-10-16 (Pacific/Auckland)

The 7.6.2 REBRAND UPDATE checkpoint introduces GP Bionic Engine 1.0,
consolidating track recognition, acoustic spectrum analysis, listening DNA
modeling and queue/playlist flow under one engine, with the equalizer runtime
merged into the Spatial Engine module; engine identity surfaces are
synchronized across the app. The 7.6.1 HOTFIX BUILD checkpoint records
width-aware Sidebar recovery. The
7.6.0 Kinetic Glass checkpoint records the annual report redesign, player title geometry,
settings layout, CJK font fallback, and identity updates on 2026-10-02. The feature
release expands the annual report into a rich chaptered scroll and standalone
long-form export while preserving v7.4.3 dialog dimensions and button placement,
keeps the lossless badge beside an optically centered song title, restores Settings
view centered alignment, provides comprehensive CJK serif and monospace font fallbacks,
and sets the document title strictly to Glass Player. Final verification is recorded
in DELIVERY_CHECKLIST.md. Browser, audio-device, 4K and 120 Hz checks remain unrun.

This file is the short operational snapshot. Read it after AGENTS.md at the
start of every new conversation. It intentionally records current facts, not
the complete historical reasoning; use AI_WORKSPACE_HANDOFF.md for that.

## 1. Release identity

| Field | Current value |
| --- | --- |
| Product | Glass Player Gen 7 · Kinetic Glass |
| Version | 7.6.2 |
| Release name | REBRAND UPDATE |
| Architecture | Peregrine Lake |
| GP Core | 4.3 — Kinetic Runtime |
| GP Bionic Engine | 1.0 — Intelligence Core |
| GP Fusion Engine | 4.2 — Playlist Flow |
| GP Motion Engine | 4.2 — Kinetic Motion |
| GP Spatial Engine | 1.1 — Room |
| GP Spectrum Engine | 2.3 — Signal |
| GP Neural Engine | 2.2 — Listening DNA |
| Runtime entry | index.html |
| Generated JavaScript | build/app.js |
| Source fragments | 52 |
| Governance modules | 20 |

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

Import closes its dialog after library commit, render, history sync, model
refresh and Daily Mix finalization; spectrum analysis continues in the
background slot and refreshes Daily Mix when done. Resonance Boost and Daily
Mix import work share in-flight batch promises and cache candidate
feature/preference scores within a mix build.

The public facade is exposed as window.GP. Services coordinate policy; engines
own technical resources; adapters own browser capabilities; views render and
dispatch commands.

Music Galaxy Service is removed in 7.3.2. Daily Mix computes similarity from
local cached features (MFCC, genre, tempo) plus the bundled offline Genre
Relations graph only; it owns no persistent or mutable product state beyond
the existing recommendation records.

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
- 7.3.2 removes the Music Galaxy surface and its service/view; Daily Mix
  keeps cached-feature similarity with offline genre relations, natural track
  endings keep playback intent so playback advances, and import closes its
  dialog before background spectrum analysis completes.
- 7.4.0 adds Queue-owned user playlists plus per-row likes (Resonance Boost
  learns `like` at +3.0, `unlike` persists without model impact), a History
  yearly report with a Dec 31–Jan 14 auto-open window and standalone HTML
  export, a Player lossless badge for FLAC, and missing-font fallback
  feedback. Playlists reuse the existing recommendations record; no
  IndexedDB schema change.
- 7.6.1 collapses the Sidebar only when the music area becomes too narrow,
  without overwriting the saved Sidebar preference, and restores that preference
  when the window width recovers.
- 7.6.2 introduces GP Bionic Engine 1.0 — Intelligence Core, consolidating
  recognition, spectrum analysis, neural modeling and queue/playlist flow;
  the equalizer runtime joins the Spatial Engine module. No persistence,
  schema, queue or audio graph contract changed.

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

## 17. 7.3.2 stability checkpoint — 2026-09-17

- PASS — `build.ps1` regenerated `build/app.js` from the authoritative source
  order. Generated build SHA-256:
  `BEE6A28970609FC0799388EB8174BD98C3372CDB6122D71900CE1858B606982E`.
- PASS — `validate-architecture.ps1`: 55 sources / 22 modules.
- PASS — `tests/contract-tests.ps1`: `PASS`, `Contracts checked: 255`.
- PASS — `tests/import-performance.test.js`.
- PASS — Generated `build/app.js` syntax with Node v24.21.0.
- PASS — Music Galaxy Service/View removed from source order, bootstrap,
  Neural, shared controls, DOM, CSS, i18n and governance; Daily Mix uses
  local cached-feature similarity plus offline Genre Relations.
- PASS — Natural `ended`/`pause` keeps playback intent so tracks advance;
  non-integer/out-of-range track indexes are rejected; resuming after `ended`
  takes one toggle.
- PASS — Import dialog closes before background spectrum analysis; per-file
  duration/cover/metadata reads run in parallel with higher concurrency,
  fewer idle yields and paint-confirmed completion.
- NOT RUN — Edge/file:// interaction with real local music, audible-device
  verification, 4K/110% visual comparison and 120 Hz hardware profiling.

## 18. 7.4.0 collection checkpoint — 2026-09-18

- PASS — `build.ps1` regenerated `build/app.js` from the authoritative source
  order (branch test740 working tree).
- PASS — `validate-architecture.ps1`: 55 sources / 22 modules.
- PASS — `tests/contract-tests.ps1`: `PASS`, `Contracts checked: 261`.
- PASS — `tests/import-performance.test.js` and Node syntax checks for the
  changed fragments plus the generated build.
- PASS — User playlists persist in one `userPlaylists` recommendations record
  with stable track keys; likes persist as `like` behavior events and derive
  latest-wins; no IndexedDB schema change.
- PASS — Annual report aggregates existing history by calendar year with a
  Dec 31–Jan 14 auto-open window, a shared-SSE annual scroll surface and a standalone interactive HTML export.
- PASS — Player shows an inline Explicit-style lossless badge on the FLAC title row; font options mark missing families, and missing fonts produce
  a fallback toast instead of silent no-ops.
- NOT RUN — Edge/file:// interaction with real local music, audible-device
  verification, 4K/110% visual comparison and 120 Hz hardware profiling.

## 19. 2026-09-26 focused bug-fix pass

The 7.4.1 pass repaired empty Library collections, stale History labels after metadata refresh, localized annual exports, terminal pause ordering, Russian Settings copy, invalid persisted display preferences, Library search telemetry, queue action copy/counts, annual report bar/rank layout, responsive report export cards, Settings folder/EQ layout, and hidden Player disc motion. Persistence/schema, Store/Event Bus, queue identity, audio graph and DOM contracts remained unchanged. Build/architecture/contract and syntax checks passed; Edge/audio/4K/120 Hz checks remained unrun.

## 20. 7.5.0 Replay Atlas feature checkpoint — 2026-10-02

- PASS — `build.ps1` regenerated `build/app.js` after the annual report,
  title-row, settings alignment, and font fallback changes. Generated build SHA-256:
  `0729FC658A0507E005EF96EA02ABF0731CDE313D4A43D7A5B5F97C17D786DDEE`.
- PASS — `validate-architecture.ps1`: 55 sources / 22 modules.
- PASS — `tests/contract-tests.ps1`: `PASS`, `Contracts checked: 261`.
- PASS — Annual report data remains history-only and local; the modal and
  downloaded HTML expose chaptered rhythm, timeline, rankings, preference,
  audio-profile and privacy sections with reveal/parallax motion while modal dimensions and trigger position stay at the v7.4.3 baseline.
- PASS — Library remains strictly on the stable v7.4.3 baseline; all playlist actions reuse existing Queue Service contracts without schema changes.
- PASS — Song title row uses a three-column grid keeping the song title optically centered with the FLAC lossless badge positioned beside it; Settings view center-alignment restored.
- PASS — Typography settings support category-aware CJK fallbacks for serif (New York -> Songti/SimSun), monospace (Cascadia Code -> Consolas/system mono), and sans-serif typefaces.
- PASS — Product identity is synchronized as `Glass Player Gen 7 · Replay
  Atlas`, version `7.5.0`, release `REPLAY ATLAS`, with document title unified to `Glass Player`.
- NOT RUN — Edge/file:// interaction with real local music, audible-device
  verification, 4K/110% visual comparison and 120 Hz hardware profiling.

## 21. 7.5.1 HOTFIX BUILD — 2026-10-02

- PASS — `build.ps1` regenerated `build/app.js` after the standalone Annual Report
  redesign, History range selector background removal, font picker sizing, Settings
  toggles, and title/lossless alignment. Generated build SHA-256:
  `30CB26BDEC544DEF486EB8B7478006328BD9D4246AF0807B12A3E4E7FC5C02C0`.
- PASS — `validate-architecture.ps1`: 55 sources / 22 modules.
- PASS — `tests/contract-tests.ps1`: `PASS`, `Contracts checked: 261`.
- PASS — Standalone Annual Report downloadable HTML completely redesigned as a
  cinematic obsidian/aurora long scroll with 8 rich story chapters, sticky chapter
  nav, scroll-linked parallax animations, 100% offline self-contained operation,
  and print/save support.
- PASS — History view range selector (`#rangeSeg`) background and shadow removed,
  seamlessly harmonizing with shared segmented control styling.
- PASS — Font picker dropdown options compacted to 38px Chinese-baseline rows with
  expanded portal height, eliminating awkward vertical scrollbars.
- PASS — Song title row keeps the song title optically centered across all lengths
  with balanced offset, placing the FLAC lossless badge immediately adjacent to the
  title without marquee clipping or width collapse.
- PASS — Settings gains fluid 120Hz motion, continuous playback, and keyboard controls
  toggles, plus a reset preferences action.
- NOT RUN — Edge/file:// interaction with real local music, audible-device
  verification, 4K/110% visual comparison and 120 Hz hardware profiling.

## 22. 7.6.0 KINETIC GLASS — 2026-10-05

- PASS — Startup prepaint now applies the saved theme and accent before the
  first visible frame; player, artwork and PiP motion stop when their surfaces
  are hidden or playback is idle.
- PASS — Artwork replacement keeps referenced Blob URLs alive through rescans
  and transitions; favorites and playlist membership continue to use stable
  recognition fields after metadata refreshes.
- PASS — Runtime identity is synchronized as `Glass Player Gen 7 · KINETIC
  GLASS`, version `7.6.0`; GP Core is 4.3, GP Fusion Engine is 4.2 and GP
  Motion Engine is 4.2. Spatial, Spectrum and Neural engine versions remain
  unchanged.
- PASS — `build.ps1` regenerated `build/app.js`; architecture validation,
  contract tests, generated syntax and whitespace checks passed.
- NOT RUN — Edge/file:// interaction, startup/artwork/favorites/PiP behavior
  with real media, audible-device verification, 4K/110% visual comparison and
  120 Hz hardware profiling.

## 23. 7.6.2 REBRAND UPDATE — 2026-10-16

- PASS — GP Bionic Engine 1.0 consolidates track identity recognition and
  spectrum analysis into src/engines/bionic-engine.js with a single engine
  port; the equalizer runtime merges into src/engines/spatial-engine.js.
  Source order 55 -> 52 fragments; governance modules 22 -> 20.
- PASS — Current identity synchronized as 7.6.2 REBRAND UPDATE across
  index.html cache revisions and build card, bootstrap and Bionic facades,
  Settings fallback, Chinese/English/Russian i18n, release data and the
  exported changelog identity.
- PASS — No IndexedDB/localStorage/schema, Store/Event Bus, queue identity,
  AudioContext/Deck graph, spatial bus or DOM contract changed; caches,
  Spectrum IDs, listening history and user data untouched.
- PASS — build.ps1 regenerated build/app.js; SHA-256
  46E7334084FBC9459464F2153795ED34C55864069799B64FE0DB76D25BCA5A43.
- PASS — validate-architecture.ps1: 52 sources / 20 modules.
- PASS — tests/contract-tests.ps1: PASS, Contracts checked: 261.
- PASS — node --check build/app.js.
- NOT RUN — Edge/file:// interaction, real audio device verification,
  4K/110% visual comparison and 120 Hz hardware profiling.


