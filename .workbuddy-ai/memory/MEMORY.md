# Glass Player — Workspace Memory (curated)

## Governance
- First-read order: AGENTS.md → CURRENT_STATE.md → AI_WORKSPACE_HANDOFF.md (by section) → DELIVERY_CHECKLIST.md → SOURCE_ORDER.txt → owner source files.
- Authority: src/** + SOURCE_ORDER.txt (52 fragments, fixed concat order) → index.html/app.css → build/app.js (generated, never hand-edit) → releases.js.
- Never edit: build/app.js, root app.js, original/Glass Player 6.2.2.html. No second Store/queue/AudioContext/SSE layer. Animations elapsed-time based, no fixed frame loops.
- Protected data: IndexedDB glass-player-gen4 v5 (trackFeatures, behaviorEvents, userModel, recommendations, trackCache), localStorage glassPlayerHistory/glassPlayerPrefs/glassPlayerSidebarCollapsed, Spectrum ID identity. Never reset/migrate without approval.
- After any src change: build.ps1 → validate-architecture.ps1 → tests/contract-tests.ps1 (+ node --check build/app.js). Record SHA-256. Edge/audio/4K/120Hz checks stay NOT RUN unless actually performed.
- Delivery claims must use DELIVERY_CHECKLIST PASS/NOT RUN/BLOCKED wording.

## Baseline facts (as of 2026-10-16)
- Version 7.6.1 HOTFIX BUILD, Gen 7, Peregrine Lake. Core 4.3, Bionic Engine 1.0, Fusion 4.2, Motion 4.2, Spatial 1.1, Spectrum 2.3, Neural 2.2. 52 sources / 20 governance modules.
- Keyboard: Space/F10 play-pause only; F9/F11 intentionally unbound.
- History: 75% accumulated = complete; calendar ranges are real boundaries; 5 day-part buckets.
- Neural: mature only at ≥20 events, ≥5 active days, ≥0.70 confidence; immature = uniform random shuffle.
- Docs drift: AGENTS.md header + AI_WORKSPACE_HANDOFF.md still describe 7.3.1/57 fragments/Music Galaxy (removed in 7.3.2). CURRENT_STATE.md + SOURCE_ORDER.txt are current truth.

## Workspace observations 2026-10-16
- Git repo on main. v7.6.2 REBRAND UPDATE committed (9374726): Bionic Engine 1.0 replaces recognition/spectrum engines + ports; equalizer runtime merged into spatial-engine.js. 52 sources / 20 modules.
- Version identity surfaces for a release: index.html (css/js ?v= cache rev, build card, currentVersionBtn), bootstrap/main.js facade, bionic-engine.js early facade, settings-view.js fallback, i18n EN+RU pairs, releases.js (entry + RELEASE_EN + export header/filename), contract-tests.ps1 (multiple hardcoded version assertions — check lines ~51/54/57/58/108/238/293/295-319 pattern).
- Untracked user utilities: glassplayer-history-backup.json, restore-history.html, 一键还原播放历史.bat — history backup/restore helpers, never commit as runtime.
- Current release: 7.6.2 REBRAND UPDATE, build SHA-256 46E7334084FBC9459464F2153795ED34C55864069799B64FE0DB76D25BCA5A43.
