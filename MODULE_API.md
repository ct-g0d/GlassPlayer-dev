# Module API — Glass Player 7.3.1

New Peregrine interfaces are **Experimental** unless stated otherwise. They return frozen facades or cloned snapshots and never expose mutable runtime internals.

## Core

| Module / API | Level | Parameters / return | Errors | Side effects | Callers | Contract test / compatibility |
|---|---|---|---|---|---|---|
| Module Registry `register(name,factory)` | Candidate | string + factory → factory | duplicate/invalid registration | defines one immutable registry entry | source files | registry uniqueness; `window.GPModules` retained |
| Event Bus `on/off/emit/clear` | Experimental | event + listener/payload | invalid listener | listener registration and synchronous notification | Services, Bootstrap | subscribe/unsubscribe test |
| Actions `patch`, `replace` | Experimental | path/value or state → frozen action | none | none | Services, Store migration | action-shape test |
| Store `getState` | Candidate | none → frozen cloned snapshot | clone failure for prohibited values | none | Selectors, Facade | isolation test; no internal reference returned |
| Store `dispatch` | Experimental | documented action → action | unknown action/path | replaces or patches serializable state; notifies subscribers | Services | reducer/notification test |
| Store `subscribe`, `subscribeSelector` | Experimental | listener → unsubscribe | invalid selector behavior propagates | registers listener | Views/Bootstrap | disposal test |
| Store `replaceStateForMigration` | Experimental | serializable state → void | clone failure | controlled checkpoint migration | Bootstrap only | replace test; not a normal feature API |
| Selectors | Experimental | state → read-only slice/current track | none | none | Views, Services, Facade | selector fixture test |
| App Context factory | Candidate | dependency object → frozen context | missing dependency surfaces at bootstrap | none | Bootstrap | freeze test |

## Browser Ports and Adapters

| Module / API | Level | Parameters / return | Errors | Side effects | Callers | Contract test / compatibility |
|---|---|---|---|---|---|---|
| StoragePort `open`, cache/features/behavior/model/recommendation methods | Candidate | existing record IDs/records → Promises | unchanged IndexedDB errors | existing database transactions only | Library, Spectrum, History, Neural | method-shape and schema-name regression |
| FilePort `pickAudioFiles`, `pickAudioFolder` | Experimental | none → Promise<File[]> | picker cancellation returns empty array | opens existing hidden input | Library Service | input binding test; file:// compatible |
| PiPPort `supported/request/exit` | Experimental | video or none → Promise | browser PiP errors propagate | native PiP lifecycle | PiP Service | support/bypass test |
| MediaSessionPort | Experimental | metadata/state/handler | browser errors propagate | updates existing Media Session | Playback Service | capability-guard test |
| ClockPort | Experimental | timer/frame arguments | native errors | schedules/cancels native work | Motion, PiP, tests | timer shape test |

## Engines

| Module / API | Level | Parameters / return | Errors | Side effects | Callers | Contract test / compatibility |
|---|---|---|---|---|---|---|
| Audio Engine `init/loadTrack/play/pause/seek/setVolume/setEQ/setSpatialMode/setSpatialEnabled/startCrossfade/stop/destroy` | Candidate | command-specific; void/Promise as existing runtime | media/Web Audio errors propagate | owns the one AudioContext and two Decks | Playback/Settings Services | single-context, command-shape, bypass regression |
| Audio Engine `getRuntimeSnapshot` | Candidate | none → frozen snapshot | none | none | Playback/PiP diagnostics | no raw node test |
| Recognition Engine | Candidate | File/track → recognition or metadata Promise | parse errors retain existing fallback | reads audio bytes; no UI | Library Service | identity field/schema regression |
| Spectrum Analyzer `analyze/readCached/processPending` | Candidate | track/key → Promise | decode/analysis errors propagate | feature calculation only | Spectrum Service | cache/version test |
| Spatial Engine `setEnabled/setMode/getSnapshot/destroy` | Candidate | boolean/mode → existing runtime result | invalid modes use existing guard | fixed A/B bus configuration on user command only | Settings/Audio | true-bypass and one-bus regression |
| Motion Engine `transitionView/transitionSector/setPopover/refresh` | Candidate | DOM host/state → void | invalid host follows existing guard | animations only | Views | no duplicate listener and timing regression |

## Services

| Module / API | Level | Parameters / return | Errors | Side effects | Callers | Contract test / compatibility |
|---|---|---|---|---|---|---|
| Playback Service `play/pause/toggle/playTrack/next/previous/seek/setVolume` | Candidate | track ID/options or numeric value | engine errors propagate | audio command, playback event, state intent | Player/PiP/Media Session | command routing and event tests |
| Queue Service `add/playNext/remove/clear/reorder/resolveNextTrack/resolvePreviousTrack/getVisibleQueue/restoreLibraryOrder` | Candidate | IDs/positions → existing result or frozen queue | invalid positions retain existing guards | mutates the one queue/timeline | Playback, Queue UI | duplicate/priority/clear/reorder tests |
| Library Service `pickFiles/pickFolder/importFiles/rescan/sort/search/getTracks` | Candidate | files/mode/query → Promise or frozen summaries | import errors propagate to existing UI | mutates the one library; schedules recognition | Library View | de-dup/import/cache test |
| History Service `checkpoint/incrementPlayCount/render/getSnapshot/destroy` | Candidate | reason or none | storage errors retain existing policy | listening persistence and DOM render | Playback/History View | no-false-time and range tests |
| Spectrum Service `analyze/readCached/processPending` | Experimental | track/key → Promise | emits `analysis:failed`, rethrows | cache read/write and completion event | Library/Neural | success/failure event test |
| Neural Service `recordBehavior/generateDailyMix/getUserModel` | Candidate | behavior/track/count → Promise/result | storage errors retain existing fallback | existing behavior/model/recommendation persistence | UI, History | confidence/fallback/no-manual-queue test |
| Settings Service `load/save/setTheme/setLanguage/setSpatialEnabled/setSpatialMode/getSnapshot` | Candidate | setting value → existing result/frozen snapshot | invalid values follow existing guards | existing preference storage and UI refresh | Settings View | restore/theme/language test |
| PiP Service `open/close/sync/destroy/getSnapshot` | Candidate | none/force flag → Promise/result | browser errors shown by existing modal | one Canvas/Video/stream lifecycle | Player View | cleanup/sync/resize test |

## Data and UI

| Module / API | Level | Parameters / return | Errors | Side effects | Callers | Contract test / compatibility |
|---|---|---|---|---|---|---|
| `GP.i18n` | Stable | translation/language functions | none | translates existing DOM and refreshes existing views | all Views | bilingual regression; unchanged alias bridge |
| `GP.changelog` | Stable | release query/render/export | unknown version returns null | renders/export log and Object URL cleanup | Changelog View | read-only clone/export test |
| `GP.genreRelations` | Candidate | genre labels/maps → resolved family, similarity or related preference score | unknown labels return lexical fallback | none; bundled static data only | Neural Service | offline-only, alias and proximity contract |
| `GP.spatialPresets` | Stable | ID/language → frozen preset/copy | unknown ID returns null | none | Spatial UI/Engine | fixed-value test |
| `GP.pipRenderer` | Stable | canvas geometry/text/cover inputs | Canvas errors propagate | drawing only | PiP Service | pure layout/draw contract |
| `GP.eqPresets` | Experimental | read-only preset object | none | none | Sound View/Audio Engine | frozen-data test |
| View `mount/render/refresh/destroy` | Experimental | context/snapshot or none | view errors propagate | DOM listeners/render/cleanup | Bootstrap | mount/destroy lifecycle test |
| Shared Controls | Experimental | root/options | invalid DOM guarded by runtime | gliders, SSE, press and selection bindings | Views | idempotent mount test |

## Compatibility policy

- `window.GP` is the supported read-only 7.3.1 facade. The frozen App Context and internal compatibility object remain private inside Bootstrap and do not expose engine internals.
- Existing `clamp`, `fmtTime`, `tr` and `applyLanguage` forwarding aliases remain until all verified callers use module APIs.
- Stable data interfaces cannot change without migrating callers and their contract tests in the same release.
