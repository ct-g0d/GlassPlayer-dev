# Dependency Graph — Peregrine Lake

Allowed direction:

```text
Core
  ↑
Browser Adapters + Engines + Data
  ↑
Services
  ↑
UI Views
  ↑
Bootstrap
```

Actual bootstrap chain:

```text
bootstrap/main
├─ Core: Contracts → Event Bus → Actions → Store → Selectors → App Context
├─ Adapters: Clock / Media Session / File / PiP / StoragePort
├─ Engines: Audio / Recognition / Spectrum / Spatial / Motion
├─ Services: Playback / Queue / Library / History / Spectrum / Neural / Music Galaxy / Settings / PiP
└─ Data + UI: i18n / Releases / EQ / Spatial presets / Galaxy View / other Views / Shared Controls
```

Cross-module paths:

- Player View → Playback Service → Queue Service / Audio Engine → Store + Event Bus.
- Library View → Library Service → FilePort / Recognition Engine / StoragePort → Store.
- Spectrum Service → Spectrum Analyzer + StoragePort → Event Bus.
- History Service → StoragePort; Neural Service consumes behavior/features plus read-only offline Genre Relations but never controls playback.
- Music Galaxy Service → Galaxy View: frozen cached-track vectors and deterministic layout results only; the Service never writes View DOM.
- Music Galaxy Service → Neural Service/Daily Mix: shared `recommendationSimilarity` results only; Neural retains preference, freshness, diversity and persistence policy.
- Music Galaxy Service → read-only offline Genre Relations; DOM, storage, audio and runtime network access are forbidden.
- PiP Service → PiPPort + Playback Service; drawing delegates to the pure PiP renderer.

Forbidden edges: Service → concrete View DOM; UI → raw AudioNode/IndexedDB; Engine → View; Core → Service; Adapter → UI. No known cycle exists in the registered factory graph.
