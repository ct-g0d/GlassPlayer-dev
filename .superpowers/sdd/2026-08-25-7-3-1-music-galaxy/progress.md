# SDD ledger — plan: docs/superpowers/plans/2026-08-25-7-3-1-music-galaxy.md

## Setup

- Workspace: `D:\GlassPlayer-dev\.superpowers\sdd\2026-08-25-7-3-1-music-galaxy`
- Project has no usable `.git`; no commit baseline or commit ranges are available.
- Ruling: use file snapshots and manually generated review packages in this workspace instead of Git-based `BASE..HEAD` packages — the plan explicitly records that verification artifacts replace commits, and initializing Git would add unrelated project state.
- Spec authority: `docs/superpowers/specs/2026-08-25-7-3-1-music-galaxy-design.md`.
- Implementer contract: each child reads its task brief, edits only the task write set, runs the named checks, writes a report beside its brief, and does not dispatch children.

## Pre-flight plan scan

### Task self-consistency

| Task | Own files and interfaces | Self-consistency result | Ruling |
| --- | --- | --- | --- |
| 1 | Creates pure Node test and extends static contracts for future service/view/identity | RED commands target absent files and the contract variables are explicitly added before use | Proceed; expected RED is intentional |
| 2 | Creates `galaxy-runtime.js`, registers `createGalaxyService`, inserts source order, turns Task 1 pure tests GREEN | Service API matches the pure test and forbids browser/runtime side effects | Proceed |
| 3 | Injects the Task 2 service into Neural and checks the shared call site | Bootstrap construction order and Neural facade are both named; existing model/persistence shape remains protected | Proceed |
| 4 | Replaces only Galaxy section child DOM, adds scoped CSS/i18n and static hooks | Exact hooks consumed by Task 5 are produced without changing section/nav ownership | Proceed |
| 5 | Creates Canvas view, consumes Task 2 service/Task 4 hooks, adds narrow refresh hook | Mount/refresh/destroy, speed gate, spatial hash and shared view lifecycle are all specified | Proceed |
| 6 | Updates visible version identities while retaining cache/model tokens | Visible engine constants are separate from `GP_SPECTRUM_ALGORITHM_VERSION` and `NEURAL_MODEL_VERSION` | Proceed |
| 7 | Adds release/governance/current-state records for the implemented surface | Documents the owner/API/dependency and leaves schema/event docs unchanged unless implementation actually adds one | Proceed |
| 8 | Builds generated runtime and runs final gates/visual checks | Build is the only writer of `build/app.js`; final checks cover source, architecture, contracts and residue | Proceed |

### Shared file/interface scan

| Shared tasks | Producer/consumer relationship | Pre-flight finding | Ruling |
| --- | --- | --- | --- |
| 1 ↔ 2 | `tests/galaxy-runtime.test.js` specifies the service Task 2 creates | Test fixture/API names agree | Proceed |
| 1 ↔ 3 | `tests/contract-tests.ps1` gains the Neural injection assertion after the initial RED set | Additive contract edits are compatible | Proceed |
| 1 ↔ 4 | Contract script checks current placeholder DOM and future hooks | Task 4 removes the exact residue Task 1 detects | Proceed |
| 1 ↔ 5 | Contract script loads and checks the future view source | Task 5 creates the file and satisfies the structural checks | Proceed |
| 1 ↔ 6 | Contract script checks engine/version identity | Task 6 supplies the identity after earlier feature checks | Proceed |
| 1 ↔ 7 | Contract script checks release/governance synchronization | Task 7 supplies durable release/docs facts | Proceed |
| 2 ↔ 3 | `createGalaxyService` is injected into Neural; `recommendationSimilarity` is the shared metric | Task 3 consumes the exact API Task 2 returns | Proceed |
| 2 ↔ 5 | `createGalaxyService` is injected into Galaxy View; `buildLayout` returns serializable points/clusters | View has no need to know service internals | Proceed |
| 3 ↔ 5 | Both modify bootstrap service/view wiring | Merge by preserving one service construction path and one `refreshMusicGalaxy` registration | Ruling: later implementation must reconcile bootstrap edits surgically; no second runtime/service owner |
| 3 ↔ 6 | Both touch Neural/bootstrap identity and service setup | Shared edits are additive and identity constants remain separate from Neural model version | Proceed |
| 4 ↔ 5 | Task 4 produces `galaxyCanvas`, `galaxyTooltip`, `galaxyStatus`; Task 5 resolves them | Exact DOM hooks are stable | Proceed |
| 4 ↔ 6 | Both touch index/i18n | DOM copy and version strings have distinct ownership; preserve both | Proceed |
| 5 ↔ 6 | Both touch bootstrap and current view facade | View wiring and identity wiring must remain one bootstrap path | Ruling: preserve the existing bootstrap order and use shared constants; do not duplicate `window.GP` facades |
| 6 ↔ 7 | Version strings/releases/docs must agree | Task 7 is downstream of identity values | Proceed |
| 7 ↔ 8 | Delivery checklist records build/architecture/contract results | Task 8 appends measured results rather than rewriting history | Proceed |

### Global constraint scan

- No task creates a second Store, Event Bus, Queue, AudioContext, IndexedDB schema, or view-transition engine.
- No task edits `build/app.js` directly, root `app.js`, or `original/Glass Player 6.2.2.html`.
- No task introduces runtime network requests, audio decode during render, fixed-frame animation, or direct UI storage/audio access.
- No task changes persistent keys, object stores, cache identity, behavior-event schema, user-model schema, or listening history.
- No task silently changes the selected Accent behavior or unrelated protected panels.

## Task status

- Task 1: minor (deferred): Existing placeholder assertions at `tests/contract-tests.ps1:173,174,217` must be reconciled when Task 4 replaces the placeholder.
- Task 1: complete (no Git commits; file-snapshot review clean)
- Task 2: fix round 1/5 (5 prior findings addressed; 1 new Important open — mutable title/artist fallback identity; no Git snapshots)
- Task 2: fix round 2/5 (1 finding addressed, 0 open; no new Critical/Important breakage)
- Task 2: complete (no Git commits; review clean after 2 fix rounds)
- Ruling: Task 3 plan omitted `src/services/neural-service.js`, the actual `createNeuralService` registration boundary — allow that file in the narrow write set so `runtime.galaxy` can reach the legacy Neural Daily Mix closure without adding a second service, Store state, Event Bus event or persistence field; cost if wrong: a reviewer may require moving the bridge into a different existing service boundary.
- Task 3: complete (no Git commits; review clean)
- Task 4: fix round 1/5 (1 Important finding addressed, 0 open; no new Critical/Important breakage)
- Task 4: complete (no Git commits; review clean after 1 fix round)
- Ruling: Task 5 plan omitted the mandatory `SOURCE_ORDER.txt` entry for the new `src/ui/galaxy-view.js` and the existing `src/ui/player-visuals.js` selector that owns adaptive title contrast — allow one exact source-order insertion and one exact `.galaxy-title` selector update; cost if wrong: a reviewer may require splitting the UI behavior or documenting a second owner.
- Task 5: pending
- Task 5 review: fix round 1/5 (3 Important and 1 Minor findings addressed; scoped re-review found 0 Critical/Important/Minor findings; review snapshot `snapshots/task-5-review-base`)
- Task 5: complete (no Git commits; review clean after 1 fix round)
- Ruling: Task 6's centralized Fusion constant is consumed at `audio-engine.js` initialization, but the existing `SOURCE_ORDER.txt` placed that consumer before `runtime-constants.js`; allow one exact source-order move of `runtime-constants.js` before `audio-engine.js`, plus the required observable audio-diagnostic version getter and order contracts. Cost if wrong: the new visible identity would cause a TDZ startup failure instead of a usable runtime.
- Task 6 review: fix round 1/5 (1 Critical and 2 Important findings addressed; scoped re-review found 0 Critical/Important/Minor findings; review snapshots `snapshots/task-6-review-base` and `task-6-fix-1-review-package.md`)
- Task 6: complete (no Git commits; review clean after 1 fix round)
- Ruling: Task 7 review exposed two runtime/documentation mismatches that cannot be repaired truthfully by copy alone: the approved MFCC+BPM layout contract needs the existing Galaxy Service to include BPM in its deterministic layout vector, and the final Bootstrap facade must preserve the already-bundled read-only Genre Relations object used by Galaxy/Neural similarity. Allow the narrow source/test additions (`src/services/galaxy-runtime.js`, `tests/galaxy-runtime.test.js`, `src/bootstrap/main.js`, and the existing contract) plus current-document corrections; no new state/event/schema/owner. Cost if wrong: either the shipped map would not satisfy the requested BPM relationship or Daily Mix would silently fall back to lexical genre matching.
- Task 7 review: fix round 1/5 (3 Important findings addressed; re-review found 0 Critical/Important and 3 Minor findings; review snapshots `snapshots/task-7-review-base` and `task-7-fix-1-review-package.md`)
- Task 7: fix round 2/5 in progress (minor audit/report/test wording cleanup)
- Task 7: complete (review fix round 2 passed; 0 Critical/Important open)
- Task 7 urgent hotfix: import completion now invokes the existing
  `refreshMusicGalaxy` controller after analysis and Daily Mix finalization;
  this keeps an already-open Galaxy view synchronized with the imported
  playlist without adding state, events or persistence.
- Task 8: complete (build, ordered-source syntax, architecture and 146
  contracts passed; browser/audio/4K/120 Hz checks remain explicitly not run)
