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
├─ Services: Playback / Queue / Library / History / Spectrum / Neural / Settings / PiP
└─ Data + UI: i18n / Releases / EQ / Spatial presets / Views / Shared Controls
```

Cross-module paths:

- Player View → Playback Service → Queue Service / Audio Engine → Store + Event Bus.
- Library View → Library Service → FilePort / Recognition Engine / StoragePort → Store.
- Spectrum Service → Spectrum Analyzer + StoragePort → Event Bus.
- History Service → StoragePort; Neural Service consumes behavior/features plus read-only offline Genre Relations but never controls playback.
- PiP Service → PiPPort + Playback Service; drawing delegates to the pure PiP renderer.

Forbidden edges: Service → concrete View DOM; UI → raw AudioNode/IndexedDB; Engine → View; Core → Service; Adapter → UI. No known cycle exists in the registered factory graph.
