# Task 2 fix round 1 review package (no Git fallback)

Fix base snapshots (the head seen by the previous reviewer):
- .superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-2-review-base/galaxy-runtime.js
- .superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-2-review-base/galaxy-runtime.test.js
- .superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-2-review-base/SOURCE_ORDER.txt

Fix changed files: src/services/galaxy-runtime.js, tests/galaxy-runtime.test.js,
and the appended report. SOURCE_ORDER.txt is unchanged in this fix.

## Findings under verification

1. src/services/galaxy-runtime.js:21-23,154 — tracks without a stable ID
received one shared spectrum:unidentified-track key, so tied-key sorting
preserved caller order and made layout output differ after reordering.
2. src/services/galaxy-runtime.js:157-164 — incomplete zero-filled MFCC
vectors participated in means, covariance, and PCA instead of using only
usable vectors.
3. src/services/galaxy-runtime.js:183-190,202-203 — refinement overwrote
points2d[center], which was also later used as the selected track's local
projection.
4. src/services/galaxy-runtime.js:195-198 — arm radius/angle produced
linear Archimedean-style placement instead of logarithmic spiral arms.
5. tests/galaxy-runtime.test.js:26-45 — no focused coverage for missing IDs
or incomplete-vector normalization.

## Implementer report

Read the appended fix-round report at:
.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-2-report.md

## Current fixed source: src/services/galaxy-runtime.js

```js
/* ================= Music Galaxy Service =================
   Pure, deterministic feature comparison and layout helpers. This service
   deliberately consumes cached track snapshots only. */
GPModules.register("createGalaxyService", function createGalaxyService() {
  const DIMENSIONS = 13;
  const POWER_ITERATIONS = 12;
  const SAFE_SCALES = [18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18];
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  const finite = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const text = value => String(value == null ? "" : value).trim();

  function hash(value) {
    let result = 2166136261;
    for (const character of text(value)) {
      result ^= character.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  function stableFallback(track) {
    const mfcc = Array.isArray(track?.mfcc?.mean) ? track.mfcc.mean : Array.isArray(track?.mfcc) ? track.mfcc : [];
    return JSON.stringify([
      track?.title || null,
      track?.artist || null,
      track?.genre || track?.inferredGenre || null,
      track?.genreSecondary || null,
      finite(track?.bpm),
      finite(track?.bpmConfidence),
      mfcc.slice(0, DIMENSIONS).map(value => finite(value))
    ]);
  }

  function stableIdentity(track) {
    const identity = track?.spectrumId || track?.audioEssenceKey || track?.contentKey || track?.id;
    return text(identity) || `fallback-${hash(stableFallback(track)).toString(16)}`;
  }

  function cleanMfcc(track) {
    const source = Array.isArray(track?.mfcc?.mean) ? track.mfcc.mean : Array.isArray(track?.mfcc) ? track.mfcc : [];
    const complete = source.length >= DIMENSIONS && source.slice(0, DIMENSIONS).every(value => Number.isFinite(Number(value)));
    return { values: Array.from({ length: DIMENSIONS }, (_, index) => finite(source[index], 0)), complete };
  }

  function featureVector(track = {}) {
    const mfcc = cleanMfcc(track);
    const bpm = finite(track.bpm);
    const bpmConfidence = clamp(finite(track.bpmConfidence, bpm === null ? 0 : 1) / (finite(track.bpmConfidence, 1) > 1 ? 100 : 1));
    const genre = text(track.genre || track.inferredGenre) || "Unknown";
    const genreSecondary = text(track.genreSecondary) || null;
    const acousticCoverage = mfcc.complete ? 1 : mfcc.values.some(value => value !== 0) ? .5 : 0;
    const coverage = clamp(acousticCoverage * .6 + (bpm === null ? 0 : .25) + (genre === "Unknown" ? 0 : .15));
    return Object.freeze({
      mfcc: Object.freeze(mfcc.values),
      mfccComplete: mfcc.complete,
      bpm,
      bpmConfidence,
      confidence: clamp(coverage * (.65 + bpmConfidence * .35)),
      coverage,
      featureCoverage: coverage,
      stableKey: `spectrum:${stableIdentity(track)}`,
      genre,
      genreSecondary,
      genres: Object.freeze([genre, genreSecondary].filter(Boolean))
    });
  }

  function lexicalSimilarity(left, right) {
    const a = text(left).toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
    const b = text(right).toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
    if (!a || !b) return .12;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const pairs = new Map();
    for (let index = 0; index < a.length - 1; index++) {
      const pair = a.slice(index, index + 2);
      pairs.set(pair, (pairs.get(pair) || 0) + 1);
    }
    let matches = 0;
    for (let index = 0; index < b.length - 1; index++) {
      const pair = b.slice(index, index + 2);
      const count = pairs.get(pair) || 0;
      if (count) { matches++; pairs.set(pair, count - 1); }
    }
    return clamp(2 * matches / (a.length + b.length - 2));
  }

  function offlineGenreSimilarity(left, right) {
    const relations = typeof globalThis !== "undefined" ? globalThis.GP?.genreRelations : null;
    const leftGenres = left.genres || [left.genre].filter(Boolean);
    const rightGenres = right.genres || [right.genre].filter(Boolean);
    let best = 0;
    for (const a of leftGenres) for (const b of rightGenres) {
      let score = null;
      if (relations && typeof relations.similarity === "function") {
        try { score = relations.similarity(a, b); } catch (_) { score = null; }
      }
      best = Math.max(best, clamp(Number.isFinite(score) ? score : lexicalSimilarity(a, b)));
    }
    return best || .12;
  }

  function asVector(track) {
    return track && Array.isArray(track.mfcc) && Object.prototype.hasOwnProperty.call(track, "stableKey") ? track : featureVector(track);
  }

  function compareTracks(leftTrack, rightTrack) {
    const left = asVector(leftTrack), right = asVector(rightTrack);
    let mfccDistance = 0;
    for (let index = 0; index < DIMENSIONS; index++) mfccDistance += Math.abs(left.mfcc[index] - right.mfcc[index]) / SAFE_SCALES[index];
    const mfccScore = mfccDistance <= 0 ? 1 : Math.exp(-mfccDistance / DIMENSIONS);
    const bothBpm = Number.isFinite(left.bpm) && Number.isFinite(right.bpm);
    const tempoScore = bothBpm ? Math.exp(-Math.abs(left.bpm - right.bpm) / 24) : .28;
    const genreScore = offlineGenreSimilarity(left, right);
    const overall = clamp(mfccScore * .60 + tempoScore * .25 + genreScore * .15);
    return Object.freeze({
      mfcc: clamp(mfccScore),
      tempo: clamp(tempoScore),
      genre: clamp(genreScore),
      overall,
      coverage: clamp((left.coverage + right.coverage) / 2),
      confidence: clamp((left.confidence + right.confidence) / 2)
    });
  }

  function dot(left, right) {
    let result = 0;
    for (let index = 0; index < left.length; index++) result += left[index] * right[index];
    return result;
  }

  function normalizeDirection(direction, fallbackIndex = 0) {
    const length = Math.sqrt(dot(direction, direction));
    if (!(length > 1e-9)) {
      const fallback = Array(DIMENSIONS).fill(0);
      fallback[fallbackIndex % DIMENSIONS] = 1;
      return fallback;
    }
    const normalized = direction.map(value => value / length);
    const pivot = normalized.reduce((best, value, index) => Math.abs(value) > Math.abs(normalized[best]) ? index : best, 0);
    if (normalized[pivot] < 0) return normalized.map(value => -value);
    return normalized;
  }

  function principalDirection(covariance, seed, against = null) {
    let direction = Array.from({ length: DIMENSIONS }, (_, index) => ((seed + index * 17) % 23) / 23 + .2);
    for (let iteration = 0; iteration < POWER_ITERATIONS; iteration++) {
      const next = covariance.map(row => dot(row, direction));
      if (against) {
        const projection = dot(next, against);
        for (let index = 0; index < DIMENSIONS; index++) next[index] -= projection * against[index];
      }
      direction = normalizeDirection(next, iteration + seed);
    }
    return normalizeDirection(direction, seed);
  }

  function distance(left, right) {
    let total = 0;
    for (let index = 0; index < left.length; index++) total += (left[index] - right[index]) ** 2;
    return total;
  }

  function buildLayout(tracks = [], options = {}) {
    const width = Math.max(120, finite(options.width, 1200));
    const height = Math.max(120, finite(options.height, 700));
    const vectors = (Array.isArray(tracks) ? tracks : []).map(asVector).sort((left, right) => left.stableKey.localeCompare(right.stableKey));
    if (!vectors.length) return Object.freeze({ width, height, points: Object.freeze([]), clusters: Object.freeze([]), labels: Object.freeze([]), coverage: 0, signature: "galaxy-empty" });

    const usableVectors = vectors.filter(vector => vector.mfccComplete);
    const means = Array(DIMENSIONS).fill(0);
    usableVectors.forEach(vector => vector.mfcc.forEach((value, index) => { means[index] += value; }));
    means.forEach((_, index) => { means[index] /= Math.max(1, usableVectors.length); });
    const scales = means.map((mean, index) => Math.max(2, Math.sqrt(usableVectors.reduce((sum, vector) => sum + (vector.mfcc[index] - mean) ** 2, 0) / Math.max(1, usableVectors.length))));
    const normalized = vectors.map(vector => vector.mfccComplete ? means.map((mean, index) => (vector.mfcc[index] - mean) / scales[index]) : Array(DIMENSIONS).fill(0));
    const covariance = Array.from({ length: DIMENSIONS }, () => Array(DIMENSIONS).fill(0));
    normalized.filter((_, index) => vectors[index].mfccComplete).forEach(vector => vector.forEach((left, row) => vector.forEach((right, column) => { covariance[row][column] += left * right; })));
    covariance.forEach(row => row.forEach((_, index) => { row[index] /= Math.max(1, vectors.length); }));
    const axisX = principalDirection(covariance, hash(vectors[0].stableKey) % 19);
    const axisY = principalDirection(covariance, (hash(vectors[vectors.length - 1].stableKey) % 19) + 3, axisX);
    const projected = normalized.map(vector => [dot(vector, axisX), dot(vector, axisY)]);
    const projectionScale = Math.max(1, ...projected.flat().map(value => Math.abs(value)));
    const points2d = projected.map(point => point.map(value => value / projectionScale));

    const k = Math.max(1, Math.min(8, Math.round(Math.sqrt(vectors.length / 2))));
    const centers = [hash(vectors[0].stableKey) % vectors.length];
    while (centers.length < k) {
      let bestIndex = 0, bestDistance = -1;
      vectors.forEach((vector, index) => {
        if (centers.includes(index)) return;
        const nearest = Math.min(...centers.map(center => distance(points2d[index], points2d[center])));
        if (nearest > bestDistance || (nearest === bestDistance && vector.stableKey < vectors[bestIndex].stableKey)) { bestDistance = nearest; bestIndex = index; }
      });
      centers.push(bestIndex);
    }
    const assignments = Array(vectors.length).fill(0);
    const centroidPoints = centers.map(center => points2d[center].slice());
    for (let pass = 0; pass < POWER_ITERATIONS; pass++) {
      const sums = centers.map(() => [0, 0, 0]);
      points2d.forEach((point, index) => {
        let cluster = 0, nearest = Infinity;
        centroidPoints.forEach((centroid, candidate) => { const d = distance(point, centroid); if (d < nearest) { nearest = d; cluster = candidate; } });
        assignments[index] = cluster; sums[cluster][0] += point[0]; sums[cluster][1] += point[1]; sums[cluster][2]++;
      });
      centroidPoints.forEach((_, index) => { if (sums[index][2]) centroidPoints[index] = [sums[index][0] / sums[index][2], sums[index][1] / sums[index][2]]; });
    }

    const marginX = Math.min(54, width * .12), marginY = Math.min(44, height * .12);
    const usableWidth = Math.max(20, width - marginX * 2), usableHeight = Math.max(20, height - marginY * 2);
    const clusterCenters = centers.map((_, index) => {
      const arm = index % 2 ? -1 : 1, armStep = Math.floor(index / 2) + 1;
      const angle = arm * (.55 + armStep * .82);
      const radius = .08 * Math.exp(.30 * Math.abs(angle));
      return [width / 2 + Math.cos(angle) * usableWidth * radius, height / 2 + Math.sin(angle) * usableHeight * radius];
    });
    const points = vectors.map((vector, index) => {
      const cluster = assignments[index], jitter = hash(vector.stableKey);
      const localX = points2d[index][0] * usableWidth * .22 + (((jitter & 255) / 255) - .5) * usableWidth * .018;
      const localY = points2d[index][1] * usableHeight * .22 + ((((jitter >>> 8) & 255) / 255) - .5) * usableHeight * .018;
      const x = Math.max(marginX, Math.min(width - marginX, clusterCenters[cluster][0] + localX));
      const y = Math.max(marginY, Math.min(height - marginY, clusterCenters[cluster][1] + localY));
      return { key: vector.stableKey, x, y, radius: Math.min(6, 2 + vector.coverage * 3), opacity: clamp(.58 + vector.confidence * .4, .35, 1), colorFamily: hash(vector.genre) % 12, cluster };
    });
    const clusters = clusterCenters.map((center, index) => {
      const members = vectors.filter((_, vectorIndex) => assignments[vectorIndex] === index);
      const genres = members.map(vector => vector.genre).filter(genre => genre !== "Unknown");
      const genre = genres.sort()[0] || "Mixed";
      const bpms = members.map(vector => vector.bpm).filter(Number.isFinite);
      const tempo = bpms.length ? `${Math.round(bpms.reduce((sum, bpm) => sum + bpm, 0) / bpms.length)} BPM` : "Tempo n/a";
      return { id: index, x: center[0], y: center[1], count: members.length, label: `${genre} · ${tempo}` };
    });
    const labels = clusters.map(cluster => cluster.label);
    const coverage = clamp(vectors.reduce((sum, vector) => sum + vector.coverage, 0) / vectors.length);
    const signature = `galaxy-${hash(points.map(point => `${point.key}:${point.x.toFixed(4)}:${point.y.toFixed(4)}`).join("|"))}`;
    return Object.freeze({ width, height, points: Object.freeze(points), clusters: Object.freeze(clusters), labels: Object.freeze(labels), coverage, signature });
  }

  return Object.freeze({ featureVector, compareTracks, buildLayout, recommendationSimilarity: compareTracks });
});


```

## Current fixed test: tests/galaxy-runtime.test.js

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


```

Reported covering evidence: pure test and both syntax checks exit 0; focused
probe asserts missing-ID caller-order independence, incomplete vectors do not
change complete-track relative coordinates, separate center storage, and
exponential spiral radius. The package is read-only; do not run broad tests.
