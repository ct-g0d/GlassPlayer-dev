# Event Contracts — 6.4.4

All names are centralized in `src/core/contracts.js`. Events are transient notifications, never request/response channels.

| Event | Payload | Producer | Consumers |
|---|---|---|---|
| `playback:track-started` | read-only playback snapshot | Playback Service | History, PiP, UI |
| `playback:track-paused` | read-only playback snapshot | Playback Service | History, PiP, UI |
| `playback:track-ended` | `{trackId, position, duration}` | Playback Service | Queue, History, Neural |
| `playback:seeked` | `{trackId, from, to, duration}` | Playback Service | History, Neural |
| `playback:crossfade-started/completed` | track IDs and timing | Audio Engine | Playback Service, UI |
| `library:import-completed` | import counts and duration | Library Service | Spectrum Service, UI |
| `analysis:completed` | `{trackId, result}` | Spectrum Service | Library, Neural, UI |
| `analysis:failed` | `{trackId, error}` | Spectrum Service | UI diagnostics |
| `settings:changed` | changed key and read-only settings snapshot | Settings Service | Engines, Views, PiP |
| `pip:opened/closed` | PiP lifecycle snapshot | PiP Service | UI |
| `gp:viewport-fit` (DOM lifecycle event) | {width,height} fitted viewport dimensions | Window Layout UI | Shared Controls Sidebar |

Listener disposal is mandatory through the unsubscribe function returned by Event Bus `on()`.

## Visual Motion Scheduling Contract

Visual animation is refresh-driven, not timer-driven. CSS motion, Web Animations and `requestAnimationFrame` are the only frame schedulers. They must present natively on 60/90/120 Hz displays, with elapsed-time interpolation preserving the same duration and final state. Fixed 60 Hz loops, frame-count timing and visual `setInterval` schedulers are forbidden.
