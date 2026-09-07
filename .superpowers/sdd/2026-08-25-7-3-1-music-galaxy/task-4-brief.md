# Task 4: Replace the Music Galaxy placeholder with localized DOM and shell CSS

Task 1 added the initial Galaxy RED contracts and Task 3 is complete. Replace
only the existing Galaxy section child and its placeholder styles with a
stable, accessible Canvas surface. Do not implement Canvas rendering or
pointer behavior in this task; Task 5 owns `src/ui/galaxy-view.js`.

## Files

- Modify `index.html`.
- Modify `app.css`.
- Modify `src/data/i18n.js`.
- Modify `tests/contract-tests.ps1`.

Do not modify any `src/**` JavaScript view/service/bootstrap file in this task.

## RED contract first

Before changing `index.html`, ensure the contract has an exact real-surface
assertion and run the contract script against the placeholder to observe RED:

```powershell
Expect ($index -match '<section class="view galaxy-view" data-view="galaxy">' -and $index -match 'class="galaxy-surface"' -and $index -match 'id="galaxyCanvas"' -and $index -match 'id="galaxyTooltip"' -and $index -match 'id="galaxyStatus"' -and $index -notmatch 'galaxy-coming-soon|敬请期待|Coming Soon') 'Music Galaxy must expose the real Canvas surface'
```

The contract already loads `$i18nSource`, `$galaxySource` and
`$galaxyViewSource`; reuse those variables. Reconcile the old 7.0/7.1
placeholder contracts instead of leaving contradictory requirements:

- Replace the old `galaxy-coming-soon` DOM assertion with the real-surface
  assertion.
- Replace the old English `Music Galaxy`/`Coming Soon` assertion with a
  localized-copy assertion against `index.html`/`src/data/i18n.js` that does
  not require `Coming Soon`.
- Update the adaptive-title CSS/build assertion to use the new `.galaxy-title`
  selector while retaining the existing 500 ms liquid-scrollbar contract.

Run the contract after these RED-only edits and record the expected named
failures before changing production DOM/CSS.

## Required DOM surface

Keep the existing section and `data-view="galaxy"` unchanged. Replace only
the centered `galaxy-coming-soon` child with one `.galaxy-surface` child that
contains:

- a `.galaxy-header` with a concise `.galaxy-kicker`, `.galaxy-title`
  heading, and `.galaxy-subtitle` explaining that each star represents a
  song and nearby stars share musical traits;
- a `.galaxy-stage`/`.galaxy-canvas-shell` containing exactly one
  `<canvas id="galaxyCanvas">` with `tabindex="0"`, a localized `aria-label`,
  and no inline layout state;
- one `<div id="galaxyTooltip" class="galaxy-tooltip" role="status"
  aria-live="polite" hidden></div>` for concise song information;
- one `<div id="galaxyStatus" class="galaxy-status" role="status"
  aria-live="polite"></div>` for coverage/count/empty-library status;
- a small `.galaxy-legend` or hint row using existing text contrast and no
  second popover/material system.

Keep all existing sidebar/nav order and all unrelated section markup exactly
as-is. Do not add duplicate canvases, masks, shell overlays, or hidden state
attributes that become a second owner of the layout.

## Localized copy

Add Chinese and English strings, plus direct Russian entries in `UI_RU` where
the current table supports them, for:

- Galaxy title and subtitle;
- star/song and cluster/genre hint;
- hover-to-identify and click-to-pin hints;
- empty library instruction;
- partial-feature coverage status;
- point/song count status;
- concise tooltip labels for song title, artist, genre and BPM;
- cluster label suffixes or tempo wording.

Keep the Chinese/English areas semantically matched. Do not put raw MFCC
vectors, Canvas/WebGL implementation wording, speculative roadmap text, or
long explanatory paragraphs in user-facing strings. Russian may use the
existing English fallback for any dynamic phrase, but must not fall back to
Chinese explanatory copy. Do not retain `敬请期待`/`Coming Soon` as the Galaxy
view copy.

## Scoped visual shell CSS

Remove the `.galaxy-coming-soon` rule and add only `.galaxy-*` selectors for
the new surface. Reuse the established acrylic/sector variables, typography,
radius, `--gp-popover-surface`, `--gp-popover-blur` and
`--gp-popover-shadow`. The shell must remain transparent enough to reveal the
player background and must not paint a white/black strip, second glass frame,
or page-wide backdrop.

Cover these states with scoped selectors:

- responsive minimum stage height and `contain:layout paint`/overflow safety;
- Canvas fills its shell without horizontal page growth;
- tooltip is small, surface-aware, pointer-events none and readable at 100%,
  110% and 4K;
- status/legend contrast uses existing text variables;
- reduced-motion fallback disables only Galaxy shell transitions;
- focus-visible state for the Canvas reuses the existing Accent/focus
  contract without an Edge default ring.

Do not add fixed-frame loops, JavaScript, `setInterval`, or global selectors.

## Checks

Run:

```powershell
rg -n 'galaxy-coming-soon|敬请期待|Coming Soon' index.html app.css src tests
rg -n 'galaxyCanvas|galaxyTooltip|galaxyStatus|galaxy-surface|galaxy-canvas' index.html app.css
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\contract-tests.ps1
```

Expected: no placeholder residue in current source/i18n/tests, stable DOM/CSS
hooks are present, and the updated DOM/CSS contracts pass. Later View,
version, release and governance contracts may remain RED. Do not change the
old generated `build/app.js`; Task 8 regenerates it.

## Boundaries

- Do not create `src/ui/galaxy-view.js` yet.
- Do not modify `src/bootstrap/main.js`, `src/ui/shared-controls.js`,
  `src/services/neural-runtime.js`, `src/services/galaxy-runtime.js`,
  `SOURCE_ORDER.txt`, `build/app.js`, release files or governance docs.
- Do not change Store state, Event Bus events, IndexedDB/localStorage/schema,
  Spectrum ID/cache identity, model/history data, audio graph or navigation
  ownership.
- Do not add a second popover/material system or a global CSS selector.
- Do not dispatch subagents.
- The project has no usable Git metadata; do not initialize Git or create
  commits.

## Report

Write the full report to:
`.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-4-report.md`

Include RED/GREEN contract evidence, exact changed hooks/copy/CSS states,
residue scans, syntax/static checks, self-review and concerns. Return only
status, changed files, one-line tests, and concerns after writing the report.
