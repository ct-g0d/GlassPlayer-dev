# App Store Schema — 6.4.4

The single Store is created by `bootstrap/main.js`. `getState()` returns a cloned, frozen snapshot; state changes only through `dispatch`.

```text
library: tracks[], currentTrackId, sortMode, importStatus
playback: status, wantsPlayback, position, duration, volume, mode,
          crossfadeEnabled, crossfadeSeconds
queue: items[], manualActive, playingQueuedTrack, resumeTrackId,
       shuffleTimeline[], shuffleCursor
settings: language, theme, backgroundMode, coverMode, adaptiveColor,
          spatialEnabled, spatialMode, loudnessNormalizationEnabled, eqPreset
analysis: activeTrackId, pending[], completed, failed
ui: activeView, activePanel, historyMode
```

Prohibited values: `AudioContext`, `AudioNode`, `AudioBuffer`, `HTMLMediaElement`, DOM nodes, Canvas contexts, `File`, Object URLs, timers, observers, functions, IDB transactions and mutable module internals.
