# Taskbar Icon, Audio Settings, and History Ranking Hotfix Design

**Date:** 2026-08-16
**Release target:** 7.2.1 — HOTFIX BUILD

## Goal

Repair inconsistent taskbar icon stroke weights, move the complete right-side Sound surface into Settings > Audio, and reshape Listening History into a non-scrolling left Top 10 area plus a right-only scrollable ranks 11–50 area.

## Evidence and root causes

- Sidebar SVGs currently mix visible `stroke-width` values: the player icon contains 1.8, 1.5 and a hidden 2.6 motion path; the Galaxy icon contains 1.45, 1.35 and 1.3; the remaining navigation icons use 1.8. This is a source-level cause of uneven taskbar weight.
- The right panel owns one `#soundBody` containing EQ, Spatial Audio, loudness normalization and track file information. The Settings Audio pane is only explanatory copy, so the controls have one natural destination but are currently attached to the wrong surface.
- History rendering slices only the first ten candidates, places Top 3 beside ranks 4–10, and lets `#topList` own scrolling. Play counts are rendered in the summary card and ranking metadata.

## Design decisions

### 1. Taskbar icon weight

Use one taskbar icon contract in `app.css`: visible stroked elements under `.nav-item` use a 1.8px non-scaling stroke. Keep the existing icon paths, opacity hierarchy, and motion classes; hidden motion artwork may retain its animation behavior but must not create a visible static weight mismatch. The fix is presentation-only and does not change navigation state or motion timing.

### 2. Audio settings ownership

Move the complete existing Sound surface, including file information, into the existing Settings `audio` pane. Preserve all control IDs (`eqPresetButton`, EQ curve nodes, Spatial controls, loudness controls, and track information nodes) so the existing Equalizer Engine, Spatial Engine, Settings Service, and playback detail refresh path continue to target the same state and DOM contracts.

Remove only the right-panel Sound tab and its old `#soundBody` surface. The right panel continues to own Queue and Daily Mix. Update Shared Controls to manage only the remaining two panel bodies and remove `#soundBody` from the shared scroll-shell registration. Keep one EQ state, one Spatial state, one loudness state, and one set of info popovers.

### 3. Listening History layout and content

Keep the existing range and history mode controls. Remove the play-count summary card, `historyStatPlays` updates, play-count metadata in ranking rows, and the explanatory caption below the Top 3 label.

Render up to 50 time-ranked songs as:

- Left column: a `Top 10` heading, the existing podium for ranks 1–3, then compact rows for ranks 4–10.
- Right column: compact rows for ranks 11–50.

Keep the existing `historyTop3` and `historyRanks4to10` IDs for compatibility, and add a dedicated `historyRanks11to50` container. `#topList` becomes a clipped layout shell; the left column has no scrolling or scroll registration, while only `historyRanks11to50` owns vertical overflow. The right list displays duration and progress only, with no play-count field.

## Ownership and protected contracts

- Icon presentation owner: `index.html` SVG markup and `app.css` taskbar icon rules; Shared Controls remains the motion/navigation consumer.
- Audio surface owner: Settings UI plus existing Equalizer, Spatial, Audio, and Settings service contracts; no new service or state owner.
- History owner: `src/services/history-service.js`; `index.html` and `app.css` are presentation consumers.
- Contract tests: `tests/contract-tests.ps1`.
- Protected: IndexedDB name/version/stores/indexes, localStorage keys, history identity/timestamps, EQ/Spatial/loudness state, AudioContext/deck graph, queue arrays, public events, existing control IDs, generated `build/app.js`, root `app.js`, and historical HTML.

## Version and documentation impact

This is a user-visible patch release. Synchronize `index.html`, `src/bootstrap/main.js`, settings About card, current-version label, `src/data/releases.js` in Chinese and English, `CURRENT_STATE.md`, and generated `build/app.js` to 7.2.1 — HOTFIX BUILD. Core remains 4.1 and Motion remains 4.1.

No persistence, schema, audio graph, queue, public API, or event contract changes are expected.

## Verification design

Write failing contracts before production edits for:

1. One taskbar stroke contract with no inconsistent visible Galaxy/player stroke declarations.
2. No right-panel Sound tab/body, Audio settings containing the preserved EQ/Spatial/loudness/file-info controls, and Shared Controls registering only existing scroll surfaces.
3. No History play-count card/metadata, `Top 10` left label, ranks 11–50 container, 50-row cap, and right-only overflow rules.

Then run the full build, architecture validation, contract suite, generated-bundle syntax check, targeted source checks, and (if available) Edge/file:// visual verification. Report blocked browser or hardware checks separately.
