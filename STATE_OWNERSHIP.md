# State Ownership — Glass Player 6.4.4

Peregrine Lake keeps one runtime owner for every mutable value. The Store contains serializable snapshots and command state only; browser and audio resources remain private.

| State | Canonical owner | Representation | Serializable | Writers | Readers |
|---|---|---|---|---|---|
| `library.tracks`, `currentTrackId`, import/sort state | Library Service / App Store | Store snapshot backed by the single `playlist` runtime array | Yes, without `File`/URL objects | Library Service | Selectors, Views, Playback Service |
| Queue, manual priority, resume target | Queue Service | Store snapshot backed by the single `playQueue` runtime array | Yes | Queue Service | Playback Service, Queue View |
| Shuffle timeline and cursor | Queue Service | Store snapshot backed by the single timeline | Yes | Queue Service | Playback Service |
| Playback status, intent, position, volume and mode | Playback Service / App Store | Store state | Yes | Playback Service | Selectors, Views, PiP Service |
| AudioContext, Deck A/B, AudioNodes, crossfade/normalization gains and analyser | Audio Engine | Engine-private runtime | No | Audio Engine only | Audio Engine snapshots only |
| Crossfade timers and AudioParam automation | Audio Engine | Engine-private runtime | No | Audio Engine only | Playback Service via commands |
| Spatial A/B buses, IR and Chorus LFO | Spatial Engine | Engine-private runtime | No | Spatial Engine only | Snapshot only |
| IndexedDB connection and transactions | Browser Storage Adapter | Adapter-private runtime | No | Storage Adapter only | Services through StoragePort |
| Track cache, features, behavior events, user model and recommendations | IndexedDB stores | Existing schema, unchanged | Yes | StoragePort clients | StoragePort clients |
| PiP canvas, video, stream, scheduler and observers | PiP Service | Service-private runtime | No | PiP Service only | Snapshot only |
| DOM, observers, pointer state and animation handles | UI Views / Motion Engine | View-private runtime | No | Owning View | Owning View |
| Theme, language, typography, EQ, Spatial and loudness-normalization preference | Settings Service / App Store | Store snapshot and existing `glassPlayerPrefs` key | Yes | Settings Service | Selectors, Views, Engines |
| History cache and active listening checkpoint | History Service | Service-private cache plus existing persistence | Yes after serialization | History Service | History View, Neural Service |
| Analysis queue and counters | Spectrum Service / App Store | Store state; Analyzer owns transient calculation buffers | Mixed | Spectrum Service | Views, diagnostics |

## Migration history

- 6.3.2: language, releases, fixed Spatial presets and PiP drawing gained explicit read-only boundaries.
- 6.4.0: formal Core/Port/Engine/Service/UI ownership documents and a single bootstrap Context were introduced. No storage key, schema or user record was migrated.
- 6.4.1: the existing preference record gains one loudness-normalization boolean; feature records may gain a derived normalization value without database/schema migration or loss of original Loudness.
