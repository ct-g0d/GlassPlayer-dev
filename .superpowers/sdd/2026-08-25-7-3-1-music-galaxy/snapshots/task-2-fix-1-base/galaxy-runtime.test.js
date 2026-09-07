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

const incomplete = { genre: "Electronic", mfcc: { mean: [] } };
const incompleteVector = galaxy.featureVector(incomplete);
assert.equal(incompleteVector.mfccComplete, false);
assert(incompleteVector.coverage < .2);
const anonymous = [
  { title: "Anonymous A", genre: "Electronic", bpm: 90, mfcc: { mean: Array(13).fill(-2) } },
  { title: "Anonymous B", genre: "Electronic", bpm: 120, mfcc: { mean: Array(13).fill(0) } },
  { title: "Anonymous C", genre: "Ambient", bpm: 150, mfcc: { mean: Array(13).fill(2) } }
];
const anonymousLayout = galaxy.buildLayout(anonymous, { width: 1200, height: 700 });
const anonymousReordered = galaxy.buildLayout([anonymous[2], anonymous[0], anonymous[1]], { width: 1200, height: 700 });
assert.equal(anonymousLayout.signature, anonymousReordered.signature);
assert.deepEqual(anonymousLayout.points, anonymousReordered.points);
assert.equal(new Set(anonymousLayout.points.map(point => point.key)).size, anonymous.length);

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
