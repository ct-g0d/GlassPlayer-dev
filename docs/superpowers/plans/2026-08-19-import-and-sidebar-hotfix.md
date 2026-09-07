# Import and sidebar hotfix

## Scope

Fix the five reported regressions without changing playback, queue, history,
stable audio identity, or IndexedDB schema.

## Owner map

- `src/services/library-runtime.js`: hidden-safe cooperative import scheduling,
  spectrum foreground waits, import completion wait, and cached file probe
  reads.
- `src/services/neural-runtime.js`: time-sliced import-time Daily Mix scoring
  and hidden-safe recommendation waits.
- `src/ui/settings-view.js` / `index.html` / `app.css`: settings category
  sidebar glider through the existing shared glider contract.
- `src/ui/shared-controls.js`, `src/ui/changelog-view.js`,
  `src/data/releases.js`, `app.css`: remove the Changelog leaf-selection
  glider and its now-unused motion hooks.
- `tests/contract-tests.ps1`: regression contracts.

## Protected behavior

Do not edit generated `build/app.js` directly. Preserve the existing File API
identity samples, cache keys, IndexedDB schema, playlist/queue state, audio
graph, history records, and Changelog hierarchy/selection behavior.

## Implementation and verification

1. Add contracts for a hidden-safe yield, chunk/prefix file-read reuse,
   time-sliced Daily Mix scoring, settings glider ownership, and removed
   Changelog leaf glider. Run the contract suite and capture the expected
   failure before production edits.
2. Replace blocking visual-frame waits in import/recommendation work with a
   shared timer fallback when the document is hidden; keep visible work
   refresh-driven. Verify no import-critical direct rAF wait remains.
3. Add per-File prefix and aligned probe-chunk caching and route recognition,
   embedded-cover, and metadata probe reads through it. Verify returned byte
   ranges remain exact and large payload reads remain bounded/direct.
4. Score Daily Mix candidates in elapsed-time slices and yield between slices;
   keep ranking, weights, persistence, and final count unchanged.
5. Add the settings sidebar to the shared glider registry and remove only the
   Changelog release-leaf glider implementation/styles/call sites.
6. Regenerate the build, run architecture/contracts, bundled Node syntax and
   targeted static checks, then complete the delivery checklist. Report
   browser/file:// visual and minimize/remote-drive runtime checks separately
   if they cannot be run in this environment.
