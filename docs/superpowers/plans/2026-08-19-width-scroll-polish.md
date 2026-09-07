# Width and scroll polish

## Scope

Continue the existing 7.2.2 hotfix without changing version identity. Align
all primary view surfaces with the Listening History width, remove only the
Changelog edge mask, make the History Top 1-10 column scrollable, and reveal
liquid scrollbar thumbs only after actual scrolling.

## Owner map

- `app.css`: shared primary-view width, Changelog mask override, complete
  History ranking scroll surface, and draggable liquid scrollbar styling.
- `src/ui/shared-controls.js`: shared scrollbar activation trigger; keep the
  existing SSE lifecycle and scroll-edge measurement intact.
- `src/data/releases.js` / `CURRENT_STATE.md`: record the 7.2.2 continuation
  without changing the version identity.
- `tests/contract-tests.ps1`: regression contracts for the requested behavior.

## Protected behavior

Do not edit generated `build/app.js` directly. Preserve version 7.2.2,
Changelog content/hierarchy/selection, History records and ranking data,
Store/persistence/audio/queue behavior, and the existing shared shell/viewport
contract outside the Changelog mask presentation.

## Implementation and verification

1. Add contracts for the unchanged 7.2.2 identity, unified 1280px primary
   view width, Changelog mask removal, History left-column scrolling, and the
   absence of pointerover scrollbar activation. Run contracts and capture RED.
2. Apply the smallest CSS/shared-control changes: make all primary views use
   the History 1280px width, give the complete History ranking surface a
   bounded vertical scroll area so Top 1–10 can be reached, keep native
   scrollbar geometry available while
   its thumb remains transparent, remove pointerover activation, and disable
   only the Changelog viewport masks.
3. Synchronize the existing 7.2.2 Chinese/English changelog text and current
   state notes without creating a new version.
4. Regenerate the build, run architecture/contracts, bundled Node syntax, and
   targeted static checks. Report browser/file:// visual verification
   separately if it cannot be run.
