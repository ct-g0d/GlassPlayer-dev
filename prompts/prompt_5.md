# Gemini Liquid Glass Browser — Part 5 Final Audit Prompt

> Executor: GPT-5.6 Luna, `reasoning.effort=max`.
> Run this in a fresh final-verification chat after Parts 1–4.
> Inputs: `checklist_1.md`, `checklist_2.md`, `checklist_3.md`, `checklist_4.md`, the repository, the original execution plan, `AGENTS.md`, and `docs/implementation-ledger.md`.
> Final artifact: `checklist_5.md` at the repository root.

## Mission

Independently determine whether the Gemini Liquid Glass Browser is actually complete, secure, usable, performant, accessible, buildable, and visually coherent. The four prior checklists are evidence candidates, not truth. Reconcile them against the source plan, source tree, tests, real runtime output, screenshots, traces, artifacts, and recovery rules. Repair every discovered implementation defect that is within the plan; do not paper over a gap by editing a checklist. The final state is `PASS` only when every required item has direct evidence. Otherwise it is `BLOCKED` with exact blockers.

## Hard opening gate

1. Locate all four checklist files. If any is missing, unreadable, internally inconsistent, or only available as an unprovided claim, stop and ask the user for the missing handoff. Do not infer completion.
2. Read the original execution plan completely enough to use Sections 1–16, especially Sections 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, and 16. Read `AGENTS.md` and the whole implementation ledger.
3. Build a reconciliation table with one row for every Module 0–13 and every prior checklist. Check the chain:
   - `checklist_2` must explicitly reconcile `checklist_1`;
   - `checklist_3` must reconcile `checklist_2`;
   - `checklist_4` must reconcile `checklist_3`;
   - no later PASS may silently erase an earlier BLOCKED item;
   - every claimed evidence path must exist and be opened/inspected.
4. If any prior checklist says PASS without direct evidence, downgrade that item to `UNPROVEN`, repair it, and record the reason. If a prior checklist is wrong, preserve the history and add a correction entry; do not rewrite evidence to make it agree.

## Final-audit rules

- Preserve version `1.2.0`, appId, artifact names, Windows x64 target, recovery provenance, and `RECOVERY_MANIFEST.json`. Never edit `build.bat`, the recovery manifest, existing immutable evidence, `dist`, `node_modules`, `.tools`, or `.qa` source. Do not initialize Git or create commits.
- Remote pages must remain sandboxed/bridge-free; all cross-process actions must use frozen narrow bridges, exact payload/enum/size/bounds validation, sender-to-owner checks, ID ownership, typed errors, and default-deny unknown permissions. No remote injection, unsafe scheme loading, arbitrary filesystem paths, or decorative `capturePage` mirroring.
- Do not add frameworks/dependencies or new product scope. Fix only a traced defect required by the original plan. For a defect belonging to an earlier module, use that module’s allowed files; use Module 13’s broad allowance only for traced integration/QA/documentation defects.
- Never weaken a test, security rule, performance budget, accessibility threshold, or evidence requirement. Never call “tests pass” equivalent to visual/runtime proof. Never claim “perfect” without the line-by-line report.
- If a command fails twice unchanged, record command/error/hypothesis/files and mark the affected item `BLOCKED`; do not loop indefinitely. Checkpoint before 100 tool calls or 100K visible context and resume from the ledger if needed.

## Audit pass A — source, architecture, and contracts

1. Verify every existing source file was read and every current feature has a keep/extend/rebuild decision with a reason (A01–A04). Verify the intended focused source layout and preserved entry filenames.
2. Verify Module 0: Electron exactly 44.0.0 in both authorized package fields; no other package/build changes; recovery/project checks; baseline/runtime evidence; reparent probe; same/sibling compositor probe; both artifacts and clean smoke.
3. Verify Module 1: Section 6.2–6.5 typography/tokens/motion; semantic token-only colors; structural/regular/clear/popover/low-power/opaque variants; specular/depth; cancelable spring/pointer helpers; reduced/inactive/forced modes; three-filter layer cap; tab thresholds; no copied technique/dependency.
4. Verify Module 2: App/Window/Tab/Overlay/Session/Store/Download/Permission ownership; schema v2; one-time migration/backup/atomic write/quarantine; no private/pageState persistence; exact IPC families/validators/typed errors; blocked schemes; pre-navigation permission/download handlers; remote isolation; explicit WebContents cleanup.
5. Verify Module 3: 96 px shell; traffic lights/hit areas/fullscreen/maximize/tiling; grouped toolbar/address/app menu; trusted overlay z-order/nonce/dismiss/focus; home exact widths/gaps/three static fields; local router; focus/a11y; no Unicode final icons; screenshots in all required modes.
6. Verify Module 4: every exact default/enum/validator; searchable split view; global vs per-site separation; atomic settings/reset; accessibility/theme fan-out; honest About and development-label removal.
7. Verify Module 5: main-enforced tab/group/pin/selection/overflow/overview/vertical invariants; audio/mute/crash/loading; close selection; in-memory Recently Closed; safe restart restore; 13/25 degradation; 40-tab width/order/layout proof.
8. Verify Module 6: shared non-persistent private partition, mode inheritance/boundaries, no history/restore/download/permission leaks, explicit private bookmark exception, disclosures, final private close cancellation/clear ordering, cookie tests.
9. Verify Module 7: live same-WebContents transfer, one-use 30-second token, compatible mode, rollback, source close-after-commit, state matrix, keyboard alternative, no orphan contents.
10. Verify Module 8: exact classifier/search engines/local ranking/12-row cap/private filtering; neutral Site Controls; HTTP Not Secure; blocked schemes; origin-bound permission allowlist and stale prompt handling; display-capture source picker; Find; closed zoom sequence and ownership.
11. Verify Module 9: bookmark roots/IDs/URL/cycle/index invariants; CRUD/search/bar/sidebar/manager; immediate edit; safe Netscape import/export limits/round-trip; migration; private explicit persistence.
12. Verify Module 10: eligible committed navigation only; 30-second merge; retention/cap/pruning/ranges; indexed search/day/domain grouping; clear independence; in-memory tab/group/window Recently Closed; private exclusion and immediate suggestion updates.
13. Verify Module 11: exact download state machine; filename/path/ID ownership; speed/ETA validity; retry linkage; normal/private persistence; tab/window close ownership; popover/manager; save dialog; no safety claims; interruption recovery.
14. Verify Module 12: allowlisted context sets; irrelevant-action omission; one submenu; closed IDs/nonces/owner binding; main clipboard limit; overlay presentation; all canonical shortcuts/focus precedence; no native Windows menu acceptance path.

## Audit pass B — tests and negative security checks

1. Run `npm run test` and record the exact exit code, test count, failures, skips, and warnings. A skipped required test is a failure.
2. Run `npm run verify:project` and record the exact result.
3. Run all relevant fixture/unit/probe tests again, including store migration/corruption, sender/owner/size validation, private isolation, tab transfer/rollback, navigation/permissions/suggestions/find/zoom, bookmarks/history/downloads, context actions/shortcuts, and leak/security negatives.
4. Prove no remote renderer can see Node, `ipcRenderer`, Gemini bridge objects, filesystem/shell/session/clipboard objects, arbitrary-path IPC, or any app-owned injection. Prove all unknown permissions and blocked schemes deny.
5. Prove normal/private cookies, histories, restore data, permission persistence, download summaries, and session cleanup exactly match policy. Prove WebContents/process counts return to baseline after repeated tab/window cycles.

## Audit pass C — real application and visual inspection

1. Launch `run-dev.bat` from a clean state and complete the entire Module 13 consolidated checklist. Use the actual fixture server and real application window.
2. Open every final PNG/contact sheet and trace/report. Inspect for clipping, overlap, z-order, unreadable contrast, stale state, inconsistent radii/specular direction, flat pre-reskin surfaces, false security wording, and mockup-vs-runtime substitution. If a required image was never captured or cannot be opened, the item is not PASS.
3. Exercise representative flows in dev: normal/private navigation; tabs/groups/pinning/selection/restore/vertical; drag reattach/detach/cancel; Address/Site Controls/permission/error; Find/Zoom; bookmark/history/download manager; active download close guards; every context type and shortcut; theme/inactive/reduced/forced/scaling modes.
4. Verify Section 10 with five warmed runs per scenario and the full A/B matrix. Record hardware, driver, resolution, DPR, refresh, frame median/p95/p99, presented drops/partials, CPU/memory, GPU delta, and effect area. Enforce: 60 Hz target; p95 ≤16.67 ms; p99 ≤33.3 ms; drops+partials <1%; effect-on p95 overhead ≤3 ms; max three filtered surfaces; blur/effect areas and 16/8 px caps; 0.5M complex/1M simple pixels; ≤16 MiB per panel/64 MiB total GPU delta; idle CPU <2 points; resize ≤4 regenerations/s; spring ≤500 ms; 13-tab and 25-tab degradation. Apply only disable-displacement → 8 px low-power → opaque fallback and re-measure.
5. Verify accessibility: contrast 4.5:1 normal and 3:1 large/bold/non-text; visible focus; names/roles/states/live announcements; keyboard-only completion; reduced motion/transparency; forced colors; increased contrast; 100/125/150/200% scaling; minimum window and 760/1080/1380/1920 widths; active/inactive windows.

## Audit pass D — packaged artifacts and recovery

1. Run `build.bat` without modifying it. Confirm both expected artifacts exist and retain product version/artifact names.
2. Launch the unpacked artifact, complete a representative normal/private/download/detach/settings/context smoke set and the consolidated checklist, open/inspect evidence, then close cleanly.
3. Launch the portable artifact and repeat the same smoke set/checklist/evidence/clean-close.
4. Run `npm run verify:recovery`. Differences are acceptable only when they are intentional, listed in the ledger, and required by the plan. Any unlisted mismatch is `BLOCKED`. Never update `RECOVERY_MANIFEST.json` to hide it.
5. Verify docs: `AGENTS.md` includes the required architecture/contracts/runtime/session/store/IPC/glass/performance/workflow notes; `README.md`, reconstruction report, QA results, ledger, and final evidence accurately state implementation versus recovered baseline, exact limitations, commands, environments, and selected glass tier/hardware.

## Repair protocol

For each failure, write a defect row before changing code: requirement/module, direct evidence, expected behavior, observed behavior, allowed files, proposed minimal fix, test/manual proof. Implement the smallest fix, add or restore a regression assertion, re-run the relevant gate, then re-run affected integrated flows. Do not batch unrelated redesign. If a failure is environmental and cannot be proven fixed, mark it `BLOCKED` with reproducible evidence.

## Final requirement report and checklist_5.md

Create `checklist_5.md` at the repository root with a complete auditable report:

```markdown
# Gemini final audit checklist 5
Date: <UTC date>
Overall status: PASS | BLOCKED

## Prior checklist chain
| Checklist | Found | Reconciled | Mismatches | Repairs/evidence |
|---|---|---|---|---|
| checklist_1.md | ... | ... | ... | ... |
| checklist_2.md | ... | ... | ... | ... |
| checklist_3.md | ... | ... | ... | ... |
| checklist_4.md | ... | ... | ... | ... |

## Module status
| Module | Status | Direct tests/commands | Runtime/manual evidence | Open issues |
|---|---|---|---|---|
| 0–13 (one row each) | ... | ... | ... | ... |

## Section 16 line-by-line coverage
| ID | Runtime status PASS/BLOCKED/UNPROVEN | Direct evidence path(s) | Repair or blocker |
|---|---|---|---|
| A01 … Q02 (every ID, no omissions) | ... | ... | ... |

## Quality gates
- [ ] Tests and project verification
- [ ] Security/privacy negative tests and WebContents cleanup
- [ ] Real dev runtime checklist and opened screenshots
- [ ] Performance five-run matrix and selected passing glass tier
- [ ] Accessibility and scaling matrix
- [ ] Unpacked and portable artifact smoke tests
- [ ] Recovery audit and intentional-mismatch accounting
- [ ] Documentation/AGENTS/ledger accuracy

## Evidence summary
- Exact commands, exit codes, test counts:
- Hardware/runtime/GPU/glass tier:
- Screenshot/trace/report paths opened:
- Expected recovery mismatches:
- Known measured limitations:
- Remaining blockers:

## Final decision
PASS is allowed only if every Module 0–13 row and every Section 16 ID is PASS with direct evidence. Otherwise Overall status is BLOCKED.
```

Also update `docs/implementation-ledger.md` with the final audit entry and the line-by-line Section 16 report. End the response with the exact status, not a vague “looks good”.
