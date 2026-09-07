# Taskbar Icon, Audio Settings, and History Ranking Hotfix Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with fresh verification at each checkpoint. Steps use checkbox syntax for tracking.

**Goal:** Ship 7.2.1 HOTFIX BUILD with consistent taskbar icon strokes, one Settings-owned audio surface, and a Top 10 / ranks 11–50 History layout whose left column never scrolls.

**Architecture:** Preserve the existing single EQ, Spatial, loudness, playback-detail, Store, and history owners. Move the existing Sound DOM into the existing Settings Audio pane without duplicating IDs or state, and split History rendering into a static left column plus a right-owned scroll viewport.

**Tech Stack:** Single-file HTML entry, ordered JavaScript source fragments, CSS, PowerShell contract tests, generated `build/app.js`, and bundled Node syntax checking.

## Global Constraints

- Edit source fragments, `index.html`, `app.css`, tests, release data, and current-state docs only; regenerate `build/app.js` with `build.ps1`.
- Preserve IndexedDB `glass-player-gen4` version 5, all object stores/indexes, localStorage keys, history identity/timestamps, EQ/Spatial/loudness state, AudioContext/deck graph, queue arrays, public events, and existing control IDs.
- Use one taskbar stroke contract at 1.8px; do not add a second motion or icon system.
- Remove the right-panel Sound tab/body after moving its complete content, including file information, into Settings > Audio.
- History has no play-count card or play-count metadata; left is ranks 1–10 and has no overflow scrolling; right is ranks 11–50 and is the only ranking scrollbar.
- Release identity is 7.2.1 — HOTFIX BUILD; GP Core and Motion remain 4.1.
- Do not edit generated `build/app.js`, root `app.js`, or `original/Glass Player 6.2.2.html` directly.

---

### Task 1: Add failing regression contracts

**Files:**
- Modify: `tests/contract-tests.ps1` at the current contract block
- Test: `tests/contract-tests.ps1`

**Interfaces:**
- Consumes: current source/build text loaded by the contract runner.
- Produces: red checks for icon stroke normalization, Sound migration, and History layout/content.

- [ ] **Step 1: Write the failing contracts**

Add checks that require:

```powershell
Expect ($css -match '\.nav-item>svg\{[^}]*stroke-width:1\.8px' -and $css -match 'vector-effect:non-scaling-stroke' -and $index -notmatch 'galaxy-nav-icon[^>]*>[\s\S]{0,600}stroke-width="1\.(3|35|45)"') 'Taskbar icon stroke normalization missing'
Expect ($index -notmatch 'data-tab="sound"' -and $index -notmatch 'id="soundBody"' -and $index -match 'data-settings-pane="audio"[\s\S]{0,10000}id="eqPresetButton"[\s\S]{0,10000}id="spatialToggle"[\s\S]{0,10000}id="loudnessNormalizeToggle"[\s\S]{0,10000}id="trackInfoCard"' -and $build -notmatch 'soundBody') 'Sound surface migration into Settings Audio missing'
Expect ($index -notmatch 'id="historyStatPlays"' -and $index -match 'Top 10' -and $index -match 'id="historyRanks11to50"' -and $build -match 'ranked=candidates\.slice\(0,50\)' -and $build -notmatch 'historyStatPlays|Played .*times' -and $css -match '\.history-ranking-grid\{[^}]*grid-template-columns:50% 50%' -and $css -match '\.history-ranks-list\{[^}]*overflow-y:auto' -and $css -match '\.history-top10[^}]*overflow:visible' -and $build -match 'GP_SCROLL_EDGE_SELECTORS=\[[^\]]*#historyRanks11to50') 'History Top 10 / ranks 11-50 and right-only scrolling missing'
```

Update the expected count by three.

- [ ] **Step 2: Run the contract suite and verify the expected red**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/contract-tests.ps1
```

Expected: FAIL only on the three new regression messages (plus any deliberate version identity checks not yet updated).

### Task 2: Normalize taskbar icon strokes

**Files:**
- Modify: `index.html` sidebar SVG presentation attributes only
- Modify: `app.css` taskbar icon rules
- Test: `tests/contract-tests.ps1`

**Interfaces:**
- Consumes: existing `.nav-item`, `.single-alpha-icon`, Galaxy motion classes, and Shared Controls navigation motion.
- Produces: one 1.8px non-scaling taskbar stroke without changing navigation or animation timing.

- [ ] **Step 1: Normalize the sidebar SVG declarations**

Set visible Sidebar/Galaxy stroke declarations to 1.8 and add one scoped CSS guard:

```css
.nav-item>svg{stroke-width:1.8px;vector-effect:non-scaling-stroke}
.nav-item>svg [stroke]:not([stroke="none"]){stroke-width:1.8px;vector-effect:non-scaling-stroke}
```

Keep fill-only stars and hidden motion overlays semantically intact; do not change animation keyframes or navigation handlers.

- [ ] **Step 2: Run the new icon contract**

Run the contract suite. Expected: the icon contract passes while the Sound and History contracts remain red.

### Task 3: Move the complete Sound surface into Settings > Audio

**Files:**
- Modify: `index.html` right panel and Settings Audio pane
- Modify: `src/ui/shared-controls.js` panel body map and SSE registrations
- Modify: `src/ui/settings-view.js` info-popover scroll anchor
- Modify: `src/engines/audio-engine.js` Sound-active state name/semantics if required by the moved surface
- Modify: `src/services/playback-runtime.js` detail-refresh condition if required by the moved surface
- Modify: `app.css` Settings Audio sound-surface layout overrides
- Test: `tests/contract-tests.ps1`

**Interfaces:**
- Consumes: existing EQ, Spatial, loudness, track-info IDs and one canonical audio/settings state.
- Produces: Settings Audio as the only Sound surface; right panel retains Queue and Daily Mix.

- [ ] **Step 1: Move DOM without changing control IDs**

Remove the right-panel `data-tab="sound"` button and `#soundBody` wrapper. Insert the existing four `.sound-section` blocks, including file information, into `data-settings-pane="audio"` under the Audio heading. Preserve every ID used by Equalizer, Spatial, loudness, popover, and track-info code.

- [ ] **Step 2: Reduce Shared Controls to the remaining right-panel tabs**

Change the panel map to `{queue:$("#queueBody"),recommend:$("#recommendBody")}`, remove `soundBody` from `GP_SCROLL_EDGE_SELECTORS` and `GP_SHARED_SHELLS`, and leave Queue/Recommend transitions unchanged.

- [ ] **Step 3: Retarget active-surface detail refresh and info popover positioning**

Replace the old `soundPanelActive`/`#soundBody` dependency with the Settings Audio visibility check or an equivalently single boolean owned by the existing audio runtime. Keep `updateTrackInfoCard` and `loadWaveformFor` as the only detail refresh path. Re-anchor info popover repositioning to `#settingsPanel` or the active Audio pane scroll surface.

- [ ] **Step 4: Fit the moved surface to Settings**

Use the existing Glass/setting row material and add only scoped `.settings-content .sound-section` rules so the EQ curve, Spatial selector, loudness bar, info card, and popovers fit the 1100–1200px Settings content without creating a second panel shell.

- [ ] **Step 5: Run the Sound migration contract**

Run the contract suite. Expected: icon and Sound contracts pass; History remains the only new red contract.

### Task 4: Rebuild History ranking into left Top 10 and right ranks 11–50

**Files:**
- Modify: `index.html` History time pane
- Modify: `src/services/history-service.js` ranking renderer and summary reset
- Modify: `app.css` History ranking shell/column overflow rules
- Modify: `src/ui/shared-controls.js` scroll selector registration if the right rank list needs shared scrollbar/SSE behavior
- Test: `tests/contract-tests.ps1`

**Interfaces:**
- Consumes: existing `calendarHistoryRange`, history identity lookup, duration ranking, `historyTop3`, and `historyRanks4to10` IDs.
- Produces: 50-item time ranking with only the right column scrolling and no play-count presentation.

- [ ] **Step 1: Remove play-count presentation**

Delete the `historyStatPlays` summary card and remove `rangePlayCount` calculations from the display path. Keep history records and play-count data untouched for other features; only the History view stops showing it.

- [ ] **Step 2: Add the new left/right containers**

Keep `historyTop3` and `historyRanks4to10` on the left, add `historyRanks11to50` on the right, and change the visible title/heading to `Top 10` and `11–50`. Do not retain the explanatory Top 3 caption.

- [ ] **Step 3: Render the 50-item split**

Use `ranked=candidates.slice(0,50)`, assign `ranked.slice(0,3)` to the podium, `ranked.slice(3,10)` to the existing 4–10 container, and `ranked.slice(10,50)` to the new 11–50 container. Keep duration and progress near the song; do not render play counts.

- [ ] **Step 4: Make the left side non-scrolling**

Set `#topList` to a clipped stationary shell, the ranking grid to two 50% columns, the left Top 10 section to `overflow:visible`, and only the right ranks container to `overflow-y:auto; min-height:0`. Remove `#topList` from `GP_SCROLL_EDGE_SELECTORS`; register `#historyRanks11to50` with the existing SSE selector list and map it to `.top-list` as its stationary shell. Ensure short-content and empty states remain visible.

- [ ] **Step 5: Run the History contract**

Run the contract suite. Expected: all new layout/content contracts pass.

### Task 5: Synchronize 7.2.1 HOTFIX BUILD identity

**Files:**
- Modify: `index.html`
- Modify: `src/bootstrap/main.js`
- Modify: `src/engines/audio-engine.js` diagnostic version if needed
- Modify: `src/engines/spectrum-analyzer.js` identity if needed
- Modify: `src/data/releases.js` Chinese/English release entry and export identity
- Modify: `CURRENT_STATE.md`
- Modify: `AGENTS.md` current baseline if required by the project contract
- Test: `tests/contract-tests.ps1`

**Interfaces:**
- Consumes: existing version identity surfaces and changelog hierarchy.
- Produces: synchronized 7.2.1 HOTFIX BUILD; Core 4.1 and Motion 4.1 unchanged.

- [ ] **Step 1: Update all user-visible identity surfaces**

Update document title, cache-busting query, public facade, About card, current-version button, releases data in both languages, and current-state baseline. Keep 7.2.0 as historical release data.

- [ ] **Step 2: Run identity contracts**

Run the contract suite and verify the version is current everywhere while historical 7.2.0 remains in the changelog.

### Task 6: Build and verify

**Files:**
- Modify: generated `build/app.js` only through `build.ps1`
- Read: `DELIVERY_CHECKLIST.md`

**Interfaces:**
- Consumes: all source changes from Tasks 1–5.
- Produces: verified generated runtime and handoff evidence.

- [ ] **Step 1: Build the generated runtime**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1
```

Record the emitted SHA256.

- [ ] **Step 2: Run architecture, contract, and syntax checks**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File validate-architecture.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests/contract-tests.ps1
C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --check build/app.js
```

- [ ] **Step 3: Run targeted static checks**

Confirm the right panel has no Sound tab/body, Audio Settings contains all preserved control IDs, History has no visible play-count text, only the right ranks list is scroll-registered, and no direct IndexedDB/AudioNode access was introduced.

- [ ] **Step 4: Read the delivery checklist and report evidence**

Read `DELIVERY_CHECKLIST.md` before the handoff. Report Build, Architecture, Contracts, targeted static checks, and Edge/audio/4K visual status separately. If `file://` visual inspection is blocked by browser policy, mark it BLOCKED/NOT RUN rather than claiming visual success.
