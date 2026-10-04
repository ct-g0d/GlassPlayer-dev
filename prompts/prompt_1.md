# Gemini Liquid Glass Browser — Part 1 Execution Prompt

> Executor: GPT-5.6 Luna, `reasoning.effort=max`.
> Run this in a fresh chat against the Gemini 1.2.0 project.
> Scope: Modules 0, 1, 2, and 3 only.
> Handoff artifact: `checklist_1.md` at the repository root.

## Mission

Implement and prove the foundation of the recovered Gemini browser: a supported Electron runtime, the reusable Liquid Glass system, explicit multi-window/security ownership, and the unified shell/overlay/home experience. Do not implement Modules 4–13 in this part. The attached execution plan is the authority; locate it as `EXECUTION_PLAN.md` or the supplied Gemini Liquid Glass execution-plan file and read Sections 1–12 plus the exact Module 0–3 sections before editing.

## Non-negotiable execution contract

1. Work in the actual Gemini project root, not in a copy or generated directory. Preserve product version `1.2.0`, appId, artifact names, and Windows x64 target.
2. Read `AGENTS.md`, `RECOVERY_MANIFEST.json`, the source inventory in the plan, and every file named in the current module’s **Files allowed** list before changing it.
3. Do not initialize Git, create commits, or claim a diff that was not measured. Do not edit `build.bat`, `run-dev.bat`, `setup-dev.bat`, `RECOVERY_MANIFEST.json`, existing immutable evidence, `dist`, `node_modules`, `.tools`, `.qa`, or generated `package-lock.json` by hand.
4. Keep remote pages in sandboxed `WebContentsView`s with `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true`, and no preload bridge. Keep all cross-process communication behind narrow frozen `contextBridge` wrappers.
5. Do not add a UI framework, state library, animation package, icon package, CSS framework, database, or glass-effect dependency. Do not inject CSS/JS into arbitrary remote pages and do not use `capturePage` for decorative glass.
6. Follow tests-first for every module: add the named failing assertions, run them and confirm they fail for the intended missing behavior, implement the smallest correct change, run the automated gate, then run the real application and complete every manual checklist item.
7. A source inspection is not visual evidence. Open every required screenshot; use actual runtime output, not mockups. Record command, exit code, evidence paths, limitations, and the next module in `docs/implementation-ledger.md`.
8. Never weaken an assertion, budget, security check, or checklist item to get green. Never retry an identical failure more than twice without a new hypothesis/evidence. Stop the current module as `BLOCKED` when a blocker persists.
9. Keep context bounded: use one module at a time, checkpoint before roughly 100 tool calls or 100K visible context, and resume from the ledger in a fresh chat. Do not ask Luna to emit one giant status object.
10. “PASS” means every automated gate, manual checklist line, screenshot/trace requirement, and definition-of-done line has direct evidence. A completion sentence alone is never evidence.

## Shared design and security values

Use the project tokens in Sections 6.2–6.5 of the plan. They are project tokens, not secret Apple constants. Preserve the semantic material hierarchy: structural/regular/clear/popover/opaque; no nested backdrop filters; no more than three concurrent filtered app-owned surfaces; 16 CSS px normal blur maximum, 8 px low-power blur; one complex displacement region at most 0.5M device pixels; displacement disabled at 13+ tabs; opaque fallback for reduced transparency, forced colors, and software/GPU failure. All motion is cancelable, pointer-originated, and at most 500 ms; reduced motion uses opacity-only transitions at most 120 ms.

The compositor boundary is strict: same-document first-party surfaces may use true backdrop blur/refraction; a shell above a sibling remote `WebContentsView` may use tint, specular edge, depth, and interaction motion, but must not claim to sample or refract remote pixels.

## Module 0 — Baseline, supported runtime, capability gates

**Depends on:** nothing.

**Allowed files:** `package.json`; `package-lock.json` only through the pinned npm toolchain; `scripts/verify-project.ps1`; `src/main.js` only for Electron-44 compatibility; `tests/probes/view-reparent.cjs`; `tests/probes/compositor-boundary.cjs`; `docs/implementation-ledger.md`; new evidence under `docs/evidence/`.

**Forbidden:** build/run/setup scripts, recovery manifest, product version/appId/build targets, feature UI files.

Execute every atomic step in Module 0 of the source plan. The minimum closed loop is:

- Record the untouched baseline with `npm run verify:recovery`, `npm run verify:project`, `run-dev.bat`, and `build.bat`; verify the home screen, a navigation, a download, both expected artifacts, and clean process shutdown.
- Pin Electron exactly to `44.0.0` in both authorized package fields, regenerate the lockfile with the project toolchain, update only the corresponding verification assertion, run `npm ci`, and repeat verification/build/smoke tests. Do not silently fall back to Electron 37 if compatibility fails.
- Build the standalone Electron 44 reparent probe: two windows, one unchanged `WebContentsView`, form value, at least two navigation entries, same WebContents ID, explicit close, and zero live WebContents afterward. URL reload is not an acceptable substitute.
- Build the compositor probe: same-document versus sibling-WebContentsView checkerboard, effect-off/tint/blur/displacement captures, opened and inspected images, and a report proving sibling-view pixels are unavailable to shell CSS.
- Record Electron/Chromium/Node, Windows build, GPU adapter/driver, resolution, DPR, and refresh rate. Preserve all evidence and mark Module 0 `PASS` only if the probes and executable smoke runs pass; otherwise mark `BLOCKED`.

**Automated gate:** exact Electron pin; no unauthorized package/build change; recovery/project verification pass; reparent and compositor probes pass or explicitly block; build creates `dist/win-unpacked/Gemini.exe` and `dist/Gemini-1.2.0-portable-x64.exe`; no new console errors.

**Manual checklist:** window/home; HTTPS and HTTP fixture navigation remain sandboxed; Back/Forward/Reload/Stop/New/Close; existing data loads; fixture download start/pause/resume/cancel; clean process exit; both built artifacts launch and smoke-test.

## Module 1 — Liquid Glass component system

**Depends on:** Module 0 `PASS`.

**Allowed files:** `src/styles.css`; `src/styles/tokens.css`; `src/styles/glass.css`; `src/styles/accessibility.css`; `src/renderer/glass.mjs`; `src/index.html` only for primitive classes/QA hooks; `tests/unit/all.test.cjs`; `tests/unit/glass-policy.test.cjs`; `tests/fixtures/glass-lab.html`; `package.json` only for the test script; `scripts/verify-project.ps1`.

**Forbidden:** main-process architecture, feature data models, build fields, remote-page injection.

Execute every atomic step in Module 1 of the source plan. The minimum closed loop is:

- Add the single `npm run test` entry (`node --test tests/unit/all.test.cjs`) without changing existing scripts, then create failing policy tests for normal/reduced/forced-color/GPU-disabled tiers, the 13-tab static rule, and the three-filtered-layer cap.
- Implement all semantic typography, spacing, geometry, light/dark/inactive/high-contrast tokens; structural, regular, clear, popover, low-power, and opaque material; asymmetric specular edge; depth shadows; focus-visible; reduced-motion/transparency/forced-colors/inactive rules.
- Implement pure `chooseGlassTier`, `tabGlassMode`, cancelable spring, and clamped pointer-normalization helpers with no privileged API or HTML generation. Use fixed in-house capsule/rounded-rectangle displacement maps only; one active specimen; tint-only during resize; restore after 200 ms settled.
- Build the glass lab specimens and run the Module 0 performance probe across effect-off/tint/blur/displacement. Reject displacement above 3 ms p95 overhead or with idle repaint activity. Run tests and project verification.

**Automated gate:** every policy assertion passes; semantic tokens are the sole raw-color source; variants have fallbacks; layer cap is enforced in code; no heavy dependency; `npm run test` and `npm run verify:project` exit 0.

**Manual checklist:** structural chrome reads as material; text remains readable over light/dark fixtures; subtle directional specular edge; hover does not bounce; press can cancel; resize uses static tier then restores eligible tier; light/dark geometry matches; reduced transparency is opaque and usable; reduced motion removes deformation; forced colors preserve boundaries/focus; inactive window recedes without losing legibility; open all required lab screenshots/traces.

## Module 2 — Multi-window architecture, store migration, IPC, security

**Depends on:** Modules 0–1 `PASS`.

**Allowed files:** the exact Module 2 list in the source plan: `src/main.js`, `src/preload.js`, `src/index.html` for CSP only, focused files under `src/main/`, the named unit tests, fixture server, and `scripts/verify-project.ps1`.

**Forbidden:** final visual feature layout, context-menu redesign, build scripts, recovery manifest.

Execute every atomic step in Module 2 of the source plan. The minimum closed loop is:

- Test absent/malformed/corrupt version-1 store data, one-time backup, atomic replacement, private-write rejection; test unknown IPC sender, extra keys, non-finite/oversized payloads, unowned IDs, path-based download rejection; test two independent windows and exact close/destroy counts; test normal `persist:gemini` and one shared non-persistent private partition.
- Implement schema version 2 exactly: bookmarks/history/downloads/settings/permissions/sessionRestore; one-time valid migration, sibling backup, temporary flush/rename, corrupt quarantine and recovery notice; never persist private data or pageState/recently-closed navigation state.
- Implement `SessionManager`, `PermissionManager`, `TabController`, `WindowController`, `OverlayController` ownership shell, `DownloadManager` ownership move, `AppController`, `ipc.js`, pure navigation classifier, and frozen preload bridge. Install permission/download/display-capture/device handlers before first navigation; unknown permissions deny.
- Enforce sender-to-owner resolution, exact schemas, enum/size/bounds validation, ID ownership, typed serializable errors, ID-only download reveal/open, blocked schemes, HTTP/HTTPS popup routing, and no remote bridge/Node exposure. Remove all single-window globals from `main.js`.

**Automated gate:** store/IPC/session/tab ownership tests pass; no cross-window action succeeds; close/destroy exactly once; normal/private isolation; recovery/project verification pass.

**Manual checklist:** existing navigation/activate/close/reorder; second window and owner isolation; close one window while other remains; final close ends remote contents; migration/backup/corrupt-file notice; HTTP/HTTPS popup; blocked `javascript`/`data`/`file`; unknown permission denied; remote DevTools sees no Gemini bridge or Node globals; no new console errors.

## Module 3 — Window chrome, overlay host, first-party shell, and home

**Depends on:** Modules 0–2 `PASS`.

**Allowed files:** the exact Module 3 list in the source plan: shell/renderer/state/icon/page/a11y files, overlay files, window/overlay IPC controllers, CSS modules, verification script, and named unit tests.

**Forbidden:** feature data-model expansion, tab groups, private mode, download redesign, build files.

Execute every atomic step in Module 3 of the source plan. The minimum closed loop is:

- Test overlay placement at all edges/corners, in-window clamping, one-overlay ownership, and stale nonce rejection.
- Rebuild semantic shell with header/tab host/navigation toolbar/local-page host/live region/CSP; no inline handlers; every control has a text alternative; no Unicode final icons; frozen overlay bridge; closed surface types; textContent-only payload rendering; roving focus and full keyboard behavior; one submenu maximum.
- Implement exact home composition: max-840 content column, max-640 Address/Search 24 px below title, bookmarks 32 px below, 24 px side insets below 760; exactly three static radial fields and specified light/dark alphas; clear glass only for hero search; structural bookmark section with max eight root-bar bookmarks and explicit empty state; no idle animation.
- Create one overlay WebContentsView per window, load once, remove when idle, place above active remote view, nonce every show, clamp to 8 px safe inset, dismiss outside/Escape, restore invoking focus. Implement Windows traffic lights with 28 px hit boxes/12 px visuals, close/minimize/fullscreen/Alt-maximize/hover placement popover, titlebar drag region, grouped toolbar controls, app-actions menu, F6/Shift+F6, live announcements, inactive/reduced states.

**Automated gate:** overlay tests, CSP/static scans, trusted-sender checks, no unsafe HTML, target-size checks, `npm run test`, and `npm run verify:project` pass.

**Manual checklist:** exactly 96 px chrome and no gap/overlap; traffic-light actions/placement; inactive behavior; titlebar dragging without control drag; focus cycling; overlays stay above remote content and dismiss/restore focus; home at 760/1380/1920 widths; light/dark/reduced/forced modes; open and inspect all required screenshots.

## Part 1 closeout and handoff

After Modules 0–3:

1. Re-read every module definition of done and every manual checklist line. Re-run `npm run test` and `npm run verify:project`.
2. Run `run-dev.bat` from a fresh launch and inspect all Part 1 screenshots. If a later module is not implemented, development-only placeholders may remain, but they must be clearly development-only and must not be presented as final polish.
3. Update `docs/implementation-ledger.md` with one exact row per Module 0–3: status, files changed, exact commands/exit codes/counts, manual results, screenshot/evidence paths, performance evidence, open issues, and `Next module: 4`.
4. Create `checklist_1.md` at the repository root. It must be a machine-readable handoff, not a vague summary, with this exact structure:

```markdown
# Gemini handoff checklist 1
Date: <UTC date>
Overall status: PASS | BLOCKED

## Module status
| Module | Status | Tests/commands | Evidence paths | Open issues |
|---|---|---|---|---|
| 0 | ... | ... | ... | ... |
| 1 | ... | ... | ... | ... |
| 2 | ... | ... | ... | ... |
| 3 | ... | ... | ... | ... |

## Completed capability assertions
- [ ] Electron 44/runtime/build gate
- [ ] Reparent probe and compositor boundary evidence
- [ ] Liquid Glass policy/tokens/fallbacks/performance tier
- [ ] Multi-window/store/IPC/session/security ownership
- [ ] Window chrome/overlay/home/focus/accessibility foundation

## Evidence and limitations
- Commands and exit codes:
- Screenshots/traces opened and inspected:
- Recovery mismatches (expected vs blocker):
- Known limitations:

## Handoff contract
- Next module: 4
- A later part must compare this file against its opening expected-completion list.
```

5. Mark a capability `[x]` only with direct evidence. If any required item is missing, set overall status `BLOCKED`, list the exact gap, and do not claim Part 1 is complete. Do not continue to Modules 4–13 in this chat.
