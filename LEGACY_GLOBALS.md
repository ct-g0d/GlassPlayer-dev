# Legacy Runtime Inventory — 6.4.4

These values remain lexical inside the one build IIFE; none is exposed as `window.currentIndex` or another communication global. The public architecture wraps the same implementation rather than copying it.

| Legacy value | Definition owner | Readers / writers | Peregrine owner | Store/private | Serializable | Status |
|---|---|---|---|---|---|---|
| `playlist` | Audio runtime preamble | Library, Playback, History, UI | Library Service | `library.tracks` snapshot + runtime files private | Partial | Bridged, one array |
| `playQueue` | Audio runtime preamble | Queue/Playback/UI | Queue Service | `queue.items` snapshot | Yes | Bridged, one array |
| `currentIndex` | Audio runtime preamble | Playback/UI/History | Playback Service | `library.currentTrackId` | Yes | Compatibility index; no window global |
| `isPlaying`, `wantsPlayback` | Audio runtime preamble | Playback/UI/PiP | Playback Service | `playback.*` | Yes | Bridged |
| `playbackIntentToken`, `pendingPlayToken` | Audio runtime preamble | Playback sequencing | Playback Service | Private | No | Private concurrency guard |
| `playMode` | Audio runtime preamble | Playback/Queue/UI | Playback Service | `playback.mode` | Yes | Bridged |
| `shuffleTimeline`, `shuffleTimelineCursor` | Audio runtime preamble | Queue navigation | Queue Service | `queue.shuffle*` | Yes | Bridged |
| `deckA`, `deckB`, `decks`, `audio` | Audio runtime preamble | Audio runtime | Audio Engine | Private | No | Private, one pair |
| `audioCtx`, `mixBus`, `masterGain`, `analyser` | Audio runtime preamble | Audio/Spatial/EQ | Audio Engine | Private | No | Private, one context |
| `crossfading`, `crossfadeSwapTimer` | Audio runtime preamble | Audio runtime | Audio Engine | Private | No | Private |
| `spatialEngine`, `spatialMode` | Player runtime | Spatial/UI settings | Spatial Engine | Runtime private + settings snapshot | Mixed | Bridged |
| `historyStoreCache` | History runtime | History/Neural | History Service | Private cache | Yes when saved | Private |
| PiP canvas/video/timers | Player runtime | PiP only | PiP Service | Private | No | Private |

Deletion condition for compatibility names: only after their real callers are migrated in a behavior-changing version with full media regression. No second value may be introduced meanwhile.
