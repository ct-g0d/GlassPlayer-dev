# BUILD REPORT

> Current checkpoint: Glass Player 6.4.4 HOTFIX BUILD / Peregrine Lake / GP Core 4.0 builds from 55 governed formal source files. Architecture validation, JavaScript syntax and 32 contract checks pass. Current build SHA-256: `ED0CED26A1FB9158342A9ED0B4E5D8655E31322AAA0AED0FB66CCC1E9980915C`. See `ARCHITECTURE_REPORT.md` and `ARCHITECTURE_VALIDATION_REPORT.md`.

> Historical checkpoint below records the completed 6.3.1 / GP Core 3.1 second-stage build. For the current 6.4.4 architecture, source order, hashes and regression results, see `ARCHITECTURE_REPORT.md`, `MODULE_GOVERNANCE.md` and `ARCHITECTURE_VALIDATION_REPORT.md`.

Release designation: Glass Player 6.3.1 HARMONIC ENHANCE  
Architecture designation: GP Core 3.1  
Stage: Source slicing and single-file build only

## Baseline declaration

- Input baseline: the existing first-stage `GlassPlayer-dev` project.
- JavaScript source baseline: the existing `app.js`.
- The original single-file HTML was not used to extract or regenerate runtime code.
- The first-stage extraction was not rerun.
- The existing `app.js`, `app.css`, and `original/Glass Player 6.2.2.html` were not regenerated.
- `index.html` was not regenerated; its only change is `./app.js` → `./build/app.js`.
- No parallel project or second runtime baseline was created.

Because this stage requires `app.js` to remain byte-identical, the 6.3.1 / GP Core 3.1 designation is recorded in this report only. Runtime version strings and the built-in changelog remain exactly as they were in the first-stage `app.js` baseline.

## Continuous source fragments

Line references use the existing first-stage `app.js` baseline.

| Order | Source fragment | Baseline lines | Continuous region |
|---:|---|---:|---|
| 1 | `src/js/00-preamble.js` | 1–107 | Outer IIFE opening, strict mode, state declarations, audio/runtime state, selectors |
| 2 | `src/js/10-state-and-audio-context.js` | 108–116 | Harmonic Lake architecture marker and schema/version constants |
| 3 | `src/js/20-database-and-storage.js` | 117–216 | IndexedDB adapter and GP database facade |
| 4 | `src/js/30-recognition-and-metadata.js` | 217–294 | Analyzer contract and existing audio compatibility boundaries |
| 5 | `src/js/40-spectrum-analysis.js` | 295–383 | Existing GP runtime metadata, UI boundary markers, i18n state and translation entry points |
| 6 | `src/js/50-i18n-and-changelog.js` | 384–3238 | Complete release data, English release detail data, changelog rendering and export |
| 7 | `src/js/60-playback-and-queue.js` | 3239–3906 | Feedback, navigation, panel motion/SSE, shared helpers, cover and metadata/genre extraction |
| 8 | `src/js/70-spatial-and-eq.js` | 3907–5905 | Neural/recommendation runtime, ambient/art rendering, library/import, Queue and playback engine |
| 9 | `src/js/80-history-and-neural.js` | 5906–6233 | Listening-history runtime, seek and track peak/format analysis |
| 10 | `src/js/90-ui-motion-and-pip.js` | 6234–7113 | EQ, Spatial Engine, track information, Snooze, traditional PiP, audio events, import wiring, settings and viewport fitting |
| 11 | `src/js/99-init-and-epilogue.js` | 7114–7134 | Original initialization sequence and outer IIFE closure |

The names describe approximate ownership only. No function, declaration, listener, or initialization block was moved to improve classification. Every fragment is a consecutive byte range from the existing `app.js`.

## Build order

`build.ps1` reads `SOURCE_ORDER.txt` and concatenates these files in fixed order:

1. `src/js/00-preamble.js`
2. `src/js/10-state-and-audio-context.js`
3. `src/js/20-database-and-storage.js`
4. `src/js/30-recognition-and-metadata.js`
5. `src/js/40-spectrum-analysis.js`
6. `src/js/50-i18n-and-changelog.js`
7. `src/js/60-playback-and-queue.js`
8. `src/js/70-spatial-and-eq.js`
9. `src/js/80-history-and-neural.js`
10. `src/js/90-ui-motion-and-pip.js`
11. `src/js/99-init-and-epilogue.js`

The build performs no formatting, minification, transpilation, module wrapping, code generation, or separator injection. Fragment bytes are written directly to `build/app.js` in the listed order using UTF-8 without BOM.

## Required declarations

| Check | Result |
|---|---|
| Logic changed | No |
| Execution order changed | No |
| Scope changed | No |
| Data structure changed | No |
| `app.css` modified | No |
| `index.html` regenerated | No |
| `index.html` only change is the script path | Yes |
| Second parallel source/runtime created | No |
| Business modules introduced | No |
| ES Modules/import/export introduced | No |

## Exact-build verification

| Check | First-stage `app.js` | `build/app.js` | Result |
|---|---:|---:|---|
| SHA-256 | `d51344e628426ec85ed257fb6e321205f999437950f21d5d2c061cf214ba33b6` | `d51344e628426ec85ed257fb6e321205f999437950f21d5d2c061cf214ba33b6` | Pass |
| Named function declarations | 347 | 347 | Pass |
| Class declarations | 10 | 10 | Pass |
| `addEventListener` calls | 145 | 145 | Pass |
| RELEASES entries | 88 | 88 | Pass |
| Outermost IIFE openings | 1 | 1 | Pass |
| Outermost IIFE closings | 1 | 1 | Pass |
| Module statements | 0 | 0 | Pass |

Exact byte comparison: Pass.  
JavaScript syntax check: Pass.

### Preserved localStorage keys

- `glassPlayerHistory`
- `glassPlayerPrefs`

### Preserved IndexedDB object stores

- `trackFeatures`
- `behaviorEvents`
- `userModel`
- `recommendations`
- `trackCache`

### Preserved GP engine identities

- GP Core 3.0
- GP Fusion Engine 2.0
- GP Motion Engine 3.1
- GP Spatial Engine 1.1
- GP Spectrum Engine 2.0
- GP Spectrum ID 1.0
- GP Neural Engine 2.0 — Resonance Boost

## Entry-point verification

- `index.html` loads exactly one runtime script: `./build/app.js`.
- `index.html` does not load `./app.js`.
- `index.html` does not load any individual `src/js` fragment.
- `app.css` SHA-256 remains `079bd1955bef707a572456b5cbcd097b5b382dd74688482732c4c05fd5424475`.
- `build/app.js` exists beside the fixed build structure and is produced successfully by `build.ps1`.

## Runtime verification scope

The generated JavaScript is byte-for-byte identical to the already-running first-stage JavaScript baseline, so function bodies, declaration order, lexical scope, listeners, initialization, audio output logic, animations and data access code are unchanged.

Automated `file://` browser-console inspection could not be executed because the controlled browser blocks local-file navigation by security policy. Interactive tests requiring the user's local music files and Picture-in-Picture permission were therefore not falsely reported as executed. Static syntax, exact-byte equivalence, entry-point structure, storage contracts and build reproducibility all pass.

No third-stage modularization was performed.
