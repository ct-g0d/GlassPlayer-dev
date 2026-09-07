# Architecture Report — 6.4.4 HOTFIX BUILD

## Outcome

Glass Player now identifies its browser architecture as **Peregrine Lake** and its core as **GP Core 4.0**. The completed 6.3.2/6.3.1 project was the only source baseline.

6.4.4 keeps those ownership boundaries, the governed read-only `src/data/genre-relations.js` module and the existing frame-pacing work. This hotfix changes folder SVG/CSS presentation, localization refresh and History display windows without adding a network path or changing persisted data.

The verified runtime was migrated from `src/js` and `src/modules` into formal `core`, `adapters/browser`, `engines`, `services`, `ui`, `data` and `bootstrap` directories. Empty legacy directories were removed. Existing implementation bodies were moved rather than copied, preserving the single playlist, Queue, audio graph, analysis runtime, history cache, Neural model and PiP lifecycle.

## Implemented boundaries

- One `window.GPModules` factory registry.
- One serializable App Store with Actions and Selectors.
- One Event Bus with centralized event names.
- One frozen App Context created by `bootstrap/main.js`.
- Browser Storage, File, PiP, Media Session and Clock Ports.
- Explicit Audio, EQ, Spatial, Recognition, Spectrum and Motion Engine contracts.
- Explicit Playback, Queue, Library, History, Spectrum, Neural, Settings and PiP Service contracts.
- View lifecycle factories and formal UI ownership.
- Read-only `window.GP` compatibility facade; the full App Context remains private.

## 6.4.4 compatibility contract

Spectrum ID, MFCC, BPM, Energy, original Loudness, EQ, Spatial parameters, Queue, history persistence, IndexedDB database/version/store/index and all existing user records remain compatible. The existing `glassPlayerPrefs` record gains one optional boolean. Existing cached Loudness derives normalization without re-decoding audio.

`SOURCE_ORDER.txt` remains the only build-order authority. `build.ps1` emits one `build/app.js`; `index.html` loads only that script without module/defer/async semantics.

## Known verification boundary

Automated `file://` navigation was blocked by the browser-control security policy. Build, syntax, architecture, ownership and static contract checks passed; direct interactive media regression must still be performed by opening `index.html` normally in Edge. This limitation is not reported as a product failure.
