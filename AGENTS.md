# Glass Player — Project Rules for Codex

This file is the always-on operating contract for the Glass Player project.
Read it before reading the current task, before inspecting source, and before
making any edit. It is intentionally shorter than AI_WORKSPACE_HANDOFF.md;
the handoff file contains historical context and detailed rationale.

## 1. First-read contract

Every new AI workspace or new conversation must follow this sequence:

1. Read this file completely.
2. Read CURRENT_STATE.md completely.
3. Read AI_WORKSPACE_HANDOFF.md sections 0, 2, 4, 5, 6, 12, 13, 14, 19,
   20, 24 and 26. For a focused task, read the additional section named by
   the task.
4. Read DELIVERY_CHECKLIST.md before any delivery claim.
5. Read SOURCE_ORDER.txt.
6. Inspect the one to three source files that own the requested behavior.
7. Inspect the matching contract in tests/contract-tests.ps1.
8. State assumptions, scope, owner module, forbidden changes and success
   criteria before editing.

Do not claim that the whole repository is understood merely because this file
was read. Files are authority only after the relevant source has been checked.

## 2. Current baseline

The current product baseline is:

- Product: Glass Player Gen 7.
- Version: 7.3.1 — GALAXY UPDATE.
- Architecture: Peregrine Lake.
- GP Core: 4.1.
- GP Fusion Engine: 4.0.
- GP Motion Engine: 4.1.
- GP Spatial Engine: 1.1.
- GP Spectrum Engine: 2.3.
- GP Neural Engine: 2.2 — Resonance Boost.
- Source fragments: 57.
- Governance modules: 23.
- Runtime entry: index.html.
- CSS authority: app.css.
- JavaScript authority: src plus SOURCE_ORDER.txt.
- Generated runtime: build/app.js.

The app is a local Edge/Chromium player and is normally opened directly from
file://. It is not an npm project, ES-module project, server application or
Electron application yet.

## 3. Source authority and generated files

Authority order:

1. src/** source fragments.
2. SOURCE_ORDER.txt execution order.
3. index.html DOM and app.css style authority.
4. src/data/releases.js for runtime changelog data.
5. build/app.js as generated output.
6. Root reports and historical docs as explanatory evidence only.
7. Root app.js as an old 6.3.x baseline; it is not loaded.
8. original/Glass Player 6.2.2.html as an immutable historical baseline.

Rules:

- Never edit build/app.js directly.
- Never edit root app.js for a current feature.
- Never edit original/Glass Player 6.2.2.html.
- Never reorder SOURCE_ORDER.txt casually. A new source fragment requires an
  explicit architecture decision and ownership entry.
- Build output must be regenerated with build.ps1 after source changes.
- Do not create a second runtime, duplicate source tree or backup copies in
  the project folder.

## 4. Mixed-enforcement policy

This project uses mixed enforcement.

Hard gates are enforced by architecture checks and contract tests:

- one registry, one Store, one Event Bus;
- one playlist runtime, one manual queue and one shuffle timeline;
- one AudioContext, one Deck A/B graph and one Spatial A/B bus pair;
- one IndexedDB database and the existing object stores/schema;
- stable public module interfaces and event names;
- source ownership and dependency direction;
- no direct UI-to-IndexedDB or UI-to-AudioNode access;
- source order, build output and version identity consistency;
- no accidental F9/F11 playback bindings; Space/F10 remain valid;
- no fixed-frame-count animation loops.

Soft gates are reviewed against the visual and product contract:

- Glass/Acrylic material stays transparent enough and background-aware;
- no white/black fake edge overlays;
- no sector geometry shift used to hide an unrelated bug;
- motion remains refresh-driven, elapsed-time based and usable at 120 Hz;
- 4K, Edge 100% zoom and Edge 110% zoom remain legible;
- English and Chinese strings stay complete and consistent;
- popovers use the shared Snooze material;
- titles use the actual surface behind them for contrast;
- no visible stutter, settle twitch or instant jump introduced.

If a soft gate is repeatedly violated, convert it into a contract test or a
documented regression fixture instead of adding another ad-hoc CSS override.

## 5. Feature classification before implementation

Every new feature or bug fix must be classified into one primary category and
one owner module. Cross-cutting work may have secondary consumers, but it must
still have one owner.

| Feature type | Primary owner | Allowed consumers | Forbidden shortcuts |
| --- | --- | --- | --- |
| Playback, pause, seek, speed, previous/next | Playback Service + Audio Engine | Queue, History, Neural, UI, PiP | UI directly changing AudioNode or creating a second media graph |
| Queue, manual playlist, shuffle timeline | Queue Service | Playback, Library/Queue UI, Neural | a second array or view-only queue |
| Import, folder scan, sort, search, temporary import | Library Service + File Port | Recognition, Spectrum, Store, Library UI | UI-owned import state or duplicate track identity |
| Metadata, Spectrum ID and stable identity | Recognition Engine | Library, Spectrum, History, Storage | using mutable title/artist as the permanent identity |
| MFCC, BPM, Energy, loudness analysis | Spectrum Analyzer/Service | Neural, Library, History, UI | runtime analysis on every render or duplicate decode |
| EQ presets and Custom EQ | Equalizer Engine + EQ data | Settings/Sound UI, Audio Engine | direct filter access from a view |
| Loudness normalization | Spectrum/Audio boundary + Settings Service | Audio Engine, Sound UI | changing stored original loudness or applying unbounded gain |
| Spatial audio | Spatial Engine + spatial-presets data | Audio Engine, Settings/Sound UI | genre/RMS-driven live tuning, Haas, duplicate buses |
| User behavior, preference, recommendation | History + Neural Services | Queue, Daily Mix, History UI | preference directly replacing random playback before maturity |
| Music Galaxy feature comparison and layout | Music Galaxy Service | Galaxy View, Neural/Daily Mix | DOM, storage, audio or network dependencies in the service |
| Listening history and play counts | History Service | Neural, History UI | deriving time from current UI state or rewriting old records |
| Theme, accent, background and title contrast | Settings + player visuals | Shared UI, views | hard-coded black/white or replacing the current accent algorithm |
| Motion, transitions, popovers and SSE | Motion Engine + Shared Controls | all views | per-view animation engines or overlaying a second glass frame |
| View layout or DOM-only presentation | owning UI view | Shared Controls/Motion | changing Store, persistence or audio policy from a view |
| Language, fonts and copy | i18n data + Settings Service | all UI/data views | hard-coded untranslated strings |
| Changelog and version identity | releases data + bootstrap/index | Changelog UI, settings build card | changing only one visible version label |
| Traditional PiP | PiP Service, PiP adapter and renderer | Playback/UI | Document PiP address-bar assumptions or second playback state |
| Performance and scheduling | owning module plus Motion/Clock contracts | diagnostics/tests | disabling features globally or adding fixed 3/60 FPS loops |
| Future Electron/SQLite preparation | adapters and ports only | services/bootstrap | rewriting services or adding Electron runtime now |

If a proposed feature does not fit this table, stop and define a new module
boundary before coding.

## 6. Module boundary rules

### Core

Core owns registry, contracts, bus, actions, Store, selectors, context and
pure utilities. Core may not import concrete services, DOM, IndexedDB or
AudioNode. Store state is serializable; snapshots are read-only.

### Browser adapters

Adapters are the only browser capability boundary for storage, file selection,
PiP, Media Session and clock. New code must call an existing Port. Do not add
direct IndexedDB/localStorage access to a view or engine.

### Engines

Engines own technical runtime resources:

- Audio Engine owns the single AudioContext, Deck A/B and output graph.
- Equalizer Engine owns EQ filters and fixed preset/custom gains.
- Spatial Engine owns fixed A/B spatial buses and mode transitions.
- Recognition Engine owns conservative identity and metadata extraction.
- Spectrum Analyzer owns transient MFCC/BPM/Energy calculation and cache reads.
- Motion Engine owns shared transition primitives, not product state.

An engine must not render DOM, write user history, reorder queues or invent
recommendation policy.

### Services

Services own product policy and coordinate engines/adapters through documented
interfaces. A service may update Store through actions and emit documented
events. It must not reach into another service's private runtime.

Music Galaxy Service is the pure deterministic owner of cached-track feature
vectors, track comparison, layout and recommendation similarity. Its public
API is `featureVector`, `compareTracks`, `buildLayout` and
`recommendationSimilarity`. Only Galaxy View and Neural/Daily Mix may consume
that API. The service must not depend on DOM, storage, audio or runtime network
access, and it owns no persistent or mutable product state.

### UI

Views render selectors and dispatch commands. Views may own DOM references,
observers and animation handles, but not canonical business state. Reusable
behavior belongs in Shared Controls or Motion Engine.

### Sector and panel protection

Every existing panel, sector, shell, sidebar, queue surface, history pane,
popover and player surface is a protected block. Before changing one, identify
its DOM owner, CSS owner, state owner and motion owner. A new feature may add a
declared child or hook, but may not silently:

- reorder existing DOM;
- rename an existing id/class/data attribute;
- change another panel's width, padding, overflow or stacking context;
- move a correct surface to fix an unrelated surface;
- add a global selector that changes every panel when only one is in scope;
- duplicate a shell, mask, popover, queue or backdrop;
- replace a shared component with a one-off visual imitation.

If a cross-panel change is genuinely required, list every affected block,
explain the shared contract being changed, and add regression checks for each
one before editing. “Looks similar” is not evidence that two blocks may share
an implementation.

### Data

Data modules are deterministic, side-effect-free constants or transforms:
i18n, releases, genre relations, EQ presets and spatial presets. No runtime
network lookup belongs in these modules.

## 7. State ownership and persistence red lines

Before changing a state value, identify its canonical owner in
STATE_OWNERSHIP.md. Never create a shadow owner.

Do not change, delete, rename or migrate without explicit user approval:

- IndexedDB name: glass-player-gen4.
- IndexedDB version: 5.
- Existing object stores, keys and indexes.
- localStorage keys glassPlayerHistory, glassPlayerPrefs and
  glassPlayerSidebarCollapsed.
- Spectrum ID, recognition anchors, audio essence keys or cache identity.
- behaviorEvents, userModel, recommendations or trackCache records.
- Historical listening records or their timestamps.

Adding a field requires:

1. a compatibility read path for old records;
2. a write path that preserves all old fields;
3. a schema/version decision;
4. a migration test or explicit no-migration rationale;
5. a note in CURRENT_STATE.md and the changelog when user-visible.

Changing a display title, artist or genre must not silently replace the stable
audio identity or disconnect old listening history.

## 8. Audio safety rules

All audio changes must preserve the one graph:

Audio source -> Deck A/B -> Crossfade -> EQ -> Loudness -> Spatial -> Final
protection -> Master Output.

Before editing audio code, record:

- which node owns the gain;
- where the node is connected;
- whether a previous node/bus is disconnected;
- the peak/headroom budget;
- what happens on play, pause, seek and track change.

Rules:

- Never create a second AudioContext.
- Never connect a node twice.
- No unbounded positive EQ or loudness gain.
- No parameter jump where a short ramp is appropriate.
- Spatial modes use fixed parameters; no live RMS, correlation, genre, BPM or
  MFCC modulation during playback.
- No Spatial Audio is a true dry bypass, not a wet gain of zero.
- A/B spatial buses coexist only during the defined transition, then the old
  bus is disconnected.
- Do not use a limiter to hide an unknown upstream graph error.
- Audio diagnostics must identify the first over-limit node before a fix is
  accepted.

## 9. Motion, 120 Hz and transition contract

Animations are time-based, not frame-count based:

- CSS transitions, Web Animations and requestAnimationFrame are permitted.
- Use elapsed-time interpolation; do not assume 60 frames or 120 iterations.
- GP_MOTION_TARGET_FPS is a ceiling/contract, not a command to force a frame
  loop.
- Pointer release must not cancel a required value transition.
- Animation cancellation must leave a deterministic final state.
- Repeated view changes must be idempotent and must not stack observers,
  timers, transforms or classes.
- Do not use transform and layout writes in competing loops.
- Any new motion must specify duration, easing, hover delay, click behavior,
  cancellation behavior and reduced-motion fallback.

Page transitions:

- The existing view transition owns opacity/visibility sequencing.
- Keep final geometry stable; do not use a late translate to “settle” a page.
- Background blend belongs to player visuals and must not repaint a fake gray
  sheet over the page.

### Soft Scroll Edge (SSE) implementation contract

SSE is a shared two-layer surface, not a new overlay:

1. A stationary gp-sse-shell owns the sector/panel background, border, radius,
   shadow and isolation.
2. A transparent gp-sse-viewport owns scrolling and moving content.
3. The viewport reaches the fixed frame; inner content padding remains inside
   the viewport.
4. Scroll endpoint state is measured from scrollTop, clientHeight and
   scrollHeight in Shared Controls.
5. Top/bottom classes are updated in requestAnimationFrame after scroll,
   resize, mutation and view changes.
6. At the top, remove the top fade; at the bottom, remove the bottom fade; in
   the middle, show both. Never show an edge fade when that edge is not cut.
7. The mask is a restrained alpha fade into the shell's existing surface. Do
   not sample a guessed color, inject a white/black strip, add a second blur
   panel, or allow the fade to exceed the shell width.
8. New scrollable surfaces must register their selector in
   GP_SCROLL_EDGE_SELECTORS and use an existing shared/owned shell mapping.
9. New SSE behavior requires tests for top, middle, bottom, resize and
   short-content states.
10. Do not create a view-specific SSE algorithm.

Current SSE owner: src/ui/shared-controls.js plus the existing app.css shell
and viewport rules. Current contract identifiers are gp-sse,
data-gp-sse, gp-sse-shell and gp-sse-viewport.

## 10. UI material and layout rules

- Preserve the established Glass Player visual language: acrylic, restrained
  translucency, subtle shadow and rounded geometry.
- Popovers, selectors and Snooze-style menus use the shared popover material.
- Do not add a separate white/black backdrop to “improve contrast”.
- Contrast is derived from the actual surface behind the text.
- The same accent derivation must work through light -> dark -> light changes.
- No title, card or sector may expand the page horizontally because of a long
  title, lyric or recommendation string.
- Edge 100% and 110%, windowed/full-screen and 4K are required layout cases.
- Every new control needs Chinese and English labels, disabled/hover/pressed
  states and accessible focus behavior without an Edge default focus ring.
- If an existing button style is requested, reuse the class/component contract;
  do not make a visually similar one-off class.

## 11. Import, analysis and performance rules

Import is a staged operation:

1. discover and de-duplicate files;
2. preserve stable identity and existing cache hits;
3. read metadata/cover;
4. restore cached Spectrum ID, MFCC, BPM, Energy and loudness;
5. analyze only missing/stale records;
6. refresh history identity and neural state as required;
7. finish the progress contract;
8. update the UI and Daily Mix without blocking normal interaction.

Rules:

- Do not re-decode cached tracks just because a view re-rendered.
- Do not run O(n²) matching when a stable key/index is available.
- Do not initialize the same analyzer, observer or graph twice.
- Background work must yield through existing scheduling contracts.
- Progress must represent completed work; do not finish the bar before work.
- Import completion must be cancellable/diagnosable without leaving a spinner
  or disabled UI forever.

## 12. History, Neural and recommendation rules

Preference is not recommendation. Keep long-term model, session context,
freshness and diversity separate.

- Behavior events use the existing types and weights.
- Complete play uses the existing accumulated 75% threshold.
- Skip penalty depends on listened fraction.
- Preference decays over time and needs confidence before affecting playback.
- Immature models preserve the original random shuffle behavior.
- Daily Mix uses cached features and offline genre relations; it must not
  require runtime Internet search.
- Similar recommendations must not repeat one song or artist excessively.
- A temporary exploration event must not immediately rewrite long-term taste.
- History UI queries must use real calendar ranges where specified.

## 13. Version and changelog rules

Every user-visible release must update all relevant identity surfaces:

- index.html title and cache-busting version;
- bootstrap public facade;
- settings build card;
- current-version button;
- releases data in Chinese and English;
- Unreleased section when ideas are not implemented;
- generated build after source changes.

Naming:

- Bug fixes: HOTFIX BUILD unless the user supplies another name.
- New feature: ask the user for a release name if none is supplied.
- Patch: x.y.z -> x.y.(z+1).
- Minor feature: x.y.z -> x.(y+1).0.
- Major generation: next generation / major version.
- Never turn a range such as 6.0.1–6.0.7 into an illegal version label.

Apple-style release-note contract:

- Each released version has one short, user-facing overview followed by a small
  set of named areas and concise bullets describing the practical result.
- Chinese and English entries must cover the same areas and remain free of
  implementation-only wording, marketing claims and speculative roadmap items.
- Newest releases appear first; roadmap ideas stay in Unreleased and are never
  presented as shipped changes.
- The release data is the durable source for the in-app log and exported log;
  identity surfaces, bilingual copy and generated output must be updated
  together.

Do not claim a feature is implemented if it only exists in Unreleased.

## 14. Required workflow for every change

Before editing:

1. Categorize the request using section 5.
2. Name the primary owner and every allowed consumer.
3. List exact files expected to change.
4. List files explicitly protected from change.
5. State whether persistence/schema/version/changelog is affected.
6. Define one reproducible success criterion per requested item.

During editing:

1. Make the smallest surgical change.
2. Reuse existing contracts/classes/events.
3. Keep DOM and public APIs stable unless the request explicitly changes them.
4. Do not combine unrelated cleanup.
5. Update comments/docs only when they describe the changed contract.

After editing:

1. Search for duplicate handlers, duplicate connections and stale references.
2. Run build.ps1.
3. Run validate-architecture.ps1.
4. Run tests/contract-tests.ps1.
5. Run targeted static checks for the changed module.
6. If possible, test in Edge/file:// with the user's real scenario.
7. Report static, runtime and visual verification separately.
8. Complete DELIVERY_CHECKLIST.md and include its PASS/NOT RUN/BLOCKED
   results in the handoff.

## 15. Stop conditions

Stop and redesign if a proposal would:

- delete or reset user data;
- create a second state owner, AudioContext, queue or playlist;
- alter Spectrum ID or cache identity without migration;
- bypass the module owner;
- add runtime network dependencies;
- add a second SSE/popover/material system;
- use a white/black overlay to hide a geometry problem;
- hard-code a 60/120 frame loop;
- edit generated output directly;
- claim Edge/audio/4K verification that was not actually performed.

When uncertain, inspect the source and ask one focused question rather than
guessing.
