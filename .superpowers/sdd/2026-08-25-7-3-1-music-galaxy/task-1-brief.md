# Task 1: Create the pure Galaxy RED tests and static contracts

This is the first implementation task for Glass Player 7.3.1. Establish the
failing pure-service tests and the initial structural contracts before any
production Galaxy code exists.

## Files

- Create `tests/galaxy-runtime.test.js`.
- Modify `tests/contract-tests.ps1`.

## Requirements

The future `src/services/galaxy-runtime.js` must register
`createGalaxyService` through the existing `GPModules.register` boundary. The
pure test must load that future source fragment with Node's `vm` and assert
the public methods `featureVector`, `compareTracks`, `buildLayout` and
`recommendationSimilarity`.

Create the test harness with this exact behavior:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const factories = {};
const context = vm.createContext({
  console,
  GPModules: { register(name, factory) { factories[name] = factory; } }
});
vm.runInContext(
  fs.readFileSync("src/services/galaxy-runtime.js", "utf8"),
  context,
  { filename: "src/services/galaxy-runtime.js" }
);

const galaxy = factories.createGalaxyService();
const track = (id, mfcc, bpm, genre = "Electronic") => ({
  spectrumId: id,
  title: id,
  artist: "Test Artist",
  genre,
  bpm,
  bpmConfidence: 95,
  mfcc: { mean: mfcc }
});
const base = track("base", Array.from({length: 13}, (_, i) => i), 128);
const near = track("near", Array.from({length: 13}, (_, i) => i + .15), 130);
const far = track("far", Array.from({length: 13}, (_, i) => 18 - i), 190, "Classical");

const vector = galaxy.featureVector(base);
assert.equal(vector.mfcc.length, 13);
assert.equal(vector.bpm, 128);
assert.equal(galaxy.compareTracks(base, base).overall, 1);
assert(galaxy.compareTracks(base, near).overall > galaxy.compareTracks(base, far).overall);

const tracks = [base, near, far, track("ambient", Array(13).fill(-3), 72, "Ambient")];
const first = galaxy.buildLayout(tracks, { width: 1200, height: 700 });
const reordered = galaxy.buildLayout([tracks[2], tracks[0], tracks[3], tracks[1]], { width: 1200, height: 700 });
const firstById = new Map(first.points.map(point => [point.key, [point.x, point.y]]));
for (const point of reordered.points) {
  assert.deepEqual([point.x, point.y], firstById.get(point.key));
  assert(Number.isFinite(point.x) && Number.isFinite(point.y));
}
assert(first.clusters.length >= 1 && first.clusters.length <= 8);
assert(first.points.every(point => point.radius > 0 && point.radius <= 6));
assert(galaxy.recommendationSimilarity(base, near).overall > galaxy.recommendationSimilarity(base, far).overall);
console.log("PASS galaxy-runtime pure behavior");
```

Use the bundled Node runtime at:
`C:\Users\user2\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`.

Before creating the production service, run the pure test and observe the
expected RED failure because `src/services/galaxy-runtime.js` is absent. Do
not create that production file in this task.

Extend `tests/contract-tests.ps1` with initial static assertions for the
future feature. Load `$galaxySource` and `$galaxyViewSource` near the other
source reads. Add these exact assertions:

```powershell
Expect ($index -notmatch 'galaxy-coming-soon|敬请期待|Coming Soon') 'Music Galaxy placeholder must be replaced'
Expect ($index -match 'id="galaxyCanvas"' -and $index -match 'id="galaxyTooltip"' -and $index -match 'id="galaxyStatus"') 'Music Galaxy Canvas surface is missing'
Expect ($galaxySource -match 'createGalaxyService|buildLayout|compareTracks|recommendationSimilarity') 'Music Galaxy Service boundary is missing'
Expect ($galaxyViewSource -match 'GALAXY_HOVER_SPEED_LIMIT|requestAnimationFrame|spatial|Canvas') 'Music Galaxy interaction/render contract is missing'
Expect ($build -match 'version:"7\.3\.1"' -and $build -match 'GP Fusion Engine 4\.0' -and $build -match 'GP Spectrum Engine 2\.3' -and $build -match 'GP Neural Engine 2\.2') '7.3.1 engine identity is missing'
```

The first contract run should show these new assertions RED while preserving
the existing baseline results. Record exact failure names in your report.

## Boundaries

- Do not create production Galaxy files in this task.
- Do not modify `index.html`, `app.css`, source files, generated output, or
  release/docs files.
- Do not weaken the pure assertions to accept missing keys, NaN, unstable
  coordinates, or reversed distance order.
- Do not dispatch subagents.
- The repository has no usable Git metadata; do not initialize Git or create
  commits.

## Checks

Run the pure Node test once before the production file exists, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\contract-tests.ps1
```

The contract script is expected to fail at the new assertions in this RED
task; existing unrelated baseline failures should not be introduced.

## Report

Write a full report to:
`.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-1-report.md`

Include changed files, exact commands and outputs, the expected RED evidence,
self-review findings, and any concerns. Return only status, changed files,
one-line test summary, and concerns after writing the report.
