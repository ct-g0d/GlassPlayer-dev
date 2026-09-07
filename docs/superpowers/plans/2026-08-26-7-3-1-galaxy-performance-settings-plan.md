# Glass Player 7.3.1 Galaxy, Import and Settings Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair every reported Galaxy, import-performance, typography and Settings bug in the existing 7.3.1 runtime.

**Architecture:** Keep one Canvas Galaxy View, one playlist and the existing service boundaries. UI owns viewport/label/tooltip presentation; Library/Neural own import policy; Browser Adapter owns folder capability; existing Settings/Sound owners receive local presentation fixes.

**Tech Stack:** Ordered single-file JavaScript fragments, Canvas 2D, CSS, IndexedDB through existing adapters, PowerShell contract tests, bundled Node syntax checks.

**Spec:** `docs/superpowers/specs/2026-08-26-7-3-1-galaxy-performance-settings-design.md`

## Global Constraints

- Do not edit `build/app.js`, root `app.js` or `original/Glass Player 6.2.2.html`.
- Preserve one Store, Event Bus, playlist, queue, AudioContext, Deck A/B graph, Spatial buses and existing storage schema/identity.
- Use cached MFCC/BPM/Energy/loudness before decoding; no mass re-analysis.
- Do not add runtime network, fixed-frame animation loops, fake white/black overlays or duplicate popover/SSE systems.
- Keep 7.3.1 identity unless a user explicitly supplies a release version/name.

### Task 1: Galaxy viewport and density repair

**Files:**
- Modify: `src/ui/galaxy-view.js`
- Modify: `app.css`
- Test/contract: `tests/galaxy-runtime.test.js`, `tests/contract-tests.ps1`

- [ ] Add failing static/pure assertions for bounded zoom/pan, visible label filtering, title-only tooltip and responsive stage height.
- [ ] Run targeted assertions and confirm RED.
- [ ] Add a bounded viewport `{scale,offsetX,offsetY}` with wheel zoom, pointer drag pan, reset gesture/key and ResizeObserver refresh; render points and hit-testing in transformed coordinates.
- [ ] Reduce point sprite opacity/size at dense zoom levels, keep a stable spatial hash, and render only separated cluster labels with bounded ellipsis text.
- [ ] Replace tooltip content with localized title only and reuse shared popover variables/opacity.
- [ ] Increase Galaxy stage to available surface height and register resize/scroll behavior without a second SSE algorithm.
- [ ] Run targeted tests and contracts GREEN.

### Task 2: Import, Resonance Boost, Daily Mix and default folder

**Files:**
- Modify: `src/services/library-runtime.js`
- Modify: `src/services/neural-runtime.js`
- Modify: `src/adapters/browser/file-adapter.js`
- Modify: `src/bootstrap/main.js`
- Modify: `src/ui/library-view.js` or existing Settings owner only if required by current DOM
- Modify: `index.html`, `app.css`, `src/data/i18n.js` only for requested controls/copy
- Test/contract: `tests/contract-tests.ps1`, targeted import/performance test source if present

- [ ] Add failing contract assertions proving cooperative yield does not wait on every rAF, Daily Mix has one batch render, and default-folder wiring is explicit.
- [ ] Run the targeted assertions and confirm RED.
- [ ] Change the shared import yield to scheduler/zero-delay priority yielding with rAF only as a fallback; keep progress painting rAF-driven.
- [ ] Coalesce one Resonance Boost refresh per import batch and avoid duplicate Daily Mix generation/render/persistence while preserving model gates, freshness and artist diversity.
- [ ] Add a supported persisted directory-handle path through the existing storage boundary; on unsupported browsers provide a truthful reselect path.
- [ ] Run targeted import/static tests GREEN.

### Task 3: Typography and settings hierarchy

**Files:**
- Modify: `src/ui/settings-view.js`
- Modify: `src/ui/player-visuals.js` only if language font application owns it
- Modify: `src/data/i18n.js`
- Modify: `index.html`, `app.css`
- Test/contract: `tests/contract-tests.ps1`

- [ ] Add failing assertions for equal language preview geometry, centered top preview, named font weights and first-position preview.
- [ ] Run them RED.
- [ ] Apply a language-aware stack with explicit metric-compatible fallback order, move preview before the picker through the existing owner contract, remove numeric weight display and keep row heights stable.
- [ ] Add only requested helper copy where it clarifies controls.
- [ ] Run contracts GREEN.

### Task 4: About, EQ, Spatial and Track Information

**Files:**
- Modify: existing `src/ui/settings-view.js`/`src/ui/sound-view.js` owner blocks
- Modify: `index.html`, `app.css`, `src/data/i18n.js`
- Test/contract: `tests/contract-tests.ps1`

- [ ] Add failing selector/copy assertions for About detail, EQ axis alignment/height, Spatial bar endpoint and bitrate wording.
- [ ] Run them RED.
- [ ] Add existing runtime facts to About, widen EQ vertical geometry while keeping curve coordinate mapping shared, end Spatial controls at the final option, and remove only the `estimated` label.
- [ ] Run contracts GREEN and inspect for accidental global selector impact.

### Task 5: Build and delivery

**Files:**
- Modify: `CURRENT_STATE.md`, `DELIVERY_CHECKLIST.md`, `AI_WORKSPACE_HANDOFF.md` only for current verified checkpoint
- Generate: `build/app.js` via `build.ps1`

- [ ] Run `build.ps1`.
- [ ] Run `validate-architecture.ps1`.
- [ ] Run `tests/contract-tests.ps1`.
- [ ] Run targeted Node tests and `node --check build/app.js`.
- [ ] Search for duplicate AudioContext/listeners and stale `estimated`/tooltip/placeholder strings.
- [ ] Record PASS/NOT RUN/BLOCKED separately; do not claim Edge/audio/4K/120Hz verification unless run.
