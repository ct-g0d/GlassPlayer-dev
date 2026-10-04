# Gemini Liquid Glass Browser — Part 2 Execution Prompt

> Executor: GPT-5.6 Luna, `reasoning.effort=max`.
> Run this in a fresh chat after Part 1.
> Scope: reconcile Modules 0–3, then implement Modules 4, 5, and 6 only.
> Handoff artifact: `checklist_2.md` at the repository root.

## Mission

Continue the Gemini browser implementation from Part 1. First prove that the foundation is really complete; then add searchable Settings, the complete tab model, and a genuine separate Private Window. The attached execution plan remains normative: locate it as `EXECUTION_PLAN.md` or the supplied Gemini Liquid Glass execution-plan file and read Sections 1–12, the exact Module 0–6 sections, and the Part 1 handoff before editing.

## Opening reconciliation gate — do this before touching product code

The expected completion list from Part 1 is deliberately embedded here so this chat does not trust a prior model’s prose:

| Expected prior module | What must already be proven |
|---|---|
| 0 | Electron exactly 44.0.0; baseline/recovery evidence; build artifacts; reparent probe; compositor boundary probe; clean normal navigation/download smoke test |
| 1 | Semantic tokens; structural/regular/clear/popover/low-power/opaque tiers; policy functions; cancelable motion; reduced/forced modes; layer cap; glass-lab performance evidence |
| 2 | App/Window/Tab/Overlay/Session/Store/Download/Permission ownership; schema v2 migration; atomic writes/quarantine; exact validated IPC; remote isolation; unknown permission deny; no single-window globals |
| 3 | 96 px shell; traffic lights; grouped toolbar; trusted overlay; focus/a11y; local page router; complete home composition; remote-view z-order; light/dark/reduced/forced evidence |

1. Locate `checklist_1.md` at the repository root. If the user pasted or attached it instead, use that exact copy. If neither exists, stop and ask for the handoff; do not infer completion.
2. Parse every Module 0–3 row, capability assertion, command/exit code, evidence path, limitation, and overall status. Cross-check it against the source tree, `docs/implementation-ledger.md`, the source plan’s Module 0–3 definitions of done, and actual files/evidence.
3. If any expected item is absent, stale, contradicted, or marked PASS without direct evidence, repair it before Module 4. Re-run the missing tests/manual checks and repair only within the original module’s allowed files. A mismatch is a real task, not a documentation nuisance.
4. Write a reconciliation entry in `docs/implementation-ledger.md` naming each mismatch, files changed, commands, evidence, and result. Do not overwrite a prior PASS with unsupported prose.
5. Proceed only when Modules 0–3 are independently `PASS`. If a foundation defect cannot be repaired safely, mark this part `BLOCKED` in the eventual checklist and stop.

## Non-negotiable execution contract

1. Work in the actual Gemini project root. Preserve version `1.2.0`, appId, artifact names, Windows x64 target, and the recovery boundary.
2. Read every file in each current module’s **Files allowed** list before editing. Do not silently broaden scope; if an unlisted file is essential, stop and report the exact path/reason.
3. Never edit `build.bat`, `run-dev.bat`, `setup-dev.bat`, `RECOVERY_MANIFEST.json`, existing immutable evidence, `dist`, `node_modules`, `.tools`, `.qa`, or generated `package-lock.json` by hand. Do not initialize Git or create commits.
4. Keep all remote content sandboxed and bridge-free. All cross-process actions use frozen, narrow contextBridge wrappers and exact sender/schema/owner validation. Unknown permissions deny.
5. No UI framework, state library, animation/icon/CSS framework, database, or glass dependency. No remote-page injection and no decorative capturePage mirroring.
6. For each module: add the named failing tests; run and confirm the intended failure; implement the smallest correct change; run automated gates; launch the real app; complete every run-dev line; open every required screenshot; update the ledger. Never claim PASS from tests alone.
7. Never weaken a test, security rule, performance budget, or manual checklist. Stop after two unchanged failures unless the hypothesis/evidence changes. Keep a human-readable checkpoint before roughly 100 tool calls or 100K visible context.

## Module 4 — Settings

**Depends on:** Modules 0–3 `PASS` after reconciliation.

**Allowed files:** `src/renderer/settings.mjs`; `src/renderer/pages.mjs`; `src/index.html`; `src/styles/pages.css`; `src/styles/chrome.css`; `src/main/store.js`; `src/main/ipc.js`; `src/preload.js`; `tests/unit/settings.test.cjs`; `tests/unit/store.test.cjs`; `tests/unit/all.test.cjs`; `tests/fixture-server.cjs`.

**Forbidden:** feature implementations owned by Modules 5–12 and build files.

Use the exact defaults from the source plan: startup New Tab; Gemini Start Page; continueWhereLeftOff false; theme System; glass Automatic; bookmark bar New Tab only; tab layout Horizontal; closeWindowWithLastTab true; recently-closed limit 25; Google search; local suggestions true and remote suggestions false/hidden; 90-day history; clear private data on last private window (mandatory); camera/microphone/location/display capture/pointer lock/keyboard lock Ask; notifications Block; clipboard-read Ask with only Allow Once/Block; fullscreen active-owned-tab/user-gesture rule; storage-access/unlisted capabilities Block; OS Downloads; askEveryTime false; remove completed Manual; text scale 100%; accessibility overrides Follow system.

Execute every atomic step in Module 4 of the source plan. The closed loop must include:

- Failing tests for every default, unknown key/enum rejection, text-scale 90–130% clamp, allowed retention values, non-disableable private cleanup, category-only reset, and atomic persistence.
- Exact schema and `settings:get`, `settings:update`, `settings:reset-section` IPC with typed validation and affected-window fan-out; appearance updates every window; private mode cannot persist unsafe private-only state.
- A searchable two-column split view: leading glass category sidebar; opaque structural content plane; General, Appearance, Tabs, Search, Privacy & Security, Site Permissions, Downloads, Accessibility, About; search indexes labels/descriptions/synonyms and focuses the exact control; visible labels and privacy explanations; scoped reset sheet with Cancel/Reset; future controls hidden or development-only disabled until their module lands; About reports runtime/app/recovery state and honestly says no Safe Browsing/malware-scanning service.
- Keyboard navigation, focus/selection semantics, 100/125/150/200% scaling, light/dark/reduced/forced modes, tests, project verification, and opened screenshots.

**Automated gate:** all defaults/validators/reset/atomic-write tests pass; search index covers visible settings; renderer has no privileged API; `npm run test` and `npm run verify:project` exit 0.

**Manual checklist:** Settings opens from menu and shortcut; every category pointer/keyboard reachable; searches focus correct settings; theme changes all open windows; reduced settings update material; 130% text and 200% scaling do not clip; reset affects only its category; cancel is side-effect free; About reports Electron 44.0.0/app 1.2.0 and no false security claim; open/inspect required screenshots.

## Module 5 — Tabs, groups, pinning, overflow, restore, vertical mode

**Depends on:** Modules 0–4 `PASS`.

**Allowed files:** exact Module 5 list in the source plan: `src/main/tab-controller.js`, `src/main/window-controller.js`, `src/main/store.js`, `src/main/ipc.js`, `src/preload.js`, `src/renderer/tabs.mjs`, `src/renderer/state.mjs`, `src/renderer/drag.mjs` for within-strip reorder only, `src/index.html`, overlay/CSS files, named tab/store/unit tests, fixture server.

**Forbidden:** cross-window detach, private windows, bookmarks/history/download/context implementations, build files.

Enforce the tab invariants in main, not only in the renderer. Every tab has id/owner/WebContents reference held only in main, title/URL/favicon/loading/crash/navigation/audio/mute/pin/group/selection/last-active/zoom; mode comes from its owner. Groups have owner, title max 80, one of six semantic colors, collapsed/order; pinned tabs cannot be grouped; pinning a grouped tab removes its group.

Execute every atomic step in Module 5. The closed loop must include:

- Failing tests for pinned ordering/unpin insertion; group create/name/recolor/collapse/delete; Ctrl-click and Shift-click selection; active selection; stable multi-selection reorder; collapsed active-group visibility; deterministic close selection; close-window setting; in-memory Recently Closed; same-run navigation-history restore; restart restore containing only current URLs/metadata; 13-tab static glass and 25-tab 72 px minimum; horizontal/vertical order identity.
- Implement select-one/toggle/range/clear separately; pin/unpin; groups; stable block reorder; close; in-memory Recently Closed; navigationHistory snapshot/restore with honest fallback notice; normal startup restore metadata and clean-exit/unclean-exit handling; audio/mute/crash/loading state; explicit owner-validated IPC/preload.
- Render fixed pinned region plus independently scrolling normal region; group headers; active contrast instead of extra blur; loading/audio/mute/crash labels and controls; minimum 72 px normal tabs/preferred 120 px; overflow fades/trackpad scroll; local tab overview through the shared overlay with title/URL search, window/group/recency order and Arrow/Enter/Delete/Escape; hideable/resizable 200–360 px vertical sidebar; groups/tabs only hierarchy.
- Disable displacement at 13+ tabs, static tint at 25+, preserve functionality/focus, implement canonical tab shortcuts, and keep cross-window movement disabled until Module 7.

**Automated gate:** reducer invariants, exact close/destroy counts, privacy-safe restore JSON, 40 rendered tabs with no title tab below 72 px, identical horizontal/vertical IDs/order, tests, project verification.

**Manual checklist:** 1/12/13/24/40 tabs; pinned scroll; pin/group/edit/collapse/delete; multi-select/move; audio/mute/crash/loading; same-run Recently Closed preserves form and Back/Forward; restart restores current URLs only; layout switch preserves order/selection; vertical resize does not cover page; open/inspect screenshots and 40-tab trace.

## Module 6 — Private Window

**Depends on:** Modules 0–5 `PASS`.

**Allowed files:** exact Module 6 list in the source plan: session/app/window/tab/overlay/store/download/permission/IPC/preload/page/state/index/overlay/CSS files and named tests/fixture.

**Forbidden:** drag-out, final download UI, context menus, build files.

Treat Private as a separate browser context, not a theme switch. All private windows share one named non-persistent Session; normal/private tabs never mix; cross-mode transfers are rejected; last private close clears storage/cache/auth cache/service workers/session-only permission/download summaries; private visits never enter persistent history, Recently Closed, restore, or address-history suggestions; explicit private bookmark creation persists; downloaded files remain on disk; private download records are memory-only; persistent permission writes from private are rejected; disclosures state that sites/organizations/networks, downloads, and bookmarks can still reveal activity.

Execute every atomic step in Module 6. The closed loop must include:

- Failing tests for different normal/private partition objects, shared private Session, non-persistence, all persistence gates, private bookmark exception, normal/private transfer rejection, and final-private close behavior (idle clear; decline stays open; confirm cancels/waits/clears in order).
- Lazy creation/reference counting; handlers before first navigation; immutable window mode inherited by tabs; history/restore/download/permission gates; bookmark persistence; Ctrl/Cmd+Shift+N and app-menu route; Private Start Page with always-visible label, restrained structural variant, limitations panel, private-only tab search, and downloads reminder.
- Exact trusted final-private-download sheet choices: “Keep Window Open” and “Close and Cancel N Downloads”; await terminal callbacks, clear storage/cache, destroy session-only summaries, never delete downloaded files/bookmarks or write a persistent visited-origin event.

**Automated gate:** normal/private cookie isolation both directions; shared private cookie between two private windows; cookie absent after final private close/new private window; persistent JSON byte-equivalent except explicit bookmark; unknown private permissions denied; tests and project verification pass.

**Manual checklist:** shortcut opens Private; label remains visible; distinct but not crude black recolor; accurate limitations; fixture login/cookie isolation; two private windows share session; closing one preserves other; final close clears; private visits absent from history/restore/suggestions; private bookmark persists; private download file remains but record disappears; exact active-download close sheet; open/inspect light/dark/reduced/inactive screenshots.

## Part 2 closeout and handoff

1. Re-run all reconciliation checks, every Module 4–6 automated gate, `npm run test`, and `npm run verify:project` from a fresh launch. Open every required screenshot and trace.
2. Update `docs/implementation-ledger.md` with rows for Modules 0–6, including the reconciliation result, exact files, commands/exit codes/counts, manual checklist results, evidence paths, limitations, and `Next module: 7`.
3. Create `checklist_2.md` at the repository root. It must preserve the prior result and be usable by Part 3 without relying on memory:

```markdown
# Gemini handoff checklist 2
Date: <UTC date>
Overall status: PASS | BLOCKED
Prior checklist reconciled: checklist_1.md — MATCH | REPAIRED | BLOCKED

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

## Completed capability assertions
- [ ] Part 1 foundation independently reconciled and evidenced
- [ ] Searchable validated Settings and global accessibility controls
- [ ] Complete tabs/groups/pinning/selection/overflow/restore/vertical mode
- [ ] Separate shared non-persistent Private Window and retention disclosures

## Evidence and limitations
- Commands and exit codes:
- Screenshots/traces opened and inspected:
- Recovery mismatches (expected vs blocker):
- Known limitations:

## Handoff contract
- Next module: 7
- Part 3 must compare this file against its opening expected-completion list and repair mismatches first.
```

4. Tick an item only with direct evidence. If anything is missing, set `Overall status: BLOCKED`, list exact repair work, and stop; do not implement Modules 7–13 in this chat.
