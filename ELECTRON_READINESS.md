# Electron Readiness — Peregrine Lake

No Electron code exists in this release. The future replacement surface is limited to five Ports:

- `StoragePort`: browser implementation uses the unchanged IndexedDB adapter; future implementation may use SQLite.
- `FilePort`: browser implementation uses the existing hidden file/folder inputs; future implementation may use a native file dialog.
- `PiPPort`: browser implementation uses standard video PiP; a desktop shell may provide a native always-on-top window.
- `MediaSessionPort`: browser implementation delegates to `navigator.mediaSession`; desktop media keys can replace it.
- `ClockPort`: browser timers and animation frames are isolated for deterministic testing.

Playback, Queue, Library, History, Spectrum, Neural, Settings, Engines and Views depend on these contracts rather than Electron APIs. IndexedDB database name/version, object stores, indexes and all persisted user data remain unchanged in 6.4.4.
