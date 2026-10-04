# Gemini Liquid Glass Browser — Part 4 Execution Prompt

> Executor: GPT-5.6 Luna, `reasoning.effort=max`.
> Run this in a fresh chat after Part 3.
> Scope: reconcile Modules 0–9, then implement Modules 10, 11, 12, and 13.
> Handoff artifact: `checklist_4.md` at the repository root.

## Mission

Finish the product feature set and perform the integration proof: History/Recently Closed, Downloads, context menus/keyboard commands, then the full performance/accessibility/security/build/documentation release gate. The attached execution plan is authoritative. Locate it as `EXECUTION_PLAN.md` or the supplied Gemini Liquid Glass execution-plan file and read Sections 1–16, the exact Module 0–13 sections, and `checklist_3.md` before editing.

## Opening reconciliation gate — mandatory

Audit this expected prior state against `checklist_3.md`, the ledger, source, tests, and actual opened evidence:

| Expected prior module | Required proven result |
|---|---|
| 0 | Supported Electron 44 runtime/build/recovery evidence; reparent and compositor probes; artifact smoke tests |
| 1 | Complete semantic Liquid Glass system, deterministic tiers/fallbacks, token/motion policy, layer cap and measured effect tier |
| 2 | Explicit per-window/tab/session/store/download/permission/overlay ownership; schema-v2 migration; atomic persistence; validated IPC; remote isolation and cleanup |
| 3 | Unified 96 px shell, traffic lights, toolbar, trusted overlay, home/local router, focus/a11y, z-order and visual evidence |
| 4 | Searchable validated Settings split view, exact defaults, scoped reset, global accessibility/theme behavior, honest About |
| 5 | Main-enforced tab/group/pin/select/overflow/overview/vertical behavior; 13/25 degradation; Recently Closed and safe restart restore |
| 6 | Shared non-persistent Private Session and strict retention/permission/download/history/restore boundaries; accurate disclosures and final-close cleanup |
| 7 | Live same-WebContents tab transfer with one-use token, rollback, mode boundary, state-preservation evidence, keyboard alternative |
| 8 | Deterministic address/search, local categorized suggestions, neutral Site Controls, origin-bound permissions, error pages, Find and Zoom |
| 9 | Main-owned bookmarks with folders/bar/sidebar/manager/search/import/export, migration and private explicit-bookmark exception |

1. Locate `checklist_3.md` at the repository root or use the exact user-provided attachment/paste. If neither exists, stop and request it; do not assume Part 3 succeeded.
2. Compare every module row and capability assertion, not merely the overall status. Verify every command/exit code, evidence path, limitation, and `[x]` assertion. Open referenced PNGs/traces and inspect them.
3. For every mismatch, repair the prior module before starting Module 10. Use that module’s original allowed files and re-run its automated/manual proof. Record the discrepancy and repair in the ledger. Never “fix” a missing feature by only changing checklist text.
4. Proceed only if Modules 0–9 are independently `PASS`. If a repair remains blocked, create `checklist_4.md` with `BLOCKED` details and stop.

## Non-negotiable execution contract

1. Preserve Gemini `1.2.0`, appId, artifact names, Windows x64 target, recovery provenance, and the no-Git/no-commit rule.
2. Read every current module’s allowed-file list before editing. If a needed file is unlisted, stop and report the exact path and reason instead of silently broadening scope.
3. Never edit `build.bat`, `run-dev.bat`, `setup-dev.bat`, `RECOVERY_MANIFEST.json`, existing immutable evidence, `dist`, `node_modules`, `.tools`, `.qa`, or generated lockfiles by hand.
4. Keep remote views sandboxed/bridge-free; use frozen narrow bridges, exact schemas, sender/owner/ID checks, default-deny unknown permissions, and no arbitrary path or remote injection.
5. No heavy framework/dependency and no decorative `capturePage` mirroring.
6. For each module: named failing tests → confirm intended failure → smallest implementation → automated gate → real app checklist → opened screenshots/traces → ledger. Never claim visual, security, or performance success from source inspection.
7. Never weaken tests, security rules, budgets, or evidence requirements. Stop after two identical failures without a changed hypothesis. Checkpoint before roughly 100 tool calls or 100K visible context.

## Module 10 — History and Recently Closed

**Depends on:** Modules 0–9 `PASS`.

**Allowed files:** exact Module 10 list in the source plan: Store/tab/window/IPC/preload, pages/toolbar(state only for suggestions), index/overlay/CSS, history/store/tab/unit tests, fixture server.

**Forbidden:** download/context implementation and build files.

Implement the exact history policy: committed main-frame HTTP/HTTPS only; exclude same-document hash-only changes, local Gemini routes, blocked/error/background speculative loads, and private pages; merge identical normalized URLs inside 30 seconds by incrementing `visitCount`/updating time; default 90 days, accepted settings 30/60/90/180/365/Forever, cap 50,000 rows, load-time plus once-daily pruning; clear ranges Last hour/24 hours/7 days/4 weeks/All time; clearing history never clears cookies/bookmarks/downloads/settings.

Execute every atomic step in Module 10. The closed loop must include:

- Failing tests for eligible navigation/subframe/local/private exclusions, 30-second merge/separate row, retention/cap, exact range boundaries, independent clear, title/URL/host/date search, deterministic day/domain grouping, immediate suggestion updates, Recently Closed tab/group/window snapshots, and no private snapshots.
- Record on committed main-frame navigation; normalize without deleting meaningful query strings; indexed in-memory search; stable-ID `history:query/clear/remove/reopen`; same-run navigationHistory restoration; in-memory-only Recently Closed including closed normal-window metadata/active index; no sensitive pageState persistence.
- Anchored app-menu overlay with Recently Closed first and today’s visits second (max 20); full History route with stable content plane, search/clear toolbar, local-day grouping/domain toggle, title/domain/URL/local time, row selection/multi-delete/Open/New Tab/Remove, range-clear sheet explicitly stating cookies/site data remain unchanged; `@history` and normal suggestions update immediately; private suggestions exclude normal history.

**Automated gate:** recording/exclusion/retention/range/search/reopen tests, private JSON byte-stability, immediate suggestion updates, tests and project verification pass.

**Manual checklist:** seeded fixture visits/title/domain/time; duplicate merge; search; day/domain views; each clear range; independent clear disclosure; row/multi-remove; @history; same-run tab/window reopen; private exclusion; opened empty/populated/search/grouped/recent/clear-sheet screenshots.

## Module 11 — Downloads

**Depends on:** Modules 0–10 `PASS`.

**Allowed files:** exact Module 11 list in the source plan: download/session/app/window/overlay/store/IPC/preload, pages/state/index/overlay/CSS, download/store/unit tests, fixture server.

**Forbidden:** context-menu expansion and build files.

Implement the exact state machine: `starting → progressing/paused/completed/cancelled/interrupted/failed`; `progressing → paused/completed/cancelled/interrupted/failed`; `paused → progressing/cancelled/interrupted/failed`; retry only from interrupted/failed creates a new DownloadItem and `previousAttemptId`; completed/cancelled terminal. “Remove from list” never deletes the file.

The closed loop must include:

- Failing tests for every allowed/disallowed transition, zero/unknown totals, filename sanitization/collision/unsafe names, ID-only open/reveal, record removal without file deletion, clear-completed, HTTP/HTTPS-only retry and linkage, private memory-only summaries, close/ownership sequencing, one save dialog and cancel, moving-average speed/ETA.
- Install managers before navigation; OS Downloads default; one OS save dialog when askEveryTime; active DownloadItems owned by main independently of initiating tabs; mode-specific fan-out and same-mode rehome; normal persistence max 1,000; private memory-only; interruption reconciliation; no “safe/scanned” language; source domain and no-Safe-Browsing limitation.
- Pause/resume/cancel/retry/open/reveal/remove/clear; toolbar button appears after first current-session download and stays while active; anchored popover (active first, five recent second, full route link); full Downloads manager with search/domain/date/state filters, stable content plane, clear action semantics; private reminder and exact final-window trusted close sheets (normal: “Keep Window Open” / “Quit and Cancel N Downloads”; private contract from Module 6).
- Fixture endpoints for normal/slow/unknown/interrupted/duplicate/unsafe names; tests and project verification.

**Automated gate:** invalid transitions/path ownership/private persistence/filename safety/removal semantics pass; tests and project verification pass.

**Manual checklist:** active progress; pause/resume/cancel; unknown total omits fake percent/ETA; safe suffixes; Ask Every Time dialog/cancel; completed open/reveal; retry; remove leaves file; clear completed; manager search/filter; private file remains but record disappears; initiating-tab/non-final-window/final-window close sequencing; no safety claim; opened active/paused/completed/failed/private/empty/popover/manager screenshots.

## Module 12 — Context menus and complete keyboard command surface

**Depends on:** Modules 0–11 `PASS`.

**Allowed files:** exact Module 12 list in the source plan: main tab/window/app/overlay/IPC, preload, renderer tabs/toolbar/pages/a11y/state, overlay/CSS/index, context/shortcut/all tests, fixture server.

**Forbidden:** native context menu as accepted Windows presentation, arbitrary shell/clipboard paths, build files.

Use the allowlisted context sets from the source plan: editable (Undo/Redo/Cut/Copy/Paste/Select All); selection (Copy/Search/Open as URL only if classified); link (open new tab/window/private when normal/copy); image (open/save/copy address); media (play/mute/open/save); page (back/forward/reload-stop/bookmark/print/source only if developer-enabled); tab (new right/reload/duplicate/pin/mute/group/move/close variants); bookmark/history/download row actions. Hide irrelevant actions, allow disabled editing commands, and never expose more than one submenu level.

The closed loop must include:

- Failing action-builder tests for every context and state, absence of irrelevant items, one-submenu limit, closed action-ID enum, one-use/stale nonce, owner-bound effect, every canonical shortcut and focused-edit conflict.
- Normalize only serializable Electron context parameters; one-use expiry nonce; main-owned allowlisted execution; overlay menu clamped to window; main clipboard limited to 1 MiB; HTTP/HTTPS URL validation; owner service routing; OS print dialog; View Source hidden unless explicitly enabled; trusted row/tab-strip contexts; Shift+F10/Menu key; Escape/focus restore.
- Extend the Module-3 app menu through the same overlay: New Window/Private, Tabs, Bookmarks/History/Downloads, View, Settings, Help; platform accelerator labels; Ctrl/Cmd+N, Shift+N, L, T, W, Shift+T, R, D, H, J, F, P, Plus, Minus, 0, 1–9, Comma; Ctrl+Tab/Shift+Tab; Ctrl/Cmd+Shift+N; Alt arrows/appropriate macOS commands; F6/Shift+F6; Shift+F10; F11; editable/page first refusal; every toolbar command has menu path; native Windows menu absent on acceptance path.

**Automated gate:** action/nonce/owner/shortcut tests, no arbitrary action IDs, no native `Menu.popup` acceptance path, tests and project verification pass.

**Manual checklist:** all context types and exact row actions; Shift+F10 and keyboard navigation; disabled announcements; edge clamping; toolbar/app/feature equivalence; new tab/window/private; copy/save/print; Find/Zoom shortcuts owner-bound; stale actions no-op; all shortcuts shell/remote focus; text editing precedence; opened screenshots for contexts/focus states.

## Module 13 — Integration, performance, accessibility, build, evidence, documentation

**Depends on:** Modules 0–12 `PASS`.

**Allowed files:** every editable source file only for a traced integration defect; `src/main/performance-recorder.js`; `scripts/qa-performance.ps1`; `scripts/verify-project.ps1`; tests/unit and fixture server; `AGENTS.md`; `README.md`; reconstruction/QA/ledger docs; new immutable evidence under `docs/evidence`; `package.json` only for QA/test script additions without changing existing build scripts.

**Forbidden:** `build.bat`, `RECOVERY_MANIFEST.json`, existing immutable evidence, `dist/node_modules/.tools/.qa` source edits, new product features.

Do not start Module 13 until Modules 0–12 are PASS. This is proof/fix-only, not a feature expansion. Execute every atomic step in Module 13 and Section 13 post-execution protocol of the source plan:

- Read every PASS ledger entry, confirm evidence exists, open every final screenshot, remove development-only labels/placeholders/unused code only when caused by this implementation.
- Add QA-only performance recorder; record actual Electron/Chromium/Node/Windows/GPU/process metrics; use contentTracing only behind explicit QA flag; discover/request applicable categories; keep measurement reports under `.qa` until reviewed.
- Run five warmed 10-second scenarios; collect shell rAF median/p95/p99 and >16.67/>33.3 ms intervals separately from presented dropped/partial frames; report CPU/memory/GPU delta/effect area; fail budgets rather than weakening them. Exercise Section 10 A/B matrix: effect off/tint/blur/fixed displacement; same/sibling surface; 1/12/13/24/40 tabs; idle/scroll/switch/overlay/resize/video/detach/DPI/minimize; light/dark/reduced/forced/GPU-disabled. Apply only the deterministic fallback sequence (disable displacement → 8 px low-power blur → opaque) and re-run.
- Verify contrast 4.5:1 normal, 3:1 large/bold/non-text controls; visible focus, names/roles/states/live announcements; keyboard-only core flows; reduced motion/transparency/forced colors/increased contrast; 100/125/150/200% scaling; minimum size and 760/1080/1380/1920 widths; active/inactive; normal/private concurrently; 1/12/13/24/40 tabs; both layouts; two normal/two private windows; all first-party pages and overlays.
- Stress 100 tabs across 10 windows and prove WebContents/process counts return to baseline. Prove remote fixture has no Node/Gemini bridge; unknown permissions deny; blocked schemes stay blocked; normal/private cookies/persistence isolate; no arbitrary path IPC; all state-changing IPC validates sender ownership.
- Run fresh `run-dev.bat` consolidated checklist; run `build.bat`; verify and launch both `dist/win-unpacked/Gemini.exe` and `dist/Gemini-1.2.0-portable-x64.exe`; repeat consolidated smoke checklist in each; close each; run `npm run verify:recovery`; expect only intentional ledger-listed mismatches and never update the recovery manifest.
- Update reconstruction report, QA results, README, and AGENTS exactly as Sections 14–15 require; include runtime/ownership/session/store/IPC/glass/performance/workflow facts, truthful limitations, commands, environments, screenshots, traces, coverage IDs, and no-Safe-Browsing statement. Re-run tests/project verification/build if relevant content changed.
- Copy every Section 16 ID (A01–A04, L01–L07, R01–R17, D01–D02, O01–O22, P01–P07, B01–B03, G01–G02, C01–C09, F01–F11, S01–S05, Q01–Q02) into the final requirement report. Mark each `PASS` only with direct runtime evidence or `BLOCKED` with exact blocker; no “not applicable” unless explicitly permitted. Declare Module 13 PASS only when all required IDs pass.

**Automated gate:** `npm run test`, `npm run verify:project`, QA performance, build, both artifact launches, security negatives, leak count, recovery audit, package version, and immutable build/recovery hashes all pass.

**Consolidated manual checklist:** start/home/bookmarks/history/downloads/settings; navigation/errors/crash recovery; tabs/groups/selection/restore; normal/private cookies/permissions/downloads/cleanup; drag transfer; address/site controls/prompts/errors; Find/Zoom; bookmark/history/download managers; download close sequencing; contexts/shortcuts; all visual/accessibility/scaling/tab-count modes; no flat pre-reskin surfaces; remote pages untouched; no console errors/unhandled rejections/security warnings/orphans; every screenshot/trace opened.

## Part 4 closeout and handoff

1. Execute the source plan’s separate post-execution verification once Module 13 appears complete: fresh task if needed; re-read plan/AGENTS/ledger; rerun tests, project verification, performance, dev checklist, build, both artifacts, representative normal/private/download/detach/settings/context flows; reopen contact sheet/report; line-by-line Section 16 evidence; state exact glass tier/hardware/limitations; never say “all done” without the report.
2. Update `docs/implementation-ledger.md` with rows for Modules 0–13, reconciliation repairs, exact commands/exit codes/counts, manual results, evidence paths, performance tier, expected recovery mismatches, open issues, and `Next module: final audit`.
3. Create `checklist_4.md` at the repository root:

```markdown
# Gemini handoff checklist 4
Date: <UTC date>
Overall status: PASS | BLOCKED
Prior checklist reconciled: checklist_3.md — MATCH | REPAIRED | BLOCKED

## Module status
| Module | Status | Reconciliation/repair | Tests/commands | Evidence paths | Open issues |
|---|---|---|---|---|---|
| 0 | ... | ... | ... | ... | ... |
| 1 | ... | ... | ... | ... | ... |
| 2 | ... | ... | ... | ... | ... |
| 3 | ... | ... | ... | ... | ... |
| 4 | ... | ... | ... | ... | ... |
| 5 | ... | ... | ... | ... | ... |
| 6 | ... | ... | ... | ... | ... |
| 7 | ... | ... | ... | ... | ... |
| 8 | ... | ... | ... | ... | ... |
| 9 | ... | ... | ... | ... | ... |
| 10 | ... | ... | ... | ... | ... |
| 11 | ... | ... | ... | ... | ... |
| 12 | ... | ... | ... | ... | ... |
| 13 | ... | ... | ... | ... | ... |

## Completed capability assertions
- [ ] Modules 0–9 reconciled with direct evidence
- [ ] History/Recently Closed complete and private-safe
- [ ] Download state machine, ownership, popover/manager, and retention complete
- [ ] Context-specific Liquid Glass menus and canonical keyboard surface complete
- [ ] Full performance/accessibility/security/build/recovery/documentation QA complete
- [ ] Every required Section 16 ID has runtime evidence

## Evidence and limitations
- Commands and exit codes:
- Screenshots/traces opened and inspected:
- Performance tier and hardware:
- Expected recovery mismatches:
- Known limitations:
- Section 16 IDs not PASS:

## Handoff contract
- Next step: Part 5 independent final audit
- Part 5 must compare this file against the original plan and all prior checklists, then repair anything incomplete.
```

4. Tick only with direct evidence. If any Module or Section 16 ID is missing, set `Overall status: BLOCKED`, list exact repair work, and stop. Do not claim the whole product is perfect in this chat.
