  /* ================= init ================= */
  GP.changelog.render();
  loadPrefs();
  buildFontPicker();
  render();
  updateAmbient();
  updateArtDisplay();
  drawWaveform();
  applyLanguage();
  GP.ui.mount(document);GP.ui.observe(document.body);
  applyViewportFit();
  initializeSelectionGliders();
  if(document.fonts?.ready)document.fonts.ready.then(()=>requestAnimationFrame(initializeSelectionGliders));
  setTimeout(scheduleViewportFit, 60); // re-measure once fonts/layout settle
  setTimeout(scheduleViewportFit, 300); // and once more after async layout settles fully

  /* ================= GP Core 4.2 — Peregrine Lake bootstrap =================
     The legacy runtime remains the single implementation while its public
     capabilities are exposed through explicit factories, ports and services.
     No second AudioContext, queue, playlist, persistence path or listener set
     is created here. */
  const contracts=GPModules.createContracts();
  GP.eqPresets=GPModules.createEqPresets(eqPresets);
  const bus=GPModules.createEventBus();
  const actions=GPModules.createActions();
  const selectors=GPModules.createSelectors();
  const store=GPModules.createStore({actions,bus,initialState:{
    library:{tracks:playlist.map(track=>({id:track.id,title:track.title,artist:track.artist,album:track.album||""})),currentTrackId:playlist[currentIndex]?.id||null,sortMode:librarySortMode,importStatus:importRunning?"running":"idle"},
    playback:{status:isPlaying?"playing":"paused",wantsPlayback,position:Number(audio.currentTime)||0,duration:Number(audio.duration)||0,volume:parseFloat($("#vol")?.value)||.7,mode:playMode,crossfadeEnabled,crossfadeSeconds},
    queue:{items:[...playQueue],manualActive:manualQueueActive,playingQueuedTrack,resumeTrackId:queueResumeIndex==null?null:playlist[queueResumeIndex]?.id||null,shuffleTimeline:[...shuffleTimeline],shuffleCursor:shuffleTimelineCursor},
    settings:{language:uiLanguage,theme:themeMode,backgroundMode:bgMode,coverMode:coverDisplayMode,adaptiveColor:adaptiveColorOn,spatialEnabled,spatialMode,loudnessNormalizationEnabled,eqPreset:eqPresetKey},
    analysis:{activeTrackId:null,pending:[],completed:GP.performance.spectrum.completed,failed:GP.performance.spectrum.failed},
    ui:{activeView:$(".view.active")?.dataset.view||"player",activePanel:$("#panelTabs .active")?.dataset.panel||"queue",historyMode:$("#historyModeSeg .active")?.dataset.historyMode||"time"}
  }});
  const storage=GPModules.createStoragePort(GPDatabase);
  const fileAdapter=GPModules.createBrowserFileAdapter({fileInput:$("#fileInput"),folderInput:$("#folderInput"),storage});
  const adapters=Object.freeze({
    clock:GPModules.createBrowserClockAdapter(),
    mediaSession:GPModules.createBrowserMediaSessionAdapter(),
    file:fileAdapter,
    pip:GPModules.createBrowserPiPAdapter(),
    storage
  });
  const audioEngine=GPModules.createAudioEngine({
    init:ensureAudioCtx,loadTrack:(trackId,autoplay=false)=>{const index=typeof trackId==="number"?trackId:playlist.findIndex(track=>track.id===trackId);return index>=0?loadTrack(index,autoplay):undefined;},
    play:playAudio,pause:pauseAudio,seek:seconds=>{audio.currentTime=Math.max(0,Math.min(Number(audio.duration)||0,Number(seconds)||0));},
    setVolume:value=>{ensureAudioCtx();const volume=Math.max(0,Math.min(1,Number(value)||0));masterGain.gain.value=volume;if($("#vol"))$("#vol").value=String(volume);},
    setEQ:applyEQPreset,setSpatialMode:mode=>selectSpatialMode(mode,true),setSpatialEnabled,
    startCrossfade:()=>maybeTriggerAutoCrossfade(),stop:pauseAudio,destroy:()=>{},
    getRuntimeSnapshot:()=>Object.freeze({activeDeck:activeIdx,status:isPlaying?"playing":"paused",position:Number(audio.currentTime)||0,duration:Number(audio.duration)||0,crossfading})
  });
  const recognitionEngine=GPModules.createRecognitionEngine({recognizeAudioEssence,detectAudioPayload,extractFileMetadata,extractGenre});
  const spectrumAnalyzer=GPModules.createSpectrumAnalyzer({analyze:track=>GPAnalyzer.analyze(track),readCached:key=>GPAnalyzer.readCached(key),processPending:()=>Promise.resolve(),version:GP_SPECTRUM_ALGORITHM_VERSION});
  const spatialRuntime=GPModules.createSpatialEngine({setEnabled:setSpatialEnabled,setMode:mode=>selectSpatialMode(mode,true),getSnapshot:()=>Object.freeze({enabled:spatialEnabled,mode:spatialMode}),destroy:()=>{}});
  const motionEngine=GPModules.createMotionEngine({transitionView:switchPrimaryView,transitionSector:transitionMotionSector,setPopover:setMotionPopover,refresh:()=>{updateAllGliders(false);refreshScrollEdgeFrames();}});
  const playbackService=GPModules.createPlaybackService({bus,events:contracts.events,runtime:{play:playAudio,pause:pauseAudio,toggle:togglePlay,playTrack:(trackId,options={})=>audioEngine.loadTrack(trackId,options.autoplay!==false),next:nextTrack,previous:prevTrack,seek:audioEngine.seek,setVolume:audioEngine.setVolume,snapshot:audioEngine.getRuntimeSnapshot}});
  const queueService=GPModules.createQueueService({add:trackId=>{const index=playlist.findIndex(track=>track.id===trackId);return index>=0?enqueueTrack(index,"end"):false;},playNext:trackId=>{const index=playlist.findIndex(track=>track.id===trackId);return index>=0?enqueueTrack(index,"next"):false;},remove:removeQueuedAt,clear:clearPlayQueue,reorder:moveQueuedTrack,resolveNextTrack:()=>playQueue[0]||null,resolvePreviousTrack:()=>shuffleTimeline[shuffleTimelineCursor-1]||null,getVisibleQueue:()=>Object.freeze([...playQueue]),restoreLibraryOrder:releaseQueuePlaybackContext});
  const libraryService=GPModules.createLibraryService({pickFiles:adapters.file.pickAudioFiles,pickFolder:adapters.file.pickAudioFolder,importFiles:addFiles,rescan:rescanImportedLibrary,sort:mode=>{librarySortMode=mode;render($("#search")?.value||"");},search:query=>render(query),getTracks:()=>Object.freeze(playlist.map(track=>Object.freeze({id:track.id,title:track.title,artist:track.artist,album:track.album||""})))});
  const autoImportDefaultFolder=files=>files.length?libraryService.importFiles(files):undefined;
  const chooseDefaultMusicFolder=async()=>{const files=await fileAdapter.pickAndRememberAudioFolder();await autoImportDefaultFolder(files);return files.length;};
  if(fileAdapter.supportsPersistedAudioFolder()){
    $("#addFolderBtn")?.addEventListener("click",async event=>{
      event.preventDefault();event.stopImmediatePropagation();
      try{await chooseDefaultMusicFolder();}
      catch(error){if(error?.name!=="AbortError")finishImportProgress(null,error);}
    },{capture:true});
    fileAdapter.restoreRememberedAudioFolder().then(autoImportDefaultFolder).catch(()=>{});
  }
  const spectrumService=GPModules.createSpectrumService({analyzer:spectrumAnalyzer,storage:adapters.storage,bus,events:contracts.events});
  const historyService=GPModules.createHistoryService({checkpoint:emitListeningCheckpoint,incrementPlayCount,render:renderHistory,getSnapshot:()=>Object.freeze(structuredClone(loadHistoryStore())),destroy:()=>{}});
  const neuralService=GPModules.createNeuralService({recordBehavior:recordBehaviorEvent,generateDailyMix,getUserModel:()=>GPDatabase.getUserModel("default")});
  const settingsService=GPModules.createSettingsService({load:loadPrefs,save:savePrefs,setTheme:mode=>{themeMode=mode;applyTheme();savePrefs();},setLanguage:GP.i18n.setLanguage,setSpatialEnabled,setSpatialMode:mode=>selectSpatialMode(mode,true),getSnapshot:()=>Object.freeze({language:uiLanguage,theme:themeMode,backgroundMode:bgMode,coverMode:coverDisplayMode,adaptiveColor:adaptiveColorOn,spatialEnabled,spatialMode,loudnessNormalizationEnabled,eqPreset:eqPresetKey})});
  const pipService=GPModules.createPiPService({open:async()=>{if(!document.pictureInPictureElement)return toggleTraditionalPiP();},close:async()=>{if(document.pictureInPictureElement)return toggleTraditionalPiP();},sync:syncTraditionalPiP,destroy:cleanupTraditionalPiP,getSnapshot:()=>Object.freeze({open:document.pictureInPictureElement===gpVideoPipVideo})});
  const services=Object.freeze({playback:playbackService,queue:queueService,library:libraryService,history:historyService,spectrum:spectrumService,neural:neuralService,settings:settingsService,pip:pipService});
  const engines=Object.freeze({audio:audioEngine,recognition:recognitionEngine,spectrum:spectrumAnalyzer,spatial:spatialRuntime,motion:motionEngine});
  const context=GPModules.createAppContext({store,bus,actions,selectors,contracts,adapters,engines,services});
  const publicFacade=Object.freeze({generation:7,version:"7.5.1",architecture:"Peregrine Lake",genreRelations:GP.genreRelations,engines:Object.freeze({core:"GP Core 4.2 — Atlas Runtime",fusion:`GP Fusion Engine ${GP_FUSION_ENGINE_VERSION} — Playlist Flow`,motion:"GP Motion Engine 4.1 — Story Scroll",spatial:"GP Spatial Engine 1.1 — Room",spectrum:`GP Spectrum Engine ${GP_SPECTRUM_ENGINE_VERSION} — Signal`,neural:`GP Neural Engine ${GP_NEURAL_ENGINE_VERSION} — Listening DNA`}),commands:Object.freeze({play:playbackService.play,pause:playbackService.pause,next:playbackService.next,previous:playbackService.previous,chooseDefaultMusicFolder}),selectors,getState:store.getState});
  window.GP=publicFacade;
})();
