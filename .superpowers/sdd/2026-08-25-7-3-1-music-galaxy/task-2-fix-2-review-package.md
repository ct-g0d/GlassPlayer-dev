# Task 2 fix round 2 review package (no Git fallback)

Fix base snapshots:
- `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-2-fix-1-base/galaxy-runtime.js`
- `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-2-fix-1-base/galaxy-runtime.test.js`

Fix changed files: `src/services/galaxy-runtime.js`,
`tests/galaxy-runtime.test.js`, and the appended report. No source-order or
integration file changed.

## Finding under verification

Round 1 re-review found that the fallback identity at the time used mutable
`title` and `artist` fields. A metadata edit could therefore change the
fallback key and layout identity for a track with no stable identity field.
This conflicted with the stable-identity constraint.

## Fix diff — fallback identity

Current `src/services/galaxy-runtime.js` lines 21–43:

```js
function stableFallback(track) {
  const mfcc = Array.isArray(track?.mfcc?.mean) ? track.mfcc.mean : Array.isArray(track?.mfcc) ? track.mfcc : [];
  const sourceFields = [
    track?.filePath, track?.path, track?.locator, track?.fileLocator,
    track?.sourcePath, track?.sourceLocator, track?.size, track?.fileSize,
    track?.byteLength, track?.duration, track?.lastModified, track?.fileLastModified
  ].filter(value => value !== undefined && value !== null && value !== "");
  if (sourceFields.length) return JSON.stringify(["source", sourceFields]);
  return JSON.stringify([
    finite(track?.bpm),
    finite(track?.bpmConfidence),
    finite(track?.energy),
    finite(track?.loudness),
    finite(track?.duration),
    finite(track?.size),
    mfcc.slice(0, DIMENSIONS).map(value => finite(value))
  ]);
}

function stableIdentity(track) {
  const identity = track?.spectrumId || track?.audioEssenceKey || track?.contentKey || track?.id;
  return text(identity) || `fallback-${hash(stableFallback(track)).toString(16)}`;
}
```

The fallback no longer reads title, artist, genre or secondary genre. Stable
identity fields remain authoritative before the fallback.

## Fix diff — regression test

Current `tests/galaxy-runtime.test.js` lines 50–68:

```js
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
assert.equal(galaxy.buildLayout([fallbackOriginal], { width: 1200, height: 700 }).signature, galaxy.buildLayout([fallbackRenamed], { width: 1200, height: 700 }).signature);
```

## Report and test evidence

Read the appended Fix round 2 section in:
`.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-2-report.md`

Reported covering results: production/test syntax checks exit 0, pure test
prints `PASS galaxy-runtime pure behavior`, and the focused fallback identity
probe passes for title/artist mutation, stable source fields, and anonymous
reordering. The implementer notes only the unavoidable identical-input
collision case, which remains deterministic and caller-order independent.
