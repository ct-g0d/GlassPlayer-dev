# Task 7: Add the 7.3.1 Apple-style release and durable governance records

Tasks 2–6 implemented the pure Music Galaxy service, Daily Mix metric reuse,
Canvas surface, and 7.3.1 visible identity. This task records those facts in
the durable release log and current governance/handoff documents.

## Files

Modify only:

- `src/data/releases.js`
- `AGENTS.md`
- `CURRENT_STATE.md`
- `AI_WORKSPACE_HANDOFF.md`
- `MODULE_API.md`
- `MODULE_GOVERNANCE.md`
- `DEPENDENCY_GRAPH.md`
- `DELIVERY_CHECKLIST.md`
- `tests/contract-tests.ps1`

Do not edit `STATE_OWNERSHIP.md`, `EVENT_CONTRACTS.md`, `STORE_SCHEMA.md`,
historical reports, source files, `SOURCE_ORDER.txt`, or generated
`build/app.js`. No state/schema/event contract changed.

## RED contract first

Strengthen `tests/contract-tests.ps1` before the production documentation
edits. Require a newest-first `version:"7.3.1"` release entry with matching
Chinese/English user-facing areas and no 7.3.1 placeholder wording. Run the
contract script and record the intended RED result before editing.

## Release entry

Insert a newest-first `7.3.1` patch entry named `GALAXY UPDATE` in
`src/data/releases.js`. Use Apple-style release notes: one short practical
overview followed by matching named areas in Chinese and English:

- `音乐银河` / `Music Galaxy`
- `星点与交互` / `Stars and Interaction`
- `MFCC、BPM 与每日推荐` / `MFCC, BPM and Daily Mix`
- `引擎版本` / `Engine Versions`

Keep bullets user-facing, concise and non-marketing. Do not expose raw MFCC
arrays, Canvas implementation details, internal source names, speculative
roadmap items or claims not implemented. Remove the implemented Galaxy preview
claim from the `Unreleased` roadmap while keeping other genuinely future ideas
there. Preserve every historical version entry unchanged. Update exported
current-version summary/filename only as required by existing release code.

## Governance and handoff

Document `Music Galaxy Service` as a pure deterministic service with the
current API (`featureVector`, `compareTracks`, `buildLayout`,
`recommendationSimilarity`), allowed consumers (Galaxy View and Neural/Daily
Mix), and forbidden DOM/storage/audio/network dependencies. Add the Service →
Galaxy View and Service → Neural dependency edges. Add the API signatures and
compatibility notes to `MODULE_API.md`. Update current (not historical)
version/source-count/engine identity and Music Galaxy ownership facts in
`AGENTS.md`, `CURRENT_STATE.md`, and the matching current sections of
`AI_WORKSPACE_HANDOFF.md`.

Append a new 7.3.1 delivery record to `DELIVERY_CHECKLIST.md`; do not rewrite
the 7.3.0 record. It must state scope, protected data, owner, version/cache
impact and explicit PASS/NOT RUN/BLOCKED statuses, without pretending build,
browser, audio, 4K or 120 Hz checks have run.

## Checks and boundaries

Run the documentation contract and focused searches for identity, release
parity, ownership and dependency edges. Do not run build or final architecture
gates in this task. Do not change source/runtime behavior, persistence,
history, queue, audio graph, or the established Apple-style changelog rule.

## Report

Write `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-7-report.md` with
RED/GREEN evidence, changed/protected files, release parity, governance
coverage, and downstream Task 8 concerns. Return only status, changed files,
tests and concerns.
