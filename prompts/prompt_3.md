# Gemini Liquid Glass Browser — Part 3 Execution Prompt

> Executor: GPT-5.6 Luna, `reasoning.effort=max`.
> Run this in a fresh chat after Part 2.
> Scope: reconcile Modules 0–6, then implement Modules 7, 8, and 9 only.
> Handoff artifact: `checklist_3.md` at the repository root.

## Mission

Continue from the Part 2 handoff. Prove the runtime, material system, architecture, shell, Settings, tabs, and Private Window are actually complete; repair any gap; then implement live tab transfer, Address and Search with permissions/Find/Zoom, and the complete Bookmarks system. The attached execution plan is authoritative. Locate it as `EXECUTION_PLAN.md` or the supplied Gemini Liquid Glass execution-plan file and read Sections 1–12, the exact Module 0–9 sections, and the Part 2 handoff before editing.

## Opening reconciliation gate — mandatory

This is the expected state before Part 3. It is not proof; it is the list to audit against `checklist_2.md` and the repository:

| Expected prior module | Required proven result |
|---|---|
| 0 | Electron 44 runtime/build/recovery evidence; reparent/compositor probes; artifacts and clean smoke tests |
| 1 | All semantic Liquid Glass tiers/tokens, policy helpers, cancelable motion, reduced modes, layer cap, measured passing tier |
| 2 | Explicit controller ownership, schema-v2 migration/atomic store, exact validated IPC, normal/private session/security handlers, remote isolation, lifecycle cleanup |
| 3 | 96 px shell, traffic lights, toolbar, trusted overlay, home, local router, focus/a11y, z-order and visual evidence |
| 4 | Validated searchable split-view Settings, exact defaults, scoped reset, global accessibility/theme behavior, honest About |
| 5 | Main-enforced tabs/groups/pinning/selection/overflow/overview/vertical mode, 13/25 degradation, Recently Closed and safe restart restore |
| 6 | Shared non-persistent private Session, strict normal/private boundaries, no history/restore/download/permission leaks, persistent explicit bookmarks, final-close cleanup/disclosures |

1. Locate `checklist_2.md` at the repository root, or use the exact copy attached/pasted by the user. If neither is available, stop and request it; never infer prior PASS.
2. Compare every row, assertion, command/exit code, evidence path, limitation, and status against the source plan, ledger, source tree, tests, and actual evidence. Open referenced images.
3. For each mismatch, repair the prior module first within that module’s allowed files. Re-run the relevant tests, project verification, and manual proof. Record the discrepancy and repair in `docs/implementation-ledger.md`.
4. Proceed to Module 7 only after Modules 0–6 are independently `PASS`. If a mismatch remains blocked, create a blocked checklist and stop.

## Non-negotiable execution contract

1. Preserve Gemini version `1.2.0`, appId, artifact names, Windows x64 target, recovery provenance, and the no-Git/no-commit rule.
2. Read every current module’s allowed-file list before edits. Do not silently touch unlisted files; report and stop if a required dependency is outside scope.
3. Never edit `build.bat`, `run-dev.bat`, `setup-dev.bat`, `RECOVERY_MANIFEST.json`, existing immutable evidence, `dist`, `node_modules`, `.tools`, `.qa`, or generated lockfiles by hand.
4. Remote WebContentsViews remain sandboxed and bridge-free. Use frozen narrow bridges, exact schemas, sender/owner/ID validation, default-deny unknown permissions, and no arbitrary paths or remote injection.
5. No heavy UI/state/animation/icon/CSS/database/glass dependency; no decorative `capturePage` mirroring.
6. Every module follows tests-first → intended failing assertion → smallest implementation → automated gate → real `run-dev.bat` checklist → opened screenshots/traces → ledger. Never call a test-only pass a visual pass.
7. Do not weaken tests, security, budgets, or evidence requirements. Stop after two unchanged failures unless the hypothesis changes. Checkpoint before roughly 100 tool calls or 100K visible context.

## Module 7 — Multi-window tab drag-out and reattach

**Depends on:** Modules 0–6 `PASS` and the Module 0 reparent probe `PASS`.

**Allowed files:** exact Module 7 list in the source plan: `src/main/app-controller.js`, `window-controller.js`, `tab-controller.js`, `ipc.js`, `preload.js`, renderer drag/tabs/state/CSS/overlay files, transfer/tab tests, fixture server, and `docs/evidence/tab-transfer-qa.md`.

**Forbidden:** URL-reload substitution, remote-page injection, build files.

Implement a one-owner transaction, not “open the URL in a new tab”. The closed loop must include:

- Failing tests for single-tab and multi-selection transfer, whole/partial group behavior, pin region, normal/private rejection, expired/reused token, Escape cancellation, target-attach rollback, no source destroy, and close-after-commit.
- Source creates a one-use 30-second token bound to tab IDs/source window/mode; renderer reports visible drop zones; drag changes only visual candidate; Escape leaves ownership untouched; compatible strip drop or cursor-outside detach chooses a same-mode target/new window on the nearest display.
- Create the target window before detach; remove the same WebContentsView from source without destroying it; remove/add records transactionally; verify object and WebContents ID unchanged; emit both states; rollback exact source order/active selection on any failure; close empty source only after commit.
- Preserve navigation history, form state, audio/mute, zoom, focus/IME, permissions, and active-download ownership; preserve find state if Electron does, otherwise document the measured limitation. Exit fullscreen/element state if safe reparenting requires it. Provide keyboard move-to-new-window and move-to-window submenu.
- Render insertion markers and trusted overlay drag preview; displacement/tier constraints at 13+ tabs; no `startDrag` misuse; validate screen rectangles against owner windows.

**Automated gate:** ownership/token/rollback tests pass; same WebContents ID survives; no extra WebContents for a transfer; cross-mode rejected; injected target failure restores source; tests and project verification pass.

**Manual checklist:** within-strip reorder; normal→normal reattach; normal/private desktop detach; cross-mode rejection; Escape exact restoration; multi-select order; group/partial-group semantics; form/Back-Forward/audio/mute/zoom/focus/download preservation; source close only after commit; 20-cycle no-orphan check; opened transfer evidence.

## Module 8 — Address and Search, Site Controls, permissions, errors, Find, Zoom

**Depends on:** Modules 0–7 `PASS`.

**Allowed files:** exact Module 8 list in the source plan: navigation/tab/permission/window/store/IPC/preload, toolbar/state/index/overlay/CSS, navigation/permission/suggestion/find-zoom tests, fixture server.

**Forbidden:** remote suggestion service, Safe Browsing claims, certificate bypass, remote injection, build files.

Use the exact deterministic classifier: trim; empty focuses current field; >8192 rejects; explicit HTTP/HTTPS parses; localhost/127/`[::1]` without spaces defaults HTTP and is Not Secure; other host/IP/IPv6/port/path/query/fragment without spaces defaults HTTPS and may offer explicit Try HTTP only on a local TLS error; otherwise query the selected closed-enum HTTPS engine (Google/Bing/DuckDuckGo). Block `javascript:`, `data:`, `vbscript:`, `chrome:`, `devtools:`, arbitrary file input. Never accept renderer-supplied templates.

The closed loop must include:

- Failing parser tests for empty/search/hostname/path/query/fragment/localhost/IPv4/IPv6/explicit schemes/blocked schemes/8193 chars; suggestion tests for open tabs/bookmarks/history, private filtering, exact ranking, URL dedupe, 12-row limit; permission decision/reset/stale-origin/unknown/private tests; Find forward/backward/navigation cancellation/tab switching/stale owner/non-persistence tests; all closed zoom-step/clamp/reset/duplicate/new-tab/drag-preservation tests.
- Local categorized suggestions (Switch to Tab/Bookmarks/History/Search), exact keyboard behavior, `@tabs/@bookmarks/@history`, Ctrl/Cmd+L and two-stage Escape; neutral Site Controls with origin/connection state/current permission/reset/settings link and no trust-lock claim; loading indicator independent of favicon; HTTP Not Secure and explicit TLS/crash/blocked-scheme pages.
- Owner-bound Find overlay 8 px below top-right content: `findInPage`, match ordinal/counts, Enter/Shift+Enter, Escape/Done `stopFindInPage('clearSelection')`, one in-memory session per tab, discard on navigation/close and never persist text. Owner-bound per-tab zoom only from 50/67/80/90/100/110/125/150/175/200%; Plus/Minus/0 and Site Controls reset; no per-site persistence.
- Origin-bound permission prompts with request ID/owner/tab/origin/permission/expiry; dismiss on navigation/close/timeout; Allow Once, normal-only Always Allow, Block; exact Section 7.5 allowlist; display capture requires current owned main-frame user gesture, app-owned source picker, no persisted allow; unknown deny.

**Automated gate:** parser/ranking/security/find/zoom tests; no typed partial query leaves process; blocked schemes never load; remote page has no permission IPC; HTTP has no secure claim; stale/wrong-owner actions rejected; tests and project verification pass.

**Manual checklist:** all URL/search/local/IP cases; blocked schemes; categorized/keyboard suggestions and Switch to Tab; @ filters; Find counts/navigation/ownership; exact zoom sequence/reset; neutral HTTP/HTTPS Site Controls; camera/mic/location/notification/clipboard/display-capture prompts; stale-origin dismissal; private no Always Allow; reset defaults; error pages; narrow-width readability; opened screenshots.

## Module 9 — Bookmarks

**Depends on:** Modules 0–8 `PASS`.

**Allowed files:** exact Module 9 list in the source plan: Store/IPC/preload, active-page tab lookup, renderer pages/toolbar/state/index, overlay/CSS, bookmark/store tests, fixture server.

**Forbidden:** history/download/context implementations, build files.

Enforce: immutable `root-bar`/`root-other`; main-generated IDs; folders URL null; bookmarks only validated HTTP/HTTPS; no ancestor cycles; contiguous sibling indices after move/delete; explicit confirmation for non-empty-folder deletion; import creates one named folder and never silently merges; export is Netscape HTML through OS dialogs.

The closed loop must include:

- Failing tests for add bookmark/folder, root protection, cycle prevention, index normalization, duplicate URL confirmation, normalized toggle, title/URL/folder-path search, non-empty deletion confirmation, nested/malformed import, export round-trip, and version-1 migration.
- Main-owned CRUD/search/normalized lookup with exact validators; bookmark IPC; in-house bookmark icon with accessible active state; anchored add/edit popover after Ctrl/Cmd+D with title/folder/remove/Done/Cancel; bookmark bar New Tab only/Always; one-level folder picker; hideable keyboard-usable sidebar; full manager with stable content plane, search/add/import/export toolbar, tree navigation and `aria-expanded`.
- Safe OS dialogs, main-side Netscape parser (state machine for DL/DT/H3/A only; ignore comments/script/style/unknown tags; limits 10 MiB, depth 32, 50,000 nodes), escaped export, no renderer path exposure; Home root-bar section and helpful empty state; Address @bookmarks updates immediately; explicit private bookmark persistence remains allowed.

**Automated gate:** all invariants, migration, import/export round-trip, deterministic search, no renderer filesystem/path access, tests and project verification pass.

**Manual checklist:** Ctrl/Cmd+D immediate edit; add/rename/move/folder/remove; confirmation; bar modes; sidebar/tree keyboard; manager search/title/URL/path; Home updates; @bookmarks; private bookmark survives; Import folder and Export→re-import hierarchy; opened empty/populated/deep/search/popover/bar/sidebar/manager screenshots.

## Part 3 closeout and handoff

1. Re-run the reconciliation and every Module 7–9 automated gate, then `npm run test` and `npm run verify:project` from a fresh launch. Open every required image/trace.
2. Update `docs/implementation-ledger.md` with Modules 0–9, reconciliation repairs, exact files, commands/exit codes/counts, manual results, evidence, limitations, and `Next module: 10`.
3. Create `checklist_3.md` at the repository root:

```markdown
# Gemini handoff checklist 3
Date: <UTC date>
Overall status: PASS | BLOCKED
Prior checklist reconciled: checklist_2.md — MATCH | REPAIRED | BLOCKED

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

## Completed capability assertions
- [ ] Modules 0–6 reconciled with direct evidence
- [ ] Live same-WebContents tab detach/reattach with rollback and mode boundaries
- [ ] Deterministic Address/Search, local suggestions, Site Controls, permissions, Find, and Zoom
- [ ] Bookmarks CRUD/folders/bar/sidebar/manager/search/import/export and private exception

## Evidence and limitations
- Commands and exit codes:
- Screenshots/traces opened and inspected:
- Recovery mismatches (expected vs blocker):
- Known Electron/state-preservation limitations:

## Handoff contract
- Next module: 10
- Part 4 must compare this file against its opening expected-completion list and repair mismatches first.
```

4. Tick only with direct evidence. If any item is missing, set `Overall status: BLOCKED`, list exact work, and stop; do not implement Modules 10–13 in this chat.
