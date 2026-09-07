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
const incompleteTempoTracks = [
  track("tempo-present", Array(13).fill(0), 128),
  { ...track("tempo-missing", Array(13).fill(1), 128), bpm: undefined },
  { ...track("tempo-invalid", Array(13).fill(2), 128), bpm: "not-a-number" }
];
const incompleteTempoLayout = galaxy.buildLayout(incompleteTempoTracks, { width: 1200, height: 700 });
const incompleteTempoRepeat = galaxy.buildLayout(incompleteTempoTracks, { width: 1200, height: 700 });
assert.deepEqual(incompleteTempoLayout.points, incompleteTempoRepeat.points);
assert(incompleteTempoLayout.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
const fallbackOriginal = {
  title: "Original Title",
  artist: "Original Artist",
  filePath: "C:/Music/stable-source.mp3",
  size: 123456,
  duration: 201,
  lastModified: 1700000000000,
  bpm: 128,
  mfcc: { mean: Array(13).fill(1) }
};
const fallbackRenamed = { ...fallbackOriginal, title: "Renamed Title", artist: "Renamed Artist" };
assert.equal(galaxy.featureVector(fallbackOriginal).stableKey, galaxy.featureVector(fallbackRenamed).stableKey);
assert.equal(
  galaxy.buildLayout([fallbackOriginal], { width: 1200, height: 700 }).signature,
  galaxy.buildLayout([fallbackRenamed], { width: 1200, height: 700 }).signature
);

const tempoLayoutTracks = [
  track("tempo-target", Array(13).fill(1), 90),
  track("tempo-middle", Array(13).fill(1), 120),
  track("tempo-high", Array(13).fill(1), 150)
];
const tempoLayout = galaxy.buildLayout(tempoLayoutTracks, { width: 1200, height: 700 });
const tempoLayoutRepeat = galaxy.buildLayout(tempoLayoutTracks, { width: 1200, height: 700 });
assert.equal(tempoLayout.signature, tempoLayoutRepeat.signature);
assert.deepEqual(tempoLayout.points, tempoLayoutRepeat.points);
const tempoChangedLayout = galaxy.buildLayout(
  [track("tempo-target", Array(13).fill(1), 180), tempoLayoutTracks[1], tempoLayoutTracks[2]],
  { width: 1200, height: 700 }
);
const pointCoordinates = (layout, key) => {
  const point = layout.points.find(candidate => candidate.key === key);
  return [point.x, point.y];
};
assert.notDeepEqual(
  pointCoordinates(tempoChangedLayout, "spectrum:tempo-target"),
  pointCoordinates(tempoLayout, "spectrum:tempo-target"),
  "changing BPM for the same stable track must change its layout coordinate"
);

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
assert(first.clusters.every(cluster => !/(?:BPM|Tempo)/.test(cluster.label)), "cluster labels must stay classification-only");
const denseTracks = Array.from({length: 120}, (_, index) => track(
  `dense-${index}`,
  Array.from({length: 13}, (_, dimension) => Math.sin(index * .37 + dimension * .19) * 8),
  60 + (index * 7) % 140,
  ["Electronic", "Ambient", "Classical", "Jazz"][index % 4]
));
const denseLayout = galaxy.buildLayout(denseTracks, { width: 1200, height: 700 });
const denseXs = denseLayout.points.map(point => point.x);
const denseYs = denseLayout.points.map(point => point.y);
assert(Math.max(...denseXs) - Math.min(...denseXs) >= 1200 * .72, "dense galaxy layout should use more stage width");
assert(Math.max(...denseYs) - Math.min(...denseYs) >= 700 * .60, "dense galaxy layout should use more stage height");
assert(galaxy.recommendationSimilarity(base, near).overall > galaxy.recommendationSimilarity(base, far).overall);
console.log("PASS galaxy-runtime pure behavior");
