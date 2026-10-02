# Glass Player — Delivery Checklist

Use this file before every handoff, release, hotfix, or claim that a change is
complete. It is a checklist, not a replacement for source code, contracts or
the detailed handoff.

Every item must be marked one of:

- PASS — verified in this task.
- NOT APPLICABLE — genuinely outside the scope; explain why.
- NOT RUN — not attempted; do not describe it as passing.
- BLOCKED — attempted but prevented by an external limitation; state the exact
  limitation and what remains unverified.

Never leave an important item silently blank.

## 0. Delivery identity

- [ ] Current working directory is the intended project root:
      GlassPlayer-dev.
- [ ] Current request and version/name are recorded.
- [ ] The requested scope is separated from unrelated historical requests.
- [ ] The release type is valid:
      patch, minor, major, or user-specified release.
- [ ] If this is a bug-only release, the name is HOTFIX BUILD unless the user
      supplied a different name.
- [ ] If this adds a feature without a name, the user has supplied or approved
      the release name.
- [ ] No speculative Unreleased item is described as implemented.

## 1. Required first-read and planning

- [ ] AGENTS.md was read.
- [ ] CURRENT_STATE.md was read.
- [ ] The relevant AI_WORKSPACE_HANDOFF.md sections were read.
- [ ] SOURCE_ORDER.txt was read.
- [ ] The actual owner source files were inspected.
- [ ] The matching contract tests were inspected.
- [ ] Assumptions were stated before editing.
- [ ] One canonical owner module was selected.
- [ ] Allowed consumers and forbidden dependencies were listed.
- [ ] Protected DOM blocks, data, APIs and files were listed.
- [ ] Success criteria were written for each requested item.

## 2. Scope and protected areas

- [ ] Only files needed for the request were changed.
- [ ] No unrelated cleanup or architecture rewrite was introduced.
- [ ] No existing panel, sector, shell, sidebar, queue surface, history pane,
      popover or player surface was silently reordered or restyled.
- [ ] No existing id, class, data attribute or aria attribute was renamed
      without explicit scope.
- [ ] No global selector was added to fix a local block.
- [ ] No second shell, glass layer, SSE layer, queue, playlist or backdrop was
      created.
- [ ] index.html DOM remains unchanged unless the request explicitly required
      a DOM change.
- [ ] app.css selector order remains intentional and existing overrides were
      not deleted accidentally.
- [ ] build/app.js was not edited directly.
- [ ] Root app.js was not edited.
- [ ] original/Glass Player 6.2.2.html was not edited.

## 3. Module and API boundary

- [ ] The change is routed to the correct owner:
      Core, Adapter, Engine, Service, Data or UI.
- [ ] Mutable state has one canonical owner.
- [ ] New public APIs have input/output, error, side-effect, caller and
      lifecycle documentation.
- [ ] New events have a documented payload, producer, consumers and unsubscribe
      path.
- [ ] No UI directly accesses IndexedDB, localStorage, AudioNode or private
      service runtime.
- [ ] No Service directly mutates a concrete View.
- [ ] No Engine owns product policy, Queue order, History policy or DOM.
- [ ] No Adapter contains playback, recommendation or layout policy.
- [ ] MODULE_API.md was updated if an API contract changed.
- [ ] EVENT_CONTRACTS.md was updated if an event contract changed.
- [ ] MODULE_GOVERNANCE.md was updated if ownership/dependencies changed.
- [ ] DEPENDENCY_GRAPH.md was updated if a dependency edge changed.

## 4. Persistence and user-data safety

- [ ] IndexedDB name remains glass-player-gen4 unless explicit migration was
      approved.
- [ ] IndexedDB version, object stores, keys and indexes remain unchanged unless
      an explicit migration was designed and tested.
- [ ] Existing localStorage keys remain unchanged.
- [ ] Existing trackFeatures, behaviorEvents, userModel, recommendations and
      trackCache records remain readable.
- [ ] Listening history was not deleted, reset or re-keyed.
- [ ] Spectrum ID/audio essence identity was not weakened by mutable metadata.
- [ ] MFCC, BPM, Energy, original loudness and cached feature data remain
      cache-first and locally reusable.
- [ ] Old records have a safe default when a new field is missing.
- [ ] STATE_OWNERSHIP.md was updated if a state owner changed.
- [ ] STORE_SCHEMA.md was updated if serializable state/schema changed.
- [ ] Any migration has a compatibility test and rollback/abort behavior.

## 5. Audio-specific checks

Mark NOT APPLICABLE for a non-audio change.

- [ ] The signal path was identified:
      source -> Deck A/B -> Crossfade -> EQ -> Loudness -> Spatial -> final
      protection -> master.
- [ ] AudioContext count remains one.
- [ ] Deck A/B count remains one pair.
- [ ] No node is connected twice.
- [ ] Old Deck, bus, timer and listener resources are cleaned up.
- [ ] EQ gain and loudness gain have bounded headroom.
- [ ] No parameter jumps were introduced on play, pause, seek or track change.
- [ ] Spatial parameters remain fixed during playback.
- [ ] No live RMS/correlation/Genre/BPM/MFCC modulation was added.
- [ ] No Spatial Audio is a true dry bypass.
- [ ] Mode switching uses the existing A/B crossfade contract.
- [ ] Final output peak/headroom behavior was checked.
- [ ] Audio diagnostics identify the first over-limit node when investigating
      clipping or an audio pop.
- [ ] Existing EQ, Crossfade, Spectrum, MFCC, BPM, Energy, Queue and History
      behavior remains covered.

## 6. Import, Spectrum and performance checks

Mark NOT APPLICABLE for a change unrelated to import/analysis/performance.

- [ ] Import de-duplicates using stable identity.
- [ ] Existing cache hits are read before decoding.
- [ ] Metadata, cover, Spectrum ID, MFCC, BPM, Energy and loudness are not
      re-rendered merely because a view refreshed.
- [ ] Import progress represents completed work.
- [ ] Progress does not finish before required initialization.
- [ ] Expensive work yields through existing scheduling.
- [ ] No duplicate analyzer, observer, timer, AudioContext or initialization
      path was introduced.
- [ ] No O(n²) loop was added where a stable key/index is available.
- [ ] No fixed low-FPS cap, giant blur layer or hard-control input was used as
      a performance shortcut.
- [ ] First import and first playback were considered separately.
- [ ] Actual Edge/4K/120 Hz profiling is marked PASS only if actually run.

## 7. UI, SSE and motion checks

- [ ] Existing Glass/Acrylic material is reused.
- [ ] Popovers use the shared Snooze material contract.
- [ ] Text contrast is derived from the actual surface behind it.
- [ ] Light -> dark -> light accent recalculation remains correct.
- [ ] Chinese and English text are complete and not mixed accidentally.
- [ ] Long text cannot widen a sector or page.
- [ ] Hover, press, click, keyboard and pointer-release behavior are defined.
- [ ] New animation duration/easing/cancellation/re-entry behavior is documented.
- [ ] Animation uses elapsed time, CSS/Web Animations or
      requestAnimationFrame.
- [ ] No fixed frame-count or visual setInterval loop was added.
- [ ] 60/90/120 Hz and Edge 100%/110% behavior was considered.
- [ ] View transitions preserve final geometry and do not settle with a twitch.

### SSE checks

- [ ] The new scroll surface is registered in the central Shared Controls
      selector list.
- [ ] It uses an existing gp-sse-shell or an explicitly justified owned shell.
- [ ] Shell owns background, border, radius, shadow and isolation.
- [ ] Transparent viewport owns scroll and moving content.
- [ ] Top/middle/bottom endpoint masks use live scroll geometry.
- [ ] Top fade is absent at the top; bottom fade is absent at the bottom.
- [ ] Middle fade is restrained and blends into the existing shell surface.
- [ ] No white/black strip, guessed color, duplicate blur rectangle or oversized
      fade was added.
- [ ] Resize, mutation, short content and window zoom were checked.

## 8. History, Neural and recommendation checks

Mark NOT APPLICABLE for a change unrelated to user modeling.

- [ ] behaviorEvents are recorded through the existing service boundary.
- [ ] Complete play uses accumulated 75% progress.
- [ ] Skip penalty uses listened fraction.
- [ ] Long-term preference, session context, exploration and recommendation
      score remain separate.
- [ ] Time decay and confidence remain active.
- [ ] Immature models preserve original random shuffle behavior.
- [ ] Daily Mix uses cached features and offline genre relations.
- [ ] Freshness and diversity prevent one song/artist from dominating.
- [ ] History uses the requested calendar range semantics.
- [ ] Metadata rescan preserves old history identity.

## 9. Version, Changelog and documentation synchronization

- [ ] index.html document title is updated if the release changed.
- [ ] Cache-busting query version is updated if required.
- [ ] src/bootstrap/main.js public version/facade is updated.
- [ ] Settings build card is updated.
- [ ] Current-version button is updated.
- [ ] src/data/releases.js contains the release in Chinese and English.
- [ ] Changelog order and legal x.y.z labels are correct.
- [ ] Unimplemented follow-up ideas remain under Unreleased.
- [ ] CURRENT_STATE.md is updated when runtime behavior changed.
- [ ] AI_WORKSPACE_HANDOFF.md is updated when architecture, history or a
      durable rule changed.
- [ ] MODULE_API.md is updated for API changes.
- [ ] STATE_OWNERSHIP.md / STORE_SCHEMA.md are updated for state/schema changes.
- [ ] EVENT_CONTRACTS.md is updated for event changes.
- [ ] MODULE_GOVERNANCE.md / DEPENDENCY_GRAPH.md are updated for module
      ownership or dependency changes.
- [ ] BUILD_REPORT.md / CONTRACT_TEST_REPORT.md / REGRESSION_REPORT.md are
      updated only when their represented checkpoint actually changed; do not
      rewrite historical reports to pretend they are current.
- [ ] No unrelated Markdown file was changed merely to create noise.

## 10. Required commands

Run from GlassPlayer-dev:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\validate-architecture.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\contract-tests.ps1
~~~

Record the result and generated build hash. If a command was not run, write
NOT RUN and explain why.

Optional targeted checks:

- Node syntax check for build/app.js when Node is available.
- Static search for duplicate event listeners, AudioContext construction and
  direct IndexedDB/UI access.
- Real Edge/file:// interaction and audio checks when the browser environment
  is available.
- 4K, 110% zoom and 120 Hz visual checks when that hardware/display is
  available.

## 11. Final handoff report template

Use this structure in the final response:

~~~text
Release:
Scope:
Changed files:
Protected files/data:
Module owner:
Persistence/schema impact:
Changelog/version impact:

Verification:
- Build:
- Architecture validation:
- Contract tests:
- Targeted static checks:
- Edge/audio/4K visual checks:

Not run or blocked:
Known follow-up:
~~~

Do not say “fixed”, “fully verified”, “4K-tested”, “audio-safe” or “no
regression” unless the corresponding check is actually PASS.

## 12. Stop and redesign

Stop before delivery if the change:

- resets or deletes user data;
- creates a second state owner, queue, playlist, AudioContext or graph;
- changes stable audio identity without migration;
- edits generated output directly;
- adds a second SSE/popover/material implementation;
- uses a global style to cover a local error;
- relies on a fixed frame count;
- leaves a required test or documentation impact unresolved.

## 13. 7.3.0 quality-fix delivery record — 2026-08-23

Status values below are intentionally explicit: PASS means verified in this
task, NOT RUN means not attempted, and BLOCKED means an attempted check was
prevented by an external limitation.

### Identity and scope

- PASS — Working directory: D:\GlassPlayer-dev.
- PASS — User-specified release: 7.3.0 — HOTFIX BUILD.
- PASS — Requested scope is limited to Spatial clarity, recommendation
  diversity, scroll intent, nonlinear EQ, ambient transitions, Library Grid
  artwork and release-note governance.
- PASS — AGENTS.md, CURRENT_STATE.md, relevant handoff sections,
  SOURCE_ORDER.txt, owner sources and matching contracts were read before
  editing.
- PASS — Protected files were not edited: build/app.js was generated only,
  and root app.js plus original/Glass Player 6.2.2.html were untouched.

### Ownership and data safety

- PASS — Owners remain Spatial Engine/data, Neural Service, Shared Controls,
  Equalizer Engine, Player Visuals/Settings, shared CSS, Queue/Library
  rendering, and releases/i18n/bootstrap identity surfaces.
- PASS — No IndexedDB schema, localStorage key, history record, stable audio
  identity, Spectrum ID or cache identity changed.
- PASS — No second Store, Event Bus, Queue, AudioContext, Deck pair, spatial
  bus pair, SSE layer or popover material system was introduced.
- NOT APPLICABLE — MODULE_API.md, EVENT_CONTRACTS.md,
  MODULE_GOVERNANCE.md, DEPENDENCY_GRAPH.md, STATE_OWNERSHIP.md and
  STORE_SCHEMA.md; no public API, event, dependency or state/schema contract
  changed.

### Verification

- PASS — build.ps1; generated SHA256:
  C1F037EE4F3A2040694E8D6148FA97556BCFB4322A835452C405D7612F27DB3D.
- PASS — validate-architecture.ps1 (Sources: 55, Modules: 22).
- PASS — tests/contract-tests.ps1 (Contracts checked: 141).
- PASS — Bundled Node syntax check for build/app.js.
- PASS — Targeted EQ transfer check confirmed nonlinear output, +/-12 dB
  bounds and 0.5 dB snapping.
- PASS — 7.3.0 Accent emphasis additions were reverted to the 7.2.2 CSS
  behavior per the user's correction; no new selection variables remain.
- PASS — Static duplicate/ownership checks are covered by architecture and
  contract validation; no direct generated-file edit was used.
- BLOCKED — Real Edge/file:// DOM and screenshot check: the connected Browser
  rejected the local file URL under its URL policy. No workaround was used.
- NOT RUN — Audible device check, 4K screenshot comparison and 120 Hz
  hardware profiling.

### Documentation and changelog

- PASS — CURRENT_STATE.md records 7.3.0 and the Apple-style release-note
  contract.
- PASS — AGENTS.md records the durable Apple-style bilingual changelog
  contract.
- PASS — src/data/releases.js contains the newest-first Chinese/English
  7.3.0 entry; Unreleased remains roadmap-only.
- NOT APPLICABLE — AI_WORKSPACE_HANDOFF.md; no additional historical
  architecture or product decision was needed beyond the already-read
  sections.

## 14. 7.3.1 Music Galaxy delivery record — 2026-08-25

Status values below are explicit: PASS means verified in Task 7, NOT RUN means
not attempted, and BLOCKED identifies an attempted check that the workspace
could not support.

### Identity and scope

- PASS — Working directory: D:\GlassPlayer-dev.
- PASS — User-specified patch release: 7.3.1 — GALAXY UPDATE.
- PASS — Original scope covered the newest-first bilingual release record,
  current identity facts, Music Galaxy API/ownership/dependency governance,
  this delivery record and the strengthened release contract; two scoped review
  fix rounds then added runtime accuracy, regression and handoff corrections.
- PASS — AGENTS.md, CURRENT_STATE.md, DELIVERY_CHECKLIST.md, Task 7 brief,
  relevant AI_WORKSPACE_HANDOFF.md sections, SOURCE_ORDER.txt, owner sources
  and matching contract were read before production documentation edits.
- PASS — All 12 in-scope baseline files matched `snapshots/task-7-base` before
  the original Task 7 edits; the report lists the complete write set including
  the later review-fix source/test files.

### Ownership and protected contracts

- PASS — Music Galaxy Service is the pure deterministic owner of
  `featureVector`, `compareTracks`, `buildLayout` and
  `recommendationSimilarity`.
- PASS — Allowed consumers are Galaxy View and Neural/Daily Mix; DOM, storage,
  audio and runtime network dependencies are forbidden.
- PASS — MODULE_API.md records signatures, fallbacks and compatibility;
  MODULE_GOVERNANCE.md records the owner and forbidden dependencies; and
  DEPENDENCY_GRAPH.md records Service → Galaxy View and Service → Neural edges.
- PASS — No state owner, Store/schema field, event, IndexedDB/localStorage
  contract, history identity, Queue rule, audio graph or Spectrum/Neural
  compatibility token changed.
- PASS — STATE_OWNERSHIP.md, EVENT_CONTRACTS.md, STORE_SCHEMA.md, historical
  reports, SOURCE_ORDER.txt and generated build/app.js were not edited. The
  only runtime-owner source edits were the approved Galaxy layout and existing
  bootstrap-facade fixes from review round 1.

### Version, release and cache impact

- PASS — src/data/releases.js contains the first released 7.3.1 entry after
  Unreleased, with matching Chinese/English Music Galaxy, Stars and
  Interaction, MFCC/BPM/Daily Mix and Engine Versions areas.
- PASS — Only the implemented Music Galaxy preview was removed from both
  Unreleased languages; Galaxy-aware recommendation and Electron Lake remain
  future roadmap items, and historical release entries are unchanged against
  the Task 7 snapshot.
- PASS — The exported current-version summary and filename identify 7.3.1 —
  GALAXY UPDATE.
- PASS — Current documentation records 57 source fragments, 23 governance
  modules, Fusion 4.0, Spectrum 2.3 and Neural 2.2.
- NOT APPLICABLE — Runtime version/cache revision surfaces were already updated
  by Task 6 and were not edited in Task 7.

### Verification

- PASS — Pre-fix release-contract RED: exit 1 with five expected 7.3.1 release,
  parity, placeholder, Unreleased and export-identity failures before
  production documentation edits.
- PASS — GREEN documentation contract: exit 0; script output `PASS` and
  `Contracts checked: 146`.
- PASS — Focused release search confirmed newest-first order, the four matching
  bilingual areas, placeholder-free 7.3.1 copy and 7.3.1 export identity.
- PASS — Focused governance/identity searches confirmed the API signatures,
  owner, forbidden dependencies, both required edges and current version,
  source-count and engine facts.
- BLOCKED — Git status/diff is unavailable because this shared workspace has
  no `.git`; exact Task 7 snapshot comparisons were used instead.
- NOT RUN — build.ps1, generated build hash and Node build syntax check; Task 7
  explicitly excludes build execution and generated output changes.
- NOT RUN — validate-architecture.ps1; Task 7 explicitly excludes the final
  architecture gate.
- NOT RUN — Edge/file:// browser interaction, audible-device checks, 4K/110%
  visual comparison and 120 Hz hardware profiling.

### Task 8 handoff

- NOT RUN — Generated build synchronization and final build/architecture gates
  remain for Task 8; build/app.js therefore does not yet contain the Task 7
  release-data update.
- NOT RUN — Browser, audio, 4K and 120 Hz checks remain unverified and must not
  be described as PASS downstream unless actually run.

### Review fix round 1

- PASS — A release-accuracy regression first failed because BPM changes did
  not affect Galaxy coordinates, then passed after the existing layout
  covariance gained one confidence-weighted normalized BPM component.
- PASS — Public Galaxy feature vectors remain 13-value MFCC vectors;
  `compareTracks`, cache/model tokens, deterministic ordering, fallbacks and
  missing-BPM behavior remain unchanged.
- PASS — The existing frozen bootstrap facade now preserves the bundled
  read-only `GP.genreRelations` edge used by Galaxy and Neural similarity; the
  existing focused contract assertion was strengthened without changing its
  hard-coded count.
- PASS — The 7.3.1 bilingual Music Galaxy bullets now distinguish MFCC+BPM
  placement from genre/tempo labels and do not claim genre drives coordinates.
- PASS — AI_WORKSPACE_HANDOFF.md marks the 7.1.1/August 3 hash as historical,
  records the measured 7.3.0 hash and 141-contract checkpoint, and explicitly
  leaves the 7.3.1 build/full gate to Task 8.
- PASS — Node v24.19.0 pure Galaxy tests, source syntax, ordered-source syntax
  and focused contracts passed (see Task 7 report for commands/results).
- NOT RUN — build.ps1, validate-architecture.ps1, browser, audio, 4K and 120 Hz
  verification, as required by the review ruling.

### Review fix round 2

- PASS — `tests/galaxy-runtime.test.js` now covers one missing-BPM track and
  one invalid-BPM track; repeated `buildLayout` calls produce identical point
  output and every coordinate is finite.
- PASS — `CURRENT_STATE.md` distinguishes frozen Bootstrap/Galaxy View track
  snapshots from Neural/Daily Mix caller-provided feature projections while
  retaining the no-mutation, no-storage, no-audio and no-network boundaries.
- PASS — `task-7-report.md` now records both review rounds, the 12-file baseline,
  the complete actual write set and pre-fix versus current evidence.
- PASS — Absolute Node v24.19.0 syntax and pure Galaxy test commands passed;
  focused contract output remained `PASS` / `Contracts checked: 146`.
- NOT RUN — build.ps1, validate-architecture.ps1, browser, audio, 4K and 120 Hz
  verification.

## 15. 7.3.1 final synchronization — 2026-08-25

- PASS — `build.ps1` regenerated `build/app.js` from `SOURCE_ORDER.txt`.
- PASS — Generated build SHA-256:
  `3487E9E49D5CBA014996A8700EB61007C960BA424A5EF4CACF61CC3EBA451443`.
- PASS — Ordered-source syntax and generated `build/app.js` syntax passed with
  Node v24.19.0.
- PASS — `validate-architecture.ps1`: 57 sources / 23 modules.
- PASS — `tests/contract-tests.ps1`: `PASS`, `Contracts checked: 146`.
- PASS — Import completion now calls the existing `refreshMusicGalaxy` view
  controller after analysis and Daily Mix finalization, so an active Galaxy
  view re-reads the playlist snapshot and exits its empty-library state.
- NOT RUN — Edge/file:// interaction, audible-device verification, 4K/110%
  visual comparison and 120 Hz hardware profiling.

## 16. 7.3.1 repair delivery — 2026-08-26

### Release and scope

- PASS — Kept the user-requested version identity at 7.3.1 GALAXY UPDATE;
  no version bump was introduced.
- PASS — Galaxy View/Service: bounded zoom and pan, responsive resize,
  dense-label separation/truncation, title-only hover and shared popover
  material.
- PASS — Library/Neural/File Adapter/Bootstrap: task-first import yielding,
  in-flight Resonance Boost and Daily Mix coalescing, cached candidate scoring,
  and persisted default-folder import through the existing storage boundary.
- PASS — Settings/Player Visuals/i18n plus DOM/CSS: language-aware typography,
  centered preview, named weight display, expanded About, aligned EQ, bounded
  Spatial strip and bitrate copy without “estimated”.

### Protected contracts and persistence

- PASS — No changes to IndexedDB name/version/stores/indexes, existing
  localStorage keys, Spectrum ID/audio identity, history, queue, Store/Event
  Bus, AudioContext, Deck A/B graph or Spatial A/B buses.
- PASS — The optional default folder uses one `defaultMusicFolder` record in
  the existing `recommendations` store and stores only an already-authorized
  `FileSystemDirectoryHandle`; unsupported or ungranted access remains an
  explicit user action.
- PASS — `build/app.js` was generated by `build.ps1`; it was not edited
  directly. Root `app.js` and the historical HTML were not edited.

### Verification

- PASS — `build.ps1`: generated SHA-256
  `D18B8F1861891ECC84539E0974EBE3AE189E009DF0A50AD6140331DC6B4D3836`.
- PASS — `validate-architecture.ps1`: 57 sources / 23 modules.
- PASS — `tests/contract-tests.ps1`: `PASS`, `Contracts checked: 161`.
- PASS — `tests/galaxy-runtime.test.js`.
- PASS — `tests/import-performance.test.js`.
- PASS — Node v24.19.0 syntax check for generated `build/app.js`.
- NOT RUN — Edge/file:// interaction with real local music and persisted
  directory permission, audible-device verification, screenshot-based 4K/110%
  visual QA and 120 Hz hardware profiling.

## 17. 7.3.2 stability delivery — 2026-09-17

### Release and scope

- PASS — Kept the user-requested version identity at 7.3.2 STABILITY UPDATE;
  GP Core 4.2, GP Fusion Engine 4.1.
- PASS — Music Galaxy Service/View plus tests removed; source order 57→55,
  governance modules 23→22.
- PASS — Natural track end keeps playback intent; non-integer/out-of-range
  indexes rejected; one-action resume after `ended`.
- PASS — Import dialog closes before background spectrum analysis; parallel
  per-file reads, higher concurrency, fewer idle yields, paint-confirmed
  completion.
- PASS — `src/data/releases.js` carries the newest-first Chinese/English
  7.3.2 entry; Unreleased drops the Galaxy roadmap and keeps recommendation
  and Electron plans; export identity is 7.3.2 STABILITY UPDATE.

### Protected contracts and persistence

- PASS — No changes to IndexedDB name/version/stores/indexes, existing
  localStorage keys, Spectrum ID/audio identity, history, queue, Store/Event
  Bus, AudioContext, Deck A/B graph or Spatial A/B buses.
- PASS — Offline Genre Relations retained for Neural/Daily Mix per user
  decision; historical release entries untouched.
- PASS — `build/app.js` was generated by `build.ps1`; it was not edited
  directly. Root `app.js` and the historical HTML were not edited.

### Verification

- PASS — `build.ps1`: generated SHA-256
  `BEE6A28970609FC0799388EB8174BD98C3372CDB6122D71900CE1858B606982E`.
- PASS — `validate-architecture.ps1`: 55 sources / 22 modules.
- PASS — `tests/contract-tests.ps1`: `PASS`, `Contracts checked: 255`.
- PASS — `tests/import-performance.test.js`.
- PASS — Node v24.21.0 syntax check for generated `build/app.js`.
- NOT RUN — Edge/file:// interaction with real local music, audible-device
  verification, 4K/110% visual comparison and 120 Hz hardware profiling.

## 18. 7.4.0 collection delivery — 2026-09-18 (branch test740)

### Release and scope

- PASS — User-requested minor release: 7.4.0 典藏更新 / COLLECTION UPDATE.
- PASS — Library playlist switcher with create/rename/delete, per-row add/remove,
  play-through in collection scope, and per-row likes (+3.0 model signal).
- PASS — History annual-report button bottom-right with Dec 31–Jan 14 auto-open,
  past-year browsing and standalone interactive HTML download.
- PASS — Player lossless badge for FLAC; missing-font fallback toast.
- PASS — `src/data/releases.js` carries the newest-first Chinese/English 7.4.0 entry;
  export identity is 7.4.0 COLLECTION UPDATE.

### Protected contracts and persistence

- PASS — No changes to IndexedDB name/version/stores/indexes, existing localStorage
  keys, Spectrum ID/audio identity, history, queue, Store/Event Bus, AudioContext,
  Deck A/B graph or Spatial A/B buses.
- PASS — Playlists reuse the existing recommendations record; likes reuse behavior
  events; historical release entries untouched.
- PASS — `build/app.js` was generated by `build.ps1`; it was not edited directly.
  Root `app.js` and the historical HTML were not edited.

### Verification

- PASS — `build.ps1`: generated SHA-256
  `F641ADD0EEA99A9C9C68BF6A460F07D33F9A718BC81246149CF2C62C7918F3E1`.
- PASS — `validate-architecture.ps1`: 55 sources / 22 modules.
- PASS — `tests/contract-tests.ps1`: `PASS`, `Contracts checked: 261`.
- PASS — `tests/import-performance.test.js` plus Node syntax checks.
- NOT RUN — Edge/file:// interaction with real local music, audible-device
  verification, 4K/110% visual comparison and 120 Hz hardware profiling.

## 19. 7.4.1 HOTFIX BUILD — 2026-09-26

- PASS — User-specified patch release: 7.4.1 HOTFIX BUILD; 7.4.0 remains in history and no speculative Unreleased item was marked shipped.
- PASS — Library empty liked/custom collections now show localized empty-state copy without masking search no-match feedback; history rankings prefer current metadata after rescan; annual HTML exports follow Chinese or English fallback copy from the active UI language.
- PASS — Natural media-end pause ordering keeps playback intent until ended can advance the existing queue/crossfade path; genuine user pauses still clear intent.
- PASS — Settings no longer leaks Chinese spatial copy in Russian mode, playback/sort labels use translation keys, and invalid persisted theme/cover/background values clamp to supported choices.
- PASS — No IndexedDB/localStorage/schema, Store/Event Bus, queue identity, AudioContext/Deck graph or DOM contract changed; all 7.4.1 identity surfaces and bilingual changelog data are synchronized.
- PASS — build.ps1 regenerated build/app.js (SHA256 DC6FDED3D99821472C7288A1395EC7C4F4D13AE3FD627BBF4C13E3060896C082); architecture validation passed with 55 sources / 22 modules; contract tests passed with 261 checks; Node syntax checks passed for changed sources and generated build.
- PASS — Focused UI/layout follow-up repaired Library search telemetry, localized queue actions and playable playlist counts; annual reports now render visible dimension bars, responsive export cards, peak-hour summary and scoped Top 10 layout; Settings keeps folder status visible and EQ geometry aligned; hidden player disc motion stops outside the Player view.
- PASS — Follow-up build SHA256 `DAC7EF23D0D9E5A17DB11689D618FB47A6F32C63B0590A16F8DE3192A7BD2EA5`; architecture and contract results remain 55 sources / 22 modules and 261 checks; Node syntax passed for changed sources and generated build.
- NOT RUN — Edge/file:// interaction, real audio device verification, 4K/110% visual comparison, and 120 Hz hardware profiling.

## 20. 7.4.2 follow-up fixes — 2026-09-27

### Scope and ownership

- PASS — User-requested patch identity is 7.4.2 HOTFIX BUILD; the identity and
  bilingual changelog entry were committed first as `388ce99`.
- PASS — Queue Service owns collection playback ordering; History Service owns
  all-time and annual aggregation; Shared Controls/CSS own report scrolling;
  Library View owns search telemetry; Settings/i18n own restored preferences and
  language copy; Audio Engine owns the single decode/playback context.
- PASS — Protected IndexedDB/localStorage schema, Spectrum ID, history keys,
  Store/Event Bus, DOM ids/classes, queue identity and audio graph topology were
  preserved. `.tmp.driveupload/` remains untracked and untouched.

### Implemented fixes

- PASS — Collection playback consumes the selected first song once while
  retaining pre-existing queue order in sequential and shuffle modes.
- PASS — Legacy undated listening seconds remain in all-time totals; finite
  calendar ranges remain date-bound.
- PASS — Stale delayed search telemetry is ignored after the query changes.
- PASS — Annual Report uses five wide summary columns and the existing shared
  scrollbar reveal selectors/styles.
- PASS — Invalid persisted play modes fall back to Sequential; loudness
  information re-renders when the interface language changes.
- PASS — Background Spectrum decoding reuses the Audio Engine context without
  resuming a suspended context or rebuilding the graph.

### Verification

- PASS — `build.ps1`: generated build SHA-256
  `3F78F70890B76FC47357A75F48EB49CF1D3F6AFDC6B3BC57DC76499CD23C72CC`.
- PASS — `validate-architecture.ps1`: 55 sources / 22 modules.
- PASS — `tests/contract-tests.ps1`: `PASS`, Contracts checked: 261.
- PASS — `node --check build/app.js`.
- PASS — `tests/service-regressions.test.js`.
- PASS — `tests/audio-context-regression.test.js`.
- NOT RUN — Edge/file:// interaction, real audio device verification, 4K/110%
  visual comparison and 120 Hz hardware profiling.

## 21. 7.4.3 HOTFIX BUILD — 2026-09-27

- PASS — Promoted the completed queue, history, Annual Report, settings, language and background-analysis fixes to the user-requested 7.4.3 HOTFIX BUILD; 7.4.2 remains in the release history.
- PASS — Synchronized `index.html`, bootstrap facade, Spectrum facade, Settings fallback, Chinese/English/Russian labels, release data and exported changelog identity.
- PASS — Preserved IndexedDB/localStorage schema, Store/Event Bus, queue identity, AudioContext/Deck graph and existing DOM contracts; `.tmp.driveupload/` remains untouched.
- PASS — `build.ps1` regenerated `build/app.js`; SHA-256 `33581E0AB8724131FE33F4BEF3EAB35BA9112A28BBCD6F095EF75E1F39E38D29`.
- PASS — Architecture validation: 55 sources / 22 modules; contract checks: 261; generated JavaScript syntax, service regressions, audio-context regression and diff whitespace checks passed.
- PASS — Release commit and annotated tag `v7.4.3` were created after the checks above.
- NOT RUN — Edge/file:// interaction, real audio device verification, 4K/110% visual comparison and 120 Hz hardware profiling.

## 22. 7.5.0 REPLAY ATLAS — 2026-10-02

- PASS — Synchronized `index.html`, bootstrap and Spectrum facades, Settings
  identity, bilingual i18n, release data and exported changelog as `7.5.0`
  `REPLAY ATLAS`; display engine names carry their feature labels; document title unified to `Glass Player`.
- PASS — Annual Report remains owned by History Service and Shared Controls;
  the in-app report and standalone download use rich long-form chapters,
  progressive reveals, scroll-linked parallax, rankings, rhythm, preference,
  audio-profile and local privacy sections while preserving v7.4.3 modal dimensions and button location.
- PASS — Library remains strictly on the stable v7.4.3 baseline; all playlist actions reuse existing Queue Service contracts without schema changes.
- PASS — Song title row uses a three-column grid keeping the song title optically centered with the FLAC lossless badge positioned beside it; Settings view center-alignment restored.
- PASS — Typography settings support category-aware CJK fallbacks for serif (New York -> Songti/SimSun), monospace (Cascadia Code -> Consolas/system mono), and sans-serif typefaces.
- PASS — Protected IndexedDB/localStorage schema, Store/Event Bus, queue
  identity, AudioContext/Deck graph, source order and existing DOM contracts
  were preserved; `.tmp.driveupload/` remains untracked and untouched.
- PASS — `build.ps1`: generated build SHA-256
  `0729FC658A0507E005EF96EA02ABF0731CDE313D4A43D7A5B5F97C17D786DDEE`.
- PASS — `validate-architecture.ps1`: 55 sources / 22 modules.
- PASS — `tests/contract-tests.ps1`: `PASS`, Contracts checked: 261.
- PASS — `node --check build/app.js`; `tests/service-regressions.test.js`; `tests/audio-context-regression.test.js`; `git diff --check` passed.
- NOT RUN — Edge/file:// interaction, real audio device verification, 4K/110%
  visual comparison and 120 Hz hardware profiling.
