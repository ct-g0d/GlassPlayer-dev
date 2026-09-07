# Glass Player 7.3.1 Music Galaxy Design

## Status

Design approved in chat on 2026-08-25. The user confirmed that the Music
Galaxy placeholder must become the real feature and that the release name is
`GALAXY UPDATE`. Implementation remains pending spec review.

## Goal

Replace the current `敬请期待` Music Galaxy sector with a believable local
music star map in which every imported song is a softly hazy luminous point,
similar songs stay near one another, style/tempo regions receive restrained
labels, and the same MFCC/BPM relationship improves Daily Mix coherence.

The release also updates the visible engine identity to GP Fusion Engine 4.0,
GP Spectrum Engine 2.3 and GP Neural Engine 2.2 while preserving existing
audio, storage and user-data contracts.

## Chosen approach

Use a Canvas 2D renderer with a pure Music Galaxy Service rather than WebGL.
Canvas 2D is the smallest reliable fit for the existing local `file://`
runtime, supports the requested atmospheric point rendering, and avoids adding
a GPU lifecycle, shader compilation path or browser-specific fallback for the
normal library sizes. The renderer will still use device-pixel-ratio backing
resolution, cached glow sprites and a cached starfield so the result remains
sharp and responsive at 4K.

WebGL was considered for very large libraries, but it would introduce a second
rendering lifecycle with no existing project contract and would make local
browser validation materially harder. SVG was rejected because one DOM node per
song would make hit testing, hover labels and large libraries less stable.

## User-visible behavior

### Galaxy surface

The existing `section.view.galaxy-view` remains the protected primary-view
surface. Its centered placeholder is replaced by a declared child structure:

- a short localized view header and feature-coverage status;
- one responsive Canvas for the star map;
- a compact legend/status line for song count, usable feature count and the
  current interaction state;
- one lightweight tooltip element reused for hover and click selection.

The tooltip shows only title, artist, style and rounded BPM. It never displays
the raw MFCC vector or a large metadata card. Click selection remains a
selection/display action and does not unexpectedly start playback.

### Point appearance

Each usable song is drawn as a small point with three restrained layers:

1. a low-alpha mist halo;
2. a colored luminous body derived from the existing Accent/ambient palette;
3. a tiny bright core with a slight per-point size variation.

The map background contains a deterministic sparse star field and a broad,
low-contrast Milky-Way-like density band. The background is rendered to a
cached offscreen layer; it is not a giant CSS blur or a second glass panel.
Points use cached radial sprites and additive compositing instead of setting a
large `shadowBlur` for every point on every frame.

### Cluster labels

The layout groups tracks into deterministic style/tempo regions. Each region
gets one concise localized label such as `电子 · 128 BPM` / `Electronic · 128
BPM`. Labels sit slightly above their region and use a very restrained text
glow. A label is omitted when the region has insufficient feature coverage or
would overlap a more confident label.

### Pointer interaction

The renderer keeps the last pointer position and speed in CSS pixels per
second. A point tooltip is eligible only after the pointer is below the
`GALAXY_HOVER_SPEED_LIMIT` and remains over a point for the short dwell window.
Fast pointer movement hides the tooltip and only updates the hit-test target;
it never performs a full metadata redraw for every event. A click pins the
short tooltip until another point, the canvas background or Escape is used.

Hit testing uses a screen-space spatial hash with fixed cells rather than
checking every point for every pointer event. Pointer capture is not used for
ordinary hover, so leaving the Canvas always clears transient hover state.
Reduced-motion mode skips point interpolation and immediately presents the
new deterministic layout.

## Data and layout contract

### Canonical feature input

The Music Galaxy Service consumes existing track fields only:

- `track.mfcc.mean[0..12]` when present;
- `track.bpm` and `track.bpmConfidence` when present;
- `track.inferredGenre`, `track.genre`, `track.genreSecondary` and
  `track.genreScores` for labels and fallback grouping;
- `track.energy` only for point brightness, never for distance in the primary
  MFCC/BPM layout metric;
- `track.spectrumId`, `track.audioEssenceKey` or `track.contentKey` as the
  stable layout key.

Missing features produce a dim, low-confidence point placed in a deterministic
peripheral fallback region. Opening or rendering the Galaxy never decodes an
audio file and never queues analysis merely because a view rendered.

### Feature vector and distance

The shared feature vector is 14-dimensional: 13 MFCC coefficients plus a
normalized BPM component. Each dimension is robustly normalized against the
current feature set, with a fixed fallback scale for small libraries. BPM is
weighted by confidence; missing or low-confidence BPM reduces its contribution
rather than creating a fake value.

The shared similarity result contains:

- MFCC similarity;
- tempo similarity using an exponential BPM distance;
- optional offline genre-family similarity;
- an overall bounded `[0,1]` score;
- feature coverage and confidence.

This result is the only feature-distance contract consumed by both Galaxy and
Neural. No duplicate MFCC/BPM distance implementation is added to the view.

### Deterministic 2D layout

The service produces stable point records keyed by the stable audio identity.
The layout pipeline is:

1. collect usable vectors and calculate normalized covariance;
2. derive two deterministic principal directions with fixed power-iteration
   counts;
3. map the two components into a broad elliptical galaxy field while keeping
   local distance order;
4. assign deterministic style/tempo clusters using feature-aware seeded
   farthest-point initialization and bounded refinement;
5. arrange cluster anchors along a subtle two-arm spiral so the map reads as a
   galaxy without separating similar songs arbitrarily;
6. place each point around its cluster anchor using its local projected vector,
   stable identity jitter and a bounded density radius;
7. return points, clusters, labels, feature coverage and a layout signature.

The same track and same feature set must yield the same logical coordinates
regardless of playlist order. New or changed tracks animate from their old
coordinate to the new coordinate over elapsed time; the animation is never
controlled by a fixed frame count.

The public service boundary is pure and serializable:

```text
createGalaxyService() -> {
  featureVector(track) -> FeatureVector,
  compareTracks(left, right) -> Similarity,
  buildLayout(tracks, options) -> GalaxyLayout,
  recommendationSimilarity(anchor, candidate) -> Similarity
}
```

The returned arrays and records are frozen or cloned snapshots. Canvas contexts,
DOM nodes, timers and pointer handles never cross this boundary.

## Neural integration

Neural Service receives the single Galaxy Service facade during bootstrap. Daily
Mix keeps its current anchor, freshness and artist-diversity safeguards, but
its coherence score uses the shared MFCC/BPM similarity as the dominant
acoustic signal. A Daily Mix remains a randomized weighted selection from a
coherent shortlist, so it does not become a fixed sorted list.

Normal immature-model Shuffle keeps its existing random safety contract and
does not become a hidden long-term preference system. The requested stronger
style/tempo grouping is applied to the Daily Mix generator and its random
shortlist, where it is visible as a coherent recommendation set.

No user-model record, behavior-event shape, recommendation store key or
listening-history identity changes. Existing recommendation records remain
readable; the new generator writes the same recommendation boundary and
stable track identities.

## Version and cache compatibility

7.3.1 is a user-specified patch release named `GALAXY UPDATE`. All identity
surfaces must agree on 7.3.1, including the document title, cache-busting
queries, settings build card, current-version button, bootstrap facade,
analyzer facade, bilingual release data and generated output.

Visible engine identity becomes:

- GP Fusion Engine 4.0;
- GP Spectrum Engine 2.3;
- GP Neural Engine 2.2 — Resonance Boost.

The engine identity version is separate from the persisted analysis/cache
compatibility token. Because Galaxy consumes already stored MFCC/BPM, the
release must not invalidate every existing track or force a full-library
decode. Old valid Spectrum records remain readable through a compatibility
path; only missing or genuinely stale analysis is eligible for work. The
IndexedDB name/version/stores/indexes, localStorage keys, Spectrum ID and audio
essence identity remain unchanged.

## Ownership and protected scope

Primary owner: new Music Galaxy Service in
`src/services/galaxy-runtime.js`.

Allowed consumers:

- `src/ui/galaxy-view.js` for Canvas rendering and pointer interaction;
- `src/services/neural-runtime.js` for shared recommendation similarity;
- `src/bootstrap/main.js` for dependency injection and public engine identity;
- existing Spectrum/Library code for cache-first track feature input.

Expected source/document files are:

- Create `src/services/galaxy-runtime.js`.
- Create `src/ui/galaxy-view.js`.
- Modify `SOURCE_ORDER.txt`, `index.html`, `app.css`,
  `src/bootstrap/main.js`, `src/services/neural-runtime.js`,
  `src/data/i18n.js`, `src/data/releases.js` and the minimal compatible
  Spectrum/version identity source files.
- Modify the matching contract tests and add a pure Node Galaxy service test.
- Update `AGENTS.md`, `CURRENT_STATE.md`, `MODULE_API.md`,
  `MODULE_GOVERNANCE.md`, `DEPENDENCY_GRAPH.md`, `EVENT_CONTRACTS.md` and
  `DELIVERY_CHECKLIST.md` only for the new ownership, API, event or release
  facts they actually document.

Protected from change:

- `build/app.js` directly;
- root `app.js` and `original/Glass Player 6.2.2.html`;
- IndexedDB schema/data, localStorage keys, track identity, history,
  behavior events and user-model storage;
- existing AudioContext, Deck A/B, EQ, Loudness, Spatial, Queue and Shuffle
  runtime ownership;
- existing navigation order, sidebar contract and unrelated panels/sectors;
- existing Accent selected-state behavior restored for 7.2.2.

## Motion and performance contract

- Static map rendering is event-driven; no visual `setInterval` loop is added.
- One requestAnimationFrame scheduler owns resize fitting, layout interpolation
  and active pointer transition work.
- Resize schedules one coalesced redraw and rebuilds only the viewport transform,
  not the feature layout unless the track signature changed.
- Background starfield and glow sprites are cached and invalidated only by
  size, theme/Accent palette or reduced-motion changes.
- Point drawing is bounded by the visible Canvas and uses no per-point DOM.
- Pointermove work records the latest event, uses the spatial hash and lets the
  shared frame scheduler commit tooltip state.
- The 4K target is sharpness plus bounded work, not a forced 120-iteration
  animation. Real 4K/120 Hz behavior remains a separately reported runtime
  check.

## Verification plan

The implementation must follow RED → GREEN → REFACTOR for each pure behavior.

The pure Node test will prove:

- the feature vector has the expected MFCC/BPM shape;
- identical tracks compare as maximally similar;
- closer MFCC/BPM tracks score above distant tracks;
- layout point keys are stable across playlist reorder;
- layout output contains finite coordinates, bounded clusters and localized
  labels;
- the recommendation similarity favors close tempo and MFCC matches.

Contract tests will prove:

- the placeholder text and placeholder-only CSS are gone;
- Canvas, tooltip, status and Galaxy Service hooks exist;
- the source order contains the new owner modules in declared order;
- the high-speed hover suppression and spatial-hash hit testing contracts are
  present;
- Neural receives the shared Galaxy similarity path;
- 7.3.1 and all three requested engine names are synchronized;
- the Apple-style bilingual `GALAXY UPDATE` release entry is newest-first;
- no second queue, Store, Event Bus, AudioContext, analysis cache or runtime
  network dependency was introduced.

Required final commands remain:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\validate-architecture.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\contract-tests.ps1
```

Also run the bundled Node syntax check, the pure Galaxy service test, targeted
static duplicate/ownership scans and, if the environment permits, a real
Edge/file:// interaction check with imported local music. Static, visual and
audio results must be reported separately.

## Acceptance criteria

1. Opening Music Galaxy shows a full atmospheric star map instead of
   `敬请期待` or `Coming Soon`.
2. Every imported song with usable features appears as one distinct hazy
   luminous point; similar songs form visibly near regions.
3. The map contains restrained Milky-Way-like depth, background stars and
   style/tempo labels without a giant blur layer or page-wide fake overlay.
4. Slow hover and click reveal only concise song information; fast pointer
   movement does not cause tooltip churn or visible lag.
5. Daily Mix consistently favors a coherent style/tempo neighborhood while
   preserving freshness, artist diversity and the existing random shortlist.
6. Existing cached MFCC/BPM/history/user data remains readable without a
   forced full-library reanalysis.
7. Fusion 4.0, Spectrum 2.3, Neural 2.2 and 7.3.1 agree across all current
   identity surfaces and the bilingual Apple-style release log.
8. Build, architecture validation, contracts, pure service tests and Node
   syntax checks pass; any unavailable Edge/audio/4K check is explicitly
   marked NOT RUN or BLOCKED.
