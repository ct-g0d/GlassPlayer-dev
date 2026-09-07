# Regression Report — 6.4.4

## Automated checks

Result: **PASS with browser-policy limitation**.

- `app.css` current 6.4.4 hash: `1B07C802B8EAB5EE6C87ADE4DA0AF876825E498536B816E906D088AEB3C4884C`.
- Baseline `app.js` unchanged: `D51344E628426EC85ED257FB6E321205F999437950F21D5D2C061CF214BA33B6`.
- Original HTML unchanged: `B85F8F8D5D944645BD2B79334E40F3F485E8E92748F81B189CF6105925670625`.
- New build syntax valid; single outer runtime and single bootstrap preserved.
- Offline Genre graph runtime check passed: Cantopop resolves to Pop; House/Techno similarity exceeds House/Classical; source contains no fetch/XHR/WebSocket/EventSource path.
- Spectrum normalization retains original Loudness, clamps static gain and adds no database version/store/index migration.
- No direct IndexedDB/transaction access outside Browser Storage Adapter.
- No direct localStorage access outside Browser Storage Adapter (release text excluded).
- No AudioContext/AudioNode construction in UI source.
- No `src/js`, `src/modules`, ES imports/exports, npm or bundler runtime.

## Interactive checklist

The following existing behavior is unchanged by source-order-preserving migration but could not be automated because browser control blocks local `file://` navigation:

- File/folder/drop import, metadata, cover, de-duplication, search, sort and rescan.
- Play/pause/seek/volume/mute, previous/next, Sequential/Shuffle/Repeat One, dual Deck and Crossfade.
- Queue add/play-next/remove/clear/reorder, queue completion and shuffle back navigation.
- EQ/Custom EQ, Spatial true bypass and fixed mode transitions.
- PiP open/close/control/theme/font/resize and cleanup.
- Spectrum cache/MFCC/BPM/Energy/Genre and no duplicate analysis.
- Listening time/ranges/Top 50/favorites/data and no false pause/seek time.
- behaviorEvents/userModel/recommendations/confidence fallback/manual Queue isolation.
- All Views, SSE, Motion, gliders, localization, themes, accent, typography and resizing.

Open `index.html` directly in Edge to execute this media-dependent checklist with the user's real local library and existing browser data.
