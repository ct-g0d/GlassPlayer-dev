# Review package — Task 1 (no Git fallback)

This project has no usable Git metadata. The Task 1 base snapshot is:
`.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-1-base/contract-tests.ps1`
with SHA-256 `86AAB9294C0FC504C4572CD17F6C99C80A94DEAB7EBA30C29F9DED12540C8674`.
The current changed files are listed below. Read this package once, then use
the exact current file paths only for any focused verification needed.

## Files changed

- `tests/galaxy-runtime.test.js` (new, full content below)
- `tests/contract-tests.ps1` (two safe source loads, five RED assertions,
  displayed count 141 → 146)
- `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-1-report.md` (report)

## New test: tests/galaxy-runtime.test.js

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

## Contract additions: tests/contract-tests.ps1

Added near the existing source reads (current lines 29–30):

```powershell
$galaxySource=if(Test-Path -LiteralPath (Join-Path $ProjectRoot 'src/services/galaxy-runtime.js')){Get-Content -LiteralPath (Join-Path $ProjectRoot 'src/services/galaxy-runtime.js') -Raw -Encoding UTF8}else{''}
$galaxyViewSource=if(Test-Path -LiteralPath (Join-Path $ProjectRoot 'src/ui/galaxy-view.js')){Get-Content -LiteralPath (Join-Path $ProjectRoot 'src/ui/galaxy-view.js') -Raw -Encoding UTF8}else{''}
```

Added at current lines 275–279:

```powershell
Expect ($index -notmatch 'galaxy-coming-soon|敬请期待|Coming Soon') 'Music Galaxy placeholder must be replaced'
Expect ($index -match 'id="galaxyCanvas"' -and $index -match 'id="galaxyTooltip"' -and $index -match 'id="galaxyStatus"') 'Music Galaxy Canvas surface is missing'
Expect ($galaxySource -match 'createGalaxyService|buildLayout|compareTracks|recommendationSimilarity') 'Music Galaxy Service boundary is missing'
Expect ($galaxyViewSource -match 'GALAXY_HOVER_SPEED_LIMIT|requestAnimationFrame|spatial|Canvas') 'Music Galaxy interaction/render contract is missing'
Expect ($build -match 'version:"7\.3\.1"' -and $build -match 'GP Fusion Engine 4\.0' -and $build -match 'GP Spectrum Engine 2\.3' -and $build -match 'GP Neural Engine 2\.2') '7.3.1 engine identity is missing'
```

The only other changed contract text is the final displayed count, from
`"Contracts checked: 141"` to `"Contracts checked: 146"`.

## Implementer report

Read:
`.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-1-report.md`

Reported checks: pure test fails with ENOENT for absent production service;
contract run reports exactly the five new named RED failures; no production
file or protected file was changed. The report notes the pre-existing
placeholder assertions at current lines 173 and 217 as a downstream concern.
