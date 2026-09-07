# Review package — Task 3 (no Git fallback)

Task 3 base snapshots:
- .superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-3-base/neural-runtime.js
- .superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-3-base/neural-service.js
- .superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-3-base/main.js
- .superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-3-base/contract-tests.ps1

Changed files:
- src/services/neural-runtime.js
- src/services/neural-service.js (existing injection bridge; ruling in ledger)
- src/bootstrap/main.js
- tests/contract-tests.ps1
- task-3-report.md

Implementer report:
.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-3-report.md

## neural-runtime.js — changed excerpts

```text
1:   /* ================= GP Neural Engine 2.1 — Resonance Boost =================
2:      Preference and recommendation are deliberately separate. Until the model
3:      passes its evidence/confidence gate, shuffle and Daily Mix remain uniform. */
4:   const NEURAL_MODEL_VERSION=4;
5:   const NEURAL_HALF_LIFE_MS=45*86400000;
6:   const NEURAL_MIN_EVENTS=20;
7:   const NEURAL_MIN_DAYS=5;
8:   const NEURAL_MIN_CONFIDENCE=.70;
9:   const GP_DAILY_MIX_COHERENCE_EXPONENT=3.4;
10:   const GP_DAILY_MIX_SHORTLIST_RATIO=.45;
11:   let neuralGalaxyService=null;
12:   const neuralSessionId=`session-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
13:   let neuralModel=null,neuralBuildTimer=0,lastNeuralBuildAt=0,pendingSelectionSource="automatic";
14:   let behaviorRuntime={trackId:null,startedAt:0,lastWallAt:0,lastMediaAt:0,listened:0,checkpoint:0,source:"automatic"};
15:   const sessionPreference={signals:[],recentTrackIds:[],exploration:{}};
16: 
17:   function finiteNumber(value,fallback=null){const n=Number(value);return Number.isFinite(n)?n:fallback;}
18:   const clamp=(...args)=>GP.utils.clamp(...args);

```

```text
168:     return weightedRandom(candidates,candidates.map(i=>recommendationScore(playlist[i],{surface:"shuffle"}).score));
169:   }
170:   function dailyGenreTokens(features){
171:     return [features?.genre,features?.genreSecondary].filter(Boolean).flatMap(value=>String(value).toLowerCase().split(/[\/,;&+|]+/)).map(value=>GP.genreRelations?.resolve(value)?.id||value.trim()).filter(value=>value&&value!=="unknown"&&value!=="mixed");
172:   }
173:   function dailyFeatureCompleteness(features){return (features?.spectrumId?1:0)+(features?.mfcc?.length>=8?2:0)+(dailyGenreTokens(features).length?1.5:0)+(Number.isFinite(features?.bpm)?.6:0)+(Number.isFinite(features?.energy)?.4:0);}
174:   function dailyFeatureSimilarity(anchor,candidate){
175:     if(!anchor||!candidate)return 0;
176:     const shared=neuralGalaxyService?.recommendationSimilarity?.(anchor,candidate);
177:     const sharedScore=Number.isFinite(shared?.overall)?shared.overall:.28;
178:     return clamp(sharedScore,0,1);
179:   }
180:   function generateDailyMix(count){
181:     let remaining=playlist.map((track,index)=>{const features=trackFeatureSnapshot(track);return{index,features,completeness:dailyFeatureCompleteness(features)};}).filter(item=>item.index!==currentIndex),picked=[],pickedFeatures=[],artistCounts=new Map();
182:     const recent=recentRecommendationIdSet({includeLastMix:true}),fresh=remaining.filter(item=>!recent.has(item.features?.spectrumId));
183:     if(fresh.length>=Math.min(count,remaining.length))remaining=fresh;
184:     if(!remaining.length)return picked;
185:     const currentFeatures=currentIndex>=0?trackFeatureSnapshot(playlist[currentIndex]):null;
186:     let anchor=currentFeatures&&dailyFeatureCompleteness(currentFeatures)>=3?currentFeatures:null;
187:     if(!anchor){
188:       const anchorPool=remaining.filter(item=>item.completeness>=2.5),pool=anchorPool.length?anchorPool:remaining;
189:       const anchorItem=weightedRandom(pool,pool.map(item=>Math.max(.1,item.completeness)*(neuralModel?.mature?recommendationScore(playlist[item.index],{surface:"daily-anchor"}).score:1)));
190:       anchor=anchorItem.features;
191:     }
192:     const targetCount=Math.min(count,remaining.length);
193:     while(picked.length<targetCount){
194:       const scored=remaining.map(item=>{
195:         const anchorScore=dailyFeatureSimilarity(anchor,item.features);
196:         const clusterScore=pickedFeatures.length?pickedFeatures.reduce((sum,features)=>sum+dailyFeatureSimilarity(features,item.features),0)/pickedFeatures.length:anchorScore;
197:         const coherence=anchorScore*.76+clusterScore*.24,preference=neuralModel?.mature?recommendationScore(playlist[item.index],{surface:"daily"}).score:1,artist=neuralArtistKey(playlist[item.index]),artistRepeat=artistCounts.get(artist)||0,diversityPenalty=Math.pow(.48,artistRepeat);
198:         return{item,coherence,weight:Math.pow(Math.max(.025,coherence),GP_DAILY_MIX_COHERENCE_EXPONENT)*Math.sqrt(preference)*Math.max(.65,item.completeness/4.5)*diversityPenalty};
199:       }).sort((a,b)=>b.coherence-a.coherence);
200:       const shortlist=scored.slice(0,Math.max(3,Math.ceil(scored.length*GP_DAILY_MIX_SHORTLIST_RATIO))),choice=weightedRandom(shortlist,shortlist.map(entry=>entry.weight));
201:       picked.push(choice.item.index);pickedFeatures.push(choice.item.features);const artist=neuralArtistKey(playlist[choice.item.index]);artistCounts.set(artist,(artistCounts.get(artist)||0)+1);remaining.splice(remaining.indexOf(choice.item),1);
202:     }
203:     recommendationPersistPromise=GPDatabase.saveRecommendations({id:"daily",generatedAt:Date.now(),modelConfidence:neuralModel?.confidence||0,mode:"feature-clustered",anchorSpectrumId:anchor?.spectrumId||null,tracks:picked.map(i=>neuralTrackId(playlist[i]))}).then(()=>true).catch(()=>false);return picked;
204:   }
205:   async function generateDailyMixForImport(count){
206:     const remaining=[];
207:     for(let index=0;index<playlist.length;index++){
208:       if(index!==currentIndex){const features=trackFeatureSnapshot(playlist[index]);remaining.push({index,features,completeness:dailyFeatureCompleteness(features)});}
209:       if(index&&index%48===0)await yieldToInputPriority();
210:     }
211:     let pool=remaining,picked=[],pickedFeatures=[],artistCounts=new Map();const recent=recentRecommendationIdSet({includeLastMix:true}),fresh=pool.filter(item=>!recent.has(item.features?.spectrumId));
212:     if(fresh.length>=Math.min(count,pool.length))pool=fresh;if(!pool.length)return picked;
213:     const currentFeatures=currentIndex>=0?trackFeatureSnapshot(playlist[currentIndex]):null;let anchor=currentFeatures&&dailyFeatureCompleteness(currentFeatures)>=3?currentFeatures:null;
214:     if(!anchor){const anchorPool=pool.filter(item=>item.completeness>=2.5),choices=anchorPool.length?anchorPool:pool;anchor=weightedRandom(choices,choices.map(item=>Math.max(.1,item.completeness)*(neuralModel?.mature?recommendationScore(playlist[item.index],{surface:"daily-anchor"}).score:1))).features;}
215:     const targetCount=Math.min(count,pool.length);
216:     while(picked.length<targetCount){
217:       const scored=[];let scoreSliceStarted=performance.now();
218:       for(const item of pool){
219:         const anchorScore=dailyFeatureSimilarity(anchor,item.features),clusterScore=pickedFeatures.length?pickedFeatures.reduce((sum,features)=>sum+dailyFeatureSimilarity(features,item.features),0)/pickedFeatures.length:anchorScore,coherence=anchorScore*.76+clusterScore*.24,preference=neuralModel?.mature?recommendationScore(playlist[item.index],{surface:"daily"}).score:1;
220:         const artist=neuralArtistKey(playlist[item.index]),artistRepeat=artistCounts.get(artist)||0,diversityPenalty=Math.pow(.48,artistRepeat);
221:         scored.push({item,coherence,weight:Math.pow(Math.max(.025,coherence),GP_DAILY_MIX_COHERENCE_EXPONENT)*Math.sqrt(preference)*Math.max(.65,item.completeness/4.5)*diversityPenalty});
222:         if(performance.now()-scoreSliceStarted>=8){await yieldToInputPriority();scoreSliceStarted=performance.now();}
223:       }
224:       scored.sort((a,b)=>b.coherence-a.coherence);
225:       const shortlist=scored.slice(0,Math.max(3,Math.ceil(scored.length*GP_DAILY_MIX_SHORTLIST_RATIO))),choice=weightedRandom(shortlist,shortlist.map(entry=>entry.weight));picked.push(choice.item.index);pickedFeatures.push(choice.item.features);const artist=neuralArtistKey(playlist[choice.item.index]);artistCounts.set(artist,(artistCounts.get(artist)||0)+1);pool.splice(pool.indexOf(choice.item),1);
226:       await yieldToInputPriority();
227:     }
228:     recommendationPersistPromise=GPDatabase.saveRecommendations({id:"daily",generatedAt:Date.now(),modelConfidence:neuralModel?.confidence||0,mode:"feature-clustered",anchorSpectrumId:anchor?.spectrumId||null,tracks:picked.map(i=>neuralTrackId(playlist[i]))}).then(()=>true).catch(()=>false);return picked;

```

## neural-service.js — full file

```text
1:   GPModules.register("createNeuralService",function createNeuralService(runtime){
2:     // The legacy Daily Mix closure reads this injected singleton; it does not create or persist a Galaxy service.
3:     neuralGalaxyService=runtime.galaxy||null;
4:     return Object.freeze({recordBehavior:runtime.recordBehavior,generateDailyMix:runtime.generateDailyMix,getUserModel:runtime.getUserModel});
5:   });

```

## bootstrap/main.js — changed service construction

```text
55:   const queueService=GPModules.createQueueService({add:trackId=>{const index=playlist.findIndex(track=>track.id===trackId);return index>=0?enqueueTrack(index,"end"):false;},playNext:trackId=>{const index=playlist.findIndex(track=>track.id===trackId);return index>=0?enqueueTrack(index,"next"):false;},remove:removeQueuedAt,clear:clearPlayQueue,reorder:moveQueuedTrack,resolveNextTrack:()=>playQueue[0]||null,resolvePreviousTrack:()=>shuffleTimeline[shuffleTimelineCursor-1]||null,getVisibleQueue:()=>Object.freeze([...playQueue]),restoreLibraryOrder:releaseQueuePlaybackContext});
56:   const libraryService=GPModules.createLibraryService({pickFiles:adapters.file.pickAudioFiles,pickFolder:adapters.file.pickAudioFolder,importFiles:addFiles,rescan:rescanImportedLibrary,sort:mode=>{librarySortMode=mode;render($("#search")?.value||"");},search:query=>render(query),getTracks:()=>Object.freeze(playlist.map(track=>Object.freeze({id:track.id,title:track.title,artist:track.artist,album:track.album||""})))});
57:   const spectrumService=GPModules.createSpectrumService({analyzer:spectrumAnalyzer,storage:adapters.storage,bus,events:contracts.events});
58:   const historyService=GPModules.createHistoryService({checkpoint:emitListeningCheckpoint,incrementPlayCount,render:renderHistory,getSnapshot:()=>Object.freeze(structuredClone(loadHistoryStore())),destroy:()=>{}});
59:   const galaxyService=GPModules.createGalaxyService();
60:   const neuralService=GPModules.createNeuralService({recordBehavior:recordBehaviorEvent,generateDailyMix,getUserModel:()=>GPDatabase.getUserModel("default"),galaxy:galaxyService});
61:   const settingsService=GPModules.createSettingsService({load:loadPrefs,save:savePrefs,setTheme:mode=>{themeMode=mode;applyTheme();savePrefs();},setLanguage:GP.i18n.setLanguage,setSpatialEnabled,setSpatialMode:mode=>selectSpatialMode(mode,true),getSnapshot:()=>Object.freeze({language:uiLanguage,theme:themeMode,backgroundMode:bgMode,coverMode:coverDisplayMode,adaptiveColor:adaptiveColorOn,spatialEnabled,spatialMode,loudnessNormalizationEnabled,eqPreset:eqPresetKey})});
62:   const pipService=GPModules.createPiPService({open:async()=>{if(!document.pictureInPictureElement)return toggleTraditionalPiP();},close:async()=>{if(document.pictureInPictureElement)return toggleTraditionalPiP();},sync:syncTraditionalPiP,destroy:cleanupTraditionalPiP,getSnapshot:()=>Object.freeze({open:document.pictureInPictureElement===gpVideoPipVideo})});
63:   const services=Object.freeze({playback:playbackService,queue:queueService,library:libraryService,history:historyService,spectrum:spectrumService,neural:neuralService,settings:settingsService,pip:pipService});

```

## contract-tests.ps1 — source load and Task 3 assertion

```text
1: param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))
2: $ErrorActionPreference='Stop'
3: $issues=[System.Collections.Generic.List[string]]::new()
4: $build=Get-Content -LiteralPath (Join-Path $ProjectRoot 'build/app.js') -Raw -Encoding UTF8
5: $index=Get-Content -LiteralPath (Join-Path $ProjectRoot 'index.html') -Raw -Encoding UTF8
6: $css=Get-Content -LiteralPath (Join-Path $ProjectRoot 'app.css') -Raw -Encoding UTF8
7: $order=Get-Content -LiteralPath (Join-Path $ProjectRoot 'SOURCE_ORDER.txt') -Encoding UTF8
8: $genre=Get-Content -LiteralPath (Join-Path $ProjectRoot 'src/data/genre-relations.js') -Raw -Encoding UTF8
9: $i18nSource=Get-Content -LiteralPath (Join-Path $ProjectRoot 'src/data/i18n.js') -Raw -Encoding UTF8
10: $playerVisualsSource=Get-Content -LiteralPath (Join-Path $ProjectRoot 'src/ui/player-visuals.js') -Raw -Encoding UTF8
11: $governance=Get-Content -LiteralPath (Join-Path $ProjectRoot 'MODULE_GOVERNANCE.md') -Raw -Encoding UTF8
12: $eventContracts=Get-Content -LiteralPath (Join-Path $ProjectRoot 'EVENT_CONTRACTS.md') -Raw -Encoding UTF8
13: $librarySource=Get-Content -LiteralPath (Join-Path $ProjectRoot 'src/services/library-runtime.js') -Raw -Encoding UTF8
14: $queueSource=Get-Content -LiteralPath (Join-Path $ProjectRoot 'src/services/queue-runtime.js') -Raw -Encoding UTF8
15: $playbackSource=Get-Content -LiteralPath (Join-Path $ProjectRoot 'src/services/playback-runtime.js') -Raw -Encoding UTF8
16: $neuralSource=Get-Content -LiteralPath (Join-Path $ProjectRoot 'src/services/neural-runtime.js') -Raw -Encoding UTF8
17: $bootstrapSource=Get-Content -LiteralPath (Join-Path $ProjectRoot 'src/bootstrap/main.js') -Raw -Encoding UTF8
18: $historySource=Get-Content -LiteralPath (Join-Path $ProjectRoot 'src/services/history-service.js') -Raw -Encoding UTF8
19: $pipSource=Get-Content -LiteralPath (Join-Path $ProjectRoot 'src/services/pip-runtime.js') -Raw -Encoding UTF8
20: $spatialSource=Get-Content -LiteralPath (Join-Path $ProjectRoot 'src/engines/spatial-engine.js') -Raw -Encoding UTF8
64: Expect (($order | Where-Object {$_ -eq 'src/data/genre-relations.js'}).Count -eq 1) 'genre-relations.js must occur once'
65: Expect ($genre -match 'source:"offline-static"') 'genre graph must declare offline-static source'
66: Expect ($genre -notmatch '\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource') 'genre graph must not perform runtime network I/O'
67: Expect ($build -match 'const NEURAL_MIN_CONFIDENCE=\.70') 'Neural confidence gate must be 0.70'
68: Expect ($bootstrapSource -match 'createGalaxyService' -and $bootstrapSource -match 'galaxy:galaxyService' -and $neuralSource -match 'galaxy.*recommendationSimilarity') 'Neural must consume the shared Galaxy similarity service'
69: Expect ($build -match 'normalizationGainDb') 'Spectrum loudness normalization cache field missing'
70: Expect ($index -match 'id="loudnessNormalizeToggle"') 'Loudness normalization control missing'

```

Reported verification: RED observed before integration; Task 3 contract
GREEN afterward; in-memory SOURCE_ORDER syntax, changed-source syntax,
Galaxy pure test, and a focused injection/preservation probe passed. Four
downstream Task 4–6 contract assertions remain RED. Build and browser/audio
checks were intentionally not run because generated output is owned by Task 8.
