  /* ================= init ================= */
  function bindWindowTrafficLights(){
    const lights=[...document.querySelectorAll(".traffic")];
    if(!lights.length)return;
    const fullscreenButton=lights.find(button=>button.dataset.windowAction==="fullscreen");
    lights.forEach(button=>button.addEventListener("click",async()=>{
      const action=button.dataset.windowAction;
      if(action!=="fullscreen"){
        window.dispatchEvent(new CustomEvent("gp:window-action",{detail:{action}}));
        return;
      }
      try{
        if(document.fullscreenElement)await document.exitFullscreen?.();
        else await document.documentElement.requestFullscreen?.();
      }catch(error){}
    }));
    const syncFocus=focused=>document.body.classList.toggle("gp-window-focused",focused);
    window.addEventListener("focus",()=>syncFocus(true));
    window.addEventListener("blur",()=>syncFocus(false));
    syncFocus(true);
    const syncFullscreenState=()=>fullscreenButton?.setAttribute("aria-pressed",String(Boolean(document.fullscreenElement)));
    document.addEventListener("fullscreenchange",syncFullscreenState,{passive:true});
    syncFullscreenState();
  }

  GP.changelog.render();
  loadPrefs();
  buildFontPicker();
  render();
  updateAmbient();
  updateArtDisplay();
  drawWaveform();
  applyLanguage();
  GP.ui.mount(document);GP.ui.observe(document.body);
  bindWindowTrafficLights();
  applyViewportFit();
  initializeSelectionGliders();
  if(document.fonts?.ready)document.fonts.ready.then(()=>requestAnimationFrame(initializeSelectionGliders));
  setTimeout(scheduleViewportFit, 60); // re-measure once fonts/layout settle
  setTimeout(scheduleViewportFit, 300); // and once more after async layout settles fully
  if(typeof requestAnimationFrame==="function"){
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        document.body?.classList.remove("gp-theme-prepaint");
      });
    });
  }else{
    document.body?.classList.remove("gp-theme-prepaint");
  }

  /* ================= GP Core 4.3 — Kinetic Runtime bootstrap =================
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
  }
  const spectrumService=GPModules.createSpectrumService({analyzer:spectrumAnalyzer,storage:adapters.storage,bus,events:contracts.events});
  const historyService=GPModules.createHistoryService({checkpoint:emitListeningCheckpoint,incrementPlayCount,render:renderHistory,getSnapshot:()=>Object.freeze(structuredClone(loadHistoryStore())),destroy:()=>{}});
  const neuralService=GPModules.createNeuralService({recordBehavior:recordBehaviorEvent,generateDailyMix,getUserModel:()=>GPDatabase.getUserModel("default")});
  const settingsService=GPModules.createSettingsService({load:loadPrefs,save:savePrefs,setTheme:mode=>{themeMode=mode;applyTheme();savePrefs();},setLanguage:GP.i18n.setLanguage,setSpatialEnabled,setSpatialMode:mode=>selectSpatialMode(mode,true),getSnapshot:()=>Object.freeze({language:uiLanguage,theme:themeMode,backgroundMode:bgMode,coverMode:coverDisplayMode,adaptiveColor:adaptiveColorOn,spatialEnabled,spatialMode,loudnessNormalizationEnabled,eqPreset:eqPresetKey})});
  const pipService=GPModules.createPiPService({open:async()=>{if(!document.pictureInPictureElement)return toggleTraditionalPiP();},close:async()=>{if(document.pictureInPictureElement)return toggleTraditionalPiP();},sync:syncTraditionalPiP,destroy:cleanupTraditionalPiP,getSnapshot:()=>Object.freeze({open:document.pictureInPictureElement===gpVideoPipVideo})});
  const services=Object.freeze({playback:playbackService,queue:queueService,library:libraryService,history:historyService,spectrum:spectrumService,neural:neuralService,settings:settingsService,pip:pipService});
    const bionicEngine=GPModules.createBionicEngine({
    recognizeAudioEssence,detectAudioPayload,extractFileMetadata,extractGenre,
    analyze:track=>GPAnalyzer.analyze(track),readCached:key=>GPAnalyzer.readCached(key),processPending:()=>Promise.resolve(),version:GP_SPECTRUM_ALGORITHM_VERSION,
    recordBehavior:recordBehaviorEvent,generateDailyMix,getUserModel:()=>GPDatabase.getUserModel("default"),
    resolveNextTrack:()=>playQueue[0]||null,resolvePreviousTrack:()=>shuffleTimeline[shuffleTimelineCursor-1]||null
  });
  const engines=Object.freeze({audio:audioEngine,bionic:bionicEngine,recognition:recognitionEngine,spectrum:spectrumAnalyzer,spatial:spatialRuntime,motion:motionEngine});
  const context=GPModules.createAppContext({store,bus,actions,selectors,contracts,adapters,engines,services});
  const publicFacade=Object.freeze({generation:7,version:"7.8.0",architecture:"Peregrine Lake",genreRelations:GP.genreRelations,engines:Object.freeze({core:"GP Core 4.3 — Kinetic Runtime",bionic:"GP Bionic Engine 1.0 — Intelligence Core",fusion:`GP Fusion Engine ${GP_FUSION_ENGINE_VERSION} — Playlist Flow`,motion:"GP Motion Engine 4.2 — Kinetic Motion",spatial:"GP Spatial Engine 1.1 — Room",spectrum:`GP Spectrum Engine ${GP_SPECTRUM_ENGINE_VERSION} — Signal`,neural:`GP Neural Engine ${GP_NEURAL_ENGINE_VERSION} — Listening DNA`}),commands:Object.freeze({play:playbackService.play,pause:playbackService.pause,next:playbackService.next,previous:playbackService.previous,chooseDefaultMusicFolder}),selectors,getState:store.getState});
  window.GP=publicFacade;
  /* Resume where you left off, paused (as CinemaX does): the song and the place in it, the manual queue, the page and the side
     panel. Saved as you go under glassPlayerSession; songs are found again by their audio identity (contentKey), as track ids
     are numbered afresh each run. Nothing is saved until the start-up restore has run, so an empty first frame can't overwrite it */
  const SESSION_KEY="glassPlayerSession";let sessionReady=false,lastSession="";
  const keyOfTrackId=id=>playlist.find(track=>track.id===id)?.contentKey||null;
  function saveSession(){
    if(!sessionReady)return;
    const text=JSON.stringify({track:playlist[currentIndex]?.contentKey||null,position:Math.round((Number(audio.currentTime)||0)*10)/10,
      queue:playQueue.map(keyOfTrackId).filter(Boolean),manualQueue:manualQueueActive,
      view:$(".view.active")?.dataset.view||"player",panel:$("#panelTabs .active")?.dataset.tab||"queue"});
    if(text===lastSession)return;lastSession=text;
    try{GPBrowserStorage.setLocal(SESSION_KEY,text);}catch(error){}
  }
  const readSession=()=>{try{return JSON.parse(GPBrowserStorage.getLocal(SESSION_KEY)||"null");}catch(error){return null;}};
  function restoreSession(){
    const saved=readSession();
    if(saved){
      const indexOf=key=>key?playlist.findIndex(track=>track.contentKey===key):-1;
      const queued=(saved.queue||[]).map(indexOf).filter(index=>index>=0).map(index=>playlist[index].id);
      if(queued.length){playQueue.splice(0,playQueue.length,...queued);manualQueueActive=saved.manualQueue!==false;renderMiniQueue({instantPosition:true});}
      const index=indexOf(saved.track),at=Number(saved.position)||0;
      if(index>=0){
        loadTrack(index,false);   // loaded, not playing
        if(at>0){const deck=audio,seek=()=>{if(deck===audio)deck.currentTime=Math.min(at,Math.max(0,(Number(deck.duration)||at+1)-1));};deck.readyState>=1?seek():deck.addEventListener("loadedmetadata",seek,{once:true});}
      }
    }
    // The saved song is gone (or there was none): pick one as an import would have (the first, or a random one in shuffle)
    if(currentIndex===-1&&playlist.length>0)loadTrack(playMode==="shuffle"?Math.floor(Math.random()*playlist.length):0,false);
    if(saved){
      // The page through its sidebar button where it has one (that also moves the sidebar highlight), else directly
      if(saved.view&&saved.view!==($(".view.active")?.dataset.view||"player")&&$(`.view[data-view="${saved.view}"]`)){
        const nav=$(`.nav-item[data-view="${saved.view}"]`);nav?nav.click():switchPrimaryView(saved.view);
      }
      if(saved.panel)$(`#panelTabs [data-tab="${saved.panel}"]:not(.active)`)?.click();
    }
    sessionReady=true;lastSession="";saveSession();
  }
  setInterval(saveSession,2000);
  addEventListener("pagehide",saveSession);document.addEventListener("visibilitychange",()=>{if(document.hidden)saveSession();});
  /* Electron: the remembered music folder loads at start-up, quietly in the background (no import dialog), and the session
     resumes once it has. The browser build keeps 7.6.3's rule: it never imports by itself, so only the page and panel resume */
  const nativeFolder=fileAdapter.hasNativeMusicFolder();
  const startupLibrary=nativeFolder?fileAdapter.restoreRememberedAudioFolder().then(files=>files.length?addFiles(files,{quiet:true,pickTrack:!readSession()?.track}):null):Promise.resolve();
  startupLibrary.catch(error=>console.warn("[GP] Music folder load failed",error)).finally(restoreSession);
  if(nativeFolder)globalThis.glassAPI.music.get().then(dir=>{const hint=$("#defaultFolderHint");if(hint)hint.textContent=dir
    ?tr(`打开 Glass Player 时自动载入：${dir}`,`Loads when Glass Player opens: ${dir}`)
    :tr("选择后，每次打开 Glass Player 都会自动载入，并回到上次的位置。","Once chosen, it loads every time Glass Player opens, right where you left off.");}).catch(()=>{});
  showDataRestored();
  GPDataVault.start({beforeReload:()=>{historyStoreCache=null;historyStoreDirty=false;},onStatus:renderDataVaultStatus,onProgress:({percent,...detail})=>{if(rescanModalMode!=="dataRunning")openDataProgress(tr("正在载入你的数据","Loading Your Data"),tr("正在准备…","Getting ready…"));paintDataProgress(percent,detail);}});
})();

