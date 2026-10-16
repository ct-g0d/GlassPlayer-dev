window.GPModules ??= Object.create(null);
window.GPModules.register = function register(name,factory){
  if(typeof name!=="string"||!name)throw new TypeError("Module name is required");
  if(typeof factory!=="function")throw new TypeError(`Module ${name} must register a factory`);
  if(Object.prototype.hasOwnProperty.call(window.GPModules,name))throw new Error(`Module already registered: ${name}`);
  Object.defineProperty(window.GPModules,name,{value:factory,enumerable:true,configurable:false,writable:false});
  return factory;
};
  /* ================= GP Gen 4 architecture / Harmonic Lake =================
     The single-file build keeps the exact 3.5.3 UI runtime. These contracts are
     deliberately adapter-based so the same Core/UI code can move to Electron
     Lake later by replacing storage/indexeddb with storage/sqlite only. */
  const GP_FEATURE_SCHEMA_VERSION = 4;
  const GP_TRACK_CACHE_SCHEMA_VERSION = 7;
  const GP_RECOGNITION_SCHEMA_VERSION = 2;
  const GP_SPECTRUM_ALGORITHM_VERSION = "2.1.0";
  const GP_FUSION_ENGINE_VERSION = "4.2";
  const GP_SPECTRUM_ENGINE_VERSION = "2.3";
  const GP_NEURAL_ENGINE_VERSION = "2.2";
  const GP_MOTION_TARGET_FPS = 120;
  const GP_MOTION_FRAME_MS = 1000 / GP_MOTION_TARGET_FPS;
  const GP_PIP_TARGET_FPS = 30;
  const GP_PIP_FRAME_MS = 1000 / GP_PIP_TARGET_FPS;
  const GP_MOTION_CONTRACT = Object.freeze({
    refreshRateCeiling:GP_MOTION_TARGET_FPS,
    scheduler:"requestAnimationFrame",
    fixedFrameTimers:false
  });

(function(){
  "use strict";

  /* ================= state ================= */
  const playlist = [];
  const playQueue = [];             // stable track ids; manual queue has priority over play mode
  const reservedSongIdentities = new Set();
  const reservedAudioFingerprints = new Set();
  let manualQueueActive = false;
  let playingQueuedTrack = false;
  let queueResumeIndex = null;
  let librarySortMode = "original";
  let queueDragFrom = null;
  let queueDragState = null;
  let queueDragFrame = 0;
  let queueSuppressClick = false;
  let currentIndex = -1;
  let isPlaying = false;
  let wantsPlayback = false;
  let playbackIntentToken = 0;
  let pendingPlayToken = 0;
  let playMode = "sequential";      // sequential | shuffle | repeatOne
  let shuffleHistory = []; // compatibility mirror; navigation uses the bounded timeline below
  let shuffleTimeline = [];
  let shuffleTimelineCursor = -1;
  let idCounter = 0;
  let coverDisplayMode = "rotate";  // rotate | static
  let bgMode = "glow";              // glow | color | blur
  let uiLanguage = "zh";
  let playbackRate = 1;
  let ambientToken = 0;
  let soundPanelActive = false;
  let loudnessNormalizationEnabled = false;
  const deckA = new Audio(); deckA.preload = "auto";
  const deckB = new Audio(); deckB.preload = "auto";
  const decks = [deckA, deckB];
  let activeIdx = 0;
  let audio = decks[activeIdx]; // always points at the currently "active" deck; reassigned on crossfade swap

  let audioCtx = null, mixBus = null, eqHeadroomGain = null, finalOutputTrimGain = null, masterGain = null, outputLimiterBypass = null, analyser = null;
  let eqResponseProbeFilters=[],eqResponseFrequencies=null,eqResponseMagnitude=null,eqResponsePhase=null,eqResponseProduct=null;
  const deckGains = [null, null];
  const deckNormalizationGains = [null, null];
  let audioDiagnosticTimer=0,audioDiagnosticTaps=null,audioDiagnosticTick=0;
  const audioDiagnosticState={version:GP_FUSION_ENGINE_VERSION,firstExceed:null,latest:null,samples:[]};
  function holdAudioParam(param,now){
    if(!param)return;
    if(typeof param.cancelAndHoldAtTime==="function")param.cancelAndHoldAtTime(now);
    else{const current=param.value;param.cancelScheduledValues(now);param.setValueAtTime(current,now);}
  }
  function smoothAudioParam(param,value,seconds=.03){
    if(!param||!audioCtx)return;const now=audioCtx.currentTime;
    holdAudioParam(param,now);param.linearRampToValueAtTime(value,now+seconds);
  }
  function playbackRateFromSlider(value){return Math.max(.5,Math.min(2,.5*Math.pow(4,Math.max(0,Math.min(1000,Number(value)||0))/1000)));}
  function playbackSliderFromRate(rate){return Math.round(Math.log(Math.max(.5,Math.min(2,Number(rate)||1))/.5)/Math.log(4)*1000);}
  function formatPlaybackRate(rate){const rounded=Math.round(rate*100)/100;return `${Number.isInteger(rounded)?rounded:rounded.toFixed(2).replace(/0$/,"")}×`;}
  function applyPlaybackRate(rate,{syncSlider=true,persist=false}={}){
    playbackRate=Math.max(.5,Math.min(2,Number(rate)||1));
    decks.forEach(deck=>{deck.defaultPlaybackRate=playbackRate;deck.playbackRate=playbackRate;if("preservesPitch" in deck)deck.preservesPitch=true;});
    if(syncSlider){const text=formatPlaybackRate(playbackRate),value=$("#playbackSpeedValue");if(value)value.textContent=text;$$("#playbackSpeedPop [data-rate]").forEach(button=>button.classList.toggle("active",Math.abs(Number(button.dataset.rate)-playbackRate)<.005));const presets=$(".playback-speed-presets");if(presets&&typeof updateGlider==="function")requestAnimationFrame(()=>updateGlider(presets,true));}
    if(persist)savePrefs();
  }
  function trackNormalizationDb(track){
    const loudness=Number.isFinite(track?.loudnessDb)?track.loudnessDb:(Number.isFinite(track?.energyDb)?track.energyDb:null);
    const reference=Math.max(...playlist.map(item=>Number.isFinite(item?.loudnessDb)?item.loudnessDb:(Number.isFinite(item?.energyDb)?item.energyDb:-Infinity)));
    const requested=Number.isFinite(loudness)&&Number.isFinite(reference)?Math.max(0,reference-loudness):0;
    if(requested<=.15)return 0;
    return Math.max(0,Math.min(7,requested));
  }
  function applyDeckNormalization(index,track,immediate=false){
    const node=deckNormalizationGains[index];if(!node||!audioCtx)return;
    const db=loudnessNormalizationEnabled?trackNormalizationDb(track):0,target=Math.pow(10,db/20),now=audioCtx.currentTime;
    holdAudioParam(node.gain,now);
    if(immediate)node.gain.setValueAtTime(target,now);else node.gain.linearRampToValueAtTime(target,now+.14);
  }
  function applyCurrentTrackNormalization(immediate=false){if(currentIndex>=0)applyDeckNormalization(activeIdx,playlist[currentIndex],immediate);}
  function combinedEQPeakDb(gains=eqGains){
    if(!audioCtx||!Array.isArray(gains))return Math.max(0,...(gains||[]).map(value=>Number(value)||0));
    if(!eqResponseProbeFilters.length){
      eqResponseProbeFilters=eqBandFreqs.map((frequency,index)=>{
        const filter=audioCtx.createBiquadFilter();filter.frequency.value=frequency;
        filter.type=index===0?"lowshelf":index===eqBandFreqs.length-1?"highshelf":"peaking";
        if(filter.type==="peaking")filter.Q.value=1;return filter;
      });
      const count=96,minimum=25,maximum=Math.min(20000,audioCtx.sampleRate*.48);
      eqResponseFrequencies=new Float32Array(count);eqResponseMagnitude=new Float32Array(count);eqResponsePhase=new Float32Array(count);eqResponseProduct=new Float64Array(count);
      for(let index=0;index<count;index++)eqResponseFrequencies[index]=minimum*Math.pow(maximum/minimum,index/(count-1));
    }
    eqResponseProduct.fill(1);
    eqResponseProbeFilters.forEach((filter,index)=>{
      filter.gain.value=Number(gains[index])||0;
      filter.getFrequencyResponse(eqResponseFrequencies,eqResponseMagnitude,eqResponsePhase);
      for(let point=0;point<eqResponseProduct.length;point++)eqResponseProduct[point]*=Math.max(1e-6,eqResponseMagnitude[point]);
    });
    let peak=1;for(const magnitude of eqResponseProduct)if(magnitude>peak)peak=magnitude;
    return Math.max(0,20*Math.log10(peak));
  }
  function syncAudioHeadroom(immediate=false,gains=eqGains){
    if(!audioCtx)return;
    const combinedPeakDb=combinedEQPeakDb(gains),preampDb=-combinedPeakDb;
    if(eqHeadroomGain){const target=Math.pow(10,preampDb/20);if(immediate)eqHeadroomGain.gain.setValueAtTime(target,audioCtx.currentTime);else smoothAudioParam(eqHeadroomGain.gain,target,.04);}
  }
  function createAudioDiagnosticAnalyser(node){
    const tap=audioCtx.createAnalyser();tap.fftSize=512;tap.smoothingTimeConstant=0;node.connect(tap);
    return{tap,data:new Float32Array(tap.fftSize)};
  }
  function audioDiagnosticLevel(record){
    record.tap.getFloatTimeDomainData(record.data);let peak=0,squares=0;
    for(const sample of record.data){const absolute=Math.abs(sample);if(absolute>peak)peak=absolute;squares+=sample*sample;}
    return{peak,rms:Math.sqrt(squares/Math.max(1,record.data.length))};
  }
  function installAudioDiagnostics(nodes){
    if(audioDiagnosticTimer)return;
    const splitter=audioCtx.createChannelSplitter(2);nodes.final.connect(splitter);
    const left=audioCtx.createAnalyser(),right=audioCtx.createAnalyser();left.fftSize=right.fftSize=512;left.smoothingTimeConstant=right.smoothingTimeConstant=0;splitter.connect(left,0);splitter.connect(right,1);
    audioDiagnosticTaps={mix:createAudioDiagnosticAnalyser(nodes.mix),eq:createAudioDiagnosticAnalyser(nodes.eq),spatial:createAudioDiagnosticAnalyser(nodes.spatial),final:createAudioDiagnosticAnalyser(nodes.final),left:{tap:left,data:new Float32Array(512)},right:{tap:right,data:new Float32Array(512)}};
    audioDiagnosticTimer=setInterval(()=>{
      if(!audioCtx||!audioDiagnosticTaps||!isPlaying)return;
      const levels={mix:audioDiagnosticLevel(audioDiagnosticTaps.mix),eq:audioDiagnosticLevel(audioDiagnosticTaps.eq),spatial:audioDiagnosticLevel(audioDiagnosticTaps.spatial),final:audioDiagnosticLevel(audioDiagnosticTaps.final)};
      audioDiagnosticTaps.left.tap.getFloatTimeDomainData(audioDiagnosticTaps.left.data);audioDiagnosticTaps.right.tap.getFloatTimeDomainData(audioDiagnosticTaps.right.data);
      let monoAveragePeak=0,unsafeRawSumPeak=0;for(let i=0;i<audioDiagnosticTaps.left.data.length;i++){const sum=audioDiagnosticTaps.left.data[i]+audioDiagnosticTaps.right.data[i];monoAveragePeak=Math.max(monoAveragePeak,Math.abs(sum*.5));unsafeRawSumPeak=Math.max(unsafeRawSumPeak,Math.abs(sum));}
      const normalizationDb=currentIndex>=0&&loudnessNormalizationEnabled?trackNormalizationDb(playlist[currentIndex]):0,eqMaxDb=combinedEQPeakDb(eqGains);
      const snapshot={at:Date.now(),track:playlist[currentIndex]?.title||"",levels,monoAveragePeak,unsafeRawSumPeak,eqMaxDb,eqPreampDb:-eqMaxDb,loudnessGainDb:normalizationDb,spatialEnabled,spatialMode:spatialEnabled?spatialMode:"none",limiterReductionDb:0,context:{sampleRate:audioCtx.sampleRate,baseLatency:Number(audioCtx.baseLatency)||0,outputLatency:Number(audioCtx.outputLatency)||0}};
      const order=["mix","eq","spatial","final"],first=order.find(name=>levels[name].peak>1.0001)||(monoAveragePeak>1.0001?"mono-average":null)||(unsafeRawSumPeak>1.0001?"unsafe-device-sum":null);
      if(first&&!audioDiagnosticState.firstExceed)audioDiagnosticState.firstExceed={node:first,...snapshot};
      audioDiagnosticState.latest=snapshot;if(first||audioDiagnosticTick++%20===0){audioDiagnosticState.samples.push(snapshot);if(audioDiagnosticState.samples.length>240)audioDiagnosticState.samples.shift();}
    },100);
    window.__GP_AUDIO_DIAGNOSTICS__=Object.freeze({get version(){return audioDiagnosticState.version;},get latest(){return audioDiagnosticState.latest;},get firstExceed(){return audioDiagnosticState.firstExceed;},get samples(){return audioDiagnosticState.samples.slice();},reset(){audioDiagnosticState.firstExceed=null;audioDiagnosticState.samples.length=0;}});
  }
  function ensureAudioCtx(options={}){
    const resume=options.resume!==false;
    if(audioCtx) { if(resume&&audioCtx.state === "suspended") audioCtx.resume(); return; }
    const AudioContextConstructor=window.AudioContext||window.webkitAudioContext;
    /* Continuous local FLAC playback benefits from the browser's playback
       buffer instead of the smallest interactive buffer. This changes no PCM
       samples; it gives Edge enough render-ahead to survive a busy 4K frame. */
    try{audioCtx=new AudioContextConstructor({latencyHint:"playback"});}catch(error){audioCtx=new AudioContextConstructor();}
    mixBus = audioCtx.createGain();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat($("#vol").value)||0.7;
    eqHeadroomGain=audioCtx.createGain();eqHeadroomGain.gain.value=1;
    /* Continuous playback stays linear. A fast compressor tracking individual
       bass cycles caused audible chatter on speaker output; real combined EQ
       response is now budgeted before the filters instead. */
    outputLimiterBypass = audioCtx.createGain();outputLimiterBypass.gain.value=1;
    finalOutputTrimGain=audioCtx.createGain();finalOutputTrimGain.gain.value=Math.pow(10,-1.5/20);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = .8;
    const eqChain = buildEQFilters();
    const spatial = ensureSpatialEngine();
    mixBus.connect(eqHeadroomGain);eqHeadroomGain.connect(eqChain[0]);
    eqChain[eqChain.length-1].connect(spatial.input);
    spatial.output.connect(finalOutputTrimGain);finalOutputTrimGain.connect(outputLimiterBypass);outputLimiterBypass.connect(masterGain);
    masterGain.connect(audioCtx.destination);
    masterGain.connect(analyser);
    decks.forEach((d,i) => {
      const src = audioCtx.createMediaElementSource(d);
      const normalization = audioCtx.createGain();
      const gain = audioCtx.createGain();
      normalization.gain.value=1;
      gain.gain.value = i === activeIdx ? 1 : 0;
      src.connect(normalization);normalization.connect(gain);gain.connect(mixBus);
      deckNormalizationGains[i]=normalization;
      deckGains[i] = gain;
    });
    installAudioDiagnostics({mix:mixBus,eq:eqChain[eqChain.length-1],spatial:spatial.output,final:outputLimiterBypass});
    applyCurrentTrackNormalization(true);syncAudioHeadroom(true);
  }
  function decodeAudioBuffer(arrayBuffer){ensureAudioCtx({resume:false});return audioCtx.decodeAudioData(arrayBuffer);}
  let miniEqFrame=0,miniEqLastPaint=0,miniEqLastSample=0,miniEqData=null,miniEqLevels=[.18,.18,.18,.18],miniEqTargets=[.18,.18,.18,.18],miniEqHoldUntil=[0,0,0,0],miniEqGeometry=null;
  function drawMiniEq(levels=miniEqLevels,refreshStyle=true){
    const canvas=$("#miniEq");if(!canvas)return;
    if(refreshStyle||!miniEqGeometry){const rect=canvas.getBoundingClientRect();if(rect.width<2||rect.height<2)return;const dpr=Math.max(1,window.devicePixelRatio||1);miniEqGeometry={width:Math.max(1,Math.round(rect.width*dpr)),height:Math.max(1,Math.round(rect.height*dpr)),color:getComputedStyle(canvas).color};}
    if(!miniEqGeometry)return;
    const {width,height,color}=miniEqGeometry;
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    const ctx=canvas.getContext("2d");if(!ctx)return;ctx.clearRect(0,0,width,height);
    let barWidth=Math.max(1,Math.round(width/6)),gap=Math.max(1,Math.floor((width-barWidth*4)/3));
    while(barWidth*4+gap*3>width&&barWidth>1)barWidth--;
    const total=barWidth*4+gap*3,startX=Math.floor((width-total)/2);
    ctx.fillStyle=color;
    levels.forEach((level,index)=>{
      const barHeight=Math.max(barWidth,Math.max(.16,Math.min(1,level))*height),x=startX+index*(barWidth+gap),y=height-barHeight,radius=Math.min(barWidth/2,barHeight/2);
      ctx.beginPath();if(typeof ctx.roundRect==="function")ctx.roundRect(x,y,barWidth,barHeight,radius);else ctx.rect(x,y,barWidth,barHeight);ctx.fill();
    });
  }
  function paintMiniEq(timestamp=performance.now()){
    miniEqFrame=0;if(!isPlaying||!analyser||document.hidden){resetMiniEq();return;}
    if(timestamp-miniEqLastPaint<GP_MOTION_FRAME_MS-.35){miniEqFrame=requestAnimationFrame(paintMiniEq);return;}
    const dt=Math.min(.05,Math.max(.001,(timestamp-(miniEqLastPaint||timestamp-GP_MOTION_FRAME_MS))/1000));miniEqLastPaint=timestamp;
    if(timestamp-miniEqLastSample>=42){
      miniEqLastSample=timestamp;miniEqData=miniEqData&&miniEqData.length===analyser.frequencyBinCount?miniEqData:new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(miniEqData);
      const sampleRate=audioCtx?.sampleRate||48000,nyquist=sampleRate/2,bands=[[45,250],[250,1000],[1000,4000],[4000,Math.min(16000,nyquist)]];
      bands.forEach((range,index)=>{
        const from=Math.max(0,Math.floor(range[0]/nyquist*miniEqData.length)),to=Math.max(from+1,Math.ceil(range[1]/nyquist*miniEqData.length));let total=0,count=0;
        for(let i=from;i<Math.min(to,miniEqData.length);i++){const normalized=miniEqData[i]/255;total+=normalized*normalized;count++;}
        const rms=count?Math.sqrt(total/count):0,raw=.14+Math.pow(rms,.72)*.86,difference=raw-miniEqTargets[index];
        if(difference>.008){miniEqTargets[index]+=difference*.58;miniEqHoldUntil[index]=timestamp+68;}
        else if(timestamp>=miniEqHoldUntil[index]&&difference<-.012)miniEqTargets[index]+=difference*.32;
      });
    }
    miniEqLevels=miniEqLevels.map((level,index)=>{
      const target=miniEqTargets[index],difference=target-level;if(Math.abs(difference)<.001)return target;
      const timeConstant=difference>0?.075:.18;
      return level+difference*(1-Math.exp(-dt/timeConstant));
    });
    drawMiniEq(miniEqLevels,false);
    miniEqFrame=requestAnimationFrame(paintMiniEq);
  }
  function resetMiniEq(){if(miniEqFrame)cancelAnimationFrame(miniEqFrame);miniEqFrame=0;miniEqLastPaint=0;miniEqLastSample=0;miniEqLevels=[.18,.18,.18,.18];miniEqTargets=[.18,.18,.18,.18];miniEqHoldUntil=[0,0,0,0];drawMiniEq();}
  function syncMiniEqMeter(){
    const playerVisible=$(".view[data-view='player']")?.classList.contains("active");
    if(isPlaying&&!document.hidden&&playerVisible){if(!miniEqFrame)miniEqFrame=requestAnimationFrame(paintMiniEq);}
    else resetMiniEq();
  }
  document.addEventListener("visibilitychange",syncMiniEqMeter);
  window.addEventListener("resize",()=>requestAnimationFrame(()=>{miniEqGeometry=null;drawMiniEq();syncMiniEqMeter();}),{passive:true});

  let crossfadeEnabled = false;
  let crossfadeSeconds = 3;
  let crossfading = false;
  let crossfadeSwapTimer = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  /* /src/storage/indexeddb.js */
  class GPIndexedDBAdapter{
    constructor(options){
      const config=options||{};
      this.name=config.name||"glass-player-gen4";
      this.version=config.version||5;
      this._openPromise=null;
    }
    open(){
      if(this._openPromise)return this._openPromise;
      this._openPromise=new Promise((resolve,reject)=>{
        if(!window.indexedDB){reject(new Error("IndexedDB unavailable"));return;}
        const request=window.indexedDB.open(this.name,this.version);
        request.onupgradeneeded=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains("trackFeatures")){
            const store=db.createObjectStore("trackFeatures",{keyPath:"contentKey"});
            store.createIndex("analyzedAt","analyzedAt",{unique:false});
            store.createIndex("schemaVersion","schemaVersion",{unique:false});
          }
          if(!db.objectStoreNames.contains("behaviorEvents")){
            const store=db.createObjectStore("behaviorEvents",{keyPath:"id",autoIncrement:true});
            store.createIndex("contentKey","contentKey",{unique:false});
            store.createIndex("timestamp","timestamp",{unique:false});
            store.createIndex("type","type",{unique:false});
          }
          if(!db.objectStoreNames.contains("userModel"))db.createObjectStore("userModel",{keyPath:"id"});
          if(!db.objectStoreNames.contains("recommendations"))db.createObjectStore("recommendations",{keyPath:"id"});
          if(!db.objectStoreNames.contains("trackCache")){
            const store=db.createObjectStore("trackCache",{keyPath:"contentKey"});
            store.createIndex("cachedAt","cachedAt",{unique:false});
            store.createIndex("fileName","fileName",{unique:false});
            store.createIndex("fileSize","fileSize",{unique:false});
            store.createIndex("fileIdentity","fileIdentity",{unique:false});
            store.createIndex("audioEssenceKey","audioEssenceKey",{unique:false});
            store.createIndex("spectrumId","spectrumId",{unique:false});
            store.createIndex("anchorHead","recognition.anchorHead",{unique:false});
            store.createIndex("anchorMiddle","recognition.anchorMiddle",{unique:false});
            store.createIndex("anchorTail","recognition.anchorTail",{unique:false});
            store.createIndex("flacPcmMd5","recognition.flacPcmMd5",{unique:false});
          }else{
            const store=request.transaction.objectStore("trackCache");
            if(!store.indexNames.contains("fileIdentity"))store.createIndex("fileIdentity","fileIdentity",{unique:false});
            if(!store.indexNames.contains("audioEssenceKey"))store.createIndex("audioEssenceKey","audioEssenceKey",{unique:false});
            if(!store.indexNames.contains("spectrumId"))store.createIndex("spectrumId","spectrumId",{unique:false});
            if(!store.indexNames.contains("anchorHead"))store.createIndex("anchorHead","recognition.anchorHead",{unique:false});
            if(!store.indexNames.contains("anchorMiddle"))store.createIndex("anchorMiddle","recognition.anchorMiddle",{unique:false});
            if(!store.indexNames.contains("anchorTail"))store.createIndex("anchorTail","recognition.anchorTail",{unique:false});
            if(!store.indexNames.contains("flacPcmMd5"))store.createIndex("flacPcmMd5","recognition.flacPcmMd5",{unique:false});
          }
        };
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>{this._openPromise=null;reject(request.error||new Error("IndexedDB open failed"));};
        request.onblocked=()=>{this._openPromise=null;reject(new Error("IndexedDB upgrade blocked"));};
      });
      return this._openPromise;
    }
    async run(storeName,mode,operation){
      const db=await this.open();
      return new Promise((resolve,reject)=>{
        const transaction=db.transaction(storeName,mode);
        const store=transaction.objectStore(storeName);
        let request;
        try{request=operation(store);}catch(error){reject(error);return;}
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error||new Error("IndexedDB request failed"));
        transaction.onabort=()=>reject(transaction.error||new Error("IndexedDB transaction aborted"));
      });
    }
    get(storeName,key){return this.run(storeName,"readonly",store=>store.get(key));}
    getByIndex(storeName,indexName,key){return this.run(storeName,"readonly",store=>store.index(indexName).get(key));}
    getAll(storeName){return this.run(storeName,"readonly",store=>store.getAll());}
    put(storeName,value){return this.run(storeName,"readwrite",store=>store.put(value));}
    delete(storeName,key){return this.run(storeName,"readwrite",store=>store.delete(key));}
    clear(storeName){return this.run(storeName,"readwrite",store=>store.clear());}
  }

  /* /src/core/database.js */
  const GPDatabase={
    adapter:null,
    use(adapter){this.adapter=adapter;return this;},
    requireAdapter(){if(!this.adapter)throw new Error("GP storage adapter is not configured");return this.adapter;},
    getTrackFeatures(contentKey){return this.requireAdapter().get("trackFeatures",contentKey);},
    saveTrackFeatures(record){return this.requireAdapter().put("trackFeatures",record);},
    deleteTrackFeatures(contentKey){return this.requireAdapter().delete("trackFeatures",contentKey);},
    getTrackCache(contentKey){return this.requireAdapter().get("trackCache",contentKey);},
    getTrackCacheByFileIdentity(fileIdentity){return this.requireAdapter().getByIndex("trackCache","fileIdentity",fileIdentity);},
    getTrackCacheByEssenceKey(audioEssenceKey){return this.requireAdapter().getByIndex("trackCache","audioEssenceKey",audioEssenceKey);},
    getTrackCacheBySpectrumId(spectrumId){return this.requireAdapter().getByIndex("trackCache","spectrumId",spectrumId);},
    getTrackCacheByRecognitionIndex(indexName,value){return value?this.requireAdapter().getByIndex("trackCache",indexName,value):Promise.resolve(null);},
    addTrackCache(record){return this.requireAdapter().run("trackCache","readwrite",store=>store.add(record));},
    saveTrackCache(record){return this.requireAdapter().put("trackCache",record);},
    addBehaviorEvent(event){return this.requireAdapter().put("behaviorEvents",event);},
    getBehaviorEvents(){return this.requireAdapter().getAll("behaviorEvents");},
    saveUserModel(model){return this.requireAdapter().put("userModel",model);},
    getUserModel(id){return this.requireAdapter().get("userModel",id||"default");},
    saveRecommendations(record){return this.requireAdapter().put("recommendations",record);},
    getRecommendations(id){return this.requireAdapter().get("recommendations",id||"daily");}
  };
  const GPBrowserStorage=Object.freeze({
    getLocal(key){return localStorage.getItem(key);},
    setLocal(key,value){localStorage.setItem(key,value);},
    removeLocal(key){localStorage.removeItem(key);}
  });
  /* ================= GP Bionic Engine 1.0 — Intelligence Core =================
     Consolidates track identity recognition, acoustic signal spectrum analysis,
     listening DNA neural modeling, and fusion queue/playlist flow. */
  const GPAnalyzer={
    schemaVersion:GP_FEATURE_SCHEMA_VERSION,
    database:GPDatabase,
    async readCached(contentKey){
      if(!contentKey)return null;
      const record=await this.database.getTrackFeatures(contentKey);
      return record&&record.schemaVersion===this.schemaVersion&&record.spectrumVersion===GP_SPECTRUM_ALGORITHM_VERSION&&record.spectrumStatus==="complete"?record:null;
    },
    createFeatureRecord(track,features){
      const data=features||{};
      return {
        contentKey:track.contentKey,
        spectrumId:track.spectrumId||track.audioEssenceKey||track.contentKey,
        audioEssenceKey:track.audioEssenceKey||track.spectrumId||track.contentKey,
        recognitionSchemaVersion:GP_RECOGNITION_SCHEMA_VERSION,
        metadata:{name:track.name||"",title:track.title||"",artist:track.artist||"",duration:Number(track.duration)||0,genre:track.genre||null,genreSource:track.genreSource||null},
        mfcc:data.mfcc&&Array.isArray(data.mfcc.mean)?{
          mean:data.mfcc.mean.slice(0,13),stdev:Array.isArray(data.mfcc.stdev)?data.mfcc.stdev.slice(0,13):[],frames:Number(data.mfcc.frames)||0,
          sampleRate:Number(data.mfcc.sampleRate)||22050,frameSize:Number(data.mfcc.frameSize)||1024,nMels:Number(data.mfcc.nMels)||40,nMfcc:Number(data.mfcc.nMfcc)||13,
          spectralCentroid:Number.isFinite(data.mfcc.spectralCentroid)?data.mfcc.spectralCentroid:null,
          spectralFlatness:Number.isFinite(data.mfcc.spectralFlatness)?data.mfcc.spectralFlatness:null,
          spectralRolloff:Number.isFinite(data.mfcc.spectralRolloff)?data.mfcc.spectralRolloff:null,
          spectralBandwidth:Number.isFinite(data.mfcc.spectralBandwidth)?data.mfcc.spectralBandwidth:null,
          zeroCrossingRate:Number.isFinite(data.mfcc.zeroCrossingRate)?data.mfcc.zeroCrossingRate:null,
          bassRatio:Number.isFinite(data.mfcc.bassRatio)?data.mfcc.bassRatio:null,midRatio:Number.isFinite(data.mfcc.midRatio)?data.mfcc.midRatio:null,
          highRatio:Number.isFinite(data.mfcc.highRatio)?data.mfcc.highRatio:null,spectralFlux:Number.isFinite(data.mfcc.spectralFlux)?data.mfcc.spectralFlux:null,
          crestFactor:Number.isFinite(data.mfcc.crestFactor)?data.mfcc.crestFactor:null,dynamicRangeDb:Number.isFinite(data.mfcc.dynamicRangeDb)?data.mfcc.dynamicRangeDb:null,
          mfccDelta:Number.isFinite(data.mfcc.mfccDelta)?data.mfcc.mfccDelta:null
        }:null,
        mfccSummary:data.mfccSummary||null,
        mood:data.mood||null,
        inferredGenre:data.inferredGenre||null,
        genreSecondary:data.genreSecondary||null,
        genreScores:Array.isArray(data.genreScores)?data.genreScores.slice(0,3):null,
        genreConfidence:Number.isFinite(data.genreConfidence)?data.genreConfidence:null,
        genreSource:data.genreSource||null,
        energy:Number.isFinite(data.energy)?data.energy:null,
        energyDb:Number.isFinite(data.energyDb)?data.energyDb:null,
        loudnessDb:Number.isFinite(data.loudnessDb)?data.loudnessDb:null,
        normalizationGainDb:Number.isFinite(data.normalizationGainDb)?data.normalizationGainDb:(Number.isFinite(data.loudnessDb)?Math.max(-7,Math.min(7,-18-data.loudnessDb)):null),
        normalizationVersion:1,
        bpm:Number.isFinite(data.bpm)?data.bpm:null,
        bpmConfidence:Number.isFinite(data.bpmConfidence)?data.bpmConfidence:null,
        sampleRate:Number.isFinite(data.sampleRate)?data.sampleRate:null,
        channels:Number.isFinite(data.channels)?data.channels:null,
        peaks:Array.isArray(data.peaks)?data.peaks.slice(0,160):null,
        spectrumVersion:data.spectrumVersion||null,
        spectrumStatus:data.spectrumStatus||null,
        schemaVersion:this.schemaVersion,
        analyzedAt:Date.now()
      };
    },
    save(track,features){
      if(!track||!track.contentKey)return Promise.reject(new Error("Track contentKey is required"));
      return this.database.saveTrackFeatures(this.createFeatureRecord(track,features));
    },
    async saveSpectrum(track,features){
      if(!track||!track.contentKey)throw new Error("Track contentKey is required");
      const existing=await this.database.getTrackFeatures(track.contentKey).catch(()=>null);
      return this.database.saveTrackFeatures(this.createFeatureRecord(track,Object.assign({},existing||{},features||{},{spectrumVersion:GP_SPECTRUM_ALGORITHM_VERSION,spectrumStatus:"complete"})));
    },
    analyze(track){
      return analyzeTrackSpectrum(track);
    }
  };

  /* /src/core/audio.js — compatibility bridge; the proven 3.5.3 runtime stays authoritative. */
  const GPAudioCore={
    runtime:null,
    bindRuntime(runtime){this.runtime=Object.freeze(Object.assign({},runtime));return this;},
    getState(){return this.runtime&&this.runtime.getState?this.runtime.getState():null;},
    play(){return this.runtime&&this.runtime.play?this.runtime.play():undefined;},
    pause(){return this.runtime&&this.runtime.pause?this.runtime.pause():undefined;},
    toggle(){return this.runtime&&this.runtime.toggle?this.runtime.toggle():undefined;},
    loadTrack(index,autoplay){return this.runtime&&this.runtime.loadTrack?this.runtime.loadTrack(index,autoplay):undefined;},
    next(){return this.runtime&&this.runtime.next?this.runtime.next():undefined;},
    previous(){return this.runtime&&this.runtime.previous?this.runtime.previous():undefined;}
  };

  /* Module boundaries only, no Beta UI mutation. */
  const GPUIModules={
    galaxy:{status:"reserved",mount:null},
    timeline:{status:"reserved",mount:null}
  };

  const gpIndexedDB=new GPIndexedDBAdapter();
  GPDatabase.use(gpIndexedDB);
  const GP=window.GP={
    generation:7,
    version:"7.6.2",
    architecture:"Peregrine Lake",
    engines:{core:"GP Core 4.3 — Kinetic Runtime",bionic:"GP Bionic Engine 1.0 — Intelligence Core",fusion:`GP Fusion Engine ${GP_FUSION_ENGINE_VERSION} — Playlist Flow`,motion:"GP Motion Engine 4.2 — Kinetic Motion",spatial:"GP Spatial Engine 1.1 — Room",spectrum:`GP Spectrum Engine ${GP_SPECTRUM_ENGINE_VERSION} — Signal`,recognition:"GP Bionic ID 1.0",neural:`GP Neural Engine ${GP_NEURAL_ENGINE_VERSION} — Listening DNA`},
    paths:{core:["audio.js","database.js","analyzer.js","recognition.js"],ui:["timeline.js"],storage:["indexeddb.js"]},
    core:{audio:GPAudioCore,database:GPDatabase,analyzer:GPAnalyzer},
    ui:GPUIModules,
    storage:{adapter:gpIndexedDB,indexeddb:GPIndexedDBAdapter},
    performance:{lastImport:null,libraryRenderCommits:0,spectrum:{queued:0,completed:0,cacheHits:0,failed:0}},
    future:{architecture:"Electron Lake",storageAdapter:"storage/sqlite.js",delivery:"EXE"}
  };
  GP.modules ??= {};

  function monotoneCurvePath(points,tension=.62){
    if(!points?.length)return "";
    if(points.length===1)return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    const slopes=points.slice(0,-1).map((point,index)=>(points[index+1].y-point.y)/Math.max(.001,points[index+1].x-point.x));
    const tangents=points.map((_,index)=>{
      if(index===0)return slopes[0]*tension;
      if(index===points.length-1)return slopes[slopes.length-1]*tension;
      const before=slopes[index-1],after=slopes[index];
      if(before===0||after===0||Math.sign(before)!==Math.sign(after))return 0;
      return .5*(Math.sign(before)+Math.sign(after))*Math.min(Math.abs(before),Math.abs(after),Math.abs(before+after)/2)*tension;
    });
    let path=`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for(let index=0;index<points.length-1;index++){
      const point=points[index],next=points[index+1],handle=(next.x-point.x)/3;
      path+=` C ${(point.x+handle).toFixed(2)} ${(point.y+tangents[index]*handle).toFixed(2)} ${(next.x-handle).toFixed(2)} ${(next.y-tangents[index+1]*handle).toFixed(2)} ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
    }
    return path;
  }
  GP.utils = (() => {
    function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
    function formatTime(sec){if(!isFinite(sec)||sec<0)sec=0;const m=Math.floor(sec/60),s=Math.floor(sec%60).toString().padStart(2,"0");return `${m}:${s}`;}
    return Object.freeze({clamp,formatTime,monotoneCurvePath});
  })();
  GPModules.register("createContracts",function createContracts(){
    const events=Object.freeze({TRACK_STARTED:"playback:track-started",TRACK_PAUSED:"playback:track-paused",TRACK_ENDED:"playback:track-ended",SEEKED:"playback:seeked",CROSSFADE_STARTED:"playback:crossfade-started",CROSSFADE_COMPLETED:"playback:crossfade-completed",IMPORT_COMPLETED:"library:import-completed",ANALYSIS_COMPLETED:"analysis:completed",ANALYSIS_FAILED:"analysis:failed",SETTINGS_CHANGED:"settings:changed",PIP_OPENED:"pip:opened",PIP_CLOSED:"pip:closed"});
    return Object.freeze({events});
  });
  GPModules.register("createEventBus",function createEventBus(){
    const listeners=new Map();
    function on(type,listener){if(typeof listener!=="function")throw new TypeError("Event listener must be a function");let set=listeners.get(type);if(!set){set=new Set();listeners.set(type,set);}set.add(listener);return()=>off(type,listener);}
    function off(type,listener){const set=listeners.get(type);if(!set)return;set.delete(listener);if(!set.size)listeners.delete(type);}
    function emit(type,payload){const set=listeners.get(type);if(!set)return;[...set].forEach(listener=>listener(payload));}
    function clear(){listeners.clear();}
    return Object.freeze({on,off,emit,clear});
  });
  GPModules.register("createActions",function createActions(){
    const types=Object.freeze({PATCH:"app/patch",REPLACE:"app/replace"});
    return Object.freeze({types,patch:(path,value)=>Object.freeze({type:types.PATCH,path:Object.freeze([...path]),value}),replace:state=>Object.freeze({type:types.REPLACE,state})});
  });
  GPModules.register("createStore",function createStore({initialState,bus,actions}){
    let state=structuredClone(initialState);const listeners=new Set(),selectorListeners=new Set();
    const snapshot=()=>Object.freeze(structuredClone(state));
    function notify(previous){const next=snapshot();listeners.forEach(listener=>listener(next,Object.freeze(structuredClone(previous))));selectorListeners.forEach(entry=>{const value=entry.selector(next);if(!Object.is(value,entry.last)){const old=entry.last;entry.last=value;entry.listener(value,old);}});}
    function dispatch(action){const previous=state;if(action?.type===actions.types.REPLACE)state=structuredClone(action.state);else if(action?.type===actions.types.PATCH){state=structuredClone(state);let target=state;for(let i=0;i<action.path.length-1;i++)target=target[action.path[i]];target[action.path.at(-1)]=structuredClone(action.value);}else throw new Error(`Unknown action: ${action?.type}`);notify(previous);return action;}
    function subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}
    function subscribeSelector(selector,listener){const entry={selector,listener,last:selector(snapshot())};selectorListeners.add(entry);return()=>selectorListeners.delete(entry);}
    function replaceStateForMigration(next){dispatch(actions.replace(next));}
    return Object.freeze({getState:snapshot,dispatch,subscribe,subscribeSelector,replaceStateForMigration});
  });
  GPModules.register("createSelectors",function createSelectors(){
    return Object.freeze({library:s=>s.library,playback:s=>s.playback,queue:s=>s.queue,settings:s=>s.settings,analysis:s=>s.analysis,ui:s=>s.ui,currentTrack:s=>s.library.tracks.find(track=>track.id===s.library.currentTrackId)||null});
  });
  GPModules.register("createAppContext",function createAppContext(parts){
    return Object.freeze({store:parts.store,bus:parts.bus,actions:parts.actions,selectors:parts.selectors,contracts:parts.contracts,adapters:Object.freeze({...parts.adapters}),engines:Object.freeze({...parts.engines}),services:Object.freeze({...parts.services})});
  });
  GPModules.register("createBrowserClockAdapter",function createBrowserClockAdapter(){return Object.freeze({now:()=>Date.now(),date:()=>new Date(),setTimeout:(fn,ms)=>window.setTimeout(fn,ms),clearTimeout:id=>window.clearTimeout(id),requestFrame:fn=>window.requestAnimationFrame(fn),cancelFrame:id=>window.cancelAnimationFrame(id)});});
  GPModules.register("createBrowserMediaSessionAdapter",function createBrowserMediaSessionAdapter(){const session=navigator.mediaSession||null;return Object.freeze({supported:!!session,setMetadata:value=>{if(session)session.metadata=value;},setPlaybackState:value=>{if(session)session.playbackState=value;},setActionHandler:(name,handler)=>{if(session)session.setActionHandler(name,handler);}});});
  GPModules.register("createBrowserFileAdapter",function createBrowserFileAdapter({fileInput,folderInput,storage}){
    const DEFAULT_MUSIC_FOLDER_ID="defaultMusicFolder";
    function pick(input){return new Promise(resolve=>{if(!input){resolve([]);return;}const done=()=>{input.removeEventListener("change",done);resolve(Array.from(input.files||[]));};input.addEventListener("change",done,{once:true});input.click();});}
    function supportsPersistedAudioFolder(){return typeof globalThis.showDirectoryPicker==="function"&&typeof storage?.getRecommendation==="function"&&typeof storage?.saveRecommendation==="function";}
    async function hasReadPermission(handle){try{return handle?.kind==="directory"&&await handle.queryPermission({mode:"read"})==="granted";}catch(error){return false;}}
    async function filesFromDirectory(handle){
      const files=[];
      async function visit(directory){for await(const entry of directory.values()){if(entry.kind==="file")files.push(await entry.getFile());else if(entry.kind==="directory")await visit(entry);}}
      await visit(handle);return files;
    }
    async function pickAndRememberAudioFolder(){
      if(!supportsPersistedAudioFolder())return pick(folderInput);
      const handle=await globalThis.showDirectoryPicker({mode:"read"});
      if(await hasReadPermission(handle))try{await storage.saveRecommendation({id:DEFAULT_MUSIC_FOLDER_ID,folderHandle:handle,savedAt:Date.now()});}catch(error){console.warn("Default music folder persistence failed",error);}
      return filesFromDirectory(handle);
    }
    async function restoreRememberedAudioFolder(){
      if(!supportsPersistedAudioFolder())return [];
      let record=null;try{record=await storage.getRecommendation(DEFAULT_MUSIC_FOLDER_ID);}catch(error){return [];}
      const handle=record?.folderHandle;if(!await hasReadPermission(handle))return [];
      try{return await filesFromDirectory(handle);}catch(error){return [];}
    }
    return Object.freeze({pickAudioFiles:()=>pick(fileInput),pickAudioFolder:()=>pick(folderInput),supportsPersistedAudioFolder,pickAndRememberAudioFolder,restoreRememberedAudioFolder});
  });
  GPModules.register("createBrowserPiPAdapter",function createBrowserPiPAdapter(){return Object.freeze({supported:()=>document.pictureInPictureEnabled===true,request:video=>video.requestPictureInPicture(),exit:()=>document.pictureInPictureElement?document.exitPictureInPicture():Promise.resolve()});});
  GPModules.register("createStoragePort",function createStoragePort(database){return Object.freeze({open:()=>database.requireAdapter().open(),getLocal:key=>GPBrowserStorage.getLocal(key),setLocal:(key,value)=>GPBrowserStorage.setLocal(key,value),removeLocal:key=>GPBrowserStorage.removeLocal(key),getTrackCache:key=>database.getTrackCache(key),saveTrackCache:value=>database.saveTrackCache(value),getTrackCacheByFileIdentity:key=>database.getTrackCacheByFileIdentity(key),getTrackCacheBySpectrumId:key=>database.getTrackCacheBySpectrumId(key),getTrackFeatures:key=>database.getTrackFeatures(key),saveTrackFeatures:value=>database.saveTrackFeatures(value),addBehaviorEvent:value=>database.addBehaviorEvent(value),getBehaviorEvents:(...args)=>database.getBehaviorEvents(...args),getUserModel:id=>database.getUserModel(id),saveUserModel:value=>database.saveUserModel(value),getRecommendation:id=>database.getRecommendations(id),saveRecommendation:value=>database.saveRecommendations(value)});});
  GP.i18n = (() => {
  const UI_EN={
    "播放器":"Player","歌单":"Library","歌曲库":"Library","听歌历史":"Listening History","设置":"Settings","更新日志":"Changelog",
    "播放队列":"Queue","音效":"Sound","每日推荐":"Daily Mix","清空":"Clear","接下来播放":"Up Next",
    "添加文件":"Add Files","添加文件夹":"Add Folder","搜索歌曲或歌手":"Search songs or artists","筛选":"Filter","全部歌曲":"All songs","已播放":"Played","未播放":"Unplayed","视图":"View","切换列表和网格视图":"Switch between list and grid views","列表 / Grid":"List / Grid","未标注专辑":"No Album","序号":"No.","封面 + 歌名/歌手":"Artwork + Song/Artist","专辑":"Album","操作":"Actions",
    "排序：原始顺序":"Sort: Original","原始顺序":"Original order","歌手 A–Z":"Artist A–Z","歌名 A–Z":"Title A–Z",
    "今天":"Today","本周":"This Week","本月":"This Month","本年":"This Year","全部":"All","听歌时间":"Listening Time","最近最爱":"Recent Favorites","听歌数据":"Listening Data","播放次数":"Plays","最常听歌曲":"Most Played Song","昨日对比":"Compared with Yesterday","听歌时长排行 Top 10":"Top 10 Listening Time","Top 3":"Top 3","较大封面与听歌数据":"Larger covers with listening data","第 4–10 名列表":"Ranks 4–10","歌曲":"Song","时长 / 播放次数":"Duration / Plays","暂无更多歌曲":"No more songs in this range",
    "听歌时长排行 Top 50":"Top 50 Listening Time","选定时间段内的听歌时长":"Listening time in selected range",
    "外观":"Appearance","界面语言":"Interface Language","外观模式":"Appearance Mode","浅色":"Light","深色":"Dark","自动":"Auto","音频":"Audio","音乐库":"Music Library","数据":"Data","高级":"Advanced","关于":"About","设置分类":"Settings Categories","音效面板":"Sound panel","本地数据":"Local Data","本地保存":"Saved locally","音效与空间音频":"Sound and Spatial Audio",
    "主题色":"Accent Color","背景效果":"Background Effect","灵动光晕":"Ambient Glow","封面取色":"Cover Color","封面虚化":"Blurred Cover",
    "播放行为":"Playback","专辑封面显示方式":"Album Art Display","随唱片旋转":"Rotate with Disc","静态展示":"Static Cover",
    "交叉淡入淡出":"Crossfade","时长":"Duration",
    "文字":"Typography","字体":"Font","字体大小":"Font Size","字体粗细":"Font Weight","细":"Light","粗":"Bold",
    "均衡器 EQ":"Equalizer","预设":"Presets","手动调节":"Manual Control","原始":"Flat","低音增强":"Bass Boost","人声增强":"Vocal Boost","高音明亮":"Bright Treble","自定义":"Manual",
    "显示器音响":"Monitor Speakers","显示器音响靠墙补偿：削减低频和低中频闷感，补回人声清晰度与空气感":"Wall-proximity compensation for monitor speakers: reduces bass and low-mid muddiness while restoring vocal clarity and air.",
    "暂停":"Pause","关闭":"Off","播完暂停":"Stop After Song","播放速度":"Speed","未选择歌曲":"No Song Selected","拖入或导入音乐开始播放":"Drop or import music to begin",
    "歌单顺序":"Library Order","手动播放列表":"Manual Queue","从播放队列移除":"Remove from queue","拖拽排序":"Drag to reorder",
    "下一首播放":"Play Next","加入播放队列":"Add to Queue","从歌单移除":"Remove from Library","生成推荐歌单":"Generate Mix","播放推荐":"Play Mix","播放推荐歌单":"Play Daily Mix",
    "0 分钟":"0 minutes","0 首等待":"0 queued","0 首歌":"0 songs","15 分钟后":"After 15 minutes","30 分钟后":"After 30 minutes","45 分钟后":"After 45 minutes","60 分钟后":"After 60 minutes",
    "Aa 你好，世界 Glass Player 123":"Aa Hello, World — Glass Player 123","New York（衬线）":"New York (Serif)","Apple 系统字体":"Apple System Font","Microsoft 系统字体":"Microsoft System Font","中文":"Chinese",
    "UI 主题色跟随当前歌曲封面":"Match UI accent to current cover","按你的跳过/听完习惯 + 语言/风格自动调权重":"Weighted by skips, completions, language and genre",
    "比特率":"Bitrate","播放":"Play","播客":"Podcast","播完这首后暂停":"Stop after this song","取消定时":"Cancel Timer","采样率":"Sample Rate","声道":"Channels","格式":"Format","文件信息":"File Information","响度":"Loudness","风格":"Genre","能量":"Energy","分析中…":"Analyzing…","未检测到":"Not detected",
    "电子":"Electronic","古典":"Classical","歌曲名称 A–Z":"Song Title A–Z","歌手名称 A–Z":"Artist Name A–Z","顺序播放":"Sequential",
    "界面配色":"Interface Color","开启后会自动识别当前浅色/深色模式，从封面提取主色并调整饱和度与明度，确保按钮和文字始终清晰可读，不会出现看不清的配色。":"Extracts a readable accent from the current cover and adapts it for light or dark mode.",
    "灵动光晕：使用主题色的流动光斑；封面取色：从当前歌曲封面提取主色作为背景色块；封面虚化：将封面放大模糊铺满背景，类似 Apple Music 动态背景。":"Ambient Glow uses animated accent blobs; Cover Color extracts a dominant color; Blurred Cover fills the background with a softened album image.",
    "可变字体会获得最平滑的粗细变化；普通字体会自动匹配最接近的字重。":"Variable fonts provide the smoothest weight changes; standard fonts use the closest available weight.",
    "还没有音乐":"No music yet","点击上方按钮导入，或直接把歌曲/文件夹拖进窗口":"Import above, or drop songs and folders into the window","封面会自动从 MP3/FLAC/M4A 中识别":"Artwork is read automatically from MP3, FLAC and M4A files",
    "歌曲文件不会保存到磁盘外，刷新页面需要重新导入；听歌记录会保留。":"Audio files never leave your device. Reimport after refresh; listening history is retained.",
    "松开鼠标以添加音乐":"Release to add music","睡眠定时":"Snooze","选择字体":"Choose Font","听歌记录":"Listening History","当前版本 7.6.2 — REBRAND UPDATE":"Current Version 7.6.2 — REBRAND UPDATE","版本 7.6.2 — REBRAND UPDATE":"Ver. 7.6.2 — REBRAND UPDATE","当前版本 7.5.0 — Replay Atlas":"Current Version 7.5.0 — Replay Atlas","版本 7.5.0 — Replay Atlas":"Ver. 7.5.0 — Replay Atlas","REPLAY ATLAS":"REPLAY ATLAS","HOTFIX BUILD":"HOTFIX BUILD","KINETIC GLASS":"KINETIC GLASS","REBRAND UPDATE":"REBRAND UPDATE","导出日志":"Export Log","打开悬浮播放器":"Open Floating Player","返回设置":"Back to Settings","清除搜索":"Clear Search","收起侧边栏":"Collapse Sidebar","展开侧边栏":"Expand Sidebar","未找到完全匹配，以下为粗略匹配":"No exact match. Approximate matches are shown below.","未找到匹配结果":"No matching results",
    "音乐库数据":"Library Data","重新扫描歌曲库":"Rescan Music Library","重新读取当前导入歌曲的 Genre、文件名信息、时长与封面；保留 Spectrum ID、MFCC、Energy、BPM 和收听历史。":"Reread Genre, filename metadata, duration and artwork from imported songs while preserving Spectrum ID, MFCC, Energy, BPM and listening history.",
    "重新扫描歌曲库？":"Rescan Music Library?","将从当前导入的音频文件重新读取 Genre、文件名信息、时长和封面，并覆盖缓存中的旧 metadata。Spectrum ID、MFCC、Energy、BPM 与收听历史不会改变。":"The current audio files will be reread for Genre, filename metadata, duration and artwork, replacing stale cached metadata. Spectrum ID, MFCC, Energy, BPM and listening history will remain unchanged.","取消":"Cancel","开始扫描":"Start Scan",
    "精选字体":"Curated Fonts","未知艺人":"Unknown Artist","未知":"Unknown","计算中…":"Calculating…","解码中…":"Decoding…","单声道":"Mono","立体声":"Stereo","版本列表":"Version List",
    "Poly Sync 40 补偿：补低频并压低人声凸起的中频":"Poly Sync 40 compensation: restore bass and reduce forward vocal mids",
    "Bose QC35 补偿：收低频、补中高频空气感":"Bose QC35 compensation: reduce bass and add upper-mid/high air",
    "Bose QC Earbuds 2024 补偿：收窄 150-400Hz 并提亮高频":"Bose QC Earbuds 2024 compensation: tighten 150–400 Hz and brighten treble"
  };
  Object.assign(UI_EN,{
    "选择 Glass Player 的界面语言。":"Choose the Glass Player interface language.","在浅色、深色或根据时间自动切换。":"Switch between Light, Dark or an automatic schedule.","选择界面使用的 Accent 颜色。":"Choose the Accent color used by the interface.","灵动光晕、封面取色或封面虚化。":"Ambient Glow, Cover Color or Blurred Cover.","让 UI 主题色跟随当前歌曲封面，并自动保持文字对比度。":"Match the UI accent to the current cover while preserving text contrast.","选择唱片旋转或静态封面展示。":"Choose a rotating disc or a static cover.","在相邻歌曲之间平滑过渡。":"Transition smoothly between adjacent songs.","均衡器、设备预设、空间音频和响度均衡仍由播放器右侧的“音效”面板统一控制，避免建立第二套音频状态。":"Equalizer, device presets, Spatial Audio and loudness balance remain in the Player Sound panel so there is one audio state.","本地数据":"Local Data","播放历史、偏好和音频分析缓存保存在当前设备的本地存储中；本次版本不改变数据结构。":"Listening history, preferences and audio-analysis caches stay in local storage; this release does not change the data schema.","本地保存":"Saved locally","Apple 字体会按 SF Pro Display、SF Pro Text、PingFang 和 SF Mono 的角色分配显示。":"Apple typography assigns SF Pro Display, SF Pro Text, PingFang and SF Mono by text role.","调整界面字体的大小。":"Adjust the interface font size.","在可读性和信息密度之间调整。":"Balance readability and information density.","音效与空间音频":"Sound and Spatial Audio","音效面板":"Sound panel",
    "空间音效":"Spatial Audio","空间音效开关":"Spatial Audio toggle","了解空间音效":"About Spatial Audio","声音":"Sound","设备":"Devices",
    "自动响度均衡":"Automatic loudness balance","了解响度均衡":"About Loudness Balance",
    "桌面音响":"Desktop Speakers","监听音箱":"Studio Monitors","宽阔舞台":"Wide Stage",
    "环绕音":"Orbit","前置双耳":"Front Binaural","现场大厅":"Live Hall","影院":"Cinema","梦境":"Dreamscape"
  });
  Object.assign(UI_EN,{"无法打开悬浮播放器":"Unable to open Floating Player","当前浏览器或页面环境暂不支持传统视频画中画。":"The current browser or page environment does not support traditional video Picture-in-Picture.","知道了":"Got it"});
  Object.assign(UI_EN,{"常规":"Regular","中等":"Medium","半粗":"Semibold","特粗":"Heavy","运行身份":"Runtime identity","架构":"Architecture","引擎":"Engines","数据安全":"Cache safety","本地单一运行时；设置不新增状态，音频分析与听歌历史继续使用现有缓存边界。":"One local runtime; Settings adds no state, and audio analysis and listening history keep their existing cache boundaries.","默认音乐文件夹":"Default Music Folder","选择文件夹":"Choose Folder","选择后，打开 HTML 时会自动导入这个文件夹中的音乐；浏览器可能要求重新授权。":"After choosing, this folder's music is imported when the HTML file opens; the browser may ask for permission again.","已保存默认文件夹，下次打开会自动导入音乐。":"Default folder saved. Its music will be imported next time.","默认文件夹已选择；本次找到 {count} 个音频文件。":"Default folder selected; found {count} audio files this time.","默认文件夹中没有找到音频文件。":"No audio files were found in the default folder.","当前浏览器不支持自动记住文件夹；请每次使用添加文件夹。":"This browser cannot remember folders automatically; use Add Folder each time."});
  const UI_RU={
    "播放器":"Плеер","歌单":"Медиатека","歌曲库":"Медиатека","听歌历史":"История прослушивания","设置":"Настройки","更新日志":"Журнал изменений",
    "播放队列":"Очередь","音效":"Звук","每日推荐":"Микс дня","清空":"Очистить","接下来播放":"Далее",
    "添加文件":"Добавить файлы","添加文件夹":"Добавить папку","搜索歌曲或歌手":"Поиск песен или исполнителей","筛选":"Фильтр","全部歌曲":"Все песни","已播放":"Прослушанные","未播放":"Непрослушанные","视图":"Вид","切换列表和网格视图":"Переключить список и сетку","列表 / Grid":"Список / сетка","未标注专辑":"Без альбома","序号":"№","封面 + 歌名/歌手":"Обложка + песня/исполнитель","专辑":"Альбом","操作":"Действия",
    "排序：原始顺序":"Сортировка: исходный порядок","原始顺序":"Исходный порядок","歌手 A–Z":"Исполнитель А–Я","歌名 A–Z":"Название А–Я",
    "今天":"Сегодня","本周":"Эта неделя","本月":"Этот месяц","本年":"Этот год","全部":"Все","听歌时间":"Время прослушивания","最近最爱":"Недавние любимые","听歌数据":"Данные прослушивания","播放次数":"Прослушивания","最常听歌曲":"Самая прослушиваемая песня","昨日对比":"Сравнение со вчера","听歌时长排行 Top 10":"Топ-10 по времени прослушивания","Top 3":"Топ-3","较大封面与听歌数据":"Крупные обложки и данные прослушивания","第 4–10 名列表":"Места 4–10","歌曲":"Песня","时长 / 播放次数":"Длительность / прослушивания","暂无更多歌曲":"Больше песен нет",
    "听歌时长排行 Top 50":"Топ-50 по времени прослушивания","选定时间段内的听歌时长":"Время прослушивания за выбранный период",
    "外观":"Внешний вид","界面语言":"Язык интерфейса","外观模式":"Режим оформления","浅色":"Светлая","深色":"Тёмная","自动":"Авто","音频":"Аудио","音乐库":"Медиатека","数据":"Данные","高级":"Дополнительно","关于":"О программе","设置分类":"Разделы настроек","音效面板":"Панель звука","本地数据":"Локальные данные","本地保存":"Сохранено локально","音效与空间音频":"Звук и пространственное аудио",
    "主题色":"Цвет акцента","背景效果":"Эффект фона","灵动光晕":"Динамическое свечение","封面取色":"Цвет обложки","封面虚化":"Размытая обложка",
    "播放行为":"Воспроизведение","专辑封面显示方式":"Отображение обложки","随唱片旋转":"Вращать с диском","静态展示":"Статичная обложка","交叉淡入淡出":"Плавное сведение","时长":"Длительность",
    "文字":"Типографика","字体":"Шрифт","字体大小":"Размер шрифта","字体粗细":"Насыщенность шрифта","细":"Светлый","粗":"Жирный",
    "均衡器 EQ":"Эквалайзер","预设":"Пресеты","手动调节":"Ручная настройка","原始":"Плоский","低音增强":"Усиление басов","人声增强":"Вокал","高音明亮":"Яркие высокие","自定义":"Вручную",
    "暂停":"Пауза","关闭":"Выкл.","播完暂停":"Остановить после песни","播放速度":"Скорость","未选择歌曲":"Песня не выбрана","拖入或导入音乐开始播放":"Перетащите или импортируйте музыку",
    "歌单顺序":"Порядок медиатеки","手动播放列表":"Ручная очередь","从播放队列移除":"Удалить из очереди","拖拽排序":"Перетащите для сортировки","下一首播放":"Воспроизвести следующей","加入播放队列":"Добавить в очередь","从歌单移除":"Удалить из медиатеки","生成推荐歌单":"Создать микс","播放推荐":"Воспроизвести микс","播放推荐歌单":"Воспроизвести микс дня",
    "Aa 你好，世界 Glass Player 123":"Aa Привет, мир — Glass Player 123","New York（衬线）":"New York (с засечками)","Apple 系统字体":"Системный шрифт Apple","中文":"Китайский","UI 主题色跟随当前歌曲封面":"Акцент по текущей обложке",
    "比特率":"Битрейт","播放":"Воспроизвести","播客":"Подкаст","播完这首后暂停":"Остановить после этой песни","取消定时":"Отменить таймер","采样率":"Частота дискретизации","声道":"Каналы","格式":"Формат","文件信息":"Информация о файле","响度":"Громкость","风格":"Жанр","能量":"Энергия","分析中…":"Анализ…","未检测到":"Не обнаружено","电子":"Электронная","古典":"Классика","歌曲名称 A–Z":"Название песни А–Я","歌手名称 A–Z":"Имя исполнителя А–Я","顺序播放":"Последовательно","随机播放":"Перемешивание","单曲循环":"Повтор одной песни",
    "界面配色":"Цвет интерфейса","还没有音乐":"Музыки пока нет","松开鼠标以添加音乐":"Отпустите кнопку мыши, чтобы добавить музыку","睡眠定时":"Таймер сна","选择字体":"Выбор шрифта","听歌记录":"История прослушивания","当前版本 7.6.2 — REBRAND UPDATE":"Текущая версия 7.6.2 — REBRAND UPDATE","版本 7.6.2 — REBRAND UPDATE":"Версия 7.6.2 — REBRAND UPDATE","当前版本 7.5.0 — Replay Atlas":"Текущая версия 7.5.0 — Replay Atlas","版本 7.5.0 — Replay Atlas":"Версия 7.5.0 — Replay Atlas","REPLAY ATLAS":"АТЛАС REPLAY","HOTFIX BUILD":"HOTFIX BUILD","KINETIC GLASS":"KINETIC GLASS","REBRAND UPDATE":"REBRAND UPDATE","导出日志":"Экспорт журнала","打开悬浮播放器":"Открыть плавающий плеер","返回设置":"Назад к настройкам","清除搜索":"Очистить поиск","收起侧边栏":"Свернуть боковую панель","展开侧边栏":"Развернуть боковую панель","未找到完全匹配，以下为粗略匹配":"Точного совпадения нет. Показаны близкие результаты","未找到匹配结果":"Совпадений нет","无法打开悬浮播放器":"Не удалось открыть плавающий плеер","当前浏览器或页面环境暂不支持传统视频画中画。":"Текущий браузер или окружение страницы не поддерживает классический режим «картинка в картинке».","知道了":"Понятно",
    "音乐库数据":"Данные медиатеки","重新扫描歌曲库":"Повторно сканировать медиатеку","重新扫描歌曲库？":"Повторно сканировать медиатеку?","取消":"Отмена","开始扫描":"Начать сканирование","精选字体":"Подборка шрифтов","未知艺人":"Неизвестный исполнитель","未知":"Неизвестно","计算中…":"Вычисление…","解码中…":"Декодирование…","单声道":"Моно","立体声":"Стерео","版本列表":"Список версий",
    "选择 Glass Player 的界面语言。":"Выберите язык интерфейса Glass Player.","在浅色、深色或根据时间自动切换。":"Выберите светлую, тёмную тему или автоматический режим.","选择界面使用的 Accent 颜色。":"Выберите цвет акцента интерфейса.","灵动光晕、封面取色或封面虚化。":"Динамическое свечение, цвет или размытие обложки.","调整界面字体的大小。":"Настройте размер шрифта интерфейса.","在可读性和信息密度之间调整。":"Баланс читаемости и плотности информации.","音效与空间音频":"Звук и пространственное аудио","空间音效":"Пространственный звук","自动响度均衡":"Автоматический баланс громкости","了解响度均衡":"О балансе громкости","桌面音响":"Настольные колонки","监听音箱":"Студийные мониторы","宽阔舞台":"Широкая сцена","环绕音":"Орбита","前置双耳":"Фронтальный бинауральный","现场大厅":"Живой зал","影院":"Кинотеатр","梦境":"Сновидение"
  };
  
  


  Object.assign(UI_RU,{"常规":"Обычный","中等":"Средний","半粗":"Полужирный","特粗":"Тяжёлый","运行身份":"Идентичность среды","架构":"Архитектура","引擎":"Движки","数据安全":"Безопасность кэша","本地单一运行时；设置不新增状态，音频分析与听歌历史继续使用现有缓存边界。":"Один локальный runtime; настройки не добавляют состояние, а анализ и история прослушивания сохраняют прежние границы кэша.","默认音乐文件夹":"Папка музыки по умолчанию","选择文件夹":"Выбрать папку","选择后，打开 HTML 时会自动导入这个文件夹中的音乐；浏览器可能要求重新授权。":"После выбора музыка из этой папки будет импортироваться при открытии HTML; браузер может запросить разрешение снова.","已保存默认文件夹，下次打开会自动导入音乐。":"Папка по умолчанию сохранена. Музыка импортируется при следующем открытии.","默认文件夹已选择；本次找到 {count} 个音频文件。":"Папка выбрана; найдено аудиофайлов: {count}.","默认文件夹中没有找到音频文件。":"В папке по умолчанию аудиофайлы не найдены.","当前浏览器不支持自动记住文件夹；请每次使用添加文件夹。":"Этот браузер не поддерживает запоминание папки; каждый раз используйте «Добавить папку»."});
  Object.assign(UI_EN,{"年度报告":"Annual Report","无损":"Lossless","播放全部":"Play All","新建歌单":"New Playlist","新建歌单…":"New Playlist…","新建歌单名称":"New playlist name","重命名":"Rename","删除歌单":"Delete playlist","未命名歌单":"Untitled Playlist","歌单：全部歌曲":"Playlists: All Songs","还没有自建歌单，先去歌单里新建一个吧":"No custom playlists yet — create one from Playlists","下载报告":"Download Report","高刷新率流动视觉":"Fluid 120Hz Motion","平滑连续播放":"Seamless Continuous Playback","按键播控":"Keyboard Controls","重置界面偏好":"Reset Interface Preferences","恢复默认":"Restore Defaults","已恢复默认设置":"Settings restored to defaults"});
  Object.assign(UI_RU,{"年度报告":"Годовой отчёт","无损":"Лосслесс","播放全部":"Играть всё","新建歌单":"Новый плейлист","新建歌单…":"Новый плейлист…","新建歌单名称":"Название нового плейлиста","重命名":"Переименовать","删除歌单":"Удалить плейлист","未命名歌单":"Плейлист без названия","歌单：全部歌曲":"Плейлисты: вся музыка","还没有自建歌单，先去歌单里新建一个吧":"Пока нет своих плейлистов — создайте его в разделе «Плейлисты»","下载报告":"Скачать отчёт","高刷新率流动视觉":"Плавная визуализация 120 Гц","平滑连续播放":"Бесшовное воспроизведение","按键播控":"Управление с клавиатуры","重置界面偏好":"Сброс настроек интерфейса","恢复默认":"По умолчанию","已恢复默认设置":"Настройки сброшены по умолчанию"});
  const i18nTextOriginal=new WeakMap();
  const i18nAttrOriginal=new WeakMap();
  function translatedValue(key){if(uiLanguage==="zh")return key;const dictionary=uiLanguage==="ru"?UI_RU:UI_EN;return dictionary[key]||UI_EN[key]||key;}
  function tr(zh,en){return uiLanguage==="zh"?zh:uiLanguage==="ru"?(UI_RU[zh]||en):en;}
  function translateTree(root){
    if(!root)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){return /\S/.test(node.nodeValue||"")&&!["SCRIPT","STYLE"].includes(node.parentElement?.tagName)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}});
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(node=>{if(!i18nTextOriginal.has(node))i18nTextOriginal.set(node,node.nodeValue);const original=i18nTextOriginal.get(node),key=original.trim(),replacement=translatedValue(key);if(uiLanguage!=="zh"&&replacement)node.nodeValue=original.replace(key,replacement);else node.nodeValue=original;});
    root.querySelectorAll?.("[placeholder],[title],[aria-label]").forEach(el=>{
      if(!i18nAttrOriginal.has(el))i18nAttrOriginal.set(el,{placeholder:el.getAttribute("placeholder"),title:el.getAttribute("title"),aria:el.getAttribute("aria-label")});
      const values=i18nAttrOriginal.get(el);[["placeholder",values.placeholder],["title",values.title],["aria-label",values.aria]].forEach(([attr,value])=>{if(value!==null)el.setAttribute(attr,uiLanguage==="zh"?value:translatedValue(value));});
    });
  }
  function applyLanguage(){
    document.documentElement.lang=uiLanguage==="en"?"en":uiLanguage==="ru"?"ru":"zh-CN";
    $$("#languageSeg button").forEach(button=>button.classList.toggle("active",button.dataset.lang===uiLanguage));
    if(typeof render==="function")render(searchInputSafe());
    if(typeof syncSortUI==="function")syncSortUI();
    if(typeof renderMiniQueue==="function")renderMiniQueue();
    GP.changelog?.render?.();
    if(typeof renderHistory==="function")renderHistory();
    if(typeof updateTrackInfoCard==="function"&&currentIndex>=0)updateTrackInfoCard(playlist[currentIndex]);
    GP.i18n.translateTree(document.body);
    if(typeof setEQPresetLabel==="function")setEQPresetLabel(eqPresetKey);
    if(typeof renderSpatialInfo==="function")renderSpatialInfo();
    if(typeof renderLoudnessInfo==="function")renderLoudnessInfo();
    if(typeof syncTraditionalPiP==="function")syncTraditionalPiP(true);
    if(currentIndex===-1){setNowPlayingTitle(tr("未选择歌曲","No Song Selected"));$("#nowArtist").textContent=tr("拖入或导入音乐开始播放","Drop or import music to begin");}
    if(typeof syncTypographyLanguage==="function")syncTypographyLanguage();
    if(typeof syncTypographyPreviewLayout==="function")syncTypographyPreviewLayout();
    if(typeof renderAboutRuntimeInfo==="function")renderAboutRuntimeInfo();
    if(typeof syncEQGeometry==="function")syncEQGeometry();
    if(typeof syncSpatialModeGeometry==="function")syncSpatialModeGeometry();
    if(typeof syncTitleLanguage==="function")syncTitleLanguage();
  }
    function getLanguage(){return uiLanguage;}
    function setLanguage(value){uiLanguage=value==="en"?"en":value==="ru"?"ru":"zh";applyLanguage();}
    return Object.freeze({tr,translateTree,applyLanguage,getLanguage,setLanguage});
  })();
  const tr=(...args)=>GP.i18n.tr(...args);
  const applyLanguage=(...args)=>GP.i18n.applyLanguage(...args);
  GP.changelog = (() => {
  const RELEASES = [
    {
      version:"Unreleased", date:"待定", kind:"ideas",
      summary:"GP Gen 8–9+ 产品路线：继续完善基于缓存声学特征的推荐体验；Electron Lake 与 EXE 迁移正式顺延至 Gen 9+。",
      sections:[
        {title:"Gen 8 — Recommendation Quality",items:[
          "继续用缓存的 MFCC、BPM 与离线风格关系优化每日推荐与随机播放的连贯性，同时保留新鲜度、多样性与随机性。",
          "MFCC、BPM 与分析结果继续写入 IndexedDB，歌曲未变化时不重复分析。"
        ]},
        {title:"Gen 9+ — Electron Lake",items:[
          "Electron Lake、SQLite和从单文件HTML迁移为桌面EXE的计划由原Gen 5+正式推迟至Gen 9及以后。",
          "届时仍保持 Core / UI / Storage 边界，以 storage/sqlite.js 替换 storage/indexeddb.js，避免重写播放器界面、Neural模型和上层业务。"
        ]}
      ]
    },
    {
      version:"7.6.2", date:"2026-10-16", kind:"patch",
      summary:"REBRAND UPDATE：GP Bionic Engine 1.0 正式登场，统一曲目识别、声学分析、听歌建模与播放队列流程，引擎标识全面焕新。",
      sections:[
        {title:"引擎身份",items:["GP Bionic Engine 1.0 — Intelligence Core 统一负责曲目识别、声学频谱分析、听歌 DNA 建模与播放队列流程。","设置「关于」页的构建卡展示全新引擎阵容，引擎列表改为逐行排版。"]},
        {title:"听歌记录",items:["窗口变窄时，排行榜合并为单个 Top 50 长列表，前三名的领奖台封面随宽度平滑缩放，不再重叠。","听歌时间范围与「听歌时间 / 最近最爱 / 听歌数据」切换并排在同一行，顶部布局更紧凑。"]},
        {title:"稳定性",items:["本次更新仅调整引擎归属与命名，识别、分析、均衡器与空间音频的实际行为保持不变。","全部缓存、Spectrum ID、听歌历史与用户数据原样保留。"]}
      ],english:{summary:"REBRAND UPDATE debuts GP Bionic Engine 1.0, unifying track recognition, acoustic analysis, listening modeling and queue flow under a refreshed engine identity.",sections:[
        {title:"Engine Identity",items:["GP Bionic Engine 1.0 — Intelligence Core unifies track recognition, acoustic spectrum analysis, Listening DNA modeling and queue flow.","The Settings About build card presents the refreshed engine lineup, with each engine listed on its own line."]},
        {title:"Listening History",items:["In narrow windows the ranking merges into a single Top 50 list, and podium covers scale smoothly with the width instead of overlapping.","The listening-time range and the Listening Time / Recent Favorites / Listening Data switch now share one row."]},
        {title:"Stability",items:["This update only reassigns and renames engines; recognition, analysis, equalizer and spatial behavior stay unchanged.","All caches, Spectrum IDs, listening history and user data remain intact."]}
      ]}
    },
    {
      version:"7.6.1", date:"2026-10-13", kind:"patch",
      summary:"HOTFIX BUILD：窗口宽度过窄时自动收起侧边栏，恢复宽度后回到已保存的侧边栏状态。",
      sections:[
        {title:"响应式布局",items:["窗口宽度过窄时，侧边栏默认收起，为主要内容保留可用空间；恢复宽度后继续遵循已保存的侧边栏偏好。"]}
      ],english:{summary:"HOTFIX BUILD collapses the Sidebar only when the window becomes too narrow, then restores the saved Sidebar preference when the width recovers.",sections:[
        {title:"Responsive Layout",items:["Narrow windows start with the Sidebar collapsed so the primary content keeps its working space; returning to a wider window restores the saved Sidebar preference."]}
      ]}
    },
    {
      version:"7.6.0", date:"2026-10-05", kind:"minor",
      summary:"KINETIC GLASS：修复启动闪白、封面生命周期、播放动效、收藏识别与悬浮播放器空闲状态，并更新 GP Core 4.3、GP Fusion Engine 4.2 与 GP Motion Engine 4.2。",
      sections:[
        {title:"启动与动效",items:["启动阶段先应用已保存的主题与强调色，消除首次绘制的白蓝闪烁。","播放器与画廊动效只在可见且需要时运行，暂停、切换视图与隐藏页面后不会继续空转。"]},
        {title:"封面与悬浮播放器",items:["重扫或替换歌曲封面时保留仍被界面、过渡副本或悬浮播放器使用的 Blob URL，避免旧封面提前失效。","播放空闲时暂停传统悬浮播放器的封面动效，恢复播放后继续同步。"]},
        {title:"收藏与识别",items:["收藏和歌单匹配继续使用稳定音频识别字段，识别刷新后的标题或艺人变化不会串联到另一首歌。"]}
      ],english:{summary:"KINETIC GLASS keeps startup, artwork, motion, favorites, and PiP stable through rapid view and metadata changes.",sections:[
        {title:"Startup and Motion",items:["Saved theme and accent settings are applied before the first paint, removing the startup white-blue flash.","Player and artwork motion runs only while visible and needed, so hidden or paused views do not keep spinning."]},
        {title:"Artwork and PiP",items:["Rescans and artwork replacement retain Blob URLs still used by the interface, transitions, or PiP instead of revoking live covers.","Traditional PiP artwork motion pauses while playback is idle and resumes with playback."]},
        {title:"Favorites and Recognition",items:["Favorites and playlist membership continue to use stable audio recognition fields, so metadata refreshes do not cross-link different recordings."]}
      ]}
    },
    {
      version:"7.5.1", date:"2026-10-02", kind:"patch",
      summary:"HOTFIX BUILD：全面重做独立年度报告长卷，修复听歌时间选择栏底色，完善字体弹窗尺寸并解决歌曲名居中与无损标识排版。",
      sections:[
        {title:"年度报告",items:["完全重做可下载的独立 HTML 年度报告，带来深邃星空与极光氛围的长卷体验、随滚动位移与渐入的章节动画、昼夜时钟、发烧音质档案与本地隐私认证。","在任何设备离线打开，支持打印与保存。"]},
        {title:"听歌记录与播放器",items:["听歌记录右上角时间段选择栏移除多余底色与阴影，恢复与其他分段控件一致的纯净设计。","重构歌曲标题排版：无论歌名长短均精准视觉居中，FLAC 无损徽标紧随右侧且绝不折叠丢失标题。"]},
        {title:"设置与字体",items:["优化字体选择弹窗尺寸，压缩选项高度并消除多余滚动条，无需滚动即可直接浏览与选择全部字体。","高级设置与播放设置新增高刷新率流动视觉、平滑连续播放与键盘播控开关，数据设置增加恢复默认偏好选项。"]}
      ],english:{summary:"HOTFIX BUILD completely redesigns the standalone Annual Report scroll, removes History range selector background, compacts font picker popup, and fixes centered player title and lossless badge geometry.",sections:[
        {title:"Annual Report",items:["Completely redesigned downloadable HTML annual report with cinematic obsidian and aurora aesthetic, scroll-linked parallax, circadian clock, audiophile DNA, and local privacy seal.","Opens fully offline on any device with print and save support."]},
        {title:"Listening History and Player",items:["Removed extraneous background and drop shadow from the History view range selector, matching shared segmented control aesthetics.","Song title row maintains optical centering across all lengths, keeping the FLAC lossless badge directly adjacent without title collapsing."]},
        {title:"Settings and Typography",items:["Compacted font picker dropdown row heights and container bounds, eliminating awkward scrollbars so all fonts are instantly visible.","Added fluid 120Hz motion, continuous playback, and keyboard controls toggles, plus a reset preferences action."]}
      ]}
    },
    {
      version:"7.5.0", date:"2026-10-02", kind:"minor",
      summary:"REPLAY ATLAS：带来全新章节式年度音乐报告，全面重构中文字体衬线与等宽回退栈，并优化播放标题与设置排版。",
      sections:[
        {title:"年度报告",items:["年度报告新增年度总览、收听节奏、季度与月度变化、重复播放、艺人/专辑/风格版图、Top 12 与本地隐私说明。","下载报告保留独立打开的 HTML，并加入随滚动进入与位移的章节故事长卷。"]},
        {title:"字体与排版",items:["全面支持中文字体衬线回退，选择 New York（衬线）时中文字体正确匹配宋体/明体，不再被无衬线黑体截断。","根据字体家族（衬线、等宽、无衬线）按语言精准匹配回退栈，补齐 Windows 与 macOS 下的中西文字体渲染。"]},
        {title:"播放器与设置",items:["FLAC 无损徽标紧随歌曲名右侧，歌曲名严格保持整行居中且不会折叠隐藏。","听歌记录标题与时间范围控件根据实际渲染背景自适应对比度，修复设置界面居中对齐。"]},
        {title:"引擎身份",items:["Glass Player Gen 7 进入 Replay Atlas 版本；Atlas Runtime、Playlist Flow、Story Scroll、Room、Signal 与 Listening DNA 成为当前引擎显示名。"]}
      ],english:{summary:"REPLAY ATLAS brings a chaptered Annual Report story scroll, complete serif and monospace CJK font fallback stacks, and centered player title and settings layout.",sections:[
        {title:"Annual Report",items:["Annual Report gains totals, listening rhythm, seasonal and monthly change, repeat plays, artist/album/genre maps, Top 12 and a local privacy note.","The standalone HTML download remains self-contained and presents a smooth chaptered story scroll."]},
        {title:"Typography and Fonts",items:["Comprehensive CJK serif fallback: selecting New York (serif) now renders Chinese glyphs with Songti/SimSun serif typefaces rather than falling back to sans-serif.","Language-aware font fallbacks correctly distinguish serif, monospace, and sans-serif stacks on Windows and macOS."]},
        {title:"Player and Settings",items:["The FLAC lossless badge sits adjacent to the song title while the title remains strictly centered without collapsing.","Listening History title and range controls adapt contrast to the rendered background, and Settings view centers properly."]},
        {title:"Engine Identity",items:["Glass Player Gen 7 enters the Replay Atlas release; Atlas Runtime, Playlist Flow, Story Scroll, Room, Signal and Listening DNA are the current engine display names."]}
      ]}
    },
    {
      version:"7.4.3", date:"2026-09-27", kind:"patch",
      summary:"HOTFIX BUILD：继续修复播放队列、旧听歌记录、年度报告、设置恢复与后台音频分析的一致性。",
      sections:[
        {title:"播放与曲库",items:["播放歌单时，首曲不会再次留在待播队列中；已有待播歌曲保留顺序。","清除搜索后不再记录过时的搜索行为；后台分析复用播放器的音频资源，不会恢复已挂起的播放。"]},
        {title:"听歌历史与年度报告",items:["全部时间排行保留旧记录中没有日期的听歌时长，按日期筛选仍只统计有日期的记录。","年度报告的五张摘要卡在宽屏上保持一行，报告滚动条使用现有的滚动显示样式。"]},
        {title:"设置与语言",items:["无效的已保存播放模式回到顺序播放，避免启动中断。","切换语言时，响度说明同步更新。"]}
      ],english:{summary:"HOTFIX BUILD continues the consistency fixes for playlist playback, legacy listening totals, Annual Report layout, restored settings and background audio analysis.",sections:[
        {title:"Playback and Library",items:["Starting a playlist no longer leaves its first song queued to play again; existing queued songs retain their order.","Cleared searches no longer record stale search activity. Background analysis reuses the player's audio resources without resuming a suspended context."]},
        {title:"History and Annual Report",items:["All-time rankings retain undated listening time from older records; calendar ranges still include dated records only.","The five Annual Report summary cards share one row on wide screens, and the report uses the existing scroll-triggered scrollbar style."]},
        {title:"Settings and Language",items:["Invalid saved playback modes fall back to Sequential instead of interrupting startup.","Loudness information updates when the interface language changes."]}
      ]}
    },
    {
      version:"7.4.2", date:"2026-09-26", kind:"patch",
      summary:"HOTFIX BUILD：修复歌单首曲重复、旧听歌记录统计、年度报告布局与设置恢复，并减少后台音频分析的资源占用。",
      sections:[
        {title:"播放与曲库",items:["播放歌单时，首曲不会再次留在待播队列中；已有待播歌曲保留顺序。","清除搜索后不再记录过时的搜索行为；后台分析复用播放器的音频资源，不会恢复已挂起的播放。"]},
        {title:"听歌历史与年度报告",items:["全部时间排行保留旧记录中没有日期的听歌时长，按日期筛选仍只统计有日期的记录。","年度报告的五张摘要卡在宽屏上保持一行，报告滚动条使用现有的滚动显示样式。"]},
        {title:"设置与语言",items:["无效的已保存播放模式回到顺序播放，避免启动中断。","切换语言时，响度说明同步更新。"]}
      ],english:{summary:"HOTFIX BUILD fixes repeated playlist starts, legacy listening totals, Annual Report layout and restored settings, while reducing background audio-analysis resources.",sections:[
        {title:"Playback and Library",items:["Starting a playlist no longer leaves its first song queued to play again; existing queued songs retain their order.","Cleared searches no longer record stale search activity. Background analysis reuses the player's audio resources without resuming a suspended context."]},
        {title:"History and Annual Report",items:["All-time rankings retain undated listening time from older records; calendar ranges still include dated records only.","The five Annual Report summary cards share one row on wide screens, and the report uses the existing scroll-triggered scrollbar style."]},
        {title:"Settings and Language",items:["Invalid saved playback modes fall back to Sequential instead of interrupting startup.","Loudness information updates when the interface language changes."]}
      ]}
    },
    {
      version:"7.4.1", date:"2026-09-26", kind:"patch",
      summary:"HOTFIX BUILD：修复曲库空状态、年度报告语言、播放结束处理与设置一致性，让空状态、报告内容与播放反馈更容易读懂。",
      sections:[
        {title:"曲库与年度报告",items:["空的我喜欢和自建歌单现在会显示明确的空状态，搜索无结果仍保留自己的提示。","年度报告的导出页面会跟随界面语言，并在歌曲资料更新后显示最新的歌曲与艺人信息；条形图、Top 10 和窄屏卡片保持可读。"]},
        {title:"播放器",items:["歌曲自然播完时，播放界面会继续进入下一首，不会因结束瞬间的状态切换停在原地。","离开播放器后，唱片旋转不会继续占用页面动画帧。"]},
        {title:"设置与语言",items:["俄语界面不再混入中文空间音频说明；播放模式和排序标签保持一致。","异常的已保存外观选项会回到可用的默认值，避免设置页出现空选中状态；默认文件夹提示可见，均衡器尺寸与设置布局一致。"]}
      ],english:{summary:"HOTFIX BUILD fixes Library empty states, Annual Report language, track endings and Settings consistency so empty states, exports and playback feedback stay clear.",sections:[
        {title:"Library and Annual Report",items:["Empty Liked and custom playlists now explain their state clearly, while search no-match feedback remains separate.","Annual Report exports follow the interface language and show refreshed song and artist metadata after a library rescan; bars, Top 10 rows and narrow cards stay readable."]},
        {title:"Player",items:["Natural track endings continue into the next song instead of stopping during the end-state transition.","Disc rotation stops scheduling frames while the Player view is hidden."]},
        {title:"Settings and Language",items:["Russian Settings no longer mixes Chinese spatial-audio copy into the page; playback-mode and sort labels stay consistent.","Invalid saved appearance choices return to supported defaults instead of leaving Settings with no active option; folder status and EQ geometry remain visible and aligned."]}
      ]}
    },
    {
      version:"7.4.0", date:"2026-09-18", kind:"minor",
      summary:"典藏更新：自建歌单与我喜欢收藏上线，听歌记录右下角加入年度报告，播放界面为无损格式加上标识，并修复字体切换问题。",
      sections:[
        {title:"歌单与喜欢",items:["曲库工具栏新增歌单切换，可以新建、重命名、删除自建歌单，把歌曲加入歌单或从歌单移除，并在歌单内按顺序连续播放。","每首歌新增爱心按钮，喜欢会同时教会 Resonance Boost 你的偏好；喜欢的歌曲自动收进我喜欢。"]},
        {title:"年度报告",items:["听歌记录右下角新增年度报告按钮，每年 12 月 31 日至次年 1 月 14 日自动弹出当年报告。","往年报告随时可以查看，并能下载为可交互的独立 HTML 文件；年份会自动往前迭代。"]},
        {title:"播放与字体",items:["播放界面在 FLAC 歌曲标题同行显示无损小徽标，其他格式保持原样。","字体选择器会标出系统未安装的字体，切换到缺失字体时会有回退提示，不再静默没有变化。"]},
        {title:"引擎版本",items:["GP Core 4.2、GP Fusion Engine 4.1、GP Motion Engine 4.1、GP Spatial Engine 1.1、GP Spectrum Engine 2.3 与 GP Neural Engine 2.2 保持不变。"]}
      ],english:{summary:"COLLECTION UPDATE adds user playlists with likes, a yearly report in Listening History, a lossless badge on the Player and font-switch feedback.",sections:[
        {title:"Playlists and Likes",items:["The Library toolbar gains a playlist switcher: create, rename and delete custom playlists, add songs or remove them, and play straight through a playlist in order.","Every song gains a like button; likes also teach Resonance Boost your taste, and liked songs collect under Liked automatically."]},
        {title:"Annual Report",items:["Listening History gains an annual-report button at the bottom right; each year's report opens automatically from December 31 through January 14.","Past yearly reports stay viewable any time and download as an interactive standalone HTML file; years roll forward automatically."]},
        {title:"Playback and Typography",items:["The Player shows a small inline lossless badge on the FLAC song title row and stays unchanged for other formats.","The font picker marks families your system has not installed, and switching to a missing font shows a fallback notice instead of silently changing nothing."]},
        {title:"Engine Versions",items:["GP Core 4.2, GP Fusion Engine 4.1, GP Motion Engine 4.1, GP Spatial Engine 1.1, GP Spectrum Engine 2.3 and GP Neural Engine 2.2 remain unchanged."]}
      ]}
    },
    {
      version:"7.3.2", date:"2026-09-17", kind:"patch",
      summary:"STABILITY UPDATE：移除音乐银河产品线，修复播完自动暂停与导入后切歌问题，并让大批量导入先关闭对话框、后台继续补齐音频特征。",
      sections:[
        {title:"音乐银河移除",items:["导航与主界面不再提供音乐银河入口；已导入歌曲、听歌记录、用户偏好与缓存分析不受影响。","每日推荐改用本地缓存特征与离线风格关系计算相似度，不再依赖银河服务。"]},
        {title:"播放稳定性",items:["修复歌曲自然播完被误判为手动暂停导致停住的问题，播完会自动进入下一首。","播放结束状态下的播放/暂停切换只需要一次操作；跨淡入与空歌单的越界保护补齐，切歌失败不再静默卡住。"]},
        {title:"导入速度",items:["导入对话框在歌曲入库、列表渲染与推荐生成完成后即关闭，音频特征分析转入后台继续补齐并自动刷新相关界面。","同一歌曲的时长、封面与信息读取改为并行，数据物化并发提升，导入等待中的空转让步减少，固定收尾等待改为绘制提交确认。"]},
        {title:"引擎版本",items:["GP Core 更新至 4.2，GP Fusion Engine 更新至 4.1；GP Motion Engine 4.1、GP Spatial Engine 1.1、GP Spectrum Engine 2.3 与 GP Neural Engine 2.2 保持不变。"]}
      ],english:{summary:"STABILITY UPDATE removes Music Galaxy, fixes end-of-track auto-pause and post-import track switching, and lets large imports close the dialog first while audio analysis continues in the background.",sections:[
        {title:"Music Galaxy Removal",items:["The navigation and main area no longer offer a Music Galaxy entry; imported songs, listening history, user preference and cached analysis are unaffected.","Daily Mix now computes similarity from local cached features and offline genre relations without the Galaxy service."]},
        {title:"Playback Stability",items:["Fixed tracks stalling at the end because a natural finish was mistaken for a manual pause; playback now advances automatically.","Toggling play after a track ends takes one action; crossfade and empty-library guards are completed so failed switches no longer stall silently."]},
        {title:"Import Speed",items:["The import dialog closes once songs are stored, lists rendered and recommendations generated, while audio feature analysis continues in the background and refreshes the affected views automatically.","Duration, artwork and metadata reads for the same song now run in parallel with higher materialization concurrency, fewer idle yields while importing, and paint-confirmed completion instead of a fixed wait."]},
        {title:"Engine Versions",items:["GP Core advances to 4.2 and GP Fusion Engine to 4.1; GP Motion Engine 4.1, GP Spatial Engine 1.1, GP Spectrum Engine 2.3 and GP Neural Engine 2.2 remain unchanged."]}
      ]}
    },
    {
      version:"7.3.1", date:"2026-08-25", kind:"patch",
      summary:"GALAXY UPDATE：用音乐银河呈现歌曲间的音色、节奏与风格关系，并让每日推荐复用同一套相似度判断。",
      sections:[
        {title:"音乐银河",items:["歌曲会按已有的 MFCC 音色与 BPM 速度关系排列为可浏览的音乐星图，并用风格标签帮助辨认不同区域；窗口大小变化、缩放与拖动会保持地图可读。"]},
        {title:"星点与交互",items:["星点会随歌曲资料完整度呈现层次；悬停或点击只显示歌曲名称，密集歌曲会降低光污染并分开区域标签，快速移动指针时会暂缓识别以保持顺滑。"]},
        {title:"MFCC、BPM 与每日推荐",items:["音乐银河与每日推荐共用缓存的 MFCC、BPM 与风格相似度，在保持连贯的同时继续兼顾新鲜度与艺人多样性。","导入时会优先复用已有分析，并把 Resonance Boost 与每日推荐按批次完成，减少等待。"]},
        {title:"设置与可读性",items:["字体示例置于顶部并保持居中，英文与俄语使用对应的字体角色；默认音乐文件夹、About、EQ、Spatial Audio 与文件信息都更易读。"]},
        {title:"引擎版本",items:["GP Fusion Engine 更新至 4.0，GP Spectrum Engine 更新至 2.3，GP Neural Engine 更新至 2.2；GP Core 4.1、GP Motion Engine 4.1 与 GP Spatial Engine 1.1 保持不变。"]}
      ],english:{summary:"GALAXY UPDATE adds Music Galaxy for exploring acoustic and tempo relationships, with Daily Mix reusing the same similarity model.",sections:[
        {title:"Music Galaxy",items:["Songs form an explorable music map from existing MFCC timbre and BPM relationships, with genre labels identifying each region; resizing, zooming and panning keep the map readable."]},
        {title:"Stars and Interaction",items:["Stars reflect feature completeness; hover or click shows only the song title, while dense libraries reduce glow pollution and separate region labels. Fast pointer movement pauses identification to keep interaction smooth."]},
        {title:"MFCC, BPM and Daily Mix",items:["Music Galaxy and Daily Mix share cached MFCC, BPM and genre similarity while continuing to balance coherence, freshness and artist diversity.","Existing analysis is reused, and Resonance Boost plus Daily Mix complete in import batches to reduce waiting."]},
        {title:"Settings and Readability",items:["The font sample is centered at the top, English and Russian use matching font roles, and Default Music Folder, About, EQ, Spatial Audio and file information are easier to read."]},
        {title:"Engine Versions",items:["GP Fusion Engine advances to 4.0, GP Spectrum Engine to 2.3 and GP Neural Engine to 2.2; GP Core 4.1, GP Motion Engine 4.1 and GP Spatial Engine 1.1 remain unchanged."]}
      ]}
    },
    {
      version:"7.3.0", date:"2026-08-23", kind:"minor",
       summary:"HOTFIX BUILD：改善环绕音清晰度、推歌多样性、滚动条触发、EQ 调整、背景切换与歌曲库高清封面。",
      sections:[
        {title:"空间音频",items:["重新平衡环绕音的直达声与双耳空间声，减少 Orbit 模式的闷感，让人声、鼓点和高频细节更清楚。"]},
        {title:"推歌与每日推荐",items:["降低相似度权重过度集中的情况，并对近期播放歌曲、上一次推荐结果和重复艺人加入冷却，减少连续听到同一首歌或同一艺人的情况。"]},
        {title:"控制与交互",items:["滚动条只在真实的滚轮、触控、键盘滚动或滚动条拖动后短暂显示；鼠标移动不会再触发滚动条。","EQ 曲线使用非线性 dB 调整，小幅修改获得更细的垂直控制，大幅调整不需要拖动很长距离，并保留 0.5 dB 步进。"]},
         {title:"背景切换",items:["切换背景形式时，目标画布与过渡颜色在同一呈现时刻提交，减少闪烁。"]},
        {title:"歌曲库与封面",items:["Grid 宽屏布局恢复每行 7 张卡片，并优先使用原始高清 coverUrl；紧凑列表继续使用缩略图，避免把小图放大成歌曲库主封面。"]}
       ],english:{summary:"HOTFIX BUILD improves spatial clarity, recommendation variety, scroll intent, EQ control, ambient transitions and Library artwork.",sections:[
        {title:"Spatial Audio",items:["Orbit rebalances direct and binaural spatial signal so vocals, drums and upper detail sound clearer instead of muffled."]},
        {title:"Daily Mix and Recommendations",items:["Similarity no longer concentrates the list as sharply; recently played tracks, the previous mix and repeated artists now receive cooldowns to reduce consecutive song and artist repeats."]},
        {title:"Controls and Interaction",items:["Scrollbars appear briefly only after wheel, touch, keyboard or scrollbar-drag intent; pointer movement alone no longer reveals them.","EQ dB control now follows a nonlinear curve for finer small adjustments and shorter large adjustments while keeping 0.5 dB steps."]},
         {title:"Ambient Transitions",items:["The destination canvas and transition bridge color commit in the same presentation frame when the background mode changes, reducing flashes."]},
        {title:"Library and Artwork",items:["Wide Grid restores seven cards per row and prefers the original high-resolution coverUrl; compact lists continue to use thumbnails instead of enlarging a small image."]}
      ]}
    },
    {
      version:"7.2.2", date:"2026-08-19", kind:"patch",
      summary:"HOTFIX BUILD：修复窗口最小化后导入停滞、每日推荐生成阶段旋转图标卡顿，以及非系统盘文件夹导入速度过慢；继续在 7.2.2 中统一 1360px 界面宽度、加入俄语、移除歌单筛选、固定字体行高并强化背景效果。",
      sections:[
        {title:"导入稳定性",items:["导入和前台音频分析在窗口隐藏或最小化时改用安全的定时让步，不再永久等待暂停的绘制帧。","识别、封面和 metadata 探针复用按文件缓存的前缀与对齐读取块，减少非 C 盘或慢速存储上的串行小读取；Spectrum ID、缓存身份和音频文件保持不变。"]},
        {title:"每日推荐与导航",items:["每日推荐候选评分按耗时切片并主动让出输入，生成阶段的旋转图标保持连续；推荐行改为播放队列式紧凑信息。","设置分类侧栏接入共享选中滑块并与主侧栏保持同一设计语言；更新日志保留 Gen → 次版本 → 补丁版本层级，但不再显示版本叶子的侧栏遮罩。"]},
        {title:"界面与滚动",items:["播放、歌曲库、听歌记录、音乐银河、设置和更新日志统一使用 1360px 居中宽度；播放器在主界面中获得更宽比例。","歌单保留宽横条列表与 Grid 视图，移除筛选按钮；宽屏 Grid 目标为每行约 7 张卡片，听歌记录 Top 1–10 与 11–50 左右两栏独立滚动，滚动条只在实际滚动后显示。"]},
        {title:"语言与字体",items:["界面语言加入俄语；俄语动态内容使用英文安全回退，不混入中文说明。","字体选择行以中文高度为基准，切换字体时保持行高不变；非 Apple 字体继续使用单一字体栈，Apple 字体按 SF Pro Display、SF Pro Text、PingFang 和 SF Mono 的角色分配。","隐藏非必要小字说明，同时保留歌曲标题、艺人、时长和可操作控件。"]},
        {title:"背景效果",items:["灵动光晕继续使用主题色，封面取色使用当前封面主色，封面虚化使用低频模糊封面；三种模式强化后仍保持不同来源。"]},
        {title:"悬浮窗与选中态",items:["悬浮播放器开启时使用更清晰的主题色边框与外沿提示，画中画视觉刷新降为 30Hz，不影响播放进度、拖拽或页面滚动。","设置侧栏点击不再显示额外光晕；更新日志选中版本取消背景遮罩。","暂停后切换主界面时，延迟到达的 timeupdate/ended 事件不再触发自动跨 fade 或续播，保持用户的暂停意图。"]}
      ],english:{summary:"HOTFIX BUILD keeps imports moving after minimize, reduces Daily Mix spinner jank, speeds folder imports from slow or non-system drives, and continues 7.2.2 with a shared 1360px canvas, Russian UI, no Library filter, fixed font-picker rows, stronger distinct ambient modes and preserved pause intent across view changes.",sections:[
        {title:"Import Reliability",items:["Import and foreground audio analysis use a timer-safe cooperative yield when the document is hidden or minimized instead of waiting forever for a paused paint frame.","Recognition, artwork and metadata probes reuse per-file prefix and aligned-range reads, reducing serial small I/O on slow or non-system storage without changing Spectrum ID, cache identity or audio files."]},
        {title:"Daily Mix and Navigation",items:["Daily Mix candidate scoring is time-sliced and yields to input so the spinner stays responsive during generation; recommendation rows now use compact Queue-like song information.","Settings categories use the shared selection glider and main-sidebar language; Changelog keeps its Gen → minor → patch hierarchy without a selected leaf mask."]},
        {title:"Interface and Scrolling",items:["Player, Library, Listening History, Music Galaxy, Settings and Changelog share a 1360px centered width, with a wider Player share beside Daily Mix.","Library keeps both the wide horizontal list and Grid views without a filter button; the wide Grid targets about seven cards per row, while History Top 1–10 and ranks 11–50 scroll independently with a thumb that appears only while scrolling."]},
        {title:"Language and Typography",items:["Russian is available beside Chinese and English; dynamic Russian release and analysis copy uses a safe English fallback instead of Chinese.","Font-picker rows use the Chinese line box as the baseline so changing fonts does not change row height; Apple typography keeps role-specific SF Pro Display, SF Pro Text, PingFang and SF Mono assignments.","Nonessential helper microcopy is hidden while song title, artist, duration and actionable controls remain visible."]},
        {title:"Background Effects",items:["Ambient Glow uses the accent palette, Cover Color uses the current cover palette, and Blurred Cover uses a low-frequency blurred cover; the three modes are stronger while remaining distinct."]},
        {title:"Floating Player and Selection",items:["The floating player shows a clearer Accent state and its Picture-in-Picture visual refresh uses 30Hz without lowering playback progress, dragging or page scrolling.","Settings sidebar clicks no longer add a separate halo, and the selected Changelog version no longer paints a background mask.","Delayed timeupdate and ended callbacks now honor a paused playback intent, so changing views cannot trigger an automatic crossfade or next-track resume."]}
      ]}
    },
    {
      version:"7.2.1", date:"2026-08-16", kind:"patch",
      summary:"HOTFIX BUILD：统一任务栏图标线宽，把完整音效面板移入设置，并重排听歌记录 Top 10 与 11–50 榜单。",
      sections:[
        {title:"任务栏图标",items:["播放器、歌曲库、听歌记录、音乐银河和设置图标统一使用 1.8px 非缩放描边，修复不同图标粗细不一致的问题。"]},
        {title:"设置与音频",items:["移除独立的音效侧栏入口，将 EQ、响度均衡、空间音效和文件信息完整放入设置 > 音频；保留原有控件、音频服务和偏好状态。"]},
        {title:"听歌记录",items:["排行榜改为左侧 Top 1–3 与 4–10、右侧 11–50；左侧不滚动，只有右侧 11–50 列表滚动。","移除听歌记录行内播放次数和 Top 3 解释文字，Top 3 区域改为 Top 10。"]}
      ],english:{summary:"HOTFIX BUILD unifies taskbar icon strokes, moves the complete Sound surface into Settings and rebuilds Listening History around Top 10 plus ranks 11–50.",sections:[
        {title:"Taskbar Icons",items:["Player, Library, Listening History, Music Galaxy and Settings icons now use one 1.8px non-scaling stroke, removing inconsistent visual weight."]},
        {title:"Settings and Audio",items:["The standalone Sound tab is removed. EQ, Loudness, Spatial Audio and Track Information now live together under Settings > Audio while preserving existing controls, audio services and preferences."]},
        {title:"Listening History",items:["The ranking uses a left Top 1–3 plus ranks 4–10 column and a right ranks 11–50 column; only the right column scrolls.","History rows no longer show play counts or the old Top 3 explanation, and the podium section is labeled Top 10."]}
      ]}
    },
    {
      version:"7.2.0", date:"2026-08-16", kind:"minor",
      summary:"VISIONAL UPDATE：重做音乐库、听歌记录与设置的主内容布局，以更紧凑的 7.2 视觉系统呈现歌曲、统计和分类设置。",
      sections:[
        {title:"Library Layout",items:["音乐库改为搜索、筛选、排序、视图与导入工具统一的表格布局，列出序号、封面与歌曲信息、专辑、播放次数、时长和操作。","播放次数直接读取现有听歌历史，不改变 Spectrum ID、播放队列或历史记录。"]},
        {title:"Listening History",items:["听歌记录的主内容限制在 1280px，顶部统计拆成四个小卡片，时间范围选择器移到标题右侧。","排行榜改为左侧 38% 的 Top 3 与右侧 62% 的第 4–10 名紧凑列表，进度条、时长和播放次数贴近歌曲信息。"]},
        {title:"Settings Navigation",items:["设置改为左侧分类导航与右侧单一当前页面；设置项采用名称/说明在左、控件在右的整行布局。","版本卡移入关于，重新扫描歌曲库移入音乐库；保持原有控件、偏好存储和音频服务接口不变。"]},
        {title:"Motion 4.1",items:["本次布局切换使用现有时间驱动的页面与面板动效，不增加固定帧计数循环；GP Core 保持 4.1，Motion Engine 更新为 4.1。"]}
      ],english:{summary:"VISIONAL UPDATE reshapes the Library, Listening History and Settings surfaces into a tighter 7.2 visual system for songs, statistics and category-based settings.",sections:[
        {title:"Library Layout",items:["Library now uses one toolbar for search, filtering, sorting, view and import actions, followed by columns for rank, artwork and song details, album, plays, duration and actions.","Play counts read the existing Listening History without changing Spectrum ID, playback Queue or history records."]},
        {title:"Listening History",items:["Listening History is bounded to 1280px, its hero becomes four compact statistic cards, and range selection moves beside the title.","The ranking becomes a 38% Top 3 column and a 62% compact ranks 4–10 list, keeping progress, duration and plays close to each song."]},
        {title:"Settings Navigation",items:["Settings now uses a left category switcher and one active right-hand page; each setting is a full row with its label and description on the left and control on the right.","The version card moves to About and Rescan Music Library moves to Music Library while existing controls, preference storage and audio service interfaces remain intact."]},
        {title:"Motion 4.1",items:["The layout transitions reuse the existing elapsed-time page and panel motion contract without fixed frame-count loops; GP Core remains 4.1 and Motion Engine advances to 4.1."]}
      ]}
    },
    {
      version:"7.1.1", date:"2026-08-03", kind:"patch",
      summary:"STABILITY UPDATE：修复缩放、搜索、导入、播放队列、日历统计与背景显示，并收紧播放快捷键和更新日志结构。",
      sections:[
        {title:"Responsive UI",items:[
          "Glass Player 品牌名称会检测真实可用宽度；仅在字体或缩放造成裁剪时启动完整往返滚动。侧栏提示图标恢复完整栏时取消易失控的飞行动画。",
          "空间音频选择器在宽度不足时自动换为两行，Glider 继续按真实按钮位置移动；静态非正方形封面改为完整适配，不裁掉原图内容。",
          "所有主页面 Sector 与背景统一增加克制的材质明度差；可滚动区域使用同主题液态玻璃滚动条，滚动停止一秒后淡出。银河占位文字直接采样背后背景自动选择黑白。",
          "浏览器缩放时先在隐藏 Canvas 完成重绘，再无缝替换现有背景，不再通过一次可见的淡入淡出制造重载闪烁。"
        ]},
        {title:"Library & Search",items:[
          "歌曲库与播放队列取消序号。新增歌曲按文件夹路径和文件名归入原始歌曲库位置，同时保持当前歌曲、Queue 与 Shuffle 索引有效。",
          "Fuzzy Search 同时覆盖歌曲、艺人、专辑、Genre、文件名、历史别名、拼音首字母和常见中文音乐词汇的完整拼音、缺字、近似拼写与常见同音字；字段索引缓存并按帧合并输入，扩展匹配不会拖慢键入。无完全匹配时在歌曲 Sector 顶部居中提示并留出结果间距。",
          "新增 ZHAN G1 · B&O 设备 EQ，以温和低频、清晰高频与宽阔声像为方向，不把未经测量的设备曲线伪装成精确校准。"
        ]},
        {title:"Playback & Neural",items:[
          "播放键盘控制现仅保留 Space / F10 播放暂停；取消网页对 F9 与 F11 的检测，上一首和下一首继续由播放器按钮与 Media Session 系统媒体键控制。方向键、WASD 与数字小键盘同样不会触发切歌。",
          "修复新增歌曲重新排序后 currentIndex 漂移和 Blob URL 缺失造成的播放键失效。手动 Queue 结束后从最后一首排队歌曲继续执行当前的顺序、随机或单曲循环逻辑。",
          "Resonance Boost 与每日推荐生成均拆分为协作批次并主动让出输入与绘制帧；导入窗口、按钮与加载环在最终生成阶段继续响应。",
          "手动 Queue 拖拽严格限制在第一首歌曲上方分隔线与 Sector 下边界之间；随机和可拖拽状态使用各自对称网格，删除序号后仍保持视觉居中。手动队列自然播放完毕时会明确通知用户。",
          "睡眠定时开始后，时钟右侧实时显示剩余分钟与秒数。"
        ]},
        {title:"Calendar History & Changelog",items:[
          "今天、本周、本月、本年及其对比全部改用真实日历边界；周一至周日形成固定周，上个月与去年不再等同于过去 30 / 365 天。已结束周的最爱艺人不会继续漂移。",
          "更新日志索引移除日期与滑块，按 Gen → 次版本 → 补丁版本三级展开；容器先平滑腾出空间，内容随后淡入。"
        ]}
      ],english:{summary:"STABILITY UPDATE repairs zoom, search, imports, queue playback, calendar history and background rendering while tightening keyboard transport and the Changelog hierarchy.",sections:[
        {title:"Responsive UI",items:["The brand measures its real width and scrolls only when zoom or typography would clip it. Sidebar hint expansion no longer uses the unstable flight animation.","Spatial Audio wraps to two rows when needed, non-square Static Covers fit without cropping, and every main Sector now uses a theme-specific derived surface: restrained light separation without washing dark mode white.","Settings, Listening Time ranking, Library Search and the EQ surface now target their visible SSE shells instead of hidden inner nodes.","Zoom recomposes the hidden Ambient canvas and swaps it atomically, avoiding a reload-like flash. The liquid scrollbar starts transparent and resolves directly to Accent without a black first frame, while Galaxy text samples its own backdrop for black/white readability."]},
        {title:"Library, Search & Playback",items:["Keyboard transport now keeps only Space/F10 for Play/Pause. Webpage detection of F9 and F11 is removed; Previous and Next remain available through player controls and Media Session system keys. Arrow keys, WASD and the numeric keypad never change tracks.","Library and Queue numbers are removed. New files are placed by path/name while current playback and queue identities remain stable.","Cached Fuzzy Search covers title, artist, album, Genre, filename, aliases, initials, common full Chinese pinyin, omissions, typos and homophones. Its similar-results message now belongs to the top of the results Sector instead of the search field.","ZHAN G1 · B&O adds a conservative warm, clear and broad device EQ; temporary imports and manual-queue completion no longer break playback.","Manual Queue dragging is clamped between the first-row divider and Sector bottom, both queue modes remain visually centered, completion shows a notification, and Snooze displays a live countdown."]},
        {title:"Neural, Calendar & Changelog",items:["Resonance Boost and import-time Daily Mix generation process work in cooperative batches so the interface remains responsive.","History uses real day, Monday-based week, calendar month and calendar year boundaries; completed weekly artist bars stay immutable.","Fuzzy Search places approximate-match guidance lower with result breathing room, while a true no-result state occupies the same centered empty-library position in larger type.","The Changelog index closes faster and opens more deliberately: space expands first, then content fades in.","The default 7.1.1 selection and every clicked x.x.x leaf release use the same glass glider as the main sidebar; hidden-view initialization now waits for measurable layout, the glider fades in, follows live hierarchy reflow and fades out when its branch closes. The two Changelog SSE shells use one shared Sector material layer, matching the contrast of other views. Liquid scrollbars fade 500ms after scrolling stops.","Snooze keeps its selected Accent option, uses tabular fixed-width countdown text, and no longer changes button width as digits change.","Spatial Audio adds Orbit first: a deliberately classic 3D image circles the listener at a fixed rate, isolated from the other stable presets."]}
      ]}
    },
    {
      version:"7.1.0", date:"2026-07-31", kind:"minor",
      summary:"RESIZE UPDATE：统一扩展所有主界面与交互控件，并保持 GP Motion Engine 4.0。",
      sections:[
        {title:"全宽响应式界面",items:[
          "歌曲库、听歌记录、音乐银河、设置与更新日志取消旧的 980 / 1120 px 页面宽度上限，像播放器一样填满主区域左右可用空间。",
          "保留主区域响应式安全边距、圆角、SSE、Edge 110% 缩放和窄窗口整体适配，不把 Sector 生硬贴到窗口边缘。"
        ]},
        {title:"统一控件尺寸",items:[
          "导航、分段选择器、导入与排序按钮、播放器控制、开关、列表操作、设置与更新日志按钮整体适度增大，并同步扩大真实点击区域。",
          "尺寸增长通过真实布局盒完成，不使用视觉缩放冒充尺寸；点击命中、图标中心与 120 Hz 动画保持一致。"
        ]},
        {title:"字体与 Motion",items:[
          "字体选择器加入 Apple 系统字体与 Microsoft 系统字体；优先使用 SF Pro Display / SF Pro Text 和 Segoe UI Variable / Segoe UI，并在未安装时安全回退。",
          "修复浅色、深色、自动主题切换时选择滑块动画被主题刷新覆盖的问题；旧位置会保留到共享 Glider 正式滑向新选项。"
        ]}
      ]
    },
    {
      version:"7.0.2", date:"2026-07-31", kind:"patch",
      summary:"HOTFIX BUILD：引入 GP Motion Engine 4.0，以可折叠并悬浮展开的侧边栏统一空间、材质与状态动画，同时修复横向滑条、每日推荐选中态与重复艺人 metadata。",
      sections:[
        {title:"120 Hz Motion Contract / \u4ea4\u4e92\u516c\u7ea6",items:[
          "\u6240\u6709\u89c6\u89c9\u52a8\u753b\u4ec5\u7531 CSS\u3001Web Animations \u6216 requestAnimationFrame \u9a71\u52a8\uff0c\u4f9d\u636e\u5b9e\u9645\u65f6\u95f4\u63d2\u503c\u5e76\u8ddf\u968f\u663e\u793a\u5668\u5237\u65b0\u8282\u594f\uff0c\u539f\u751f\u652f\u6301 60 / 90 / 120 Hz\u3002\u56fa\u5b9a 60 Hz \u5b9a\u65f6\u5668\u4e0e\u6309\u5e27\u8ba1\u6570\u7684\u89c6\u89c9\u52a8\u753b\u88ab\u5e95\u5c42\u516c\u7ea6\u7981\u6b62\u5e76\u7eb3\u5165\u81ea\u52a8\u68c0\u67e5\u3002",
          "\u6536\u7a84\u4fa7\u8fb9\u680f\u73b0\u5728\u4fdd\u6301\u9501\u5b9a\uff0c\u4e0d\u518d\u7531 Hover \u5c55\u5f00\u3002GP \u56fe\u6807\u505c\u7559 550 ms \u624d\u6de1\u5165\u5c55\u5f00\u63d0\u793a\uff1b\u9608\u503c\u524d\u76f4\u63a5\u70b9\u51fb\u4f1a\u7acb\u5373\u5c55\u5f00\uff0c\u4e0d\u989d\u5916\u64ad\u653e\u63d0\u793a\u3002",
          "\u6a2a\u5411\u8f68\u9053\u7a0d\u5fae\u51cf\u7ec6\u5e76\u7f29\u5c0f\u89e6\u53d1\u9ad8\u5ea6\uff1bHover \u52a0\u7c97\u4e0e\u70b9\u51fb\u8df3\u8f6c\u5168\u90e8\u91c7\u7528\u8fde\u7eed\u65f6\u95f4\u63d2\u503c\u3002EQ \u548c\u542c\u6b4c\u6570\u636e\u6539\u7528\u5171\u4eab\u7684\u4e0d\u8d8a\u754c\u5355\u8c03\u4e09\u6b21\u66f2\u7ebf\uff0c\u6d88\u9664\u4e0b\u964d\u533a\u95f4\u7684\u53cd\u5411\u62d0\u5f2f\u3002"
        ]},
        {title:"GP Motion Engine 4.0",items:[
          "侧边栏“歌单”入口在中文界面更名为“歌曲库”，英文仍保持 Library。",
          "Glass Player 品牌右侧新增侧边栏形态按钮。点击后右边界平滑向左收拢，仅保留完整 GP 图标与纯图标导航；形态按钮隐藏，GP 图标接管点击恢复完整侧边栏的操作。",
          "收窄侧边栏继承系统弹窗的自适应毛玻璃材质，图标保持完整不透明。选中玻璃块与侧栏几何使用同一 520ms 时间轴，避免不同步、抽搐与重复布局。",
          "点击收回后会锁定当前指针周期，必须先移出侧边栏再重新移入才允许悬浮展开；完整侧边栏随后作为浮层覆盖页面，不挤压已经拓宽的主内容。图标竖条只向右轻弹后原路返回。",
          "首次导入进入 Resonance Boost 用户模型阶段时，大型行为记录改为分批计算并主动让出绘制帧；转圈动画固定进入独立合成层，不再偶发停住，同时仍在导入完成前生成完整模型。"
        ]},
        {title:"统一横向滑条",items:[
          "播放进度、音量、Crossfade、字体大小和字体粗细全部接入同一底层 Range 视觉：实心圆角轨道、Accent 已完成区段与低对比未完成区段。",
          "Hover 与拖动时轨道平滑加粗，离开后恢复；滑块继续使用现有半透明玻璃拖动点，数值范围、存储与音频行为不变。"
        ]},
        {title:"Daily Mix 与 Metadata",items:[
          "单独点击每日推荐中的歌曲开始播放后，点击反馈与选中遮罩会在播放提交后清理，不再永久覆盖该歌曲行。",
          "多值 ID3/Vorbis Artist 标签会按规范化文本去除完全相同的重复值；Sabrina Carpenter / Sabrina Carpenter 会恢复为单一 Sabrina Carpenter，同时 AC/DC 等真实名称不受影响。"
        ]}
      ]
    },
    {
      version:"7.0.1", date:"2026-07-30", kind:"patch",
      summary:"HOTFIX BUILD：重新定义更新日志合并规则，重做音乐银河图标与可逆动效，进一步减轻按钮雾感，并让页面外滚动可靠收回所有情境弹窗。",
      sections:[
        {title:"语义化版本历史",items:[
          "同一小版本线内反复处理同类问题的补丁现在合并为一个标准 x.x.x 条目，不再显示 6.6.1–6.6.4 这类非版本范围。",
          "合并后仍需保留的后续补丁会按时间顺序向前补号；原始 RELEASES 数据不删除，只在更新日志索引与导出文本中呈现压缩后的版本历史。",
          "除 6.x 外，3.x–5.x 中反复修复的 Queue、SSE、图标动效、播放器布局、语言、Accent、Recognition 与 PiP 维护记录也完成选择性合并。",
          "移除 GP Gen 4 Pre-Release Update，4.0.0 Beta 规范为 4.0.0，3.3.2 RE 规范为 3.3.2，并恢复 3.3.2 在 3.3.1 之前的正确倒序排列。"
        ]},
        {title:"Music Galaxy Icon",items:[
          "银河图标改为三层 29° 倾斜椭圆星盘，移除过密圆环、实心星核与额外光晕，保留三颗清晰星点，并扩大整体视觉面积以匹配其他侧边栏图标。",
          "触发动效时图标仅执行更明显的纯缩放：三层椭圆始终保持固定倾斜角度，三颗星点随星盘同步扩张，随后全部沿原路径回落。"
        ]},
        {title:"更轻的按钮材质",items:[
          "继续降低分段按钮、主标签、Snooze、画中画、清空、字体选择等共享按钮底面的雾感和不透明度，同时保留选中层级与文字可读性。",
          "统一 Glass 基础面板、强玻璃选择框、情境弹窗、悬浮提示、选择窗和数据展示板块同步增加通透度；通用弹窗模糊由 18px 降至 10px，让背景颜色和细节更自然地透入。"
        ]},
        {title:"Popover Scroll Dismiss",items:[
          "统一弹窗管理器监听页面级滚动；只要滚动发生在当前弹窗之外，已打开弹窗立即按标准退出动效收回。",
          "弹窗内部的选项滚动仍保持可用，不会误关；字体选择、EQ、Snooze、排序、倍速与说明弹窗全部继承同一规则。"
        ]}
      ]
    },
    {
      version:"7.0.0", date:"2026-07-30", kind:"major",
      summary:"GALAXY UPDATE：Glass Player Gen 7 正式启程。音乐银河首次进入产品导航，为未来把整座本地音乐库化作可探索星空建立入口；GP Fusion Engine 3.0 与 GP Motion Engine 3.4 同步更新。",
      sections:[
        {title:"Music Galaxy — 第一束星光",items:[
          "左侧主导航在“设置”上方加入“音乐银河”。它使用现有单一导航状态、页面转场和 Accent 选择滑块，没有创建第二套路由或独立运行时。",
          "音乐银河当前以纯净预告页面亮相：不设置 Sector、卡片或虚构功能，仅在 Glass Player 的实时背景中央显示“敬请期待”。",
          "这一入口为后续把歌曲映射为发光星点、通过 MFCC 与 BPM 组织距离、形成风格星系保留正式产品位置；本版本不提前运行 Canvas/WebGL 或额外分析任务。"
        ]},
        {title:"GP Fusion Engine 3.0",items:[
          "导航、主题、语言、背景与页面生命周期现在可以直接接纳新一代体验页面，同时继续共享现有 Peregrine Lake 状态和底层服务。",
          "音乐银河预告页不会触碰播放、Queue、EQ、Spatial、Spectrum、Neural、听歌记录或 IndexedDB 数据；进入和离开页面不会中断音乐。"
        ]},
        {title:"GP Motion Engine 3.4",items:[
          "新增音乐银河导航图标微交互：轨道轻转、核心呼吸、星点依次闪耀，并遵循既有 300 ms Hover 延迟、点击触发与 Reduce Motion 规则。",
          "新页面自动继承现有 Primary View 淡出、背景间隔与淡入生命周期，因此未来加入正式银河内容时无需另写一套切页动效。"
        ]},
        {title:"更轻的按钮玻璃",items:[
          "分段选择、主页面标签、睡眠定时、画中画、清空、字体选择和常用情境按钮的表面透明度只做轻微调整，减少厚重雾感但保留清晰层次。",
          "更新日志返回按钮的背景模糊由 18 px 收敛至 15 px，并略微增加透明度。弹窗、SSE、主面板、内容卡片和整体背景材质保持不变。"
        ]}
      ]
    },
    {
      version:"6.7.1", date:"2026-07-30", kind:"patch",
      summary:"HOTFIX BUILD：最近最爱改为自适应近期偏好，响度均衡真正提升小声歌曲，并修复搜索、手动队列模式切换、每日推荐入队与 Queue 定位动效。",
      sections:[
        {title:"智能近期偏好",items:[
          "最近最爱不再把观察窗口内的听歌时长简单相加。系统从 7、14、21、30、45 天中选择最短且证据充足的近期窗口；数据不足时才逐级扩大。",
          "歌曲、艺人、专辑与风格按时间衰减后的听歌时长、近期有效播放和近期相对趋势共同排序，越新的主动收听权重越高，长期历史不会继续压过最近发生的偏好变化。"
        ]},
        {title:"响度均衡",items:[
          "修复峰值余量误判把绝大多数补偿压成 0 dB 的根因。开启后以曲库中最响歌曲为参照，只提高较小声歌曲，并通过现有 Deck Gain 平滑应用。",
          "增益保持 7 dB 安全上限，不改写文件、不改变右侧原曲响度数据，也不改变 EQ、Spatial 或主音量设定。"
        ]},
        {title:"Queue 与推荐",items:[
          "手动队列在顺序播放与单曲循环之间切换时不再刷新整个 Sector；随机模式只让序号与拖拽柄在原位淡出，切回时原位恢复。",
          "每日推荐的播放按钮会把当日推荐整体写入同一套手动播放队列，随后完全服从手动队列的顺序、随机、单曲循环、删除与清空逻辑，并显示加入成功通知。",
          "Queue 定位全部统一使用浏览器原生平滑滚动。短距离不再单独采用另一套动画，所有定位保持与长距离移动完全一致的滚动质感。"
        ]},
        {title:"搜索控件",items:[
          "隐藏 Edge 原生蓝色搜索清除按钮，换成与 Glass Player 现有删除图标一致的圆润叉号；仅在存在搜索内容时出现。"
        ]}
      ]
    },
    {
      version:"6.7.0", date:"2026-07-28", kind:"minor",
      summary:"LOGIC UPDATE：GP Core 4.1 与 GP Fusion Engine 2.2 统一更新日志入口、主题背景过渡、手动队列播放模式、模糊搜索、倍速选择与 Queue 定位逻辑。",
      sections:[
        {title:"GP Core 4.1 — 单一更新日志入口",items:[
          "移除左侧侧边栏的更新日志按钮与对应选中遮罩；设置顶部的软件版本卡片成为唯一入口，并继续复用现有完整页面切换动画。",
          "更新日志标题左侧加入圆润的毛玻璃返回按钮，可沿相同底层转场返回设置，不创建第二套导航状态。"
        ]},
        {title:"主题与背景同步",items:[
          "Light、Dark 与 Auto 切换会重新预合成当前背景，并通过双 Canvas 交叉淡化呈现；Blurred Cover 不再保留上一主题的明暗结果。",
          "主题选中滑块在状态与布局提交后的双帧阶段重新测量，修复偶发缺失移动动画。"
        ]},
        {title:"GP Fusion Engine 2.2 — 手动队列播放模式",items:[
          "手动队列现在服从顺序播放、随机播放和单曲循环。随机模式从剩余手动队列中随机抽取；单曲循环保留当前歌曲，不被待播项强制推进。",
          "随机模式隐藏手动队列序号和拖拽排序柄；切回顺序或单曲循环时，通过 Queue 内容淡出/淡入恢复按钮和序号。",
          "暂停状态下已存在手动队列时，主播放按钮会可靠启动队列首个有效目标，修复直接拖入新歌曲并加入队列后播放无响应。",
          "每日推荐的播放按钮会把当前推荐结果写入同一套手动播放队列，再由顺序、随机或单曲循环处理后续播放，不再维护独立的推荐播放路径。"
        ]},
        {title:"Fuzzy Search",items:[
          "歌曲、艺人和专辑搜索在精确包含之外支持 Unicode 归一化、紧凑子序列匹配和受限编辑距离，轻微拼写错误仍可找到目标。",
          "模糊匹配只在本地歌曲数组运行，不引入网络请求或额外索引数据库。"
        ]},
        {title:"紧凑倍速与 Queue Motion",items:[
          "播放倍速改为更短的五段毛玻璃滑动条；弹窗内部只保留五个触点，当前倍速继续由下方播放器按钮显示。",
          "倍速弹窗提升到 body 顶层并固定在倍速图标正上方，在窗口缩放和不同页面比例下不再被播放器 Sector 裁切。",
          "Queue 短距离定位采用独立的三次缓入缓出曲线；长距离继续使用浏览器原生 Smooth Scroll，近距离移动不再突然跳位。"
        ]},
        {title:"Crossfade 与 EQ 缩放稳定性",items:[
          "Crossfade 调节范围收敛为 0.5–3.0 秒；旧设置超过新范围时会安全归一到 3.0 秒。",
          "EQ 曲线使用保持比例的 SVG 坐标系，并把指针位置逆变换回固定 ViewBox；浏览器缩放后网格比例、拖拽命中与圆形控制点不再被横向或纵向压缩。"
        ]}
      ]
    },
    {
      version:"6.6.5", date:"2026-07-26", kind:"patch",
      summary:"SPECTRUM UPDATE：GP Spectrum Engine 2.2 让听歌记录的播放次数严格跟随今天、本周、本月、本年与全部范围，并以实际累计播放达到歌曲时长的 75% 作为一次有效播放。",
      sections:[
        {title:"GP Spectrum Engine 2.2",items:[
          "播放完成度与逐日播放次数形成统一的历史统计契约：达到 75% 才确认一次有效播放，并将结果写入对应日期。",
          "时长与播放次数现在共享同一个时间范围聚合基础，避免当前范围混入终身累计次数。"
        ]},
        {title:"范围一致的播放次数",items:[
          "今天只显示今天完成的播放次数；本周、本月和本年分别聚合各自时间范围，全部保留歌曲的完整累计次数。",
          "逐日播放次数与原有逐日听歌时长一同持久化。切换时间范围时，时长和次数使用同一日期窗口，不再把历史总次数显示在今天。",
          "旧版本没有保存逐日次数的记录，会依据原有终身次数在各日的真实听歌时长占比恢复；若旧总次数字段本身为 0，则按逐日听歌秒数与歌曲时长的 75% 门槛回溯计算。缺少旧歌曲时长但确实存在听歌时长时至少恢复为一次，不再把已有历史统一显示为 0。"
        ]},
        {title:"75% 有效播放规则",items:[
          "同一次播放中实际累计播放时长达到歌曲总时长的 75% 后才计为一次；允许中途 Seek 或跳过片段，但直接拖到后段不会把未播放部分算入累计。",
          "同一次播放流程最多计数一次，切歌、自动 Crossfade 与自然播放结束共享同一防重复状态。"
        ]},
        {title:"路线整理",items:[
          "从 Unreleased 中移除 Music Time Machine / Timeline 规划；Music Galaxy、Galaxy-Aware Recommendation 与 Gen 9+ Electron Lake 路线保持不变。",
          "现有听歌时长、历史总次数、歌曲身份关联与 IndexedDB 用户数据均保留，不执行清空或重建。"
        ]}
      ]
    },
    {
      version:"6.6.4", date:"2026-07-26", kind:"patch",
      summary:"HOTFIX BUILD：重新规划主线程调度，在完全不改变 UI、动画观感、交互逻辑和数据结果的前提下消除重复渲染与输入阻塞。",
      sections:[
        {title:"输入优先调度",items:[
          "导入歌曲仍完成相同的 Spectrum ID、metadata、封面、MFCC、Energy、BPM、历史同步、Resonance Boost 与每日推荐流程，但批次之间会优先让出已等待的鼠标和键盘输入。",
          "保留原有并发能力，不再通过无差别提高并发量挤占主线程；大块 WMA payload 扫描增加安全切片，避免单次同步循环长期独占界面。",
          "进度计算、缓存内容、歌曲识别结果、推荐结果与导入完成边界保持不变。"
        ]},
        {title:"可见区域渲染",items:[
          "播放器不可见时暂停其四频段 Canvas 与进度条 DOM 绘制，返回播放页时同帧恢复当前准确状态；音频播放、听歌记录与行为采集持续正常运行。",
          "隐藏页面的横向选择器与 SSE 不再参与全局测量；页面真正显示时仍按照原有底层系统重新对齐。",
          "窗口适配只刷新当前活动页面，不再在同一轮 resize 中重复扫描全部页面与全部 UI Registry 组件。"
        ]},
        {title:"启动与布局去重",items:[
          "删除启动阶段重复的选择器初始化和重复 resize 路径，保留首次布局、字体完成和最终 viewport settle 三个必要校准点。",
          "动画时长、缓动曲线、模糊、主题、播放器布局、Queue 定位、SSE、EQ、Spatial、听歌记录和 IndexedDB schema 均未改变。"
        ]}
      ]
    },
    {
      version:"6.6.3", date:"2026-07-26", kind:"patch",
      summary:"HOTFIX BUILD：恢复播放队列的自由手动滚动，并消除首次播放时的重复归位抽搐。",
      sections:[
        {title:"一次性 Queue 归位",items:[
          "删除平滑滚动结束后的延迟二次复核；首次播放不再在动画中途收到第二条定位指令。",
          "首次播放若 Queue 仍停留在顶部，只执行一条原生平滑定位；不会直接闪跳，也不会在滚动途中追加第二条命令。",
          "播放、暂停、切歌以及切回播放队列时只执行一次当前歌曲归位。该次动画结束后播放器不再接管滚动，用户可以自由浏览整个队列。",
          "歌曲序号与播放图标继续使用固定居中容器和原位交叉淡化。"
        ]}
      ]
    },
    {
      version:"6.6.2", date:"2026-07-26", kind:"patch",
      summary:"HOTFIX BUILD：修复空歌单背景网格、播放队列定位漂移与导入阶段卡顿。",
      sections:[
        {title:"播放队列定位",items:[
          "播放队列不再使用歌曲序号乘以假定行高来定位；改为读取当前歌曲的真实渲染位置，缩放、字体和多次切歌不再累积偏差。",
          "暂停、切换歌曲和反复操作都会生成新的唯一定位请求，让当前歌曲平滑回到第二个完整可见位置；滚动结束后会再次复核位置。",
          "首次导入定位完成后立即撤销首次播放备用请求，避免两条滚动链同时启动；歌曲序号与播放图标使用固定居中容器并原位交叉淡化。"
        ]},
        {title:"导入与初始化",items:[
          "封面与缩略图在导入窗口结束前完成解码预载，进入播放器后不再把首轮封面加载留给可交互阶段。",
          "识别与歌曲数据读取并发度获得克制提升，批次之间继续向浏览器动画帧让步；导入进度条在工作期间保留独立合成层。"
        ]},
        {title:"初始背景",items:[
          "未导入歌曲时的三色背景改为按物理视口直接绘制，不再放大低分辨率渐变采样，从源头消除高分屏可见的网格感。"
        ]}
      ]
    },
    {
      version:"6.6.1", date:"2026-07-26", kind:"patch",
      summary:"HOTFIX BUILD：完成真实的封面交叉淡化与导入初始化闭环，并修复切歌动效、Queue 滚动、倍速弹窗和四段频谱反馈。",
      sections:[
        {title:"换歌响应与 Queue",items:[
          "上一首与下一首按钮的完整 300ms 动效获得独占视觉窗口；Queue 对账、取色、背景、波形与信息刷新不再从动画中段开始抢占主线程。",
          "按钮动效完成后才启动 Queue 的原生平滑滚动，保留加速与末段减速；首次播放定位不再重复发送第二个滚动请求。",
          "播放标记继续只更新旧歌曲与新歌曲两行，避免换歌时扫描完整歌单。"
        ]},
        {title:"封面无缝交叉淡化",items:[
          "新封面先完成预载，再让旧封面副本与新封面同步反向淡化；整个过程中不会暴露灰色唱片底层或空白静态封面。",
          "唱片模式只替换唱片内部的图像。唱片本体角度、旋转时间线、中心轴和唱针完全不参与封面转场。"
        ]},
        {title:"完整导入闭环",items:[
          "Spectrum、MFCC、Energy、BPM、持久缓存、历史身份同步、behaviorEvents 数据载入、Resonance Boost 用户模型刷新、每日推荐生成与保存、Library、Queue、背景与当前歌曲信息全部在导入弹窗内完成。",
          "进度条只在上述工作真正结束后进入 100%，并等待末段动画抵达终点后才显示“导入完成”；进入播放器后不再继续这一批初始化。",
          "导入遮罩移除深黑覆盖，弹窗移除显式边框并适度提高表面亮度，同时保留系统通用玻璃模糊。"
        ]},
        {title:"控制与频谱细节",items:[
          "播放速度弹窗下移至按钮附近，不再悬得过高。",
          "四段频谱保留明显动态范围，同时使用较慢目标采样与最高 120Hz 的连续视觉插值；细碎抖动被过滤，但鼓点、低频和高频变化仍清楚可见。"
        ]}
      ]
    },
    {
      version:"6.6.0", date:"2026-07-26", kind:"minor",
      summary:"SNOW LEOPARD 3.0：重排导入完成后的工作队列，重建固定视窗中的播放队列定位，并消除换歌时背景白闪与控制动效卡顿。",
      sections:[
        {title:"导入交互调度",items:[
          "导入完成弹窗不再自动消失；只有点击完成按钮才会退出，遮罩点击与 Escape 不会绕过确认。",
          "听歌历史同步、每日推荐刷新与 Spectrum 分析不再和导入完成后的首轮交互争抢主线程；它们会在用户确认且鼠标、触控、滚轮与键盘连续静止满 10 秒后才开始，期间任何新操作都会重新计时。",
          "首次导入的 Library 与 Queue 先完成必要的可见内容提交，再释放后台分析，避免进度结束后的几秒钟内页面像失去触控一样卡住。",
          "导入弹窗保留系统通用模糊与透明表面，但移除由黑色外阴影形成的硬边，改为低强度 Accent 深度与内部高光。"
        ]},
        {title:"固定视窗播放队列",items:[
          "播放队列外层视窗保持固定，只有内部歌曲列表移动；当前歌曲最终始终位于第二个完整可见行，第一行保留给上一首歌曲并允许 SSE 自然裁切。",
          "定位目标改为由列表起点、统一行高与真实歌曲序号直接计算。滚动方向严格取决于目标位置与当前位置的正负距离，从第 100 首返回第 20 首会向上移动，不再绕到歌单底部后继续向下。",
          "滚动核心恢复 6.0.2 已验证的浏览器原生 smooth scroll，让系统负责加速与末段减速；新的定位请求令牌只负责丢弃过期重试，不再逐帧改写 scrollTop。Queue 行不再使用可能在程序滚动中临时改变布局的 content-visibility。"
        ]},
        {title:"换歌视觉连续性",items:[
          "Blurred Cover 过渡的中间底色改为取自当前封面与主题计算出的真实过渡色，不再暴露浅色或深色基础背景造成白闪。",
          "歌名与歌手在原位交叉淡化；移除标题测量期间的临时左对齐，不再产生从左侧飞入的错觉。",
          "唱片模式完整保留唱片本体的角度、旋转时间线与唱针状态，只让唱片内部的专辑图淡出并淡入新图；静态封面使用同样的原位透明度过渡。",
          "换歌后的前两个合成帧只提交按钮、歌名与封面反馈；Queue 对账、Accent 取色、背景绘制、文件信息、波形和 PiP 刷新随后错峰执行。",
          "播放标记只更新旧歌曲与新歌曲两行，不再在每次换歌时同步遍历整份 Library 和 Queue。",
          "上一首与下一首动效获得 340ms 的优先合成窗口；高分辨率背景绘制会稍后开始，避免 4K Canvas 工作阻塞按钮回弹。",
          "切歌图标移动改用稳定的 translate3d 合成路径，并只在动效运行时声明合成提示，减少常驻 GPU 图层。",
          "未导入歌曲时恢复 6.0.2 的三块 Accent 柔和色团构图；色团预先合成为静态低频 Canvas，不重新引入常驻 CSS blur 或动态背景负载。",
          "首次导入后第一次真正开始播放时会明确把默认 Queue 定位到当前歌曲，不再等待下一次切歌。"
        ]}
      ]
    },
    {
      version:"6.5.7", date:"2026-07-26", kind:"patch",
      summary:"HOTFIX BUILD：修复倍速旧数据迁移、Accent 同步、标题逐点取色、导入后的触控阻塞，以及默认播放队列在返回和切歌后的滚动定位。",
      sections:[
        {title:"播放速度",items:[
          "播放速度只接受 0.5×、0.75×、1×、1.5× 和 2× 五个合法档位；旧版遗留的 0–1000 滑条位置不会再被误读为 2×，无效旧值统一迁移为 1×。",
          "倍速按钮、当前数值和分段滑块在 Accent 提交的同一帧刷新，不再短暂保留上一首歌曲的主题色。"
        ]},
        {title:"背景可读性",items:[
          "听歌记录 Top 50 与其他页面标题不再依赖估算的页面背景；系统直接采样标题中心正后方的当前背景 Canvas 像素，并据此选择黑色或白色文字。"
        ]},
        {title:"导入响应",items:[
          "Library 每帧挂载数量由 28 首降至 12 首，默认 Queue 由每帧 32 首降至 16 首，为鼠标、触控与动画留下稳定执行窗口。",
          "导入成功状态短暂显示后自动释放全屏进度遮罩，不再让完成后的界面像触控失灵。"
        ]},
        {title:"播放队列定位",items:[
          "从音效或每日推荐返回默认播放队列时，从用户上次滚动位置平滑滚回当前歌曲，不再瞬间跳到目标。",
          "切歌后同样平滑定位当前歌曲；定位改为依据滚动容器与歌曲行的实时矩形，不再依赖不稳定的 offsetTop。",
          "若当前歌曲行仍在分帧挂载，定位会等待并重试；因此不会再停在旧位置、滚到错误歌曲或找不到正在播放的歌曲。"
        ]}
      ]
    },
    {
      version:"6.5.6", date:"2026-07-26", kind:"patch",
      summary:"HOTFIX BUILD（重新发布）：重做系统弹窗材质与唯一弹窗状态管理，加入倍速分段滑块，稳定低频输出，并让导入提交分帧完成。",
      sections:[
        {title:"Curve Equalizer Polish",items:[
          "Snooze 的主题亚克力、18px 背景景深、边框与阴影现由 gp-motion-popover 单一底层类统一提供；排序、字体、空间说明、响度说明和未来弹窗无需维护类型白名单或独立材质。",
          "系统弹窗改用当前主题底色与 Accent 共同计算的高遮盖非纯白/非纯黑表面：保留轻微背景关系，但不再让文字、曲线和色块像湿纸一样穿透。",
          "EQ Preset 删除独立开关实现并接入同一个全局 Popover 管理器；打开时提升至页面顶层弹窗层，避免 EQ 曲线所在的局部合成层让曲线穿透模糊表面。",
          "移除曲线右上角重复的“手动调节 / Manual Control”说明；Preset 名称本身继续在手动修改后淡入为“自定义 / Manual”。",
          "为 60Hz、150Hz、400Hz、1kHz、2.4kHz、6kHz 与 15kHz 添加贯穿增益区域的竖向网格线，零增益横线和曲线仍使用当前主题层级。",
          "七个增益节点缩小并改为 Accent 衍生的半透明玻璃圆点；拖动状态只进行轻微放大，曲线和滑动轴不会被粗重节点遮挡。"
        ]},
        {title:"4K Moiré Hard Stop",items:[
          "撤销 4K 背景的 2×放大路径，背景 Canvas 始终按照 viewport × devicePixelRatio 的真实物理尺寸生成。",
          "歌曲背景切换不再让两张 Canvas 同时半透明叠加；旧背景先独立淡出至主题底色，完全退出后新背景再独立淡入，任意时刻只有一张纹理参与合成。",
          "背景层明确禁止 transform 与 CSS filter；普通切页、按钮动画和面板淡入淡出只复用已经完成的静态位图，不再触发背景重采样或重新模糊。"
        ]},
        {title:"四频段动画连续性",items:[
          "四条实时频段由约 20Hz 的粗量化目标改为约 31Hz 的低敏感平滑目标，仍会过滤细碎噪声，但不再以阶梯方式跳到下一格。",
          "Canvas 高度保留亚像素精度，视觉层继续随屏幕 requestAnimationFrame 插值；上升与回落分别使用连续时间常数，兼顾丝滑运动和克制反馈。"
        ]},
        {title:"播放控制与音频稳定性",items:[
          "播放速度平时保持为与播放模式对称的轻量按钮；点击后只显示 0.5×、0.75×、1×、1.5× 与 2× 五个档位，不再保留重复的滑动轴、范围读数或当前值。",
          "五个倍速档位组成一条毛玻璃分段滑块；选中遮罩在档位之间平滑横移，音高保持和设置持久化继续有效。",
          "封面 Accent 提交时，同一帧刷新 EQ Preset 按钮、上下文控件、曲线填充与四频段颜色，不再滞留上一首歌曲的主题色。",
          "EQ 余量不再只读取最高的单个频段，而是通过 96 个对数频率点测量七个 Biquad 的完整叠加响应；低频相邻频段共同抬升时也会预留真实峰值空间。",
          "移除连续播放路径中会追随低频周期快速增益变化的末端压缩器，改为固定线性输出与真实 EQ 前级补偿，避免鼓点和持续低音出现卡顿式爆裂。",
          "后台 Spectrum 分析会在播放期间彻底让出执行时间，避免长 MFCC / BPM 循环与本地 FLAC 解码争夺主线程。",
          "导入完成后的 Library 与默认 Queue 改为小批次逐帧挂载；离屏歌曲行启用 content-visibility，历史同步与日推刷新移入稍后的浏览器空闲窗口。",
          "从音效或每日推荐返回播放队列时，只要当前不是手动播放列表，默认歌单都会立即重新定位到当前歌曲；手动 Queue 的用户滚动位置不受影响。"
        ]},
        {title:"Hover 层级净化",items:[
          "移除侧边栏、更新日志版本、歌曲行、弹窗选项和行内操作等控件在 hover 时覆盖的预选中背景遮罩；真正的 active 滑块和选中状态保持不变。",
          "所有既有 hover 延迟、图标微动效、文字或图标颜色反馈、拖动提示及点击反馈继续保留。"
        ]},
        {title:"单弹窗与转场纹理修复",items:[
          "全局 Popover Manager 保证任意时刻最多只有一个小弹窗可见；打开新弹窗会立即完整收起旧弹窗并同步所有 trigger 的 aria-expanded 状态，点击原按钮或外部区域仍按统一退场动画关闭。",
          "切页彻底取消实色桥接层；前景页面只执行淡出与淡入，当前歌曲背景从转场开始到结束保持不变，不再突然灰屏。",
          "深色 Blurred Cover 提高预模糊采样精度并压缩低亮度色阶跨度，减轻 4K 深色背景最容易暴露的带状纹理。"
        ]},
        {title:"本地化修复",items:[
          "播放队列的缓存签名现在包含当前界面语言；首次恢复中文设置或中途切换语言时，空歌单提示会同步刷新，不再残留英文。"
        ]}
      ]
    },
    {
      version:"6.5.5", date:"2026-07-26", kind:"patch",
      summary:"UI UPDATE：GP Fusion Engine 2.1 与 GP Motion Engine 3.3 重构 Equalizer 曲线交互、听歌洞察排版和高分辨率背景合成，并进一步平滑实时频段反馈。",
      sections:[
        {title:"GP Fusion Engine 2.1 — Curve Equalizer",items:[
          "七段 EQ 从独立竖条重构为连续 Accent 曲线：七个频点仍可直接上下拖动，曲线以平滑三次 Bézier 连结并实时显示增益轮廓。",
          "Preset 收入复用系统毛玻璃材质的弹窗；删除 Classical 与 Podcast，保留声音、设备和最后一项 Manual。手动修改任意现有 EQ 时，当前名称以轻微淡出/淡入从原 Preset 切换为 Manual。",
          "切换 Preset 时，七个频点和曲线在 360ms 内共同移动到目标位置，Web Audio Filter 同步平滑 Ramp，不再让界面或声音参数瞬间跳变。",
          "Manual 曲线继续独立持久化；浅色、深色、中英文与封面 Accent 均复用现有主题和设置存储。"
        ]},
        {title:"Listening Insight Layout",items:[
          "听歌习惯摘要改为自适应两区布局；多个可信时段分别成为可换行的信息块，时段和 Genre 不再挤成一条失衡的超长标题。",
          "听歌数据的最爱艺人周榜从过去 10 周扩展至过去 12 周。",
          "过去十天听歌时间由折线改为平滑曲线，保留真实数据点、日期、Hover 明细与 Accent 渐变面积。"
        ]},
        {title:"4K Motion Stability",items:[
          "4K 环境背景使用严格的 2× 物理像素栅格：1920×1080 静态低频色场精确映射至 3840×2160，避免两张全尺寸 Canvas 在 Edge 分数 DPI 合成时产生动态摩尔纹。",
          "背景混合缩短为线性 420ms，并取消临时 will-change 图层；1080p 继续 1:1 显示，前景、封面、文字和所有 UI 仍保持原生分辨率。",
          "四频段改为约 20Hz 的稳定目标采样与最高 120Hz 的独立视觉插值；加入 RMS、量化死区、105ms 峰值保持及更慢 Release，小幅频率变化被过滤，上升和回落均在接近目标时自然减速。"
        ]}
      ]
    },
    {
      version:"6.5.4", date:"2026-07-26", kind:"patch",
      summary:"HOTFIX BUILD：修复 Poly Sync 40 输出链的超限风险、4K 转场摩尔纹、四频段抖动及多个界面状态回归，并重写响度均衡与听歌时段结论。",
      sections:[
        {title:"Audio Output Integrity",items:["确认 Audio Graph 只有一份：双 Deck 经 Crossfade、响度 Gain、EQ、Spatial 后进入同一条最终输出，不存在重复 AudioContext 或重复 connect。","EQ 正增益现在获得等量负 preamp；Spatial 之后固定保留 -1.5dBFS 余量，再经过仅捕获越界峰值的最终 Limiter，用户音量位于其后。","响度均衡改为以当前曲库最响歌曲为参考，只提升较安静歌曲且不压低较响歌曲；Gain 保持上限、有限值检查和 140ms 平滑。","播放、暂停、Seek、切歌与 Crossfade 使用短增益包络；音量与静音操作不再瞬间跳变。","新增只读音频诊断环形记录，采样 Mix、EQ、Spatial、Final、标准 Mono 平均及不安全声道直接求和，记录首次超限节点、RMS、Peak、EQ、响度、Spatial、Limiter 与 AudioContext 延迟。"]},
        {title:"4K Motion & Background",items:["Blurred Cover 仍先生成低频颜色场，但最终 Canvas 改为 viewport × devicePixelRatio 的原生 backing store，不再把 1280×720 表面二次缩放到 4K。","背景转场只执行 opacity 混合，明确禁止 transform；1080p 与 4K 使用同一静态像素合成逻辑，避免低刷新率下被放大的动态空间混叠。","播放进度右侧四频段增加更强的频谱平滑、独立 attack/release 与微抖死区，保留真实响应但不再逐帧抽搐。"]},
        {title:"Interface & State Repair",items:["设置版本卡改为单一真实 Accent 边框，删除透明底边框与叠加伪元素之间泄露出的左侧白条。","Spatial 与响度说明弹窗在 Portal 的 show 状态真正提交后连续定位两帧，不再飞到页面左上角。","首次导入后先提交歌单 DOM，再设置起始歌曲；播放器正在播放时歌单不会再偶发空白。","Queue 在隐藏时记录待定位状态，重新显示后只在确有歌曲变化时定位当前歌曲，避免漏跳与无条件重置滚动位置。","听歌习惯从单一最大时段升级为最多三个达到置信门槛的时段，并结合 Neural 模型中该时段偏好的 Genre 生成更完整的结论。"]}
      ]
    },
    {
      version:"6.5.3", date:"2026-07-25", kind:"patch",
      summary:"HOTFIX BUILD：GP Motion Engine 3.3 消除播放/暂停卡顿与 4K 切页背景纹理，并修复导入掉帧、短期重复推荐以及 FLAC 在切歌或连续播放中的随机爆音。",
      sections:[
        {title:"GP Motion Engine 3.3",items:["播放与暂停只更新当前歌曲的状态标识，不再重建整个歌单和 Queue；唱片减速与唱针移动不再和大规模 DOM 重排争抢主线程。","封面虚化背景先缩采样到低频颜色场并固定柔化，再放大到显示分辨率；切页淡出时不再暴露封面文字、圆环或巨大轮廓。","整页切换不再强制创建 3D 栅格层；扫描、按钮和播放进度继续跟随显示器刷新率，最高 120Hz。"]},
        {title:"Import Responsiveness",items:["缓存完全匹配时不再重复写入 IndexedDB；只有 Spectrum ID 或识别锚点发生变化时才更新缓存。","歌单歌曲由逐条 HTML 插入改为一次批量提交，歌曲操作使用容器级事件代理，避免数百次 DOM 解析和监听器绑定。","历史元数据同步和 Spectrum 分析移入空闲时段；音乐正在播放时暂停新的全曲解码、MFCC 与 BPM 计算，暂停后再继续。"]},
        {title:"Recommendation Freshness",items:["Shuffle 和 Daily Mix 建立短期硬排除窗口，当前会话最近播放及 Shuffle 时间线中的歌曲不会立即再次进入候选。","长期偏好、Genre、MFCC、BPM 与 Energy 仍决定候选权重，但不能压过短期去重规则。"]},
        {title:"Lossless FLAC & Continuous Playback",items:["FLAC 继续由 Edge 原生解码为 PCM，不转码、不重新压缩、不修改源文件；双 Deck 改为完整预载，并使用面向连续音乐的 playback 音频缓冲。","移除直通与 Compressor 两条不同延迟路径的并联交叉；Spatial Bus 末端的常驻 12:1 Compressor 也退出信号链，避免强瞬态中途触发非线性咔声或音量呼吸。","播放、暂停与双 Deck 切换的增益包络只在新解码器真正开始输出后执行；暂停会先淡出再断开，不再截断非零 PCM 采样。","听歌记录继续实时累计，但整库 JSON 与 localStorage 写入改在空闲时批量完成；隐藏或关闭页面时强制落盘，在保留数据的同时移除播放中的周期负荷峰值。"]}
      ]
    },
    {
      version:"6.5.2", date:"2026-07-24", kind:"patch",
      summary:"HOTFIX BUILD：修复 6.5.1 降低 GPU 常驻图层后暴露出的巨大圆形色块与背景纹理，恢复柔和、连续且低负荷的默认 Glass 背景。",
      sections:[
        {title:"Ambient Background Repair",items:["确认默认界面的巨大灰色圆盘来自三个径向色块失去模糊后直接暴露，而非 Player、Queue 或 SSE 的布局错误。","三个色块恢复为只提供颜色的静态输入，统一交给一张背景级柔化层处理；不再为每个色块分别创建 blur、hue-rotate 或 will-change 图层。","径向颜色在 58% 之前已降至极低强度，并在 82% 完全透明；单层 64px 柔化消除硬圆边、渐变分层与交互时出现的摩尔纹。"]},
        {title:"Default & Theme Balance",items:["未导入歌曲时，环境色强度降至正常播放背景的一半以下，黑白 Accent 不再生成覆盖播放器与 Queue 的巨大白灰区域。","导入歌曲后仍保留封面/主题颜色氛围；Color Background 使用较高但受控的强度，Glow 模式保持更克制。","背景柔化层缩小超采样边界并保持静态缓存，在恢复视觉连续性的同时避免回到三个独立 GPU 滤镜造成的高占用。"]},
        {title:"Motion Contract",items:["GP Motion Engine 3.2 的 120Hz 上限、播放进度、四频段、唱片与 PiP 调度保持不变。","本次只修复背景输入与合成方式，不降低动画帧率，也不修改音频、播放队列、Spectrum、听歌记录或用户模型。"]}
      ]
    },
    {
      version:"6.5.1", date:"2026-07-24", kind:"patch",
      summary:"MOTION UPDATE：GP Motion Engine 3.2 将所有实时视觉调度统一到最高 120Hz，同时释放静止背景的常驻 GPU 合成层，以更均衡的 CPU/GPU 分工降低高分辨率负载。",
      sections:[
        {title:"GP Motion Engine 3.2",items:["新增统一的 120Hz Motion 时基；Canvas 四频段、播放进度、唱片时间线和传统画中画均通过 requestAnimationFrame 跟随屏幕刷新率，最高以 8.33ms 间隔更新。","CSS 与 Web Animations 动效不再附加 60fps 限制，继续由 Edge 合成器按显示器实际刷新率输出；移除按钮光晕中故意制造低帧感的 steps() 采样。","播放进度从低频 timeupdate 显示升级为独立 120Hz 视觉循环；时间文本仍只在整秒变化时写入，避免为了高刷新率反复修改不变内容。"]},
        {title:"Balanced Rendering",items:["撤销三个超大色块各自常驻的 blur、hue-rotate 与 will-change GPU 图层；色相在背景生成时由 CPU 只计算一次，柔和渐变直接作为静态结果显示。","Blurred Cover 只在歌曲背景交叉混合的 560ms 内临时提升为合成层，动画结束立即释放；静止界面不再长期占用额外 GPU 纹理。","传统画中画的视频轨道和动态前景上限提高到 120fps，但背景仍保持单次缓存，不会在每一帧重新执行封面模糊或调色。"]},
        {title:"Frame Safety",items:["120Hz 是上限而非强制忙循环：60Hz 屏幕自然获得 60 次回调，120Hz 屏幕获得最高 120 次，后台标签页自动停止播放器视觉循环。","高频循环只更新真实运动的进度与四频段数据；SSE、标题判色、背景取色、推荐和听歌算法仍按事件或缓存刷新，不被错误提升到 120Hz。"]}
      ]
    },
    {
      version:"6.5.0", date:"2026-07-24", kind:"minor",
      summary:"EXPERIENCE UPDATE：重新平衡音频增强链的峰值余量，并集中修复播放器反馈、扫描动效、标题可读性与高分辨率界面的合成稳定性。",
      sections:[
        {title:"Audio Experience",items:["为响度均衡、正增益 EQ 与空间音效建立统一固定余量，避免多段增益叠加造成削波、爆音或瞬时咔声。","EQ 参数以短时平滑过渡写入；最终安全层在关闭增强时保持透明直通，开启增强时只拦截极少数越界峰值。","正向响度补偿同时受缓存峰值与固定上限约束，播放器右侧仍显示原曲响度，不修改音频文件或既有 Spectrum 数据。"]},
        {title:"Playback & Controls",items:["四频段播放指示器不再缓存隐藏页面的 1 × 1 几何；返回播放页时按实际像素重新测量，并以更高刷新率稳定显示。","ON / OFF 开关脱离全局按钮按压缩放链，拖动与点击只保留水平状态变化，不再偶发上移或下移。","导入与重新扫描共用更紧凑、对称的双箭头圆环，并将持续旋转速度降低为更克制的 1.35 秒一周。"]},
        {title:"Rendering & Readability",items:["页面标题在主题、封面背景混合、页面落位和窗口变化后重新读取直接背景，自动选择黑/白文字并加入克制的反向阴影保护。","页面切换改为无强制同步布局的双帧合成提交，四频段显示恢复 60fps 采样节奏；允许浏览器使用更多 CPU/GPU 换取更稳定的动画帧。","环境色块把模糊与色相处理下沉到独立合成层，封面背景常驻稳定 GPU 层，并延长径向渐变，消除交互时的大面积纹理重采样和摩尔纹。"]}
      ]
    },
    {
      version:"6.4.4", date:"2026-07-23", kind:"patch",
      summary:"HOTFIX BUILD：以真实裁切重做文件夹抽纸动效，并修复中文设置标题混入英文的问题。",
      sections:[
        {title:"扫描反馈与控件一致性",items:[
          "首次导入与重新扫描歌曲库共用严格同心的双向循环箭头，修复两段路径视觉错位；导入或扫描进行期间图标持续匀速旋转，完成后稳定停回原位。",
          "空间音效与响度的感叹号说明已经展开时，再次点击同一按钮不再重播动效或造成弹窗跳动；指针离开按钮和说明区域后才收回。",
          "中文版将 Crossfade 标题完整本地化为“交叉淡入淡出”，时长滑块与数值在左、开关在右并统一至同一水平基线；关闭后复用主题色选择器的灰化过渡并彻底禁止拖动。",
          "Founder’s Note 的关闭按钮不再等待 400ms 定时器；点击后关闭符号与弹窗退出同时开始，消除明显的操作延迟。"
        ]},
        {title:"Folder Paper Motion",items:[
          "纸张改为完整的实心矩形，并通过独立裁切窗口只显示文件夹上方真正抽出的部分；最大位置仍连续延伸到文件夹内部，不再出现纸张底部断裂。",
          "静止状态纸张完全收回且不可见；抽出距离从 5px 收紧到约 3.55px，文件夹反向下沉同步减弱，整体更克制。",
          "纸张不透明度提升到接近实心，同时保持圆角顶边和 500ms 原有响应节奏。"
        ]},
        {title:"Chinese Localization",items:[
          "中文模式的设置标题只显示“界面语言”；英文模式显示“Interface Language”，不再在中文界面混入“/ Language”。",
          "切换语言时立即重绘每日推荐空状态，修复先进入英文再切回中文后仍显示“At least 2 songs are required to generate a mix”的问题。",
          "删除 Crossfade 下方多余的“切歌时平滑过渡，而不是硬切”说明；“重新扫描全部歌曲”统一改名为“重新扫描歌曲库”。",
          "听歌数据中的最爱艺人周图从过去 5 周扩展到过去 10 周；最近最爱卡片保持原来的简洁“最爱艺人”标签。",
          "最近最爱的歌曲、艺人、专辑与风格继续共享智能观察窗口：优先约 30 天，并根据有效听歌天数与置信度在 21/30/45/60 天间调整。",
          "删除听歌时长大数字下方重复的“今天/本周/本月/今年的听歌时长”说明，时间选择和环比信息已经足够表达当前范围。"
        ]}
      ]
    },
    {
      version:"6.4.3", date:"2026-07-23", kind:"patch",
      summary:"HOTFIX BUILD：重画更新日志折角与圆角轮廓，重做文件夹纸张抽出层级，修复 Accent 色样圆形填充，并规范 Founder’s Note 署名排版。",
      sections:[
        {title:"Changelog & Import Icon Geometry",items:[
          "更新日志图标改为单一连续圆角文档轮廓，右上折角与外框共享同一交点，不再出现三角折角偏移或尖锐边缘。",
          "添加文件夹动效改为真实前后层级：更宽的纸张藏在文件夹正面之后，向上抽出更明显距离；文件夹同步轻微下沉并弹性复位。",
          "添加文件的加号雾光波保持原设计，文件选择和文件夹选择逻辑均未改变。"
        ]},
        {title:"Accent Swatches",items:[
          "主题色圆点取消浏览器原生按钮外观和默认内边距，改由完整圆形伪元素绘制颜色，消除黑色与其他色样四边露白。",
          "黑白主题色样保留深浅辨识，但不再以高亮白色切面破坏圆形边缘。"
        ]},
        {title:"Founder’s Note Typography",items:[
          "正文和署名拆成独立排版层；“—— CT”始终保持同一行并靠右显示，符合引用署名格式。",
          "原有玻璃背景、关闭方式和居中关闭符号动效保持不变。"
        ]}
      ]
    },
    {
      version:"6.4.2", date:"2026-07-23", kind:"patch",
      summary:"HOTFIX BUILD：在不改变现有视觉、音频与数据契约的前提下改善界面帧调度，补齐响度说明、统一图标几何与导入动效，并修复听歌记录布局。",
      sections:[
        {title:"Frame Pacing & Rendering",items:[
          "Mini EQ 缓存画布尺寸与颜色，SSE 更新和图表 Tooltip 移入 requestAnimationFrame；播放期间不再重复触发布局测量和样式解析。",
          "Genre 解析与相似度加入有界内存缓存，Daily Mix 在单轮生成中复用歌曲特征快照，避免重复扫描 MFCC、BPM、Energy 与 Genre。",
          "封面虚化只在真实 Blend 期间启用合成提示，静止背景不再常驻额外 GPU 图层；视觉参数、过渡时间和最终画面保持不变。"
        ]},
        {title:"Sound Guidance & Founder’s Note",items:[
          "响度栏新增与空间音效一致的倒感叹号按钮和玻璃说明：自动均衡只改变播放增益，原曲 Loudness 显示与文件本身保持不变。",
          "Founder’s Note 的关闭符号改为对称 SVG，旋转围绕真实中心进行；署名独立下移并统一为“—— CT”。"
        ]},
        {title:"Icon Geometry & Motion",items:[
          "播放器、侧边栏、默认封面、听歌记录坐标轴与歌曲操作图标统一圆角端点和连接几何，消除半透明路径相交造成的浅色接缝。",
          "添加文件加入加号形雾光波；添加文件夹加入纸张抽出与文件夹反向回弹；每日推荐播放沿用统一的圆角三角脉冲，文字保持静止。",
          "上一首、下一首、播放、暂停、侧边栏和列表操作的尖角得到克制圆化，现有 Motion 波形同步适配新轮廓。"
        ]},
        {title:"Listening History Layout",items:[
          "听歌记录恢复与其他主页面一致的最大内容宽度和左右留白，不再在宽屏中无条件填满全部空白。",
          "图表指针反馈按帧合并更新，保留原有 Tooltip 视觉并降低高频移动时的主线程压力。"
        ]}
      ]
    },
    {
      version:"6.4.1", date:"2026-07-23", kind:"patch",
      summary:"NEURAL BOOST：GP Spectrum Engine 2.1 与 GP Neural Engine 2.1 将离线 Genre 关系、固定响度均衡和更严格的置信度门槛接入 Peregrine Lake。",
      sections:[
        {title:"GP Neural Engine 2.1 — Offline Genre Intelligence",items:[
          "Resonance Boost 的推荐介入门槛由 0.56 提升到 0.70；数据不足时 Shuffle 仍保持原始随机，不会被未成熟模型强行干预。",
          "新增完全离线的 Genre / Style 关系图。它以宽泛 Genre、子风格别名与固定关联权重连接 Pop、Rock、Electronic、R&B、Jazz 等体系，并在标签不匹配时用本地名称相似度映射最近类别。",
          "Genre 关系同时参与长期偏好、时段偏好、Session、Shuffle 与 Daily Mix 聚类。播放器运行时不请求 MusicBrainz、Discogs 或任何网络 API。"
        ]},
        {title:"GP Spectrum Engine 2.1 — Fixed Loudness Balance",items:[
          "Spectrum 分析从原曲固定 Loudness 计算保守的每曲增益并写入现有 IndexedDB 特征记录；已有缓存可直接从原 Loudness 补算，无需重新解码歌曲。",
          "音效页响度栏加入独立开关。均衡只通过双 Deck 各自的静态 Gain 平滑应用，不改写文件、不改写原曲 Loudness 显示，也不干扰 Crossfade、EQ 或 Spatial Bus。"
        ]},
        {title:"History & Interaction Repair",items:[
          "最近最爱中的最爱艺人固定使用过去十周记录；听歌记录默认打开“今天”。历史页容器获得严格的 min-width 与横向裁切约束，较长统计不再撑宽窗口。",
          "歌单与 Queue 行内操作扩大真实点击区域而保持图标与选中遮罩不变，减少误触整行播放。",
          "点击 Changelog 当前版本会打开一段项目纪念文字，复用底层玻璃模糊。装饰性小字说明从设置、推荐、图表和 PiP 弹窗中移除，必要确认与实时进度仍保留。"
        ]}
      ]
    },
    {
      version:"6.4.0", date:"2026-07-22", kind:"minor",
      summary:"PEREGRINE UPDATE：GP Core 4.0 引入 Peregrine Lake，将第三阶段源码分片迁入正式 Core / Adapter / Engine / Service / UI / Data / Bootstrap 层级，并建立可验证的模块治理、Port 边界与单一构建入口。",
      sections:[
        {title:"Peregrine Lake — Formal Architecture",items:[
          "现有第三阶段项目是唯一输入基线；真实实现从 src/js 与 src/modules 迁入正式目录，旧目录在迁移完成后删除，不从 original 或第一阶段 app.js 回建，也不创建第二套运行时。",
          "SOURCE_ORDER.txt 继续是唯一执行顺序，build.ps1 仍只输出 build/app.js，index.html 仍以普通同步脚本在 file:// 环境运行；没有 import/export、npm、Bundler、Electron、SQLite 或 IPC。",
          "模块工厂统一注册到 window.GPModules，由 bootstrap/main.js 显式创建唯一 Context；window.GP 保留兼容入口，并新增只读 public Facade。"
        ]},
        {title:"Core, Ports & Ownership",items:[
          "Core 现在提供 Module Registry、Event Bus、Actions、Store、Selectors、Contracts 与 App Context；长期状态、瞬时事件、命令和浏览器能力各自拥有明确通信路径。",
          "Browser Storage、File、PiP、Media Session 与 Clock Adapter 建立 Port 边界。未来 Electron Lake 只需替换浏览器 Adapter，现有 Services、Engines、UI 与数据契约无需重写。",
          "AudioContext、双 Deck、AudioNode、Crossfade 自动化、PiP Canvas 与 IndexedDB transaction 继续由各自运行时私有持有，绝不进入可序列化 Store。"
        ]},
        {title:"Service & Engine Contracts",items:[
          "Playback、Queue、Library、History、Spectrum、Neural、Settings 与 PiP 获得显式 Service 接口；Audio、Spatial、Recognition、Spectrum Analyzer 与 Motion 获得显式 Engine 接口。",
          "现有 Queue、Shuffle Timeline、Spectrum ID、MFCC/BPM/Energy、听歌历史、用户模型、推荐、Spatial A/B Bus 与 PiP 生命周期仍只保留一份真实实现；本次不修改算法参数、音频图、数据库 Schema 或用户数据。",
          "MODULE_API.md 记录每个公开接口的等级、参数、返回值、错误、副作用、调用者、测试与兼容策略；新接口默认 Experimental，满足真实演进与契约测试后才能升级。"
        ]},
        {title:"Permanent Governance & Validation",items:[
          "MODULE_GOVERNANCE.md 成为文件归属、职责、读写权限与允许依赖的永久权威；STATE_OWNERSHIP.md、DEPENDENCY_GRAPH.md、EVENT_CONTRACTS.md 与 STORE_SCHEMA.md 分别记录状态、依赖、事件和 Store 契约。",
          "新增 validate-architecture.ps1，对 SOURCE_ORDER 文件存在性、唯一归属、模块必填字段、API 契约、Stable 测试记录与循环依赖声明进行只读检查。",
          "本次迁移不改变 CSS、DOM、布局、Motion 参数、EQ、Spatial 参数、推荐权重、歌曲身份算法、localStorage key、IndexedDB 名称/version/store/index 或任何已有听歌数据。"
        ]}
      ]
    },
    {
      version:"6.3.2", date:"2026-07-22", kind:"patch",
      summary:"HARMONIC ENHANCE：GP Core 3.2 完成 Harmonic Lake 第一轮低风险模块化，将语言、更新日志、空间音效固定预设、PiP 纯绘制与通用工具迁移为明确的 GP 模块接口，同时保持播放、音频图、数据与界面行为不变。",
      sections:[
        {title:"GP Core 3.2 — Low-Risk Module Boundaries",items:[
          "建立兼容扩展的 window.GP.modules 命名空间，并新增 GP.utils、GP.i18n、GP.changelog、GP.spatialPresets 与 GP.pipRenderer；模块仍按 SOURCE_ORDER.txt 拼入唯一 build/app.js，不引入 ES Modules 或第三方构建工具。",
          "每项实现均从第二阶段 src/js 原位置迁移而非复制；原实现被删除，真实调用者改为模块 API，必要的 clamp、fmtTime、tr、translateTree 与 applyLanguage 别名仅作无状态转发。",
          "ui-static.js 因当前源码不存在边界清晰且有真实调用者的静态模板而未创建，避免制造没有调用者的未来接口。"
        ]},
        {title:"Stable Product Services",items:[
          "GP.i18n 私有持有完整 UI_EN 字典与两份 DOM 原文 WeakMap，但继续使用原有唯一 uiLanguage 状态；中英文切换、动态列表、Track Info、Settings、Changelog 与 PiP 同步语义保持不变。",
          "GP.changelog 私有持有唯一 RELEASES、英文摘要与英文详情数据，通过只读副本查询、渲染和导出 API 服务现有界面；6.3.1 与 6.3.2 记录已加入完整中英文日志。",
          "GP.spatialPresets 只提供八种固定预设、名称和说明的只读查询；GP.pipRenderer 只负责无状态圆角路径、文字裁切、封面绘制与尺寸计算。"
        ]},
        {title:"Zero Runtime Drift",items:[
          "Dual Deck、Crossfade、播放状态、Queue、Shuffle、IndexedDB、Spectrum ID、metadata、MFCC/BPM/Energy、听歌计时、Neural 推荐、Spatial Bus Runtime 与 PiP 生命周期均未模块化或改写。",
          "app.css、第一阶段 app.js 与 original/Glass Player 6.2.2.html 保持不可修改；localStorage key、数据库名称/版本、object store、index 与全部用户数据 schema 均未改变。",
          "构建继续由 build.ps1 严格按 SOURCE_ORDER.txt 以 UTF-8 无 BOM 顺序拼接；index.html 仍只同步加载 ./build/app.js，并维持单一外层 IIFE。"
        ]}
      ]
    },
    {
      version:"6.3.1", date:"2026-07-22", kind:"patch",
      summary:"HARMONIC ENHANCE：GP Core 3.1 在 6.3.0 物理拆分之上建立可维护源码分片与单文件构建链，同时保证构建结果与第一阶段 app.js 逐字节一致。",
      sections:[
        {title:"GP Core 3.1 — Source Slicing",items:[
          "第一阶段不可修改 app.js 被保留为校验基准；当前可维护源码按原始连续顺序划分为 11 个 src/js 分片，覆盖前导、状态与音频上下文、数据库、识别、Spectrum、i18n/日志、播放/队列、Spatial/EQ、History/Neural、UI/PiP 与初始化边界。",
          "分片只是源码物理边界，不使用 import/export，不移动声明、不格式化、不重命名，也不改变最外层 IIFE、作用域、提升关系或执行时机。"
        ]},
        {title:"Deterministic Single-File Build",items:[
          "SOURCE_ORDER.txt 成为唯一构建顺序来源；build.ps1 只按清单以 UTF-8 无 BOM 读取和连接分片，输出唯一 build/app.js。",
          "index.html 从 ./app.js 切换为只加载 ./build/app.js；不并行加载旧脚本、源码分片或模块文件，file:// 仍保持相对资源路径。",
          "阶段完成时 build/app.js 与第一阶段 app.js 的 SHA-256、文本和字节完全一致，函数声明、类声明、监听器、RELEASES、IIFE 与数据键计数保持一致。"
        ]}
      ]
    },
    {
      version:"6.3.0", date:"2026-07-22", kind:"minor",
      summary:"HARMONIC UPDATE：GP Core 3.0 将 Glass Player 从单体 HTML 物理拆分为 index.html、app.css 与 app.js，为后续开发建立清晰文件边界，同时保持现有播放逻辑、数据结构、界面层叠与执行时机不变。",
      sections:[
        {title:"GP Core 3.0 — Physical Separation",items:[
          "原有唯一主 style 内容按原始顺序完整迁移到 app.css；所有 selector、覆盖规则与层叠先后保持不变。",
          "原有主 script 内容按原始顺序完整迁移到 app.js；最外层 IIFE、strict mode、脚本在 body 末尾的执行位置与同步加载时机全部保留。",
          "index.html 仅以普通 stylesheet link 和非 module、非 defer、非 async 的 script 标签连接两个外部文件，不进行模块化、重构、重命名或格式化。"
        ]},
        {title:"Harmonic Baseline",items:[
          "完整的 Glass Player 6.2.2 单文件版本以不可修改基准保存在 original/Glass Player 6.2.2.html，可用于逐字符回拼和后续回归核对。",
          "双 Deck、Crossfade、EQ、GP Spatial Engine、PiP、Queue、Shuffle timeline、Spectrum ID、MFCC、BPM、Energy、听歌记录、推荐、Motion Engine、SSE、主题与语言均保持原有实现。",
          "localStorage key、IndexedDB 名称与版本、object store、index、schema、metadata、behaviorEvents、userModel、recommendations 与 trackCache 未迁移、未改名、未清理。"
        ]},
        {title:"Zero-Logic Contract",items:[
          "本次更新不包含性能优化、旧代码清理、重复 CSS 合并或架构模块化；除 6.3.0 发布信息与本条更新日志外，不改变任何运行逻辑。",
          "拆分产物通过原件哈希、CSS/JavaScript 内容顺序、IIFE 边界、脚本语法、外链位置与资源路径检查。"
        ]}
      ]
    },
    {
      version:"6.2.2", date:"2026-07-20", kind:"patch",
      summary:"HOTFIX BUILD：GP Spatial Engine 1.1 将八种空间状态重构为完全固定、可预测的调音，并以 400ms equal-power A/B Bus 切换消除播放中的声场漂移、音色跳变和音量呼吸。",
      sections:[
        {title:"GP Spatial Engine 1.1 — Static Presets",items:[
          "彻底移除播放过程中的 Correlation 定时器、100ms 参数刷新、动态 Width、动态 Reflection / Reverb / Chorus / HRTF 保护、Haas 与自动 Makeup Gain。Genre、BPM、MFCC、Energy、播放/暂停、切歌、Seek 和 Crossfade 均不会触发空间参数更新。",
          "Desktop Speakers、Studio Monitors、Wide Stage、Front Binaural、Live Hall、Cinema 与 Dreamscape 全部使用发布时固定参数；关闭开关构成第八种 No Spatial Audio 状态。",
          "同一模式播放期间 Low Side、Mid/High Width、Crossfeed、HRTF、四路 Reflection、Side Reverb、Chorus、Pre Gain 与 Output Trim 不会自行变化。"
        ]},
        {title:"400ms Equal-Power A/B Bus",items:[
          "Spatial Engine 预建两套轻量 Bus。正常播放只有当前 Bus 接入；用户主动切换模式时，未使用 Bus 写入全部固定参数并从 0 淡入，旧 Bus 同时以 equal-power 曲线从 1 淡出。",
          "400ms 结束后旧 Bus 输入立即断开，Dreamscape 之外的 Chorus LFO 停止。连续快速选择会只保留最后一个待切换模式，不会在半途重写仍可听见的 Bus。",
          "暂停、恢复、Seek、切歌与双 Deck Crossfade 不重建 Bus、不重新淡入空间模式，也不改变当前参数。"
        ]},
        {title:"True Bypass & Stable Output",items:[
          "No Spatial Audio 直接使用原有 post-EQ Dry Master 路径；两套 Spatial Bus 输入完全断开，HRTF、Reflection、Convolver、Width 与 Chorus 不再获得音频，Chorus LFO 同步停止。",
          "每套 Spatial Bus 使用固定 0.72 Pre Gain 与每模式固定 Output Trim，不存在实时峰值追踪、自动响度补偿或动态增益。",
          "常驻 Master Compressor 已移除。每套 Bus 末端仅保留 threshold -1dB、knee 0、ratio 12、attack 0.003、release 0.06 的轻量峰值安全器；原始 Dry 路径完全绕过它。"
        ]},
        {title:"Deterministic Space",items:[
          "所有模式彻底移除 Haas。Desktop / Studio 只以极轻 Crossfeed 为主且关闭 HRTF；Front 以 HRTF 为主；Wide 主要依靠静态 M/S Width；Hall / Cinema 只使用有限 Reflection 与 Side Reverb；只有 Dreamscape 运行 0.18Hz、1ms Depth 的轻 Chorus。",
          "四路 Early Reflection 固定为 8ms/-0.55、13ms/+0.45、21ms/-0.35、31ms/+0.65，内部 Gain 永不随机变化。",
          "0.55s、0.60s 与 0.75s IR 缓存在引擎初始化时以固定种子一次性生成并由两套 Bus 永久复用；不随歌曲、模式切换、主题或播放状态重新生成。"
        ]},
        {title:"UI & Preference Hotfix",items:[
          "空间开关现在记住上一次选择。关闭后再打开会恢复原模式，不再强制跳回 Desktop Speakers。现有七按钮布局、开关、设置存储键与中英文名称保持不变。",
          "倒感叹号说明弹窗提升到页面顶层定位，绕过 Sound 滚动 sector 的嵌套合成限制；它现在直接采样最终页面背景并继续复用 Snooze 的玻璃材质和 Motion 生命周期。",
          "EQ、Crossfade、Spectrum、MFCC、BPM、Energy、Queue、推荐、行为模型与听歌记录没有改动，也不会因本次更新重新分析或迁移。"
        ]}
      ]
    },
    {
      version:"6.2.1", date:"2026-07-20", kind:"patch",
      summary:"HOTFIX BUILD：修复空间音效说明弹窗未真正接入 GP Motion Engine 公共玻璃材质的问题。",
      sections:[
        {title:"Spatial Popover Glass",items:[
          "倒感叹号说明弹窗现在直接复用 Snooze、歌单排序与字体选择器的 gp-popover 底层契约，不再维护独立的背景模糊方案。",
          "弹窗统一使用当前主题计算出的半透明表面、8px contextual blur、低强度饱和度、边框与阴影；深浅主题和封面背景变化时会同步更新。",
          "保留原有七条空间模式说明、100ms hover 响应和点击立即显示逻辑，不改动 Spatial Audio Graph、模式参数或用户音频数据。"
        ]}
      ]
    },
    {
      version:"6.2.0", date:"2026-07-20", kind:"minor",
      summary:"AUDIO UPDATE：引入 GP Spatial Engine 1.0，在现有双 Deck、Crossfade 与 EQ 之后加入单实例、低负荷、相位受保护的七模式空间声场。",
      sections:[
        {title:"GP Spatial Engine 1.0",items:[
          "公共音频链更新为 Crossfade Output → Existing EQ → Spatial Engine → Limiter → Master Gain；继续只使用原来的 AudioContext 和两只 Deck，不创建第二套播放、Spectrum、MFCC、BPM 或 Energy 运行时。",
          "所有 Panner、Delay、Filter、Convolver、Gain 与相位检测节点首次播放时只创建一次。模式切换只用 120ms AudioParam Ramp 改变参数，不断线、不重建 Audio Graph。",
          "空间开关关闭时同时绕过 Spatial Wet Bus 与空间输出 Limiter，恢复真正的 EQ 后原始双声道直通；不会用变响制造更沉浸的错觉。"
        ]},
        {title:"Seven Spatial Modes",items:[
          "加入桌面音响、监听音箱、宽阔舞台、前置双耳、现场大厅、影院与梦境七种固定方案，分别侧重自然前置、准确中央、左右宽度、头外定位、厅堂距离、影院深度与漂浮氛围。",
          "低频使用 120Hz Mid / Side 约束，中频与高频分段扩宽；Crossfeed、并行 HRTF、四路早期反射、Side-only 短混响以及受限 Chorus / Haas 按模式组合。",
          "开关开启默认选择桌面音响；关闭时隐藏选择滑块但保留七个入口，直接点击任一模式会在原位置淡入滑块并同步开启。"
        ]},
        {title:"Phase & Output Protection",items:[
          "播放且页面可见时最多每 100ms 计算一次左右相关性；相关性降低时平滑收窄 High Side、Reflection 与 Reverb，负相关时关闭 Haas / Chorus 并强制低频 Side 归零。",
          "暂停或关闭 Spatial 后停止检测；隐藏页面时检测最高降至每秒两次。四条 Reflection 与一次生成的 0.9 秒 Stereo IR 是固定上限。",
          "轻模式预留约 -3dB、强模式约 -4.5dB 的内部叠加余量，并以 -2dB / 20:1 Limiter 保护峰值。"
        ]},
        {title:"Sound UI & Motion",items:[
          "EQ 重排为声音与设备两组；通用音色和针对 QC35、QC Earbuds、Poly Sync 40、靠墙显示器音响的设备补偿不再混在同一行。",
          "空间音效位于 EQ 与响度之间。倒感叹号按钮立即播放上下分离再无抽搐回弹的动效，hover 100ms 或点击直接显示七条通俗短说明。",
          "通用 segmented 底层增加按钮间距和文字两侧安全余量，滑块继续依据当前按钮的真实尺寸定位，不强制统一宽度。",
          "选择滑块改为单段连续位移与宽度插值，取消中途拉伸和二次落位；连续切换会从当前视觉位置平滑接续。关闭空间音频会立即清除旧模式的滑块、强调文字和按压残影。",
          "顺序、随机与单曲循环的图标在固定 22px 画布内只做原位 opacity 淡出/淡入，消除路径替换时的上下抽搐。页面与 sector 的 Fade 生命周期统一公开为 GP.motion 底层接口。"
        ]},
        {title:"Traditional PiP Clarity",items:[
          "Blurred Cover 小窗背景改为复用主界面约 58px 的柔化尺度并向画布外扩采样，不再清晰显示封面细节或露出模糊边缘。",
          "封面绘制边界与前景几何对齐到实际设备像素，改善小尺寸窗口的封面和文字锐度，同时保持固定 1080p 轨道、静态背景缓存与 60fps 动态前景。"
        ]}
      ]
    },
    {
      version:"6.1.0", date:"2026-07-20", kind:"minor",
      summary:"SNOW LEOPARD 2.0：在功能、视觉和本地用户数据完全不变的前提下，清理长期迭代留下的不可达旧实现，缩小单文件体积并降低首次解析负担。",
      sections:[
        {title:"Dead Runtime Removal",items:[
          "移除已被传统视频画中画完全替代的旧 Document PiP 文档、样式、队列镜像与同步生命周期；当前传统 PiP 的 1080p 固定画布、60fps 前景和静态背景缓存保持不变。",
          "移除 return 之后永远不会执行的旧侧边栏 WAAPI 动画分支，以及没有调用者的早期动效辅助函数。"
        ]},
        {title:"Parser & History Consolidation",items:[
          "移除已经被统一 metadata 管线替代的独立 ID3 / FLAC Genre 旧解析器；实际导入、重新扫描、封面与文件信息读取继续使用当前完整解析路径。",
          "移除已经被 5.9.0 索引化听歌记录渲染器替代的 renderHistoryLegacy；现行听歌统计、喜好、时段模型和可视化逻辑不变。"
        ]},
        {title:"User Data Safety Contract",items:[
          "不清空、不迁移也不重命名任何 localStorage 或 IndexedDB 数据库、对象仓库与键；听歌记录、behaviorEvents、userModel、recommendations 和历史身份映射全部保留。",
          "Spectrum ID、MFCC、BPM、Energy、Genre、文件快照和重新扫描前后 identity 兼容路径全部保留；已经分析过的歌曲不会因为本次精简而重新分析。"
        ]},
        {title:"Zero Visual Change",items:[
          "保留全部现行 CSS 与层叠覆盖关系，不合并可能改变优先级的重复 selector；SSE、玻璃材质、响应式布局和 Motion Engine 的最终视觉输出不变。",
          "本次只删除经引用审计确认不可达的旧 JavaScript，当前播放、导入、Queue、历史、设置、更新日志和传统 PiP 的用户路径不变。"
        ]}
      ]
    },
    {
      version:"6.0.4", date:"2026-07-20", kind:"patch",
      summary:"HOTFIX BUILD：固定传统 PiP 视频轨道尺寸，消除缩放时窗口自放大与右边界抽搐，并将静态背景与高帧率动态内容彻底分层。",
      sections:[
        {title:"Stable PiP Geometry",items:[
          "视频轨道在整个 PiP 生命周期内固定为 1920 × 1080；拖动窗口只连续调整内部封面与文字比例，不再改变 Canvas 固有分辨率或触发 Edge 重设窗口大小。",
          "移除 440px、320px 等离散布局跳点，改为依据小窗宽度连续插值封面尺寸、位置和字号，右边界不再跨阈值突然位移。"
        ]},
        {title:"Layered Rendering",items:[
          "背景、封面取色与 Blurred Cover 缓存为静态层，仅在歌曲、主题、Accent 或背景模式变化时重建；高成本背景滤镜不进入逐帧循环。",
          "前景封面、歌名、播放进度、时间和播放状态在独立动态层合成，视频流从 3fps 恢复为最高 60fps。",
          "固定 1080p 超采样源为小尺寸窗口提供稳定清晰度，同时避免 4K 背景每帧重绘导致播放卡顿。"
        ]},
        {title:"Title Marquee",items:[
          "歌名能够完整显示时保持静止；超出可用宽度时先停顿 1.1 秒，再以恒定速度连续循环滚动。",
          "滚动尾部保留间距并接回下一轮标题，不截断为省略号；更换歌曲、字体、粗细或窗口宽度后重新从歌名开头计时。"
        ]}
      ]
    },
    {
      version:"6.0.3", date:"2026-07-20", kind:"patch",
      summary:"HOTFIX BUILD：修复传统 PiP 在暂停时冻结设置画面的问题，并为小尺寸窗口加入清晰度优先的紧凑构图与低负荷渲染策略。",
      sections:[
        {title:"True Live Synchronization",items:[
          "传统 PiP 视频处于暂停时，主题、背景、字体、字号、粗细或 Accent 改动会短暂推送一帧更新后恢复暂停，不会启动主音频，也不需要重新打开小窗。",
          "PiP 窗口尺寸变化被直接监听；缩放结束后按照真实宽高重新选择构图和像素输出。"
        ]},
        {title:"Compact Clarity",items:[
          "小尺寸 PiP 自动放大封面、歌名与歌手字号，减少次要说明占用，避免把完整桌面构图整体压缩成模糊缩略图。",
          "封面缺失时只保留干净的半透明封面底板，彻底移除封面中心的圆点占位符。",
          "Blurred Cover 在紧凑尺寸下降低模糊半径，前景原始封面始终不参与背景滤镜。"
        ]},
        {title:"Playback-First Performance",items:[
          "Canvas 分辨率按 PiP 窗口实际物理尺寸进行约 2.15 倍超采样：小窗从 1600px 起步，只有真正放大时才逐级提升至 4K。",
          "视频流限制为 3fps，播放进度画面最多约每 480ms 重绘一次；主题和字体等用户操作仍即时刷新，避免 4K 背景滤镜持续争抢 GPU。"
        ]}
      ]
    },
    {
      version:"6.0.2", date:"2026-07-20", kind:"patch",
      summary:"HOTFIX BUILD：重构传统 PiP 的实时设置同步、背景分层与像素输出，使主题、字体和背景调整无需关闭小窗即可生效。",
      sections:[
        {title:"Live Settings Sync",items:[
          "深色/浅色/自动主题、Accent、背景模式、界面语言、字体、字体大小和字体粗细统一进入 PiP 重绘信号；设置变化在当前小窗内直接更新，不再要求重新打开。",
          "自适应封面 Accent 异步完成后也会单独触发同步；同一动画帧内的连续设置更新会合并为一次绘制。"
        ]},
        {title:"Distinct Background Modes",items:[
          "灵动光晕使用克制的 Accent 光斑；封面取色使用封面提取的三色空间渐变；封面虚化才绘制真实封面背景，三种模式不再被同一层模糊覆盖。",
          "移除视频画面外围的玻璃面板描边与封闭边界，让封面、文字和背景直接组成一张完整画面。"
        ]},
        {title:"Adaptive High Resolution",items:[
          "PiP Canvas 按屏幕物理像素自动选择 1920、2K 至最高 3840 × 2160 输出；4K 屏幕不再继续使用固定 1280 × 720 视频源。",
          "高清缩放在设计坐标层统一完成，前景封面保持原始 coverUrl、高质量采样且不应用背景模糊；文字阴影模糊被移除，字体边缘更清楚。"
        ]}
      ]
    },
    {
      version:"6.0.1", date:"2026-07-20", kind:"patch",
      summary:"HOTFIX BUILD：悬浮播放器由 Document PiP 改为传统视频画中画，移除文件来源地址栏，并以高清画布重新输出封面与播放信息。",
      sections:[
        {title:"Borderless Video PiP",items:[
          "停用带页面来源栏的 Document Picture-in-Picture 路径，改用 Edge 原生视频画中画外壳；悬浮窗不再显示 file 地址栏。",
          "上一首、播放/暂停与下一首继续通过浏览器原生 PiP 控件和现有 Media Session 接口控制 GP，音频、Web Audio 与 Spectrum 分析仍只运行一份。"
        ]},
        {title:"High-Resolution Visual Surface",items:[
          "使用 1280 × 720 高分辨率 Canvas 生成 PiP 视频画面，前景封面优先读取原始 coverUrl，不再把低分辨率 thumbUrl 放大为主封面。",
          "画面同步当前封面、歌名、歌手、进度、播放状态、深浅色、Accent、字体与字体粗细；只有画面或播放状态变化时才重绘。"
        ]},
        {title:"Lifecycle Hotfix",items:[
          "关闭 PiP 后立即停止临时 Canvas 视频轨道、移除隐藏 Video/Canvas 并断开主题观察器，避免后台持续绘制或占用 GPU。",
          "不支持传统画中画、权限被拒绝或创建失败时继续使用 GP 玻璃弹窗说明真实原因。"
        ]}
      ]
    },
    {
      version:"6.0.0", date:"2026-07-20", kind:"major",
      summary:"ACCESSIBILITY UPDATE：Glass Player 进入 Gen 6，以原生 Document Picture-in-Picture 带来真正置顶、可缩放且与主播放器双向同步的悬浮播放器。",
      sections:[
        {title:"GP Core 2.3 — Multi-Document Runtime",items:[
          "主页面继续作为唯一音频源；悬浮窗不复制 Audio、Web Audio、Spectrum 分析或播放状态，只调用现有上一首、播放/暂停、下一首与歌曲选择接口。",
          "当前歌曲、封面、进度、播放状态、主题、Accent、字体、粗细、语言和队列通过轻量同步层投射到同源 PiP 文档。",
          "窗口关闭、页面退出或浏览器拒绝创建时完整释放 Observer、Resize 计时器和临时引用，不残留第二套运行时。"
        ]},
        {title:"GP Fusion Engine 2.0 — Floating Player",items:[
          "Snooze 右侧加入无文字圆形悬浮播放器入口；两个错位圆角窗口组成图标，整组控制仍以 Snooze + PiP 的组合宽度保持居中。",
          "Document PiP 窗口由 Edge 保持在其他窗口上方，可由用户拖动位置并调整大小；上次宽高会作为下一次打开时的建议尺寸。",
          "静态封面、歌名、歌手、进度和上一首/播放/下一首构成核心界面；足够宽且足够高时才显示最多 5–8 首精简 Up Next，避免队列挤压播放器。",
          "不支持 API、页面环境未开放、权限拒绝或窗口创建失败时显示正式玻璃弹窗，并给出 secure、protocol 或浏览器错误信息。"
        ]},
        {title:"GP Motion Engine 3.1 — Responsive PiP Motion",items:[
          "入口图标 hover 300ms 后或点击时触发：后层窗口向右上、前层窗口向左下分离，再沿稳定曲线弹回原位。",
          "PiP 播放按钮与上一首/下一首沿用主播放器的圆形层级、Accent 状态和 500ms 微交互，不产生结束帧抽搐。",
          "窗口按真实宽高切换极小、紧凑、纵向、标准、超宽低高和大型队列布局；很窄但很长时封面转为上方静态展示，很宽但很矮时使用低高度横向布局。",
          "背景直接复用当前 Glow、封面取色或 Blurred Cover 状态与主题变量，不重新提取封面颜色，也不启动第二套动态背景。"
        ]}
      ]
    },
    {
      version:"5.9.0", date:"2026-07-20", kind:"minor",
      summary:"HOTFIX BUILD：重构听歌记录的数据读取路径，统一五个听歌时段，并确保喜好、时段结论和统计数据随新记录可靠刷新。",
      sections:[
        {title:"History Performance",items:[
          "Spectrum ID、旧歌曲键与歌手/歌名别名在进入听歌记录前一次性建立索引；排行榜、最近最爱和洞察不再为每一条历史记录反复遍历整个歌单。",
          "Top 50 行启用浏览器原生的屏外内容跳过，未进入可视区域的歌曲不再持续参与布局和绘制；封面继续按需解码，界面结构与视觉保持不变。",
          "排行榜、最近最爱与听歌数据进行批量 DOM 提交；提交期间跳过 SSE 的中间 Mutation 测量，内容稳定后只重新测量一次。"
        ]},
        {title:"Reliable Preference Refresh",items:[
          "听歌历史每次写入仍立即更新内存版本；当听歌记录页处于可见状态时，界面最多每 30 秒在空闲帧刷新一次，避免每 8 秒全量重绘。",
          "最爱歌曲、艺人、专辑、Genre、听歌时段、排行榜、图表与洞察都以同一历史版本签名失效，不会继续显示旧结论。",
          "Neural 长期偏好仍由有效行为触发，并限制为最多每分钟重建一次；缓存模型超过六小时或模型版本变化时会自动重建。"
        ]},
        {title:"Five Listening Periods",items:[
          "深夜 22:00–04:59、清晨 05:00–09:59、午间 10:00–14:59、下午 15:00–17:59、晚间 18:00–21:59。",
          "听歌记录的时段结论与 Neural Engine 的时间情境使用同一个底层时段函数；旧行为事件会在本版本首次模型重建时按新边界重新归类。"
        ]}
      ]
    },
    {
      version:"5.8.6", date:"2026-07-18", kind:"patch",
      summary:"HOTFIX BUILD：重新平衡播放器封面、上下安全留白与独立播放模式按钮间距，并把拖动圆点收紧为可透视滑轴的 Accent 玻璃材质。",
      sections:[
        {title:"Responsive Player Spacing",items:[
          "完整恢复 5.8.1 及更早版本的播放器内部排版参数：较大的内边距、190–330px 唱片范围以及歌曲信息到进度条的独立间距。",
          "随机播放、上一首、播放和下一首重新作为四项完整控制组居中，与参考截图保持相同的横向节奏。",
          "唱片、歌曲信息、进度、播放控制、音量和 Snooze 作为一个整体按播放器高度垂直居中，顶部与底部自然形成近似对称的空间。"
        ]},
        {title:"Transparent Accent Range Thumb",items:[
          "拖动圆点由 18px 收紧至 15px，仅比默认圆点大 1px，并继续保留当前 Accent 色相。",
          "显著降低玻璃填充与背景模糊，使滑轴直线能够真实穿透圆点显示；松手后仍立即恢复默认实心 Accent 圆点。"
        ]},
        {title:"Paused Turntable Seam Repair",items:[
          "空唱盘由带角向切线的环形高光改为连续径向亚克力明暗，暂停在任意旋转角度都不会再从圆心射出斜向亮条。",
          "唱针杆的 1px 外边框改为内部亚像素轮廓，避免 Edge 缩放时把斜边重采样成突兀白条；唱针造型、角度与运动时序保持不变。"
        ]}
      ]
    },
    {
      version:"5.8.5", date:"2026-07-18", kind:"patch",
      summary:"HOTFIX BUILD：重新校准播放器封面与底部交互区的垂直分配，修正播放控制行的真实视觉中心，并恢复滑轴圆点正确的默认与拖动状态。",
      sections:[
        {title:"Player Geometry Correction",items:[
          "封面在左侧播放器 sector 内明确下移，同时继续按 sector 的实际宽高自适应缩放；底部进度、控制、音量与 Snooze 仍固定在安全边距内。",
          "上一首、播放与下一首组成真正居中的三按钮主轴；播放模式按钮退出主轴排版并独立定位，其文字标签不再把整行图标向上或向右推偏。"
        ]},
        {title:"Range Thumb State Repair",items:[
          "未操作时恢复清晰的 Accent 实心圆点；只有鼠标按住并拖动期间才替换为保留同一 Accent 色相的半透明玻璃圆点。",
          "松开、取消拖动、在控件外松开或失去焦点都会立即销毁临时玻璃层；鼠标移走后不再残留错误的选中状态。"
        ]}
      ]
    },
    {
      version:"5.8.4", date:"2026-07-18", kind:"patch",
      summary:"HOTFIX BUILD：重做播放进度右侧四频段显示和设置滑轴选中材质，并重新分配播放器左区的封面与底部交互空间。",
      sections:[
        {title:"Pixel-Exact Spectrum Meter",items:[
          "四频段指示由四个 2.5px CSS 元素改为单一高 DPI Canvas；每次按实际显示尺寸与 devicePixelRatio 计算整数物理像素。",
          "四根柱在任何页面自适应缩放、Edge 缩放和 DPI 组合下共享同一个整数宽度与间距，并在窗口变化时重新居中绘制；四频段响度逻辑保持不变。"
        ]},
        {title:"Persistent Range Glass",items:[
          "时长、字体大小和字体粗细滑轴在聚焦或拖动期间持续保留真正的玻璃圆点，不再在鼠标松开时立即退回黑色 Accent 原生圆点。",
          "失焦后的原生圆点也使用独立半透明渐变、轻边框与阴影；深色背景下仍可辨认，但不会成为实心黑块。"
        ]},
        {title:"Responsive Player Rebalance",items:[
          "进度、播放控制、音量和 Snooze 组成固定的底部交互栈并贴近播放器底部安全边距，上方空间交还给封面与歌曲信息。",
          "唱片和静态封面按左侧 sector 自身宽度、高度和剩余控制区空间共同缩放；全屏时放大，窄窗或矮窗时按比例缩小，始终保持正方形与边框余量。"
        ]}
      ]
    },
    {
      version:"5.8.3", date:"2026-07-18", kind:"patch",
      summary:"HOTFIX BUILD：清除播放器相邻 sector 的错误阴影叠色，修复设置滑轴的实心圆点，并以可靠的测量与分阶段运动重写长歌名滚动。",
      sections:[
        {title:"Player Surface Repair",items:[
          "移除播放器左右两个玻璃 sector 各自向外扩散的阴影，只保留固定内边框；中央间隙和四个外角不再因双重投影形成与实时背景不同的暗色区域。",
          "播放器布局、玻璃透明度、圆角、主题色和内部内容保持不变。"
        ]},
        {title:"Range Glass Foundation",items:[
          "时长、字体大小和字体粗细滑轴在拖动时强制隐藏原生实心圆点的背景、边框、阴影与缩放，只显示独立覆盖的玻璃圆点。",
          "浅色与深色模式分别使用明确的低透明度表面、轻边框与 9px 背景模糊；滑轴圆点继续与弹窗材质分离。"
        ]},
        {title:"Deterministic Title Marquee",items:[
          "每次选歌后先显示歌名开头并短暂停顿；只有真实溢出的标题才建立双副本滚动轨道。滚动全程保持同一速度，并按当前页面缩放比例换算，使全屏与缩小窗口的肉眼速度一致。",
          "副本间距增至 88px，起点与完整一圈后的终点使用同一 14px 内边距；测量和位移统一使用缩放前 CSS 坐标，修复自适应缩放导致的欠移动、前抽和终点偏离。",
          "选歌、首次导入长标题、字体加载、进入播放页和窗口尺寸变化都会生成新的测量版本；旧动画立即取消，隐藏状态下持续重试而不会漏触发。"
        ]}
      ]
    },
    {
      version:"5.8.2", date:"2026-07-18", kind:"patch",
      summary:"HOTFIX BUILD：修复播放器响应式边界、Queue 更新抽搐、选择遮罩与标题滚动，重新分离弹窗和滑动圆点材质，并消除缩放时的字体毛刺与重影。",
      sections:[
        {title:"Player Geometry & Queue",items:[
          "播放器左右区域改为可收缩网格，右栏、Queue 内容和长歌名不再撑宽整个播放器；当前歌曲切换时复用现有 Queue 行，只更新播放状态和位置，避免右边界重建抽搐。",
          "唱片与静态封面按可用宽度、高度及边框余量共同缩放，在非全屏 Edge 窗口中保持居中且不贴边、不溢出。",
          "Sound 与其他分段选择器加入尺寸和字体加载监听，窗口缩放、页面缩放或字体变化后立即重测遮罩几何。"
        ]},
        {title:"Motion & Typography",items:[
          "页面、面板、Queue、EQ、播放模式和弹窗的淡入淡出按同一比例压缩时长，完整保留原有运动曲线与阶段。",
          "移除整页文字容器的强制 GPU 位图层和人工文字描边；窗口适配缩放对齐设备像素步进，改善特定缩放比例下的字体毛刺、重影和闪烁。",
          "长标题只在真实溢出时滚动；统一起止位置，增加副本间空白，并在完整一圈末端平滑减速后停顿，避免尾字残留和突然跳回。"
        ]},
        {title:"Glass Controls",items:[
          "字体弹窗移至页面级玻璃层，真实复用 Snooze 的表面、模糊、边框和阴影，避免设置面板嵌套合成改变材质。",
          "滑动圆点建立独立的高透明材质变量，不再套用较实的弹窗表面；四频段指示器重做为等宽、等距网格。"
        ]}
      ]
    },
    {
      version:"5.8.1", date:"2026-07-18", kind:"patch",
      summary:"HOTFIX BUILD：重新校准 FINAL PANTHER REFORM 的切换时序、播放动效与玻璃控件，修复首击延迟、错误标题滚动及唱片/唱针不同步。",
      sections:[
        {title:"Motion Timing Repair",items:[
          "主页面、播放器右栏、听歌记录与更新日志统一改为完整淡出、短暂露出真实背景、再淡入；不再使用过快的交叠切换。",
          "播放器右侧 Queue / Sound / Daily Mix 的滑块在点击当下立即响应，内容提交只认最后一次选择，修复需要二次点击及落后一个状态的问题。",
          "EQ 选中材质拥有独立退场、背景停顿和新按钮入场动画，不再只切换 active 状态。"
        ]},
        {title:"Playback Motion Repair",items:[
          "Daily Mix 的播放三角形先收缩，再在恢复放大的同时释放三角形雾粒脉冲；主侧边栏 Play 在原有圆形与三角脉冲基础上加入三角形预收缩。",
          "唱片使用 720ms 有限减速曲线，并与唱针返回使用同一开始时刻和结束时刻；移除渐近停止与唱针末端抽搐。",
          "上一首/下一首缩短至 300ms，并将蓄力与撞击提前到动画前段，消除视觉响应延迟；四频段指示重新分配间距。"
        ]},
        {title:"Typography & Glass Controls",items:[
          "标题只有在自然文字宽度真实超过容器时才滚动；溢出标题使用双副本无缝循环，以更快速度完整滚动一圈，并在与起点重合后停顿。",
          "字体弹窗强制复用 Snooze / Sort 的同一背景、模糊、边框与阴影变量。",
          "进度与设置滑动轴在拖动时隐藏原生圆点，改用独立的 Snooze 材质玻璃圆点；空唱片移除音乐符号，只保留玻璃拟物轴芯。"
        ]}
      ]
    },
    {
      version:"5.8.0", date:"2026-07-18", kind:"minor",
      summary:"FINAL PANTHER REFORM：完成 Queue、页面切换、播放动效与设置交互的系统级收尾，并将重叠淡入淡出升级为 GP Motion Engine 3.1。",
      sections:[
        {title:"GP Motion Engine 3.1 — Overlap Bridge",items:[
          "主侧边栏、播放器右栏、听歌记录、更新日志与 EQ 统一使用透明度重叠桥接；旧内容尚未完全淡出时新内容已开始淡入，缩短响应等待且不改变落位几何。",
          "清空 Queue 使用相同淡入淡出底层，并在提交帧直接定位当前歌曲，不再从歌单顶部平滑滚动。",
          "播放模式图标与 EQ 选中态采用相同的交叠淡出/淡入节奏；字体选择弹窗接入 Snooze 的标准玻璃材质。"
        ]},
        {title:"Queue & Playback Reliability",items:[
          "Queue 通过 Spectrum ID / 稳定音频身份统一阻止重复歌曲；再次加入时明确提示“已经在播放队列中”。",
          "顺序、随机和单曲循环状态均使用 Accent；清空手动 Queue 后立即恢复正常播放队列及当前歌曲位置。",
          "唱片暂停改为物理减速并保留最终角度，消除瞬停后的反向抽搐；长歌名加入单次滚动、停顿与循环显示。"
        ]},
        {title:"Control & Settings Polish",items:[
          "上一首/下一首在按下瞬间响应：三角形先反向蓄力，再回弹触及竖条；影子距离收敛，四条实时频段指示改为等距。",
          "每日推荐的播放三角形复用播放语义脉冲，文字保持静止；静态封面略微放大并上移至唱片中心。",
          "设置开关支持点击与横向拖动；所有横向滑动轴校正圆心，并在拖动时使用选中滑块同款玻璃状态；左上角 Logo 允许完整溢出，避免底部裁剪。"
        ]}
      ]
    },
    {
      version:"5.7.0", date:"2026-07-18", kind:"minor",
      summary:"FOUNDATION UPDATE：GP Core 2.2 与 GP Motion Engine 3.0 将界面能力升级为可声明、可组合、可自动挂载的 UI 底层；新页面可以通过统一 Class 接入 SSE、选择滑块、弹窗材质、按压反馈和页面生命周期。",
      sections:[
        {title:"GP Core 2.2 — Declarative UI Registry",items:[
          "新增 GP.ui 注册中心，统一提供 register、mount、refresh 与 observe 生命周期；每个组件只挂载一次，并通过幂等状态防止重复事件和重复 Observer。",
          "MutationObserver 以动画帧批处理动态加入的 DOM。未来页面或异步生成组件只要使用已知 Class / data contract，就会自动完成初始化，不需要继续扩大固定 ID 数组。",
          "公开 GP.ui.switchView、GP.ui.transitionSector 与 GP.ui.setPopover 接口，同时保留 Galaxy、Timeline 模块边界和现有播放业务调用方式。"
        ]},
        {title:"GP Motion Engine 3.0 — Class-composed Motion",items:[
          "gp-sse / data-gp-sse 自动接入 Harmonic Reform Shell / Viewport、滚动端点检测、ResizeObserver 与内容变化重测量；自有表面和共享 Panel 两种模式继续保持相同视觉。",
          "gp-segmented / data-gp-glider 自动生成并重测选择滑块；gp-action 自动获得全局按住—释放反馈；gp-popover 自动复用 Snooze 的玻璃材质和统一进出生命周期。",
          "gp-adaptive-title 与 gp-context-control 为未来页面提供局部背景可读性和控制层取色入口；页面切换和 Sector 切换仍只改变透明度，不触碰几何落位。"
        ]},
        {title:"Zero-regression Compatibility",items:[
          "5.6.3 的播放器、Library、Queue、Sound、Listening History、Settings、Changelog、主题与响应式排版继续使用原来的 DOM 和视觉参数，只由注册中心接管初始化。",
          "Spectrum ID 仍在导入阶段立即生成；MFCC、BPM、Energy 和 Loudness 继续采用缓存优先的后台分析并写入 IndexedDB。本次更新不改变音频识别算法、推荐权重或播放顺序。"
        ]}
      ]
    },
    {
      version:"5.6.3", date:"2026-07-17", kind:"patch",
      summary:"HOTFIX BUILD：彻底移除页面落位阶段的几何位移，并将每日推荐改为基于 Spectrum ID、Genre、MFCC、BPM 与 Energy 的单一风格簇生成。",
      sections:[
        {title:"Stable View Commit",items:[
          "主页面和可切换 Sector 的进入/退出只改变透明度，不再动画 transform、scale 或文字栅格位置；目标页面先在不可见状态完成高度、缩放和滑块布局，再开始淡入。",
          "动画由真实 animationend 完成收尾，计时器只作为异常兜底，消除动画尾端与静态帧交接时的整体突然位移。"
        ]},
        {title:"Feature-clustered Daily Mix",items:[
          "每日推荐先从已有 Spectrum ID、Genre 与 MFCC 证据选择一个核心风格锚点，再以 MFCC 距离为主要声学近邻依据，并用 BPM、Energy 与用户偏好作次级排序。",
          "已知 Genre 不同的歌曲只有在 MFCC 高度相似时才允许跨簇，避免 Electronic / EDM 与无关唱作流行歌曲交错出现。",
          "导入完成后自动生成；后台 Spectrum 分析补齐 MFCC 后会自动重建。移除手动生成按钮，播放控件改为三角形图标加“播放”。推荐列表不再显示左侧原歌单序号。"
        ]},
        {title:"Queue Interaction Repair",items:[
          "加入手动 Queue 后立即清除歌单操作按钮遗留的按压、光晕和焦点状态，不再留下上一次操作遮罩。",
          "加入 Queue 的三横杠蓄力后只回弹至 5°；手动 Queue 拖拽浮层复用 Snooze 弹窗的背景、模糊、边框与阴影材质。"
        ]}
      ]
    },
    {
      version:"5.6.2", date:"2026-07-17", kind:"patch",
      summary:"HOTFIX BUILD：重建深浅主题与封面 Accent 的往返计算，加入 18:00–05:00 自动深色时段，并稳定页面入场、标题对比、实时四频段波形与列表操作动效。",
      sections:[
        {title:"Theme-safe Accent Pairing",items:[
          "每套手动主题色拥有独立的浅色与深色版本：保持相同色相，深色界面使用更明亮的 Accent，浅色界面使用更沉稳的 Accent。",
          "封面自适应颜色永久从未经加工的原始调色板重新计算；浅色→深色→浅色不再拿上一次加工结果继续计算，也不再读取主题过渡中的临时背景帧。",
          "自动主题固定为 05:00–18:00 浅色、18:00–05:00 深色，并在边界时间自动切换。生成/播放推荐、导入、排序与更新日志操作控件获得较轻的背景协调。"
        ]},
        {title:"Direct Surface Readability",items:[
          "歌单、听歌记录、设置和更新日志标题分别按自身所在坐标估算直接位于其后的封面模糊/色块表面，并独立选择黑色或白色文字。",
          "页面尺寸、主题、背景模式和封面调色板改变后会重新计算，不再把浅色模式一律等同于黑色标题。"
        ]},
        {title:"Motion & Live Spectrum",items:[
          "主页面先完成最终高度布局再开始从左淡入；动画终点与静态帧完全一致，移除落位瞬间的整体抽搐。",
          "进度条右侧四条波形分别读取低频、低中频、中高频和高频的实时 Analyser 响度；暂停或页面隐藏时立即停止绘制。",
          "歌单和每日推荐移除删除叉号；下一首、加入 Queue、手动 Queue 删除和拖拽排序手柄加入 300ms 延迟 Hover 与点击动效。"
        ]}
      ]
    },
    {
      version:"5.6.1", date:"2026-07-17", kind:"patch",
      summary:"HOTFIX BUILD：修复主题往返后的自适应 accent 对比失真，并稳定唱盘旋转与唱针亚克力合成层，同时移除旋转子树中的实时背景采样。",
      sections:[
        {title:"Theme-safe Adaptive Accent",items:[
          "Accent 写入统一经过单一提交函数，同时刷新 --accent、--accent-rgb、--accent-contrast 与唱盘派生色，避免同一次主题切换产生互相覆盖的中间状态。",
          "每首歌曲缓存最近一次封面调色板；浅色/深色切换时先用该调色板立即按新背景重算可读颜色，再由同一请求代次完成异步校验。旧主题结果不能覆盖新主题。",
          "手动与自适应配色都会重新计算黑白前景对比，不再沿用上一个主题的 --accent-contrast。"
        ]},
        {title:"Stable Turntable Composition",items:[
          "唱盘改由一条永久存在的14秒CSS旋转时间线管理；页面切换、主题切换和暂停只改变播放状态，不重建动画，因此角度连续且不会回正或跳帧。",
          "唱盘、轴心与唱针使用同一个稳定派生 accent RGB，主题更新只提交一次颜色，避免透明圆盘先闪亮再跳到最终色。",
          "移除旋转轴心和唱针基座中的实时 backdrop-filter 采样，保留原有渐变、透明度、阴影和饱和视觉；旋转时不再每帧重新采样其后方4K图层，降低3D合成压力。"
        ]}
      ]
    },
    {
      version:"5.6.0", date:"2026-07-17", kind:"minor",
      summary:"PANTHER UPDATE：GP Motion Engine 2.4 与 GP Fusion Engine 1.1 统一修复主题自适应、可回溯随机播放、Queue 拖拽落位和并发通知反馈。",
      sections:[
        {title:"Adaptive Glass & Contrast",items:[
          "浅色模式的添加文件、添加文件夹、排序、听歌记录横栏、导出日志和当前版本控件移除白色内描边；更新日志两个控件统一字号、32px高度与垂直居中。",
          "最近最爱的答案不再退化为纯黑字：系统保留当前 accent 的色相，在真实卡片合成色上动态调整亮度，达到可读对比度。四张卡片和听歌习惯区统一为无侧边色条、无夹层阴影的 accent 玻璃边界。",
          "歌单、听歌记录、设置与更新日志标题在浅色模式下结合封面调色板和背景模式估算真实底色，再智能选择黑色或白色。",
          "主题切换加入异步 accent 请求代次保护；浅色→深色→浅色时，旧主题的封面取色结果不能覆盖新主题计算。唱针轴心圆盘固定在稳定的 accent 亚克力合成层，页面切换不再闪成亮白色。"
        ]},
        {title:"GP Motion Engine 2.4",items:[
          "上一首/下一首扩展为600ms方向动画：三角形先向反方向蓄力，再弹向竖片并平滑归位；残影更清晰但只延伸短距离。",
          "Queue拖拽期间仅目标区间歌曲让位。松手后取消全列表二次FLIP交换，只让被拖歌曲从浮层落入最终位置，并为序号加入轻微淡入缩放。原位置不再残留半透明影子。",
          "歌单与Queue的删除按钮复用下一首/加入Queue的shader；删除、清空均产生明确通知。"
        ]},
        {title:"GP Fusion Engine 1.1",items:[
          "Shuffle使用最多21个位置的有界时间线，保留当前歌曲之前最多20首。上一首只沿历史后退；后退后再按下一首会沿原随机路线前进，不会重新抽取歌曲。",
          "通知系统改为可并发的FIFO视觉栈：新通知从右侧进入并位于底部，旧通知平滑上移；每张通知顶部使用accent进度条显示剩余时间，结束后从右侧退出。",
          "通知生命周期不参与Queue添加判定，连续快速加入歌曲不会等待上一条通知离场。"
        ]}
      ]
    },
    {
      version:"5.5.9", date:"2026-07-17", kind:"patch",
      summary:"HOTFIX BUILD：校正浅色模式的控制层级与自适应 accent，可读性；收紧 Snooze / 前后切歌动效；并修复 queue 添加与清空后的播放状态残留。",
      sections:[
        {title:"Light Mode Contrast",items:[
          "浅色模式下，歌单的添加文件、添加文件夹、排序按钮，听歌记录横栏，以及更新日志的导出日志和当前版本标签获得更明确但仍透明的白色底层。",
          "最近最爱的答案颜色根据当前背景调色板、玻璃合成色与卡片 accent 混色估算结果，在黑色或白色之间自动选择对比度更高的一种。",
          "封面自适应 accent 在 OKLab 中限制过高明度与色度，并把选中滑块自身的半透明 accent 背景纳入对比计算；浅色模式不会再产生过浅、刺眼又难读的选中文字。"
        ]},
        {title:"Motion Refinement",items:[
          "Snooze 的三个 Z 缩短 S 形路径，最终方向由向右30度收敛为垂直偏右15度；横向摆动和旋转幅度降低，使轨迹更温柔并继续保持在按钮边界内。",
          "上一首/下一首取消 hover 触发，只在点击时运行300ms；竖条到达最远点后立即原路收回，残影只移动一小段并在前68%的时间内结束。",
          "全局按钮按下反馈改为按压状态机：pointerdown 到达中间态后保持，只有 pointerup / pointercancel 才执行回弹和淡出，不再按住鼠标时提前跑完。"
        ]},
        {title:"Queue Reliability",items:[
          "普通加入 queue 允许同一歌曲形成多个独立排队项；设为下一首仍保持原逻辑，如果歌曲已经排队就移动到队首。",
          "删除最后一个排队项、清空 queue 或从歌单移除最后一个相关项时，会同时释放 playingQueuedTrack 与 queueResumeIndex，下一首立即恢复当前播放模式，不再被已清空的 queue 接管。"
        ]}
      ]
    },
    {
      version:"5.5.8", date:"2026-07-17", kind:"patch",
      summary:"HOTFIX BUILD：为 Snooze、上一首与下一首补齐语义微动效，并将 Snooze 的玻璃弹窗材质写入 Motion Engine 底层供歌单排序复用。",
      sections:[
        {title:"Snooze & Skip Micro-interactions",items:[
          "睡眠定时按钮加入400ms时钟轻摆与三个依次升起的Z；Z沿S形轨迹向右上约30度淡出，悬停300ms后触发，点击立即重播。英文名称由Sleep Timer统一为Snooze。",
          "上一首与下一首加入400ms方向动画：外侧竖条先向目标方向弹出，再沿原路径拉回；最远点留下的克制残影继续向外淡出。"
        ]},
        {title:"GP Motion Engine — Shared Popover Material",items:[
          "Snooze与歌单排序使用同一gp-motion-popover底层模板、同一透明材质和同一退出清理流程；后续弹窗可直接复用，不再各自维护泛白程度。",
          "弹窗改用更接近当前背景的弱饱和玻璃层，降低不透明度与白色污染，同时保留足够的8px背景模糊和边界分离。"
        ]}
      ]
    },
    {
      version:"5.5.7", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：GP Motion Engine 2.3 将无抽搐的淡出/淡入生命周期写入通用底层，并覆盖更新日志、听歌记录横栏与睡眠时间弹窗。",
      sections:[
        {title:"GP Motion Engine 2.3 — Unified Sector Lifecycle",items:[
          "主页面与所有可切换 sector 统一采用退出、内容提交、进入、稳定落点四阶段生命周期；未来新增页面可直接复用同一底层，不再单独拼接动画。",
          "进入动画在 88% 到 100% 保持最终位置，并在移除动画类后额外保留一帧合成层，消除页面进入末端的抽搐、过冲和闪跳。",
          "连续快速点击会保留最终请求并按完整生命周期落位，避免中途撤销 transform 或 opacity 图层。"
        ]},
        {title:"Changelog & Listening History",items:[
          "更新日志切换版本时，旧内容先淡出、内容在不可见阶段更新，再由新版本说明稳定淡入。",
          "听歌记录的听歌时间、最近最爱与听歌数据三个横栏接入相同动画；统计渲染与 SSE 刷新只在目标 sector 激活后执行。"
        ]},
        {title:"Sleep Timer",items:[
          "睡眠时间弹窗不再从左侧引入，而是从下方轻微上移并淡入；关闭时沿原路径向下淡出。",
          "背景模糊由 10 px / 118% 饱和度回调至 6 px / 110%，在旧版通透感与新版可读性之间取得中和。"
        ]}
      ]
    },
    {
      version:"5.5.6", date:"2026-07-16", kind:"minor",
      summary:"STABALIZATION RELEASE：引入 GP Motion Engine 2.2，把主界面切换升级为与 Harmonic Reform SSE 同级的底层动效系统；完整 panel/sector 统一淡出与淡入，同时保持玻璃、SSE和内部交互层稳定。",
      sections:[
        {title:"GP Motion Engine 2.2 — Primary View Lifecycle",items:[
          "Play、Library、Listening History、Settings与Changelog不再由侧边栏点击代码直接display切换，而是统一进入底层Primary View控制器。",
          "当前完整view以130ms淡出并轻微缩小至99.7%，目标view再以280ms从透明、99.4%比例和3px纵向偏移恢复到完整终态。",
          "动画只合成opacity与transform，不对大型玻璃panel执行实时blur，不移动SSE shell，也不逐项动画内部按钮、歌曲行或图表。"
        ]},
        {title:"Stable Transition Arbitration",items:[
          "快速连续点击时，淡出阶段只保留最后一次目标；淡入阶段先完成当前落位，再自动切换到最后请求的界面，避免动画层中途撤销产生闪烁或抽搐。",
          "重复点击当前侧边栏入口仍可触发对应图标微交互，但主界面不会重新渲染、重新淡入或重算听歌数据。",
          "每次真正完成切换后才统一执行窗口适配、玻璃滑块定位、SSE状态刷新；Listening History只在成为最终目标后安排按需统计。"
        ]},
        {title:"Rendering & Accessibility Contract",items:[
          "转场类只在410ms生命周期内临时启用will-change，结束后立即释放合成提示，避免五个隐藏页面长期占用GPU纹理。",
          "prefers-reduced-motion启用时跳过淡出淡入并直接完成底层视图切换，布局与数据刷新路径保持一致。",
          "GP运行时引擎标识升级为GP Motion Engine 2.2；播放、队列、SSE、背景、主题、metadata缓存和听歌记录格式均不改变。"
        ]}
      ]
    },
    {
      version:"5.5.5", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：彻底移除 Edge 原生黑色焦点圈，修复播放雾光在 SVG 四角被裁成方形的问题，并轻度增强睡眠定时弹窗的背景模糊。",
      sections:[
        {title:"Focus Ring Removal",items:[
          "Glass Player 内所有元素的 :focus 与 :focus-visible 均不再显示 Edge 原生 outline；鼠标、键盘、F10媒体控制或上次点击残留焦点都不会出现黑圈。",
          "同时关闭按钮、输入框、选择框、链接与 tabindex 元素的浏览器 tap highlight，避免系统级黑色轮廓重新覆盖玻璃UI。",
          "播放器自己的 active、accent color、玻璃滑块和点击动效保持不变；只移除浏览器额外绘制的黑色焦点层。"
        ]},
        {title:"Rounded Play Haze",items:[
          "播放圆环脉冲最大尺寸会超出原24×24 SVG视口；旧版在上下左右四个边界被矩形视口裁切，因此雾光在四角附近呈现方形。",
          "侧边栏SVG现在允许脉冲与blur超出视口渲染，圆形雾光和三角雾光完整扩散，不再出现四角切面。",
          "600ms对称放大与原路返回、三倍三角形面积和静态播放图标均保持不变。"
        ]},
        {title:"Sleep Timer Glass",items:[
          "睡眠定时选项弹窗改用更稳定的强玻璃底色，并仅增加10px背景模糊与轻度饱和度融合。",
          "背景穿透感得到收敛，但不使用大面积高强度模糊，不改变弹窗尺寸、选项或点击逻辑。"
        ]}
      ]
    },
    {
      version:"5.5.4", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：修复部分 MP3 歌名与艺人末尾出现 / 且重新扫描无法清除的问题，并重新校准 GP Motion Engine 2.1 的播放、歌单、听歌记录与 hover 节奏。",
      sections:[
        {title:"Metadata Terminator Repair",items:[
          "ID3 文本帧末尾的 NUL 字节现在被识别为字符串终止符并直接移除，不再错误转换成“ / ”。这覆盖 Where Did U Go、部分毛不易、薛之谦、方大同等 MP3 标签表现。",
          "只有位于字符串内部的 NUL 才继续作为多值分隔符转换为“Artist A / Artist B”；FLAC 中真实存在的多个 ARTIST 字段仍按原顺序保留。",
          "Title、Artist、Album、Date 与 Genre 共用同一套尾部分隔符清理，连续斜杠与字段末尾残留斜杠会在写入歌单和 IndexedDB 前统一删除。"
        ]},
        {title:"Rescan & History Synchronization",items:[
          "重新扫描全部歌曲会重新解码当前文件的标签，并用清理后的 Title、Artist 与 Album 覆盖 trackCache 中带斜杠的旧 metadata。",
          "Spectrum ID、MFCC、Energy、BPM、技术信息、播放次数与听歌时长保持不变；刷新后的显示信息通过 Spectrum ID 同步到现有听歌记录。",
          "旧的带斜杠名称仍保留在身份别名中用于安全回接历史，但不再作为歌单、播放器或听歌记录的当前显示名称。"
        ]},
        {title:"Motion Timing Calibration",items:[
          "播放图标与歌单图标动画调整为600ms；听歌记录图标的坐标轴和折线调整为400ms；设置与更新日志保持500ms。",
          "侧边栏 hover 触发门槛由400ms缩短至300ms，移出会取消等待，点击继续立即触发。",
          "动画运行状态统一保留至620ms，确保最长的600ms动画完整结束后再清理，不截断最后一帧。"
        ]}
      ]
    },
    {
      version:"5.5.3", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：统一侧边栏图标动效为500ms，重做播放雾光脉冲的对称回程并稳定SVG描边；同时修复听歌记录缩放布局与响应延迟、设置产品卡边框，以及播放器右侧sector进入动画的末端抽搐。",
      sections:[
        {title:"500ms Motion System",items:[
          "播放、歌单、听歌数据、设置和更新日志五套侧边栏图标动效统一使用500ms完整时间轴；运行class在520ms清理，不提前截断最后一帧。",
          "侧边栏hover改为停留400ms后才触发动效，pointerleave会取消等待；点击仍立即触发并清除hover计时，快速掠过图标不再产生多余动画。",
          "播放三角与外圆脉冲在0–50%沿原路径放大，在50–100%使用镜像关键帧原路缩回，不再在最大尺寸后直接跳回静态状态。",
          "脉冲加入极轻的blur与currentColor drop-shadow，形成柔和雾光边缘；静态播放圆和三角始终保持清晰。"
        ]},
        {title:"Stable SVG Stroke",items:[
          "歌单音符与设置齿轮明确锁定1.8px描边，并使用non-scaling-stroke和geometricPrecision，避免动画期间合成描边变粗、结束时突然闪细。",
          "听歌数据的X/Y轴与现有折线全部在500ms内完成；Y轴继续使用dash trace，不恢复会闪烁的scaleY合成层。",
          "更新日志的第一条文字线先显露一小段并继续展开，第二条随后开始，二者都在同一500ms文档时间轴内完成。"
        ]},
        {title:"Listening History Responsiveness",items:[
          "缩小窗口时，顶部听歌时间/最近最爱/听歌数据控制栏保持fit-content并左对齐，不再被小屏媒体规则强制拉伸至整页宽度。",
          "歌曲身份与历史metadata同步只在导入和手动重新扫描后运行，不再在每次历史标签点击时遍历整个歌单与历史库。",
          "点击历史标签后先立即切换按钮与pane，再把图表、洞察和排行生成延后两个绘制帧，使视觉反馈先于重计算出现；连续快速点击会取消过期渲染任务。"
        ]},
        {title:"Media Key Reliability",items:[
          "Edge 支持 Media Session 时只由系统 Media Session 接管 F10 的播放与暂停，不再让同一次按键同时经过 keydown 与系统媒体事件两条路径。",
          "按下与松开不再分别触发一次状态切换，修复 pause → play → pause 的双触发；不支持 Media Session 的浏览器才启用键盘媒体键回退。"
        ]},
        {title:"Panel & Build Card Polish",items:[
          "设置顶部产品信息卡把玻璃高光限制在卡片内部，并在最上层使用完全不透明的实时accent color绘制完整圆角边框；左、右、上、下四边不再分别混入黑白底色。",
          "播放器右侧Queue、Sound和Daily Mix进入动画统一返回translate3d(0,0,0)，并让panel body持续留在同一合成层；末尾12%保持稳定终态，消除结束瞬间的抽搐。"
        ]}
      ]
    },
    {
      version:"5.5.2", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：重建GP Motion Engine 2.1侧边栏图标触发链，修复播放脉冲不可见以及hover/click互相覆盖的问题；五套动画现在由同一个可重复触发的800ms控制器执行。",
      sections:[
        {title:"Reliable Motion Trigger",items:[
          "删除5.5.1依赖CSS hover状态与SVG克隆的触发链，改为由统一icon-motion-run状态重启纯CSS keyframes；不依赖SVG Web Animations API。",
          "pointerenter与click都会移除、强制提交并重新加入运行状态，不再因为指针仍停留在按钮上而无法重播，也不会在结束后留下fill状态。",
          "静态SVG始终保留在DOM中；动画完成或取消后自动显示精确的原始图标。"
        ]},
        {title:"Play Pulse Visibility & Area",items:[
          "播放脉冲恢复为明确可见的2.6px圆角三角描边，并在原播放三角形的几何中心向外扩散；静态外圆之外同步加入一层低透明度圆形脉冲。",
          "按最终修订要求，最大三角形面积为原图形的3倍；面积随线性尺寸平方变化，因此使用√3，即1.73205081的线性缩放。",
          "脉冲从透明开始，在800ms序列内出现、扩张、短暂停留并回落至完全透明；静态播放三角形全程不消失。"
        ]},
        {title:"True 800ms Graph Trace",items:[
          "听歌数据图标的横轴和纵轴从第0ms同时启动，并在第800ms完成；折线同样从第0ms开始，完整trace耗时调整为1000ms。",
          "折线直接trace现有静态路径M7 15 → L11 11 → L14 14 → L19 8，使用stroke-dashoffset从28降至0，不替换或简化原轨迹。",
          "纵轴改用18单位stroke-dashoffset描画，不再缩放独立合成层，消除第800ms动画结束、图层撤销时的瞬间闪烁。",
          "播放与设置齿轮各自运行完整800ms；歌单音符和更新日志文档按最终修订缩短为500ms，各自的内部描画顺序仍在对应的单一时间轴内完成。"
        ]},
        {title:"Fn / Media Key Separation",items:[
          "浏览器不会暴露Fn为可检测修饰键，Fn+F11只会以普通F11到达网页，因此旧逻辑无法可靠区分全屏操作与下一首。",
          "5.5.2不再拦截原始F9、F10和F11，也删除全屏时对这三个按键的Keyboard Lock；Fn+F11现在完整交还Edge执行全屏。",
          "播放器只响应真正的MediaTrackPrevious、MediaPlayPause和MediaTrackNext系统媒体事件，并继续通过Media Session提供上一首、播放、暂停与下一首。"
        ]}
      ]
    },
    {
      version:"5.5.1", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：恢复经典三柱Glass Player产品图标；将五套侧边栏语义动效统一调整为800ms，并修正播放三角脉冲与听歌数据折线的几何和时间关系。",
      sections:[
        {title:"Product Icon Rollback",items:[
          "侧边栏品牌区、设置产品信息卡和浏览器标签页全部恢复5.4.1使用的经典三柱圆形图标。",
          "外圆仍实时跟随accent color，三柱使用accent contrast；5.5.0引入的单线音符产品Logo不再显示。"
        ]},
        {title:"800ms Motion Timing",items:[
          "播放、歌单音符、听歌数据、设置齿轮和更新日志文档五套动效的完整周期统一为800ms；click触发状态延长到820ms后清理，避免动画尾帧被提前截断。",
          "歌单音符与文档内部仍保持分段顺序，但最后一个子动作会与第800ms的总周期终点准确对齐。"
        ]},
        {title:"Geometry & Trace Corrections",items:[
          "播放按钮外扩三角形改为原三角形面积的2倍。由于面积随线性尺寸平方变化，实际线性缩放采用√2，即1.41421356，而不是5.5.0的1.618。",
          "听歌数据图标的折线直接沿现有d路径 M7 15 → L11 11 → L14 14 → L19 8描画，不生成替代轨迹。",
          "横轴、纵轴和折线全部从第0ms开始，并在同一个第800ms完成；折线trace耗时与axis延长耗时严格相等。"
        ]}
      ]
    },
    {
      version:"5.5.0", date:"2026-07-16", kind:"minor",
      summary:"UI UPDATE — GP Motion Engine 2.1：Glass Player采用全新的动态音符标识，并为全部五个侧边栏图标加入与功能语义一致的轻量微交互；Queue自动定位进一步下移当前播放歌曲，完整避开SSE渐隐区域。",
      sections:[
        {title:"New Glass Player Identity",items:[
          "侧边栏品牌区、设置产品信息卡与浏览器标签页中的旧三柱图标全部替换为新的单线音乐音符标识。",
          "音符始终位于完整圆形载体内；圆形背景继续实时使用当前accent color，音符使用自动计算的accent contrast，兼容浅色、深色与封面取色。",
          "标识使用原生SVG路径，不引入位图背景、额外网络资源或高成本滤镜，因此在4K界面中保持清晰并维持低渲染负荷。"
        ]},
        {title:"GP Motion Engine 2.1 — Semantic Icon Motion",items:[
          "播放图标从原三角形向外扩散一层低透明度三角脉冲，最大比例为约1.618，并在440ms内回归静态形状。",
          "歌单音符按下方共鸣圆、连接杆、上方音符的顺序连续描画；听歌记录从坐标原点同步生成两条轴线和数据折线。",
          "设置齿轮只旋转外部机械结构，中心孔保持绝对静止；更新日志文档从左上方展开，达到约75%时两条文字线同步写入。",
          "五个动效均可由hover或click触发，总时长不超过0.5秒；结束或指针离开后恢复到与原始静态SVG完全一致的状态，并遵守系统Reduce Motion设置。"
        ]},
        {title:"Queue Now Playing Clearance",items:[
          "Library Order仍按原始歌单顺序和原始编号显示，不移动歌曲数据，也不改变手动播放列表与拖拽逻辑。",
          "自动定位时在当前歌曲上方预留超过两个完整歌曲行的空间，使当前项从SSE最浓的边缘继续向下移动，并完整显示封面、标题、艺人、时长与点击区域。",
          "歌单开头仍使用scrollTop 0保护，不会为了预留空间制造空白或破坏第一首歌曲的位置。"
        ]}
      ]
    },
    {
      version:"5.4.1", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：修复默认播放队列自动定位时，当前播放歌曲占据首个SSE遮罩位置的问题；当前歌曲现在固定下移一个完整可视行。同步规划Gen 6–8的时间机器、音乐银河与Galaxy-Aware Recommendation，并将Electron Lake推迟至Gen 9+。",
      sections:[
        {title:"Queue Now Playing Visibility",items:[
          "默认Library Order队列仍保持原歌单顺序与原始位置编号，不移动或重排歌曲数据。",
          "自动定位当前歌曲时，顶部预留一条完整歌曲行加6px间距；上一首可以进入SSE渐隐区，当前播放项落在第二个可视位置并保持完整可读。",
          "歌单第一首仍安全停留在scrollTop 0；手动播放列表、拖拽顺序、下一首优先级和点击播放逻辑不变。"
        ]},
        {title:"Unreleased Roadmap Revision",items:[
          "Gen 6规划音乐时间机器：metadata年份/艺人/专辑驱动的横向可拖拽时间轴。",
          "Gen 7规划音乐银河：MFCC、BPM、Genre距离、二维坐标、Canvas/WebGL银河绘制、星系标签与低负荷hover。",
          "Gen 8规划使用银河的MFCC+BPM缓存优化随机播放和每日推荐，同时保留新鲜度、多样性与随机性。",
          "Electron Lake、SQLite与EXE迁移由Gen 5+顺延至Gen 9+。"
        ]}
      ]
    },
    {
      version:"5.4.0", date:"2026-07-16", kind:"minor",
      summary:"HARMONIC REFORM — GP Core 2.1 / GP Motion Engine 2.0：Soft Scroll Edge 完成架构级重设计。固定 panel shell 保留真实玻璃背景，滚动 viewport 只负责移动内容；完整 sector 在接触裁切边缘时逐渐融入外层 panel，不再叠加任何 blur 横条。",
      sections:[
        {title:"Architecture Reset",items:[
          "物理删除 5.3.3–5.3.10 的全部 SSE 实现，包括 sticky 伪元素、body 级 fixed frame、edge cap、getBoundingClientRect 定位、边界颜色采样、内容副本和 backdrop blur 覆盖层。",
          "5.4.0 只继承播放器功能与数据逻辑；滚动视觉子系统从空白状态重新建立，不在 5.3.10 规则后追加补丁。"
        ]},
        {title:"GP Core 2.1 — Shell / Viewport Separation",items:[
          "每个滚动界面拆分为固定 gp-sse-shell 与透明 gp-sse-viewport：shell 独占 panel 的背景、border、圆角与阴影，viewport 独占滚动。",
          "原本自己同时承担 glass 与滚动的听歌排行、设置、更新日志版本栏和详情栏，启动时会建立独立固定 shell，并把原 glass 表面完整迁移到 shell。",
          "播放队列、音效、每日推荐复用 side-panel；歌单复用 library-panel；最近最爱和听歌数据复用各自 history pane，不创建悬浮外框。"
        ]},
        {title:"GP Motion Engine 2.0 — Whole-Sector Dissolve",items:[
          "mask 作用于整个滚动 viewport 的最终内容画面，因此歌曲行、EQ 区块、设置组、图表和 data-card 会作为完整 sector 一起渐隐，不会出现文字先消失而卡片背景仍停留。",
          "渐隐区域直接露出固定 shell 已经渲染好的真实 panel 背景；没有黑色、白色、主题预设色或额外模糊层覆盖在内容上。",
          "到顶时顶部完整显示，到底时底部完整显示；位于中间时上下两侧独立启用，不可滚动时完全关闭。"
        ]},
        {title:"Frame Contact & Performance",items:[
          "Library 与 side-panel 的旧外边距被迁入 viewport 内部，使移动内容可以一直经过真实外框边缘，而不是在距离 border 数十像素处提前停止。",
          "新系统不读取每帧几何、不创建额外 DOM 副本、不执行大面积 backdrop-filter；普通滚动只更新两个布尔状态，适合高分辨率界面。"
        ]}
      ]
    },
    {
      version:"5.3.9", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：依据 Apple iOS 26 Liquid Glass 与 Scroll Edge Effect 官方设计原则，撤销以颜色盖住内容的 SSE 路径，改为内容透明度溶解与窄幅实时可变模糊共同作用。",
      sections:[
        {title:"Apple Scroll Edge Model",items:[
          "Apple 的 Scroll Edge Effect 用于维持浮动 Liquid Glass UI 与动态滚动内容的层级分离；内容进入边缘时应柔和溶解进背景，而不是出现实色渐变块或发光边缘。",
          "Queue、Sound 与 Listening Data 现在直接对滚动内容应用 alpha dissolve mask：边界像素完全透明，32px 内分五级恢复至完全不透明。",
          "透明内容自然露出 sector 自己的真实背景，因此主题、封面配色、玻璃透明度和相邻背景无需再由 JavaScript 猜测或复制。"
        ]},
        {title:"Variable Blur Layer",items:[
          "在内容溶解之上只保留一层与 viewport 等宽的窄幅实时 backdrop blur，模糊降低为 8px、饱和度为 68%，不包含白色、黑色或主题色填充。",
          "blur 层和 alpha mask 使用相同的顶部/底部启停状态：到顶关闭顶部、到底关闭底部、中间同时开启。",
          "Queue、Sound、Listening Data 每个视图只拥有一个对应边缘效果，不再把外层播放器面板或单独卡片当成第二层 SSE。"
        ]},
        {title:"Geometry & Media Controls",items:[
          "三个核心 SSE 完全采用自身 scroll viewport 的 getBoundingClientRect，frame 宽高、mask 宽高和实际裁切边界保持一致。",
          "功能键继续使用无锁时间戳去抖；Media Session 现在同步播放状态并写入当前歌曲标题、艺人、专辑和封面，使系统媒体按键保持稳定会话。"
        ]}
      ]
    },
    {
      version:"5.3.8", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：按每个滚动 viewport 的真实边界统一重构 SSE，不再针对任何具体文字或控件；恢复正确的上下端启停、精确宽高和边界外侧实时底色，并修复功能键连续控制。",
      sections:[
        {title:"Viewport-Level SSE",items:[
          "SSE 作用对象是 Queue、Sound、Listening Data 以及其他已启用滚动 sector 的完整 viewport；歌曲行、BPM、图表、文字或控件都只是经过边界的普通内容，不存在单项特判。",
          "Queue 与 Sound 不再借用外层播放器面板的宽度和底部位置，Listening Data 也严格采用自身滚动区域矩形，因此 frame 不会比 sector 更宽、更高或延伸到相邻区域。",
          "滚动到顶时关闭顶部 SSE，滚动到底时关闭底部 SSE；位于中间时上下同时显示，不可滚动时全部关闭。"
        ]},
        {title:"Boundary Surface Sampling",items:[
          "顶部从 viewport 上方两像素、底部从 viewport 下方两像素读取实际命中的 DOM 表面背景色，并强制转换为不透明 RGB 起点。",
          "边界起点先覆盖被裁切内容，随后在短距离内释放为实时去饱和 backdrop blur，最后平滑过渡到零模糊和完全清晰。",
          "主题、封面背景或 Ambient 颜色变化后会重新采样全部 SSE 边界；不再依赖固定白色光晕或通用预设颜色。"
        ]},
        {title:"Continuous Playback Keys",items:[
          "移除可能因 keyup 丢失而锁死的 held-key 集合和 700ms 状态锁，改用只过滤系统自动连发的短时间戳去抖。",
          "每次新的 F9/F10/F11 keydown 都能独立触发上一首、播放/暂停和下一首。",
          "播放与暂停事件同步写入 Media Session playbackState，避免系统媒体键执行一次后状态未更新而停止继续派发。"
        ]}
      ]
    },
    {
      version:"5.3.7", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：移除导致 SSE 泛白的人工颜色覆盖，改为直接对边界后方的实时画面去饱和并模糊；同时修复滚动端点硬切与 F9/F10/F11 只能触发一次的问题。",
      sections:[
        {title:"Realtime Boundary Sampling",items:[
          "删除 5.3.6 中由 glass-bg-strong 与 bg-base 混合生成的 frame-opaque 色层；该色层无法等同于屏幕上实际合成后的背景，是深色界面泛白或偏色的根源。",
          "SSE 现在只保留接近完全透明的中性激活层，并通过 backdrop-filter 直接采样边界后方的实时像素。",
          "实时画面先降低至 54% 饱和度，再执行 15px 高斯模糊和轻微对比度收敛；封面取色、主题背景和当前 sector 颜色都会自然参与结果。"
        ]},
        {title:"Persistent Soft Boundary",items:[
          "SSE 被定义为滚动视口边界，而不是剩余滚动方向提示。只要 sector 可以滚动，顶部与底部边缘都会保持启用。",
          "列表到达第一项或最后一项时不再关闭对应模糊层，因此文字、封面和歌曲模块不会在圆角边框处突然被直线裁断。",
          "七段透明 mask 只控制实时模糊的强弱，不再加入白色、黑色或主题预设填充。"
        ]},
        {title:"Reusable Function Keys",items:[
          "F9/F10/F11 改为 window capture 级别处理，同时识别 event.code、event.key 与三种 Media 键名。",
          "按键使用独立 pressed/released 状态，keyup、窗口失焦和页面隐藏都会清理状态。",
          "加入 700ms 安全释放机制；即使 Edge 或系统拦截了某次 keyup，下一次独立按键仍然可以正常控制播放。"
        ]}
      ]
    },
    {
      version:"5.3.6", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：收紧并增强 Queue、Sound 与 Listening Data 的 Soft Scroll Edge，校正唱针物理旋转中心，改善缩放字体渲染，修复 Changelog 滑块适配，并加入 F9/F10/F11 播放控制。",
      sections:[
        {title:"SSE Surface Integration",items:[
          "Soft Scroll Edge 的可见深度缩短至此前约六成，避免模糊区域过度侵入 Queue、Sound 和 Listening Data 的正文空间。",
          "边缘最外侧现在由当前 glass surface 与背景实时混合成完全不透明的连续色面，再在较短距离内释放为清晰内容，形成从 sector 背景自然延伸出的效果。",
          "模糊半径调整为 13px；边缘遮蔽、模糊和透明度使用不同但同步的多段曲线，增加渐变感同时消除末端硬切。",
          "Queue 与 Sound 继续绑定整个播放器侧面 sector 的真实下边界；Listening Data 使用其完整滚动区域而非单张数据卡片。"
        ]},
        {title:"Disk Reader Geometry",items:[
          "唱臂的水平位置、垂直位置和 transform-origin 现在全部由唱针底座直径的一半计算。",
          "唱臂旋转轴精确落在圆形底座中心，不再从底座下方偏移的位置旋转。"
        ]},
        {title:"Typography & Changelog Fit",items:[
          "Edge 窗口自适应由整层 transform texture 缩放改为 Chromium layout zoom，使字体在缩放后重新参与字形栅格化，减少边缘毛糙。",
          "每次窗口适配结束后统一重新测量主导航、横向滑块、Changelog 版本滑块和 SSE；Changelog 列表自身尺寸变化也由 ResizeObserver 独立校正。"
        ]},
        {title:"Playback Function Keys",items:[
          "F9、F10、F11 分别控制上一首、播放/暂停和下一首，并拦截按键长按造成的重复触发。",
          "全屏状态下尝试通过 Keyboard Lock 保留三个功能键；同时接入 Media Session 的上一首、播放、暂停和下一首系统控制。"
        ]}
      ]
    },
    {
      version:"5.3.5", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：修复自适应缩放下 Acrylic Edge Frame 的多处位置、尺寸和圆角比例错位，并重新塑造模糊区域与清晰内容之间的长距离柔和过渡。",
      sections:[
        {title:"Viewport-Accurate Alignment",items:[
          "确认 5.3.4 错位来自坐标系混用：getBoundingClientRect 返回缩放后的视口坐标，而旧 frame 被放进受缩放的局部父容器，导致位置与大小被重复缩放。",
          "所有 Edge Frame 现在直接挂载到页面根层并使用 fixed 视口坐标，位置和尺寸与目标 sector 的最终屏幕矩形一一对应。",
          "圆角和边缘深度根据元素实际缩放比例重新计算；Queue、Sound 与 Library 使用其真实外层面板作为边界，不再出现主体与模糊层大小不一致。"
        ]},
        {title:"Continuous Acrylic Transition",items:[
          "删除边缘处不透明的深色主题混合填充，改用当前玻璃面板的透明 acrylic surface，避免深色主题出现黑色矩形块。",
          "模糊半径提高到 18px，过渡深度扩大约 28%，并用七段 alpha mask 从强模糊逐级衰减至完全清晰。",
          "颜色遮罩同时采用五段低对比度透明梯度；模糊、颜色和透明度在不同位置同步退场，消除原先模糊结束处的硬边界。",
          "隐藏 sector 的 frame 自动关闭，窗口缩放、布局重算与页面切换继续触发重新测量。"
        ]}
      ]
    },
    {
      version:"5.3.4", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：修复主侧边导航滑块点击后从页面顶部重新飞入的问题，并以绑定真实滚动视口的独立 Acrylic Edge Frame 重构 Soft Scroll Edge。",
      sections:[
        {title:"Sidebar Navigation",items:[
          "主导航选中块由 CSS 伪元素改为真实 DOM 元素，位置和尺寸直接从当前按钮读取，不再通过可能离散重置的 CSS 自定义属性间接驱动。",
          "快速连续切换时取消上一段未完成动画，并从当前选择位置执行 FLIP transform；不会再把页面顶部当作新动画起点。",
          "保留轻微放大与自然收尾，动画仅改变 transform，且移动结束立即释放 will-change。"
        ]},
        {title:"Acrylic Edge Frame",items:[
          "废弃位于滚动内容内部的 sticky 伪元素。每个目标 sector 现在拥有一个独立、绝对定位并按真实边界裁切的边缘 frame。",
          "frame 从 getBoundingClientRect 读取真实位置和尺寸，从 computed style 读取实际圆角、深度与主题混合色，因此不会再与外框之间留出空隙。",
          "14px 高斯模糊与多段透明度遮罩由边界向内连续衰减，从完全遮蔽平滑过渡到清晰内容，避免突兀的黑块或白雾断层。",
          "ResizeObserver、窗口缩放、界面切换和 Queue/Sound 切换都会重新对齐 frame；不可见页面的 frame 自动停用。"
        ]}
      ]
    },
    {
      version:"5.3.3", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：修正高分辨率下选择滑块的合成与调度，重做导入阶段比例，并把 Soft Scroll Edge 从悬浮遮罩改为由真实容器边界向内容延伸的自适应渐隐。",
      sections:[
        {title:"Motion Composition",items:[
          "主导航、横向选择器与 Changelog 滑块改用 compositor-only transform 路径；尺寸变化通过 FLIP 比例吸收，不再逐帧动画 left、top、width 或 height。",
          "will-change 只在滑块移动期间启用，动画结束立即释放，避免长期保留额外合成层。",
          "音效波形、每日推荐和听歌记录等较重渲染延后到滑块首帧完成之后，减少点击瞬间与动画争抢主线程。"
        ]},
        {title:"Proportional Import Progress",items:[
          "导入进度重新分配为音频身份识别 35%、IndexedDB 与歌曲信息恢复 55%、提交及界面渲染 10%。",
          "歌曲计数完成时进度停在对应阶段末端，随后明确显示保存与界面更新，不再出现 341/341 后进度条突然补满。",
          "提交、渲染与完成之间主动让出绘制帧，使 Edge 能按顺序呈现 93%、97% 与 100% 状态。"
        ]},
        {title:"Border-Anchored Soft Scroll Edge",items:[
          "移除悬浮在内容内部、与圆角边框之间留缝的白色遮罩；渐隐现在从 Queue、Sound、Library、Top 50、Settings 与 Changelog 各自真实边界向内延伸。",
          "顶部和底部效果分别只在对应方向仍有内容时显示；首次进入可滚动页面即可显示底部边缘，不再要求先滚动一次。",
          "边缘颜色由当前背景与玻璃面板颜色动态混合，深色或低饱和主题仍有足够可见度，同时避免固定白雾。",
          "各容器的实际 padding 被纳入边缘宽度与偏移，圆角贴合 sector 外缘，滚动内容不会穿过边缘与 border 之间的空隙。"
        ]}
      ]
    },
    {
      version:"5.3.2", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：引入 GP Motion Engine 1.3，彻底停止全屏背景的持续移动与实时重合成，降低 2K/4K 高刷新率下的 GPU 3D 压力；同时为曲库导入加入不可误关的分阶段进度条，并阻止重复点击当前横向选项触发无意义刷新。",
      sections:[
        {title:"GP Motion Engine 1.3",items:[
          "Ambient Glow、Cover Color 与 Blurred Cover 全部改为静态呈现：删除色块 Wander 动画、背景位置动画、父背景漂移和 Cover Color 的 JavaScript requestAnimationFrame 循环。",
          "背景仍保留封面配色、模糊封面、色彩饱和度与原有层次；文字、按钮、唱片、封面和边框继续使用浏览器原生 4K 分辨率，没有对前景 UI 做降采样。",
          "只有当前选择的背景模式参与渲染。未启用的 Glow / Blurred Cover 使用 display:none，不再依靠 opacity:0 保留合成层。",
          "静态背景外扩由 20–24% 收敛到 12%，足以覆盖 58px 模糊边缘，同时显著缩小 4K 离屏纹理面积。"
        ]},
        {title:"4K Composition Path",items:[
          "大型 Glass 面板不再对已经高度模糊的背景重复执行全尺寸 backdrop-filter；透明底色、边框、阴影和层级保持不变。",
          "主侧边栏、横向选中滑块与 Changelog 滑块移除 38px backdrop-filter，保留原来的透明色、轮廓和移动动画。",
          "软滚动边缘改为纯渐变与 Mask 淡出，不再在滚动过程中持续进行 15px 背景采样。",
          "唱片旋转、唱针、按钮微交互和滑块 Motion 保留；优化对象只限于高成本的全屏/大面积背景合成。"
        ]},
        {title:"Blocking Import Progress",items:[
          "文件与文件夹导入现在立即打开与“重新扫描”一致的硬控进度弹窗；导入运行期间无法点击遮罩、Escape、取消按钮或背景界面提前关闭。",
          "前 50% 显示 Spectrum ID / 音频身份识别进度，后 50% 显示 IndexedDB 缓存恢复、metadata、封面和时长读取进度。",
          "完成页汇总处理数量、缓存命中、新增和重复跳过数量；发生异常时保留已经成功导入的歌曲并提供明确关闭状态。",
          "Spectrum 后台声学分析仍在列表可用后按原有队列执行，不把首次可播放时间拖到 MFCC、Energy 和 BPM 全部完成之后。"
        ]},
        {title:"Idempotent Segmented Controls",items:[
          "横向选择器增加统一的当前项拦截：再次点击已经选中的 Queue、Sound、Daily Mix、主题、背景、封面模式、时间范围、语言、历史模式或 EQ 预设时不重新渲染页面。",
          "点击其他选项后再返回原选项仍执行正常刷新、数据加载与滑块动画；只消除对当前状态没有任何改变的重复点击。",
          "这一规则避免当前页面被重新写入 DOM、滚动位置重置、音效信息重复读取或选中滑块重复启动。"
        ]}
      ]
    },
    {
      version:"5.3.1", date:"2026-07-16", kind:"patch",
      summary:"HOTFIX BUILD：修复 Changelog 竖向滑块缩放后上下移动越过目标和收尾抽动的问题，更新设置页 Gen 5 产品信息，校正单曲循环数字角标，并新增面向靠墙显示器音响的清晰度补偿 EQ。",
      sections:[
        {title:"Changelog Glider",items:[
          "Changelog 版本滑块取消会改变可见边界的缩放阶段，只保留位置与尺寸的连续插值，避免向上或向下移动时越过目标版本行。",
          "移动曲线改为无过冲的 360ms ease-out；连续快速点击版本时，浏览器直接从当前插值位置前往新目标，不再经历放大、越界、缩回三段互相打架的动画。",
          "竖向滑块继续保持无外发光规则。主导航原有克制缩放不受本次 Changelog 专项修复影响。"
        ]},
        {title:"Product Information & Repeat One",items:[
          "设置页软件名称改为 Glass Player Gen 5，副标题在中文界面显示“版本 3.1”，英文界面显示“Ver. 3.1”。",
          "版本徽章更新为 HOTFIX BUILD，点击后直接进入 5.3.1 对应更新日志。",
          "修复单曲循环右上角数字 1 的容器被脚本切换成 block 后失去居中的问题；角标现在使用固定 14px 网格居中、等宽数字和明确行高。"
        ]},
        {title:"Monitor Speakers EQ",items:[
          "音效预设新增“显示器音响 / Monitor Speakers”，用于显示器内置扬声器或小型桌面扬声器贴近后墙时的通用补偿。",
          "60Hz、150Hz 和 400Hz 分别削减 3.5dB、4dB 和 2.5dB，降低墙面边界增益、箱体共振与低中频堆积造成的沉闷感。",
          "1kHz 至 15kHz 逐步补入 0.5–2.5dB，改善对白、人声轮廓和空气感；该预设只改变实时七段 EQ，不修改歌曲 MFCC、BPM、Energy、Spectrum ID 或缓存分析结果。",
          "这是不依赖具体显示器型号的保守起点。房间、桌面和墙距不同，Custom 仍可在此基础上进一步微调。"
        ]}
      ]
    },
    {
      version:"5.3.0", date:"2026-07-16", kind:"minor",
      summary:"NEURAL INTERLINK UPDATE：GP Neural Engine 2.0 — Resonance Boost 将本地行为采集、长期偏好、会话偏好、探索判断与推荐评分正式连成一条可持续学习的链路；证据不足时继续使用真正的均匀随机，不让未成熟模型干涉播放。",
      sections:[
        {title:"GP Neural Engine 2.0 — Resonance Boost",items:[
          "behaviorEvents 现已持续写入 IndexedDB：快速或接近结尾的跳过、完整播放、重播、拖动进度、主动搜索、从列表选择、加入队列、循环与 Shuffle 切换、播放模式变化，以及按真实媒体推进量结算的实际播放时长。",
          "每条与歌曲相关的事件携带 Spectrum ID 和当时的 MFCC、BPM、Energy、Genre、Artist、Album 特征快照；模型生成时会优先用当前曲库里同 Spectrum ID 的最新标签补全表面信息。",
          "实际播放时长以媒体时间与墙钟时间双重约束累计，跳转、后台停顿和异常时间跃迁不会被当成正常收听；播放中每 30 秒、暂停、隐藏页面和离开页面时都会提交增量检查点。"
        ]},
        {title:"Preference Is Not Recommendation",items:[
          "User Preference Model 只表达长期偏好：Artist、Album、Genre 权重，BPM 与 Energy 中心，MFCC 音色中心、分时段 Genre 倾向、歌曲证据和最近播放时间。",
          "Recommendation Score 是独立的即时层：长期偏好之外同时计算当前时段、会话短期意图、声学相似度、新鲜度、多样性与有限探索奖励，避免高喜欢度歌手被无限重复。",
          "主动搜索、列表点播、加入队列和重播属于强正反馈；完整播放与真实停留为中等正反馈。跳过惩罚按跳过位置动态变化，5 秒级快速跳过远重于播放到 90% 后离开。"
        ]},
        {title:"Evolution, Session & Exploration",items:[
          "长期偏好采用 45 天半衰期，旧兴趣逐渐回到中性，而不是永久累积；当前会话信号以分钟级衰减，只短暂提高同 Artist、Album、Genre 和 MFCC 相似歌曲的概率。",
          "由 Shuffle 或推荐带来的新风格首先进入探索观察：前三次接受和前四次跳过只形成弱证据，不会因一次偶然播放或一次跳过立刻改写长期模型。",
          "主动选择后会短期提高相似歌曲机会，但后续相似推荐必须经过连续反馈才能形成稳定趋势。手动播放队列始终拥有最高优先级，Neural 不会重排用户明确安排的顺序。"
        ]},
        {title:"Confidence Gate & Safe Shuffle",items:[
          "模型成熟需要同时满足至少 20 个有效行为证据、5 个活跃日期和 0.56 置信度；置信度由衰减后的证据量、活跃天数及声学特征覆盖率共同生成。",
          "门槛未通过时，Shuffle 和每日推荐明确走 uniform-random-fallback：候选歌曲等概率抽取，旧版按 Genre/Language 直接乘权的隐藏加权不再参与。",
          "模型成熟后使用有上下限的 weighted random，而不是确定性最高分：推荐权重限制在 0.35–3.4，仍保留随机性、新鲜度和风格多样性，并将每日推荐快照、置信度和模型模式写入 IndexedDB。"
        ]},
        {title:"Motion & Listening History Fixes",items:[
          "主侧边栏、Changelog 版本侧边栏以及后续竖向导航统一禁止外发光和点击光晕；取消独立 stretch 动画，改用单一位移与尺寸插值，消除抵达终点后的抽回与抽搐。",
          "没有可靠日期的旧累计时长不再被迁移成今天的数据。选中的今天、本周、本月或今年确实没有收听记录时，只显示小字“当前无听歌数据”，也不会虚构默认第一首和四分钟。",
          "本版本不删除旧累计总时长，只把无日期数据隔离为 legacyUndatedSeconds，确保它不能污染任何有日期范围的榜单。"
        ]}
      ]
    },
    {
      version:"5.2.0", date:"2026-07-15", kind:"minor",
      summary:"MOTION UPDATE：引入 GP Motion Engine 1.2，统一横向与竖向玻璃滑块的移动、放大和拉伸节奏，降低侧边栏轮廓光；同时恢复基于 Spectrum ID 的改名历史同步，并为每次手动重扫保存前后两版 metadata 身份。",
      sections:[
        {title:"GP Motion Engine 1.2",items:[
          "主导航竖向滑块在移动中采用更克制的横向放大与轻微纵向拉长，抵达前自然回落；不再出现过强的纵向膨胀。",
          "Changelog 版本滑块改用与主导航一致的 430ms 缓动、CSS 位移与伸缩节奏，取消显得过快的独立跳跃路径。",
          "横向分段滑块不再拉成长条覆盖整个移动距离，改为连续位移中明显但克制的整体放大，并平滑适配目标按钮宽度。",
          "主导航和 Changelog 滑块的常驻阴影显著减弱；点击只留下可见但温柔的主题色轮廓，不再向外扩散强光。"
        ]},
        {title:"Spectrum Identity Snapshots",items:[
          "每次手动重新扫描后只保留刷新前与刷新后各一版 metadata 身份快照，包括 Title、Artist、Album、Genre、文件身份和时间戳。",
          "快照不复制封面 Blob、MFCC、Energy 或 BPM，因此不会把高成本歌曲缓存扩大一倍。",
          "缓存命中同一 Spectrum ID 后会检查文件名、大小、修改时间和相对路径；表面信息变化时自动刷新标签和封面，声学分析继续直接复用。"
        ]},
        {title:"Renamed History Recovery",items:[
          "恢复 5.1.1 问题 2 的稳定身份同步：历史记录可沿 Spectrum ID、audioEssenceKey、legacyContentKeys、Artist 别名、Title 别名及重扫前后快照回接当前歌曲。",
          "历史合并现在同时保留身份别名，不再只合并播放次数和秒数；成功回接后立即显示当前歌名、歌手、专辑、Genre 与当前封面。",
          "Spectrum ID 引入前且歌名、歌手均已完全改变的孤立旧记录仍不会被冒险猜测合并，避免把私人听歌数据接到错误歌曲。"
        ]},
        {title:"Resonance Boost Confidence",items:[
          "听歌时段尚未达到最低活跃天数或置信度时，只显示“仍在学习你的听歌时段”。",
          "在尚未形成结论的状态下隐藏“Resonance Boost 已形成稳定结论”一行；只有时段结论真实成立后才显示对应置信度说明。"
        ]},
        {title:"Compatibility",items:[
          "5.1.2 恢复的原始听歌时长采集、保存周期与统计算法保持不变；本版本没有重新引入 5.1.1 的问题 1 改动。",
          "玻璃机械轴心、播放、队列、EQ、Spectrum 声学缓存、主题和中英文界面继续兼容。"
        ]}
      ]
    },
    {
      version:"5.1.2", date:"2026-07-15", kind:"patch",
      summary:"HOTFIX BUILD：完整撤回 5.1.1 对听歌时长、周期统计、历史身份和 metadata 刷新的全部修改，恢复 5.1.0 原始行为；仅保留唱片玻璃机械轴心。",
      sections:[
        {title:"Complete History Rollback",items:[
          "听歌时长采集、4–5 秒增量保护、8 秒保存周期、每日记录结构与原有统计口径全部恢复为 5.1.0 实现。",
          "撤回自然周/月/年、后台计时重写、Crossfade 单独结算、旧记录未定日期迁移等 5.1.1 改动，避免现有周听歌时长骤减。",
          "撤回双版本 metadataVersions、titleAliases、导入时自动刷新和新增历史合并路径；本版本不再尝试修复灰色旧历史。"
        ]},
        {title:"Record Spindle",items:[
          "保留 5.1.1 中唯一确认有效的视觉改动：唱片中心黑点改为更小的玻璃机械轴心。",
          "轴心使用与唱针一致的毛玻璃、扁平与轻拟物材质，仍清楚可见但不再遮挡封面中心。"
        ]},
        {title:"Safety",items:[
          "5.1.2 直接基于原始 5.1.0 构建，而不是在 5.1.1 上局部删除，以确保没有残留计时或历史实验代码。",
          "播放、Spectrum 分析、IndexedDB 缓存、队列、EQ、主题与现有 5.1.0 用户数据格式保持不变。"
        ]}
      ]
    },
    {
      version:"5.1.1", date:"2026-07-15", kind:"patch",
      summary:"SPECTRUM ID PATCH（已撤回）：曾尝试重写听歌时长与改名历史恢复，但造成现有周期听歌时长回退，相关实现已在 5.1.2 全部撤销。",
      sections:[
        {title:"Withdrawn",items:[
          "本版本的计时、自然周期、双版本 metadata 快照与历史恢复改动不再作为有效功能。",
          "5.1.2 不继承这些实现，仅在版本历史中保留此条目说明回滚原因。"
        ]}
      ]
    },
    {
      version:"5.1.0", date:"2026-07-15", kind:"patch",
      summary:"HOTFIX BUILD：重新实现与背景自然融合的自适应 Soft Scroll Edge，修复改名歌曲的历史身份迁移，并重排最近最爱、十日趋势图与多条可信听歌洞察。",
      sections:[
        {title:"Adaptive Soft Scroll Edge",items:[
          "移除造成白色蒙层的强玻璃底色，改用透明 backdrop-filter、渐进 mask 与当前卡片背景的低强度动态染色；文字会溶入背景，而不是撞上一条矩形白边。",
          "上下效果完整覆盖滚动区域的全部宽度；专门修复 Grid 容器伪元素只占第一列、导致听歌数据右半边没有 Fade 的问题。",
          "边缘曲率与 Queue、Sound、Library、History、Settings 及 Changelog 各自的容器圆角匹配；效果仍只在用户滚动且对应方向存在内容时出现。"
        ]},
        {title:"Identity-safe Listening History",items:[
          "历史迁移现在会依次检查 Spectrum ID、audioEssenceKey、旧 contentKey、历史条目内的稳定身份、艺人别名及文件名标题，不再只比较当前 Artist + Title。",
          "重新扫描 metadata 前先把旧字符串键绑定到 Spectrum ID；扫描完成后统一刷新 Title、Artist、Album 与 Genre，因此旧听歌时长不会留在灰封面的旧名字下。",
          "历史封面查找共享同一套身份解析路径，可从稳定 ID、旧别名或当前播放列表记录恢复正确封面。"
        ]},
        {title:"Recent Favorites & Listening Data",items:[
          "最爱歌曲、最爱艺人、最爱专辑与最爱风格固定为真正的 2 × 2 矩阵；听歌习惯移到独立横向摘要，不再制造空白格。",
          "四张卡片的答案升级为更醒目的响应式大字，同时保持长歌名与窄窗口下的安全换行。",
          "折线图改为过去十天，取消会压扁坐标文字的非等比缩放，并降低图表高度，使日期轴更紧凑清晰。",
          "洞察窗口会在 4、6、8、12、16 周中根据有效周、有效天数和总时长选择最短可信范围；最多输出五条有关艺人、专辑、歌曲、时长趋势与活跃星期的本地洞察。"
        ]}
      ]
    },
    {
      version:"5.0.0", date:"2026-07-15", kind:"major",
      summary:"NEURAL UPDATE：正式引入 GP Neural Engine 1.0 — Resonance Boost，把播放队列、稳定歌曲身份与本地收听行为连接成第一代个人音乐洞察，同时为所有主要滚动界面加入 iOS 26 风格的柔和边缘玻璃。",
      sections:[
        {title:"GP Neural Engine 1.0 — Resonance Boost",items:[
          "Resonance Boost 将 Spectrum ID 作为歌曲身份，将逐日听歌时长、播放次数、时段分布与当前 metadata 作为本地行为信号；所有推导均在浏览器本地完成。",
          "最近最爱从歌曲、艺人、专辑、Genre 和听歌时段五个维度生成报告；数据量不足时扩大观察窗口，置信度仍不够则明确保持学习状态，绝不编造结论。",
          "听歌数据新增近一周每日时长折线图、过去五周最爱艺人和过去十二个月最爱艺人，并从最近八周生成可读洞察。"
        ]},
        {title:"Liquid Scroll Edges",items:[
          "Queue、Sound、Library、Listening History、Settings，以及 Changelog 的版本列表与正文均加入 soft scroll edge effect。",
          "初始静止状态不显示装饰；用户开始滚动后，内容在上下边界以渐变模糊和透明度过渡进入玻璃层，避免文字被硬切。",
          "效果只在内容确实可以继续向对应方向滚动时启用，并避免上下模糊层叠加。"
        ]},
        {title:"Queue Intelligence",items:[
          "默认队列重新保持 1 到音乐库末尾的固定真实顺序；当前曲目不再被旋转成列表第一项。",
          "切歌时自动把当前曲目定位到边缘玻璃下方，并保留上一首的局部内容作为位置上下文；用户仍可自由滚动到第 1 首或最后一首。",
          "当播放模式为 Shuffle 且首次导入音乐时，起始曲目从整个音乐库随机选择，不再永远停在第 1 首。"
        ]},
        {title:"Listening History Identity",items:[
          "全库重新扫描完成后，历史记录立即按 Spectrum ID 同步最新 Title 与 Artist；改名歌曲不会再显示旧名称。",
          "历史封面也改为优先按 Spectrum ID 关联当前音乐库，Artist 或 Title 改动不会让封面退化为灰色占位图。",
          "新增今天/本周/本月/本年的同期对比，以绿色上箭头或红色下箭头显示相对上一周期的时长变化。"
        ]},
        {title:"Performance Contract",items:[
          "报告只聚合 localStorage 中已经记录的秒数，不解码音频、不重跑 MFCC、Energy 或 BPM，也不触碰播放优先级。",
          "图表使用轻量 SVG 与 CSS，只有 hover 时才显示详细信息；时段统计随正常播放增量写入，不扫描旧文件。",
          "GP Spectrum 缓存、IndexedDB、Spectrum ID、队列拖拽、EQ、主题和现有播放体验保持兼容。"
        ]}
      ]
    },
    {
      version:"4.4.2", date:"2026-07-15", kind:"patch",
      summary:"HOTFIX BUILD：新增全库现存数据重新扫描，在 Spectrum ID 不变的前提下用音频文件里的最新 metadata 覆盖陈旧缓存，并以确认、进度和完成弹窗清楚反馈；MFCC、Energy、BPM 与收听历史完整保留。",
      sections:[
        {title:"Added",items:[
          "设置页新增“重新扫描全部歌曲”按钮，可对当前已导入的整个音乐库执行一次受控 metadata 刷新。",
          "点击后先显示确认弹窗；扫描期间显示实时歌曲计数与进度条；结束后显示更新数、真实 Genre 命中数和失败数。",
          "重新扫描支持从 MP3 ID3 与 FLAC Vorbis Comment 读取 Title、Artist、Album、日期和一个或多个 Genre。"
        ]},
        {title:"Changed",items:[
          "重新扫描会更新文件名、Title、Artist、Album、日期、Genre、时长、封面、缩略图、文件大小和修改时间，并将结果写回现有 trackCache。",
          "文件真实 Genre 会覆盖旧的 spectrum-inference 可见结果；如果文件仍没有 Genre，则继续使用已经缓存的 Spectrum 推断，不重新分析音频。",
          "Artist 改名会追加到同一 Spectrum ID 的 artistAliases；当前 genreIds 会跟随文件真实 Genre 刷新，canonicalArtistId 保持不变。"
        ]},
        {title:"Preserved",items:[
          "Spectrum ID、audioEssenceKey、三枚音频锚点、FLAC PCM MD5 和 legacyContentKeys 全部保持不变。",
          "MFCC、Energy、Loudness、BPM、采样率、声道、波形、氛围、推荐数据与播放历史不会删除、重算或迁移到新歌曲身份。",
          "重新扫描最多同时处理两首歌，完成后只统一刷新一次列表与当前歌曲界面，避免大量重复 render。"
        ]},
        {title:"Fixed",items:[
          "修复同一音频再次导入时因 Spectrum ID 命中 IndexedDB 而永久显示旧 Genre、旧 Artist 或旧封面的缓存遮蔽问题。",
          "修复仅改变文件夹路径、文件名或标签仍无法让 Glass Player 读取最新文件 metadata 的问题。"
        ]}
      ]
    },
    {
      version:"4.4.1", date:"2026-07-15", kind:"patch",
      summary:"SPECTRUM ID UPDATE：将 4.4.0 的音频本体识别正式命名为 GP Spectrum ID 1.0，采用更保守的恢复规则，并为 Artist/Genre/时间维度的个人收听模型建立稳定身份字段；同时完成可永久恢复的 Custom EQ。",
      sections:[
        {title:"GP Spectrum ID 1.0",items:[
          "每首歌获得 gpsid:v1 Spectrum ID；ID 只由容器中真实音频流的长度、前/中/后三枚 SHA-256 锚点以及可用时的 FLAC PCM MD5 组成。",
          "文件名、Title、Artist、Genre、Album、封面、padding 和文件修改时间不进入 Spectrum ID；这些表层信息以后可以独立修改。",
          "audioEssenceKey 继续作为兼容别名，4.4.0 与更早版本的 contentKey 会迁移到 Spectrum ID，不丢失旧识别结果。"
        ]},
        {title:"Conservative Match Policy",items:[
          "完整 Spectrum ID 精确一致或 FLAC PCM MD5 一致时才直接确认同一音频。",
          "锚点容错不再接受任意 2/3：必须音频流长度与结构签名完全一致、中段锚点一致，并且前段或尾段至少再一致一个。",
          "无法满足证据门槛时宁可建立待确认的新身份，也不会仅凭歌名、艺人、码率、时长或 Genre 强行合并。"
        ]},
        {title:"Personal Listening Foundation",items:[
          "track cache 新增 spectrumId 与 identityLinks，预留 canonicalArtistId、artistAliases 和 genreIds；统一艺人名称时可继续绑定原歌曲身份。",
          "播放历史开始优先使用 Spectrum ID，而不是 artist + title 字符串；旧历史会在歌曲再次播放时无损迁移，并保留曾经出现过的 Artist 名称。",
          "为未来 Favorite Artist、按 Artist/Genre/时间统计和高度个人化推荐预留稳定数据关系，本版本暂不添加新的可见页面。"
        ]},
        {title:"Persistent Custom EQ",items:[
          "Custom 按钮现在始终显示，不需要先拖动频段滑块才出现。",
          "手动调整任意频段会立即保存独立的 customEQGains；切换到 Flat、Bass、Vocal 等预设不会覆盖自定义曲线。",
          "以后点击 Custom 会恢复上次保存的七段频率增益；4.4.0 已保存的自定义 eqGains 会自动迁移。"
        ]},
        {title:"Compatibility",items:[
          "GP Spectrum Engine 2.0、Spectrum Algorithm 2.1.0、MFCC、Energy、BPM、Genre 与技术信息读取保持不变。",
          "IndexedDB 升级到数据库 v5、track cache schema v6，并增加 Spectrum ID 索引；旧缓存继续只加不减。",
          "本版本不处理同曲 Live/Studio 多版本消歧，因为当前音乐库不存在这种并存情况；不同音频流仍自然得到不同 Spectrum ID。"
        ]}
      ]
    },
    {
      version:"4.4.0", date:"2026-07-15", kind:"minor",
      summary:"RECOG UPDATE：引入 GP Recognition Engine 1.0，以音频流本体而不是文件名、Artist、Title、Genre、封面或修改时间识别歌曲；旧版 MFCC、Energy、BPM、波形、封面与技术信息会迁移到新的稳定身份。",
      sections:[
        {title:"Audio-Essence Identity",items:[
          "新增 audioEssenceKey：先定位容器中的真实音频数据区，再以音频流长度和三枚独立 SHA-256 锚点生成稳定歌曲身份。修改文件名或 metadata 不会改变该身份。",
          "三枚锚点分别取自音频流前段、中段与尾段；它们不读取 ID3、FLAC Vorbis Comment、MP4 metadata、WAV LIST 标签或封面。",
          "Bitrate、时长、采样率与声道继续保留为技术信息和辅助校验，但不单独充当歌曲主键，避免不同歌曲因参数相同而被误合并。"
        ]},
        {title:"Four-Layer FLAC Recognition",items:[
          "FLAC 除三枚音频流锚点外，额外读取 STREAMINFO 内的 PCM MD5；Artist、Title、Genre、Album、封面和 padding 改动均不会影响该值。",
          "匹配优先级为完整 audioEssenceKey → FLAC PCM MD5 → 三锚点多数票。即使某一锚点因容器异常漂移，另外两枚一致时仍可恢复原歌曲。",
          "当前音乐库的 328 个 FLAC 与 13 个 MP3 均通过三锚点实文件读取测试，并得到 341 个独立音频身份。"
        ]},
        {title:"Container-Aware Recognition",items:[
          "MP3 会跳过 ID3v2、ID3v1 与 APE 标签；FLAC 会跳过全部 metadata block；M4A/MP4 只识别 mdat；WAV 只识别 data chunk。",
          "Ogg/Opus 会越过识别头与评论头，WMA 会定位 ASF Data Object；无法可靠定位音频区的罕见格式会明确标为 unreliable，而不会冒充稳定识别。",
          "导入只读取容器头和最多三段 64KB 音频数据，不为身份识别解码整首歌曲，也不增加播放启动负担。"
        ]},
        {title:"Legacy Cache Migration",items:[
          "IndexedDB 升级到数据库 v4、track cache schema v5，并为 audioEssenceKey、三枚锚点与 FLAC PCM MD5 建立索引。旧记录继续只加不减。",
          "首次用 4.4.0 导入未修改的旧文件时，会通过旧 fileIdentity 找回 4.3.1 记录，再把 MFCC、Energy、Loudness、BPM、采样率、声道、波形、封面与 Genre 结果复制到新身份。",
          "Spectrum Algorithm 仍为 2.1.0、feature schema 仍为 v4，因此身份迁移不会触发声学特征重算；旧 contentKey 作为 legacyContentKeys 保留以便追溯。"
        ]},
        {title:"Future Metadata Safety",items:[
          "为后续批量统一 Artist、写入正式 Genre、修改 Title 与重命名文件预留 recognition 和 legacyContentKeys 字段；metadata 变化与音频身份从此分离。",
          "未来显示信息可被新标签覆盖，但推荐与相似度使用的 MFCC/BPM/Energy 仍绑定 audioEssenceKey，不会因改名丢失。",
          "本版本不改变播放器 UI、动画、播放逻辑或现有 Genre/MFCC 展示；RECOG UPDATE 只替换底层识别与缓存主键体系。"
        ]}
      ]
    },
    {
      version:"4.3.1", date:"2026-07-15", kind:"patch",
      summary:"HOTFIX BUILD：撤销 4.3.0 会将不确定歌曲默认归类为 Pop 的错误设计，重建 Genre 为多特征、多类别评分系统，并重写 MFCC 简短摘要，修复《光辉岁月》被判断为 Pop、Dark · Soft 等明显错误。",
      sections:[
        {title:"Genre Collapse Fix",items:[
          "删除 inferSpectrumProfile 中的默认 Pop 分支；任何类别都必须通过声学证据或明确文本线索获得分数，证据不足时使用 Mixed，而不是伪造 Pop。",
          "分类器同时计算各 Genre 得分、第一名与第二名差距、Top 3 分数及置信度；两个类别接近时允许显示双标签，不再强行隐藏不确定性。",
          "加入固定回归样本：BEYOND /《光辉岁月》必须得到 Rock，MFCC 摘要必须为 Warm · Driving，不允许再次出现 Pop 或 Dark · Soft。"
        ]},
        {title:"Expanded Acoustic Evidence",items:[
          "MFCC 代表帧上限由 72 增加至 120，并继续均匀覆盖整首歌曲；新增数据仍与 Energy/BPM 共用唯一一次音频解码。",
          "除 13 维 MFCC 均值和标准差外，新增频谱滚降、频谱带宽、过零率、低/中/高频能量比例、频谱通量、峰均比、动态范围和 MFCC 帧间变化。",
          "Genre 评分综合 Energy、RMS Loudness、BPM、节奏置信度、MFCC、频段分布、动态与谱变化，不再用单个 centroid/flatness 阈值决定整首歌。"
        ]},
        {title:"Multi-Genre Scoring",items:[
          "独立评分 Pop、Rock、Metal、Electronic、Hip-Hop、R&B/Soul、Jazz、Classical、Ambient、Folk/Country、Soundtrack、Reggae、Blues 与 Mixed。",
          "Rock 强调中频、动态、谱变化、响度和节奏范围；Electronic 强调稳定节拍、能量与频段结构；Classical 与 Ambient 通过动态范围和节奏稳定度进一步区分。",
          "该轻量模型没有冒充 CNN：它是适合单文件 HTML 的可解释评分器。GTZAN 等开源工作也表明 Genre 分类需要标准化后的多维声学特征，而不是仅靠 MFCC 名称或少量阈值。"
        ]},
        {title:"Offline Artist & Title Knowledge",items:[
          "扩充离线艺人/作品线索，覆盖 BEYOND、黄家驹、《光辉岁月》《海阔天空》《真的爱你》以及更多中外 Rock、Metal、Classical、Jazz、Electronic、Hip-Hop、R&B、Ambient、Soundtrack 等艺人。",
          "明确文本线索只为对应类别增加高权重，仍保留声学得分；文件自带真实 Genre 时继续优先使用 metadata，不覆盖用户标签。"
        ]},
        {title:"MFCC Summary Semantics",items:[
          "废除 Dark · Soft 这种将音色明暗直接解释为情绪的组合；音色改用 Bright、Warm、Deep，运动/结构改用 Driving、Dynamic、Punchy、Calm、Smooth、Balanced。",
          "Rock/Metal 作品会优先显示 Driving 或 Dynamic；Soft 标签已完全删除。MFCC 摘要现在描述声音结构，不再假装判断歌曲情感。"
        ]},
        {title:"Cache Migration",items:[
          "Spectrum Algorithm 升级至 2.1.0、feature/track cache 升级至 schema v4；4.3.0 的错误 Genre 和缺失特征会执行一次纠正分析。",
          "纠正后的全部新特征、Top 3 Genre 得分、双标签、摘要与置信度继续永久保存到 IndexedDB；后续启动不重复计算。"
        ]}
      ]
    },
    {
      version:"4.3.0", date:"2026-07-15", kind:"minor",
      summary:"SPECTRUM UPDATE：GP Spectrum Engine 升级至 2.0，在原有 Energy、Loudness 与 BPM 之外加入本地 MFCC 音色分析、超简短声音摘要、氛围判断和缺失 Genre 推断。所有结果只计算一次并永久写入 IndexedDB。",
      sections:[
        {title:"GP Spectrum Engine 2.0",items:[
          "将声学特征缓存升级到 schema v3 与 Spectrum Algorithm 2.0.0；旧版本 Energy/BPM 缓存只会为新增 MFCC 执行一次升级分析，此后直接恢复。",
          "Energy、RMS Loudness、BPM、MFCC、氛围、推断 Genre、置信度、Sample Rate、Channels 与波形继续共用唯一一次 AudioBuffer 解码。",
          "分析仍在首轮歌单渲染后逐首排队，不并发解码多首音频；计算阶段通过 requestIdleCallback 分片让出主线程。"
        ]},
        {title:"MFCC Pipeline",items:[
          "实现 Hann 窗、1024 点 radix-2 FFT、功率谱、40 段 Mel filterbank、log-Mel 与正交 DCT-II，输出 13 维 MFCC。",
          "参数结构参考 librosa 的 Mel spectrogram / MFCC 链路与 Essentia MusicExtractor 的 low-level MFCC 统计方式，但实现为无外部依赖的原生 JavaScript。",
          "每首歌曲最多选择 72 个均匀分布于整首音频的代表帧；保存 13 维均值、标准差、有效帧数、采样率、FFT 大小、Mel 段数、频谱质心和频谱平坦度。"
        ]},
        {title:"Mood & Genre Inference",items:[
          "由 Energy、RMS Loudness、BPM、MFCC 统计、频谱质心和频谱平坦度组合判断明亮/温暖/深沉、平静/有活力/强烈等氛围轮廓。",
          "Genre 推断先检查艺人、歌名和文件名中的明确本地线索，再用声学特征在 Pop、Rock、Electronic、Hip-Hop、R&B/Soul、Jazz、Classical、Ambient、Folk/Country 与 Soundtrack 中选择。",
          "只有文件本身没有 Genre 时才自动补全；推断结果标记为 spectrum-inference 并保存置信度，不覆盖真实 metadata 标签。",
          "该功能是本地启发式分类而非联网识别或预训练模型，因此提供可复现的合理归类，但不声明达到专业音乐分类模型的准确率。"
        ]},
        {title:"Sound UI",items:[
          "在 Energy 与 BPM 下方加入 MFCC 超简短摘要，例如“温暖 · 柔和”或“明亮 · 有活力”；中英文会随界面即时切换。",
          "原本缺失的 Genre 会在分析完成后填入本地推断结果，缓存命中时在第一次列表渲染前直接恢复。"
        ]},
        {title:"Persistent & Future-Ready",items:[
          "trackFeatures 与完整 trackCache 同时保存 MFCC 向量统计、摘要代码、氛围、Genre、来源、置信度和算法版本；移除歌曲仍不删除结果。",
          "未来学习用户喜好或重做推荐算法可以直接读取已缓存特征向量，不需要重新解码整个音乐库；只有明确升级 Spectrum 算法版本时才会执行一次受控迁移。",
          "固定 72 帧 MFCC 上限使新增 FFT/DCT 工作量与歌曲长度解耦，避免重新出现 Snow Leopard Update 之前随歌单规模失控的初始化计算。"
        ]}
      ]
    },
    {
      version:"4.2.1", date:"2026-07-15", kind:"patch",
      summary:"HOTFIX BUILD：将歌曲文件信息、metadata、封面、技术参数、波形、Energy 与 BPM 统一为只读一次的 IndexedDB 完整快照，并彻底移除音效信息栏遗留的重复音频解码；同时重新提高自动封面主题色在背景和玻璃卡片上的可读性。",
      sections:[
        {title:"Complete IndexedDB Song Snapshot",items:[
          "同一 contentKey 的永久歌曲记录现在同时保存文件名、文件大小、MIME 类型、修改时间、相对路径、格式、时长、估算比特率、标题、艺人、Genre、原始封面和缩略图。",
          "首次 Spectrum 分析完成后，同一记录继续写入 Sample Rate、Channels、160 点轻量波形、Energy、Energy dB、BPM、BPM confidence、算法版本与完成状态。",
          "缓存记录升级为 schema v2，并带有 informationComplete 标记；歌曲从当前歌单移除仍不会删除 IndexedDB 中的完整信息。"
        ]},
        {title:"Read Once, Restore Everything",items:[
          "重新启动并再次选择同一文件时，播放器先按 fileIdentity/contentKey 命中缓存，并在首次列表显示前恢复所有可见歌曲信息。",
          "4.2.0 已经生成的 trackFeatures 会在首次命中时自动合并回主 trackCache，完成一次兼容迁移，不需要重新解码音频。",
          "即使 BPM 无法稳定识别，Sample Rate、Channels、Energy 与完成状态仍按真实结果保存；BPM 显示未检测到而不是让整条缓存失效。"
        ]},
        {title:"Duplicate Decode Removal",items:[
          "删除旧 loadWaveformFor() 中独立的 AudioContext、整文件 arrayBuffer 和 decodeAudioData 队列。进入音效页面现在只绘制已缓存波形并更新文字，不再读取音频文件。",
          "整个运行时只保留 GP Spectrum Engine 的唯一一次完整解码；同一解码同时产出技术参数、波形、Energy 和 BPM。",
          "格式、时长和比特率均从持久快照显示，Sample Rate 与 Channels 不再因为切换歌曲或重新进入音效页而出现重复解码。"
        ]},
        {title:"Accent Readability",items:[
          "自动封面主题色的最低对比度提升至 4.5:1，不再只对页面底色检查，而是同时检查页面背景与实际强玻璃卡片的合成表面。",
          "保留 OKLab 封面调和与低色度限制，因此提高可读性依靠亮度方向的动态求解，不会退回预设色，也不会重新制造高饱和荧光色。",
          "保留约 7.5:1 的高对比度保护线，在清楚可读和视觉柔和之间保留明确边界。"
        ]},
        {title:"Compatibility",items:[
          "GP Spectrum Engine 1.0 的 Energy/BPM 算法范围不变；本次修复集中于持久化完整性、重复读取和 Accent 可读性。",
          "播放器布局、Glass UI、动画、播放队列、EQ 与原有操作方式保持不变。"
        ]}
      ]
    },
    {
      version:"4.2.0", date:"2026-07-15", kind:"minor",
      summary:"SPECTRUM UPDATE：引入 GP Spectrum Engine 1.0，为本地歌曲自动检测 Energy 与 BPM，并将结果持久保存到 IndexedDB。已经分析过的同一音频文件在重启并重新导入后直接恢复结果，不再重复解码。",
      sections:[
        {title:"GP Spectrum Engine 1.0",items:[
          "建立独立的歌曲声学特征分析流程；当前正式支持 Energy 与 BPM，分析器版本、完成状态和置信度随歌曲 contentKey 一同记录。",
          "分析任务在歌单首次完成显示后才进入后台队列，并且严格逐首执行，避免多首音频同时解码造成初始化卡顿和瞬时内存峰值。",
          "每首歌曲最多分析 180 秒；长歌曲从第 15 秒开始取样，避开部分作品过长的静音或渐入，同时限制单次计算规模。"
        ]},
        {title:"Energy Detection",items:[
          "以 100 Hz 时间包络抽样音频，在每个时间块内计算多声道 RMS，再由整段均方能量得到响度强度。",
          "RMS 转换为 dB 后映射到 0–100 的 Energy 指标；它描述歌曲整体声能，不使用曲风或文件名作随机猜测。",
          "分析得到的轻量波形峰值可复用到当前会话，避免为同一首歌再启动一次波形解码。"
        ]},
        {title:"BPM Detection",items:[
          "从能量包络的正向变化构造 onset flux，再通过 60–200 BPM 范围内的归一化自相关寻找主要节拍周期。",
          "加入二倍频与三倍频校正，减少 120、180 BPM 被误判为 60 BPM 的半速/三分之一速结果，并保存 BPM confidence。",
          "无稳定节拍或分析时长不足时明确显示未检测到，不伪造一个随机 BPM。"
        ]},
        {title:"Persistent Feature Cache",items:[
          "Energy、原始 dB、BPM、置信度、采样率、声道数、算法版本和完成状态写入 IndexedDB 的 trackFeatures 数据区。",
          "缓存继续采用只加不减的 contentKey 身份：歌曲从当前歌单移除不会删除分析结果；重启后重新选择同一文件即可直接恢复。",
          "特征缓存会在首轮列表渲染前读取，缓存未命中的歌曲才在渲染后排队；单首分析完成只更新正在显示的歌曲信息卡，不重建整个歌单。"
        ]},
        {title:"Sound UI",items:[
          "在音效页歌曲信息栏的 Genre 下方加入 Energy 与 BPM 两行，分析中、未检测到和已完成状态均有明确反馈。",
          "Energy 显示为 0–100，BPM 显示为整数 BPM；中英文界面同步提供对应标签与状态文本。"
        ]},
        {title:"Accent Contrast Hotfix",items:[
          "封面自动取色仍由封面调色板与真实背景动态调和，但主题色与背景的最低对比度从 2.35 提高到 3.25。",
          "继续保留最大对比度限制，避免重新变成刺眼荧光色；结果同时满足可读性下限与视觉柔和上限，而不是改用预设颜色。"
        ]},
        {title:"Scope",items:[
          "本版本没有引入 MFCC，也没有启用基于声学特征的推荐；MFCC 将沿用同一 trackFeatures 持久化契约在后续版本实现。",
          "播放器布局、Glass UI、动画参数、播放队列和音频控制逻辑不因 Spectrum Engine 发生改版。"
        ]}
      ]
    },
    {
      version:"4.1.2", date:"2026-07-15", kind:"patch",
      summary:"HOTFIX BUILD：重做“UI 主题色跟随当前歌曲封面”的颜色算法。主题色不再强制提高饱和度，也不从预设色中挑选，而是由封面多色调色板与当前真实背景色动态调和。",
      sections:[
        {title:"Adaptive Accent Harmony",items:[
          "从封面提取最多 5 个主要颜色，不再只使用出现次数最高的单一色块，降低大片纯色背景误导主题色的概率。",
          "将封面颜色转换到 OKLab 感知色彩空间，根据颜色排名与有效色度计算加权中心，使结果保留每张封面独有的色相关系。",
          "读取页面当前实际 background-color，并在 OKLab 中将封面色彩中心与背景色按比例混合；浅色、深色和自动主题因此会得到不同但协调的结果。",
          "算法只限制最终感知色度上限，不替换成任何预设主题色；灰色封面仍可生成中性色，彩色封面则保留经过柔化的自身色相。"
        ]},
        {title:"Contrast & Comfort",items:[
          "使用真实相对亮度计算主题色与背景的对比度；不足时沿 OKLab 明度轴逐步调整，直到达到最低可辨识阈值。",
          "高饱和红、蓝、黄、绿等颜色会保留来源色相，但降低感知色度，避免按钮、光晕和版本标签出现荧光感。",
          "按钮前景色改由 WCAG 黑白对比度自动选择，避免柔化后的主题色导致图标或文字不清楚。"
        ]},
        {title:"Compatibility",items:[
          "手动 Accent Color 预设保持不变；新算法只在开启 Match UI accent to current cover 时运行。",
          "封面、背景模式、Glass UI、动画和 GP Core 2.0 缓存流程不受影响。"
        ]}
      ]
    },
    {
      version:"4.1.1", date:"2026-07-15", kind:"patch",
      summary:"HOTFIX BUILD：正式为 Snow Leopard 架构修订引入新的引擎版本标识——GP Core 2.0 与 GP Motion Engine 1.1，并统一当前构建、运行时信息和更新日志中的版本定义。",
      sections:[
        {title:"GP Core 2.0",items:[
          "将 4.1.0 建立的 append-only IndexedDB 曲库缓存、有界导入流水线、两级缓存命中与单次 render 提交正式定义为 GP Core 2.0。",
          "Core 2.0 的边界覆盖歌曲身份、metadata、封面缩略图、持久缓存与导入调度；播放文件本身仍由用户授权的本地文件提供。",
          "继续保持 Storage Adapter 契约，为未来 Electron Lake 使用 SQLite 替换 IndexedDB 保留稳定接口。"
        ]},
        {title:"GP Motion Engine 1.1",items:[
          "将 Motion Engine 升级至 1.1，确认现有 Glass 滑块、队列拖拽、唱片、Disk Reader 与设置开关兼容新的单次渲染生命周期。",
          "Motion 1.1 不重新设计视觉风格；它是对 Gen 3 动画系统在 GP Core 2.0 数据流下的兼容性修订。",
          "播放器 CSS、动效参数、响应式布局与交互反馈保持 Snow Leopard Update 的视觉结果。"
        ]},
        {title:"Build Identity",items:[
          "当前版本更新为 Glass Player 4.1.1，构建名称为 HOTFIX BUILD。",
          "版本卡、运行时 window.GP.engines、中英文更新日志与 TXT 导出标题已统一使用新的版本和引擎编号。",
          "4.1.0 SNOW LEOPARD UPDATE 作为完整架构更新保留在历史日志中。"
        ]}
      ]
    },
    {
      version:"4.1.0", date:"2026-07-15", kind:"minor",
      summary:"SNOW LEOPARD UPDATE：不增加新的可见页面，而是重写本地曲库的导入、缓存与渲染链路。歌曲信息和封面进入只增不减的 IndexedDB 缓存；同一文件夹在重启后重新导入时优先零读取命中，并且每批文件只提交一次完整列表渲染。",
      sections:[
        {title:"Architecture — 从预留接口到真实缓存主链路",items:[
          "将 4.0.0 中仅作为边界预留的 IndexedDB 正式接入歌曲导入流程，新增 trackCache 数据区并将数据库升级至 schema v3。",
          "trackCache 以 contentKey 为永久主键，保存文件身份、基础 metadata、时长、Genre、原始封面 Blob、192px 缩略图 Blob 与缓存时间。",
          "缓存采用 append-only 语义：歌曲从当前歌单移除时只释放本次会话的音频和图片 URL，不删除 IndexedDB 中已经完成的歌曲信息。",
          "数据库门面只提供 getTrackCache、getTrackCacheByFileIdentity 与 addTrackCache，不向播放器业务暴露删除 trackCache 的路径。"
        ]},
        {title:"Two-Level Cache — 重启后的快速命中",items:[
          "第一层使用文件大小、修改时间、类型和文件夹相对路径组成 fileIdentity；重新选择同一文件夹时无需读取音频内容即可命中缓存。",
          "文件被移动、重命名或身份信息变化时，第二层只读取开头、中间和结尾各 64KB，生成 SHA-256 contentKey，再按音频内容恢复原有缓存。",
          "命中缓存后直接恢复 title、artist、duration、genre、封面和缩略图，不再重复解析 ID3、FLAC 或 MP4 metadata。",
          "缓存只保存歌曲信息与图片，不复制整首音频文件；刷新或重启后仍需由用户重新选择本地文件夹，以保持私人本地播放器的权限边界。"
        ]},
        {title:"Import Pipeline — 有界并发而不是全量 Promise.all",items:[
          "文件身份和内容指纹最多并行 4 个任务；真正的 metadata、封面与 Genre 解析最多并行 2 首，避免数十个音频文件同时进入内存。",
          "临时 Audio metadata 探针在得到时长、失败或超时后立即暂停、移除 src 并执行 load()，主动释放媒体资源。",
          "M4A / MP4 不再执行整文件 arrayBuffer()；现在只扫描顶层 Atom 头，定位 moov 后最多读取 32MB metadata 区块。",
          "单个损坏或不支持的文件只回退到文件名信息，不会中断整批导入，也不会迫使已经完成的歌曲重新处理。"
        ]},
        {title:"Rendering Complexity — 删除初始化 O(n²)",items:[
          "旧流程在每首歌曲时长完成和封面完成后分别重建整个歌单与播放队列，导致 n 首歌曲触发约 2n 次 O(n) 列表生成。",
          "4.1.0 在后台完成整批缓存解析后统一提交状态：无论本批加入多少首歌，完整列表只 render 一次。",
          "因此导入阶段的解析工作保持 O(n)，列表渲染提交次数为 O(1)；最终一次生成 n 行仍然是必要的 O(n)，不虚假宣称整个导入为 O(1)。",
          "GP.performance.lastImport 会记录 files、cacheHits、cacheMisses、cacheWrites、duplicates、renderCommits 与 durationMs，便于实际验证每次导入只提交一次渲染。"
        ]},
        {title:"Cover & Memory — 封面只解析一次",items:[
          "首次解析到的原始封面以 Blob 永久缓存，供唱片和静态封面使用；同时生成独立的 192×192 WebP 缩略图供歌单、播放队列和历史排行使用。",
          "36px 列表图片不再迫使 Edge 为每首歌解码完整的大尺寸封面；缩略图启用 lazy loading 与 async decoding。",
          "同一歌曲下次导入时直接从 IndexedDB 恢复两个图片 Blob，不再扫描音频文件，也不再重新生成缩略图。",
          "删除当前歌单歌曲会撤销本次会话创建的 coverUrl、thumbUrl 与 audioUrl，但持久缓存保持不变。"
        ]},
        {title:"On-Demand Audio Analysis — 初始化不再解码整首歌",items:[
          "首次加载歌曲时不再立刻为了响度和声道信息读取并解码整首音频；只有用户打开音效页时才按需启动分析。",
          "音频分析改为单通道顺序队列，快速切歌时过期任务会在读取或解码前退出，避免多首歌曲同时形成 PCM 内存峰值。",
          "移除 decodeAudioData 前的完整 ArrayBuffer 副本，进一步降低单首歌曲分析时的瞬时内存。"
        ]},
        {title:"Compatibility & Storage Rules",items:[
          "播放器布局、Glass UI、动效、播放队列、主题、双 Deck、EQ 与 Crossfade 保持原有交互；Snow Leopard Update 的主要变化位于数据和导入层。",
          "缓存记录默认只增不减；从歌单移除、减少本次导入文件数量或切换文件夹都不会清除历史歌曲信息。",
          "只有用户主动清理 Edge 的网站数据或浏览器拒绝 IndexedDB 时缓存才会丢失；播放器会在存储不可用时安全回退到本次会话解析。",
          "这一缓存接口继续遵循 Storage Adapter 边界，未来 Electron Lake 可以用 SQLite 接管相同职责，而不重写上层导入逻辑。"
        ]}
      ]
    },
    {
      version:"4.0.0", date:"2026-07-15", kind:"major",
      summary:"GP Neural 的第一份工程蓝图：Gen 4 将让 Glass Player 从“能够播放与呈现音乐”迈向“能够理解音乐”。本 Beta 先建立可迁移、可缓存、可验证的底层边界；现有播放器 UI、动画、队列与操作手感保持不变。",
      sections:[
        {title:"Beta Mission — 从播放音乐到理解音乐",items:[
          "GP Neural 是 Glass Player Gen 4 的核心方向：以可计算的音频特征取代缺少依据的随机判断，让推荐、聚类与可视化建立在歌曲本身之上。",
          "第一阶段只整理架构与数据契约，不急于把未完成的分析结果暴露给用户；这样可以避免半成品算法污染现有推荐体验。",
          "4.0.0 的兼容承诺是 Zero-Visual-Change：除版本信息与更新日志外，3.5.3 的 DOM、CSS、布局、主题、动效、队列和播放逻辑均保持原有体验。",
          "Gen 4 继续运行于浏览器形态的 Harmonic Lake；它是未来 Electron Lake 的准备层，而不是提前进行一次高风险的整体重写。"
        ]},
        {title:"Harmonic Lake — Gen 4 模块边界",items:[
          "/src/core/audio.js 作为现有音频运行时的兼容桥梁，继续承接双 Deck、Web Audio、EQ、Crossfade、播放状态与队列调用，不改变上层使用方式。",
          "/src/core/database.js 提供统一的数据访问门面；上层模块只表达“读取或保存什么”，不直接依赖 IndexedDB 的具体语法。",
          "/src/core/analyzer.js 定义 GP Neural 的 cache-first 分析入口、特征记录格式与分析版本，为后续真正接入音频计算保留稳定契约。",
          "/src/storage/indexeddb.js 负责浏览器本地持久化；/src/ui/galaxy.js 与 /src/ui/timeline.js 目前仅保留模块入口，不生成任何新界面。",
          "模块拆分的目标不是增加层级，而是把音频、分析、存储与未来 UI 解耦，使单个模块升级时不牵动整个播放器。"
        ]},
        {title:"IndexedDB — 本地数据基础",items:[
          "数据库采用懒加载策略：页面初始化时不立即打开数据库，只有未来模块真正请求数据时才建立连接，避免为当前用户体验增加无意义的启动负担。",
          "trackFeatures 以 contentKey 标识音频内容，计划保存 metadata、MFCC、Energy、BPM、分析时间与 schemaVersion；同一首歌再次导入时可以优先命中缓存。",
          "behaviorEvents 预留播放完成、跳过、重播、加入队列等行为事件；userModel 用于保存聚合后的偏好，而不是无限堆积原始操作。",
          "recommendations 预留可复现的推荐快照，使推荐来源、生成时间和使用的模型版本能够被检查，而不是每次刷新都得到不可解释的随机结果。",
          "所有数据只保存在本机浏览器存储中；本 Beta 不上传歌曲、音频特征或用户行为。"
        ]},
        {title:"Analysis Pipeline — 计划中的分析链路",items:[
          "目标流程为：导入歌曲 → 生成稳定 contentKey → 查询本地缓存 → 读取 metadata → 解码必要音频片段 → 计算 Energy / BPM / MFCC → 写入 IndexedDB → 提供给推荐与可视化模块。",
          "缓存命中时跳过重复解码与计算，只恢复已验证的特征记录；缓存未命中或 schemaVersion 变化时才重新分析。",
          "分析任务将与首屏播放能力分离：歌曲应先可见、可搜索、可播放，再在后台分批补齐特征，避免初始化音乐库时阻塞 Edge 主线程。",
          "未来会限制并发分析数量、及时释放 AudioBuffer，并以分段任务让出主线程，目标是在保持界面丝滑的同时降低峰值内存。",
          "错误或不支持的音频不会阻止整批导入；失败记录应可单独重试，并明确区分 metadata 成功与音频特征成功。"
        ]},
        {title:"MFCC + Energy + BPM — 三类核心信号",items:[
          "Energy 描述歌曲整体响度、密度与动态强弱，为区分舒缓、饱满或高强度段落提供基础，但不会被简单当作音量旋钮。",
          "BPM 描述主要节拍速度，并需要置信度与半拍/双拍校正，避免把 70 BPM 与 140 BPM 的同源节奏错误分离。",
          "MFCC 描述频谱包络与音色结构，可用于衡量歌曲之间的听感距离；它不是直接输出流派名称的标签器。",
          "三类特征会先标准化再组合为相似度向量，避免单一 BPM 或单一响度支配整个推荐结果。",
          "特征值必须携带分析版本，算法升级后可以选择性重算，而不是让旧数据与新数据无声混用。"
        ]},
        {title:"User Model & Recommendations — 推荐方向",items:[
          "计划中的数据流为：歌曲特征 + 用户行为 → 本地用户模型 → 推荐候选 → 日推歌单与随机播放优化。",
          "播放完成、主动重播与加入队列可形成正向信号；快速跳过只能作为弱负向信号，避免一次误触永久降低歌曲权重。",
          "日推歌单将优先维持相近的风格、音色、Energy 与 Tempo，使一组歌曲具有连续氛围，同时保留少量探索位防止推荐越来越窄。",
          "随机播放不会被直接删除，而会升级为受当前歌曲、用户偏好与近期重复惩罚共同约束的可解释选择。",
          "现有手动播放队列仍拥有最高优先级；GP Neural 不得打乱用户明确安排的下一首顺序。"
        ]},
        {title:"Performance & Cache Strategy — 性能展望",items:[
          "同一音频只分析一次是首要原则：稳定指纹、特征缓存与 schema 版本共同减少重复工作，并直接缩短再次导入音乐库的等待时间。",
          "分析将采用渐进式调度，优先当前歌曲和即将播放的歌曲，其余曲目在空闲时间处理，避免一次性抢占 CPU。",
          "内存策略将限制同时存在的解码缓冲区数量，分析完成后释放大对象，只长期保存紧凑的特征向量和必要统计。",
          "银河和时间机器未来只读取整理后的坐标或特征摘要，不在每一帧重复计算音频距离；鼠标高速移动时也不会强制生成昂贵详情。",
          "性能优化不得通过移除动画、降低交互完整度或改变现有视觉层级来换取，用户可见的丝滑体验是验收条件之一。"
        ]},
        {title:"Electron Lake Readiness — 为 Gen 5+ 铺路",items:[
          "未来桌面版将把 storage/indexeddb.js 替换为 storage/sqlite.js；core/database.js 对外接口保持一致，分析器和 UI 不需要了解底层数据库已经变化。",
          "Electron Lake 的目标是从单 HTML 交付转向 EXE、SQLite 与更稳定的后台分析能力，但迁移本身属于 Gen 5+，不计入本 Beta 的已完成功能。",
          "在 Harmonic Lake 阶段先验证数据结构、缓存规则与模块责任，可以显著降低未来桌面迁移时同时改动 UI、算法和存储的风险。"
        ]},
        {title:"Beta Scope — 已完成与尚未实现",items:[
          "本 Beta 已完成：Core / UI / Storage 模块契约、现有 Audio Runtime 兼容桥、懒加载 IndexedDB schema、特征记录格式，以及对应的实体 /src 目录骨架。",
          "本 Beta 尚未实现：真实 MFCC、Energy、BPM 计算，导入流程中的缓存命中，用户模型，新推荐算法，音乐银河，音乐时间机器，以及 Electron / SQLite。",
          "未实现项目会继续保留为路线图，不以占位接口冒充可用功能；后续每项能力都需要经过正确性、性能与 UI 无回归验证后再进入正式日志。",
          "Beta 的成功标准不是界面看起来更新了，而是未来加入 Neural 能力时不再需要破坏已经成熟的播放器体验。"
        ]}
      ]
    },
    {
      version:"GP Gen 4 Pre-Release Update", date:"2026-07-15", kind:"milestone",
      summary:"一份面向 Gen 4 的完整回顾：Glass Player 的前三代并不是互相取代的三套播放器，而是从“建立可靠核心”、到“融合听歌体验”、再到“形成完整设计语言”的连续积累。GP Core、GP Fusion 与 GP Motion 共同构成今天的 Harmonic Lake。",
      sections:[
        {title:"Why This Retrospective — 为什么在 Gen 4 前回顾",items:[
          "版本号记录改动，Generation 则记录产品能力发生质变的阶段；本篇将 1.x–3.x 的功能清单整理为清晰的产品演进逻辑。",
          "Gen 1 回答“本地播放器能否可靠工作”，Gen 2 回答“多个播放能力能否形成连续体验”，Gen 3 回答“所有界面与交互能否说同一种设计语言”。",
          "3.5.3 FINAL HOTFIX RELEASE 为 3.x 收尾：核心播放、沉浸体验和 Motion 设计语言至此形成稳定基线。",
          "进入 Gen 4 后，前三代引擎不会被替换；GP Neural 将建立在它们之上，为音乐理解、缓存和推荐提供第四层能力。"
        ]},
        {title:"Glass Player Gen 1 — Foundation Generation",items:[
          "Built the foundation of local music experience.",
          "Gen 1 从最基本但不可妥协的本地音乐路径开始：导入文件、识别歌曲、显示资料、搜索音乐库、控制播放，并让所有内容留在用户设备中。",
          "Playback 建立播放 / 暂停、进度、上一首 / 下一首、音量与播放状态；Music Library 让一批离散文件第一次成为可浏览的歌曲集合。",
          "Metadata 与封面读取把文件名提升为歌曲、歌手、专辑等可识别信息；Search 则让本地曲库不再依赖手动翻找。",
          "Basic Glass UI 首次确立半透明面板、柔和层次与封面驱动氛围，为后续完整 Glass 语言留下视觉原点。",
          "这一代的价值不是功能数量，而是建立可信的最短闭环：导入一首歌后，用户能够找到它、理解它并稳定播放它。"
        ]},
        {title:"GP Core 1.0 — Harmonic Lake 的根基",items:[
          "1.x 正式引入 GP Core 1.0，定义播放器的核心职责与浏览器本地运行方式；Harmonic Lake 由此成为 Glass Player 的基础架构名称。",
          "GP Core 负责歌曲对象、播放状态、音乐库、metadata 与界面之间的基本数据流，使核心播放不依赖某一个具体页面。",
          "Core 的版本只在底层职责、运行模型或关键数据流发生架构级变化时提升，不与普通 UI 修复或单个功能版本机械同步。",
          "Gen 1 的局限也由此显现：播放器已经可用，但音效、队列、统计和推荐仍像彼此分离的功能，尚未形成沉浸而连续的听歌过程。"
        ]},
        {title:"Glass Player Gen 2 — Experience Generation",items:[
          "Transformed playback into an immersive experience.",
          "Web Audio Engine 将播放从单纯的媒体控制扩展为可塑的音频链路；EQ、频谱与 Crossfade 开始真正参与听感和过渡。",
          "双 Deck 与 Crossfade 让歌曲切换可以提前准备并平滑衔接，降低停止、切歌和状态竞争带来的割裂感。",
          "Queue 与 Mini Player 把“现在播放什么、接下来播放什么、离开主界面后如何继续控制”连接成同一条操作路径。",
          "Listening Statistics 将播放时长、次数和历史转化为可回看的个人记录；Recommendations 开始尝试根据本地行为组织下一批歌曲。",
          "睡眠定时、每日推荐与播放模式等能力逐步补齐，让播放器从工具转向可以长时间停留的音乐环境。"
        ]},
        {title:"GP Fusion Engine 1.0 — 多段体验的融合",items:[
          "2.x 引入 GP Fusion Engine 1.0；Fusion 的重点不是把功能堆在一起，而是让音频引擎、队列、过渡、统计和推荐共享一致状态。",
          "一次播放行为可以同时更新当前歌曲、队列位置、听歌记录和推荐信号；一次切歌也需要同时处理双 Deck、Crossfade 与界面反馈。",
          "手动队列逐渐成为用户意图的最高优先级，播放模式则在队列结束后恢复，奠定后来 queue-first 行为的基础。",
          "Gen 2 解决了体验割裂，但功能快速增长也暴露出新的问题：不同页面的选择控件、动效、阴影、响应式布局和状态反馈缺少统一标准。"
        ]},
        {title:"Glass Player Gen 3 — Design Generation",items:[
          "Established the complete Glass design language.",
          "Glass UI System 将毛玻璃、光晕、圆角、阴影、前后景层次和 Accent Color 从零散效果整理为统一的视觉体系。",
          "Animations & Micro-interactions 为选择滑块、拖拽队列、开关、按钮、唱片与 Disk Reader 建立连续反馈，让状态变化不再突然闪现。",
          "Dynamic Themes 让 Color Blob、Blurred Cover 与封面取色参与整个界面的氛围，同时处理 Accent Color 的可读性与控制权冲突。",
          "Responsive Layouts 使播放器在 Edge 全屏、普通窗口与缩小窗口中保持完整排版，减少边界挤压、尺寸跳动和依赖浏览器 90% 缩放的问题。",
          "Localization & Product Polish 补齐中英文、字体、字体粗细、更新日志、导出功能、设置版本卡片与大量长期存在的细节问题。"
        ]},
        {title:"GP Motion Engine 1.0 — 交互成为系统",items:[
          "3.x 引入 GP Motion Engine 1.0，把动画从装饰提升为状态表达：滑块告诉用户选择从哪里移动到哪里，拖拽告诉用户歌曲将落入哪个位置。",
          "统一的 stretch → slide → settle 动势应用到侧边栏、分段选择与更新日志，阴影和毛玻璃随移动产生适度反馈，并在终点恢复稳定。",
          "队列拖拽使用明确手柄、圆角浮起卡片、腾位动画与落位回弹；唱片暂停保留角度，Disk Reader 根据真实播放状态接触或移开。",
          "播放按钮与真实 audio 事件同步，避免快速操作后界面显示播放但音频已经停止；Motion 因而同时承担美感与状态可信度。",
          "Gen 3 的最终成果不是动画更多，而是所有可交互界面具有一致的节奏、重量、层次和因果关系。"
        ]},
        {title:"Three Generations, One Product — 三代引擎关系",items:[
          "Gen 1 / GP Core 1.0 提供稳定的本地音乐核心；Gen 2 / GP Fusion Engine 1.0 连接音频与用户旅程；Gen 3 / GP Motion Engine 1.0 统一可见与可感知的交互。",
          "GP Core 决定播放器如何工作，GP Fusion 决定多个能力如何协同，GP Motion 决定协同过程如何被用户看见和理解。",
          "三者共同运行于 Harmonic Lake：Core 是地基，Fusion 是连接层，Motion 是体验层；任何新世代都必须保留已经验证的可靠性。",
          "代际升级不代表删除上一代。Gen 4 的 GP Neural 会消费 Core 提供的歌曲、Fusion 提供的行为与 Motion 保护的体验边界。"
        ]},
        {title:"Handoff to Gen 4 — 交棒给 GP Neural",items:[
          "前三代已经解决“播放什么”和“怎样播放得更好”；Gen 4 开始解决“这些歌曲在声音上为什么相似，以及用户此刻可能想听什么”。",
          "MFCC、Energy 与 BPM 将为歌曲建立可比较的本地特征，用户行为则补充个人偏好，两者结合后才形成推荐依据。",
          "分析结果需要缓存到 IndexedDB，避免每次导入都重新解码整套音乐库；性能、内存和主线程响应将成为 Gen 4 的核心工程指标。",
          "音乐银河、时间机器和更一致的日推歌单属于 GP Neural 的未来表达层，但必须在特征正确、缓存可靠和性能可控之后逐步开放。",
          "Pre-Release Update 在这里结束回顾；4.0.0 Beta 从同一条产品脉络继续向前，同时承诺不以破坏 Gen 3 的成熟 UI 来换取底层升级。"
        ]}
      ]
    },
    {
      version:"3.5.3", date:"2026-07-14", kind:"patch",
      summary:"FINAL HOTFIX RELEASE：完成 3.x 最终交互打磨，统一滑块动势，稳定播放状态，并加入与唱片联动的 Disk Reader。",
      sections:[
        {title:"Added",items:["唱片右上方加入拟物与扁平风格结合的 Disk Reader；播放时接触唱片，暂停时平滑移开。"]},
        {title:"Changed",items:["所有横向和纵向毛玻璃滑块在移动中微微放大，接近终点时开始回落并恢复原尺寸。","设置中的 On/Off 开关改为纯水平连续滑动，移除点击时生硬的整体位移。"]},
        {title:"Fixed",items:["唱片暂停后保留当前旋转角度，恢复播放时从原位置继续。","以真实音频事件和操作序号同步播放状态，修复快速操作后音频已停但按钮仍显示播放的问题。","暂停时同步清理双 Deck Crossfade 状态，避免残留播放任务干扰下一次操作。"]}
      ]
    },
    {
      version:"3.5.2", date:"2026-07-14", kind:"patch",
      summary:"HOTFIX：以实际动画循环重做封面取色背景运动，并恢复左侧栏与更新日志一致的拉伸滑动反馈。",
      sections:[{title:"Fixed",items:["封面取色不再仅依赖难以察觉的 CSS 动画，改由持续动画循环驱动三个独立色块。","修复导航点击后无动画重新测量覆盖滑动过渡的问题。","左侧栏滑块重新加入移动时拉伸、到位后回弹的毛玻璃动画。"]}]
    },
    {
      version:"3.5.1", date:"2026-07-14", kind:"patch",
      summary:"HOTFIX：恢复封面取色背景运动和左侧滑块，修复字体变化后的滑块测量，并消除自适应封面配色与手动主题色之间的冲突。",
      sections:[{title:"Fixed",items:["封面取色的三个色块改为可明显辨认但仍缓慢的独立无规则移动。","左侧栏选中滑块改为侧边栏自身的稳定毛玻璃层，不再依赖动态插入元素。","字体粗细或大小变化后重新测量全部滑块，避免文字宽度变化造成错位。","开启封面自适应主题色时将手动 Accent Color 灰化并禁用；关闭后恢复操作。"]}]
    },
    {
      version:"3.5.0", date:"2026-07-14", kind:"minor",
      summary:"AESTHETIC UPDATE：强化连续调节、首屏毛玻璃选中态与动态环境背景，并加入完整更新日志导出。",
      sections:[
        {title:"Added",items:["更新日志版本列表加入毛玻璃滑块。","可将从 1.0.0 至今的完整更新日志导出为 UTF-8 TXT 文件。","Color Blob 与 Blurred Cover 背景加入多轨、无规则、慢速环境运动。"]},
        {title:"Changed",items:["字体粗细改为真正连续且更明显的视觉变化。","Crossfade 过渡时间改为 0.1 秒级连续调节。","Blurred Cover 以超出视窗的连续色场移动，避免边缘割裂。"]},
        {title:"Fixed",items:["首次打开页面无需点击即可显示当前选中的毛玻璃滑块。","播放历史中的播放次数随中英文界面同步切换。"]}
      ]
    },
    {
      version:"3.4.3", date:"2026-07-14", kind:"patch",
      summary:"修复滑块初始缺失与侧边栏错位，统一轻量阴影，并让字体粗细连续可见。",
      sections:[{title:"Fixed",items:["侧边栏滑块建立明确的左上定位基准。","所有毛玻璃滑块使用统一的轻量主题色阴影。","字体粗细改为 1 级步进、可变字体轴和细微合成描边。","页面首次加载及字体完成加载后主动初始化全部滑块。"]}]
    },
    {
      version:"3.4.2", date:"2026-07-14", kind:"patch",
      summary:"Mini Tweak：补回语言切换滑动效果，统一 EQ 与侧边栏的主题色毛玻璃选中样式。",
      sections:[{title:"Fixed",items:["修复中英文切换时滑块被提前重定位而没有动画。","EQ 预设选中项恢复主题色高亮。","左侧导航改为滑动毛玻璃选中块。"]}]
    },
    {
      version:"3.4.1", date:"2026-07-14", kind:"patch",
      summary:"重点修复分段选择器毛玻璃错位，并补齐英文模式的全部界面与更新日志。",
      sections:[{title:"Fixed",items:["滑块改用组件内部坐标，Edge 缩放和窗口自适应时不再偏移。","英文模式覆盖静态文字、小字说明、按钮属性、运行时提示和更新日志。"]}]
    },
    {
      version:"3.4.0", date:"2026-07-14", kind:"minor",
      summary:"LANG. & UI UPDATE：加入中英文界面、播放列表优先播放规则与高质感滑动选择器。",
      sections:[
        {title:"Added",items:["设置页新增中文与 English 切换，并保存语言偏好。","分段选择器新增带 38px 毛玻璃的伸展滑动指示块。"]},
        {title:"Changed",items:["手动播放列表始终优先于顺序、随机和单曲循环；播放完后恢复用户原播放模式。","点击下一首时，已在列表中的歌曲移动到最前面。"]},
        {title:"Fixed",items:["修复手动播放列表 hover 与拖拽时闪烁抽搐。","修复设置页版本卡片阴影缺失及黑白硬轮廓。"]}
      ]
    },
    {
      version:"3.3.3", date:"2026-07-14", kind:"patch",
      summary:"针对实际播放队列重新修复重复加入和拖拽圆角，并精简字体选择。",
      sections:[
        {title:"Added", items:["重新加入 New York 衬线字体，并为未安装字体提供差异明显的本地备用字体。"]},
        {title:"Changed", items:[
          "字体列表仅保留 Mi Sans、Cascadia Code、Trebuchet MS、Quicksand 与 New York。",
          "拖拽改用独立悬浮副本，不再直接放大滚动容器中的原歌曲行。"
        ]},
        {title:"Fixed", items:[
          "同一歌曲已在手动播放列表中时，下一首和加入播放列表操作都会被拦截并提示。",
          "修复拖拽歌曲显示为直角白色长条的问题。",
          "修复字体选项看起来相同或选择后没有明显变化的问题。"
        ]}
      ]
    },
    {
      version:"3.3.2", date:"2026-07-14", kind:"patch",
      summary:"修订重复导入检查、播放器卡片边框、完整默认队列和字体设置。",
      sections:[
        {title:"Added",items:["加入字体粗细调节，并保存用户选择。"]},
        {title:"Changed",items:["设置页软件信息卡片跟随浅色、深色模式与主题色。","默认歌单顺序取消数量上限，可滚动查看整个歌单。"]},
        {title:"Fixed",items:["加入导入阶段的歌曲身份与音频内容指纹检查。","播放器左右卡片改用稳定内描边，移除反复尺寸观测。"]}
      ]
    },
    {
      version:"3.3.1", date:"2026-07-14", kind:"patch",
      summary:"修复播放队列语义与歌单按钮误播放，并补充排序、反馈提示和带把手的平滑拖拽。",
      sections:[
        {title:"Added", items:[
          "歌单新增原始顺序、歌手名称 A–Z、歌曲名称 A–Z 三种查看方式。",
          "“下一首播放”和“从歌单移除”成功后显示毛玻璃弹出消息。",
          "设置页顶部新增版本卡片，点击 HOTFIX BUILD 可直接打开 3.3.1 更新日志。"
        ]},
        {title:"Changed", items:[
          "默认播放队列继续显示歌曲在原歌单中的位置；首次手动加入后切换为独立播放列表。",
          "队列拖拽入口移到歌曲长条最右侧的三横线把手，拖动时加入抬升、让位和落位动画。"
        ]},
        {title:"Fixed", items:[
          "修复点击加入播放列表时没有入队、反而将歌曲从头播放的问题。",
          "修复手动播放列表与默认歌单位置显示混合的问题。"
        ]}
      ]
    },
    {
      version:"3.3.0", date:"2026-07-14", kind:"minor",
      summary:"加入独立播放队列，让临时点播不再打乱歌单和原有播放模式。",
      sections:[
        {title:"Added", items:[
          "歌单中的每首歌曲新增“下一首播放”和“加入播放队列”操作。",
          "播放器右侧新增真实播放队列，可查看顺序、拖拽排序、点击立即播放、移除单曲或一键清空。",
          "歌曲自然结束、手动下一首和交叉淡入淡出都会优先读取播放队列。"
        ]},
        {title:"Changed", items:[
          "播放队列为空时，继续使用顺序、随机、单曲循环或每日推荐的原有规则。",
          "从歌单删除歌曲时同步清理队列中的对应项目，避免失效条目。"
        ]}
      ]
    },
    {
      version:"3.2.2", date:"2026-07-14", kind:"patch",
      summary:"统一各主界面与侧边栏的上下边框基线，并补齐更新日志版本标签的点击光晕。",
      sections:[
        {title:"Changed", items:[
          "主内容区上下外边距统一为 16px，与侧边栏玻璃边框精确对齐。",
          "提高窗口适配的内部设计高度，缩小普通 Edge 窗口时为播放器内容保留更稳定的纵向空间。"
        ]},
        {title:"Fixed", items:[
          "扩大唱片上方和睡眠定时按钮下方的安全留白，避免内容贴近播放器边框。",
          "为更新日志的全部版本选择标签及当前版本标签加入点击光晕。"
        ]}
      ]
    },
    {
      version:"3.2.1", date:"2026-07-14", kind:"patch",
      summary:"恢复扩散式点击光晕，并集中修复睡眠定时、EQ、字体选择和更新日志入口的视觉问题。",
      sections:[
        {title:"Changed", items:[
          "恢复第一版的外扩散 + 内发光点击反馈，取消边界白条。",
          "光晕改用 4 阶低帧动画与更小的模糊范围，保留观感并降低 Edge 合成负担。",
          "字体选择改为与睡眠定时器一致的自定义毛玻璃弹出菜单。"
        ]},
        {title:"Fixed", items:[
          "光晕动画结束后立即移除 glow-pulse 状态，修复点击过的按钮持续发光。",
          "增加睡眠定时按钮与播放卡片底边之间的安全距离。",
          "EQ 预设改为整齐的四列网格，并恢复每个 EQ 按钮的点击光晕。",
          "修复 Edge 原生字体选择框及下拉列表全白的问题。",
          "修复侧边栏更新日志按钮上方两个角为直角的问题。"
        ]}
      ]
    },
    {
      version:"3.2.0", date:"2026-07-14", kind:"minor",
      summary:"降低 Edge 的视觉特效负担，重做窗口自适应，并加入可按版本浏览的内置更新日志。",
      sections:[
        {title:"Added", items:[
          "侧边栏最底部新增“更新日志”，可以选择 Unreleased 或任意历史版本查看。",
          "新增统一 app shell 缩放器：窗口不足设计尺寸时整套桌面布局按比例缩小。"
        ]},
        {title:"Changed", items:[
          "点击光晕由多层模糊阴影改为短促的粗线框反馈，减少合成与重绘。",
          "降低环境光斑、封面虚化和玻璃面板的模糊半径；缩小窗口时暂停光斑漂移动画。",
          "全屏时自然填充可用空间，非全屏时保持完整双栏排版并自动适配窗口边界。"
        ]},
        {title:"Fixed", items:[
          "修复 Edge 非 F11 状态下界面被窗口边界裁切、需要手动缩放至 90% 的问题。",
          "修复左右栏在临界宽度换行造成的布局跳动。",
          "固定歌曲标题和艺人信息行高，长文本使用省略号，切歌不再改变播放卡片尺寸。",
          "修复首次打开、尚无本地偏好设置时 7 段 EQ 滑块没有生成的问题。"
        ]}
      ]
    },
    {
      version:"3.1.1", date:"2026-07-14", kind:"patch",
      summary:"恢复 16:9 固定布局，收紧 EQ 界面并补充更多实用预设。",
      sections:[
        {title:"Changed", items:["撤回额外安全滚动层与窗口断点实验，恢复锁死外层滚动。","通用与设备 EQ 合并为紧凑 chip 区，设备说明移动到悬停提示。"]},
        {title:"Added", items:["新增古典、电子、播客预设。"]},
        {title:"Fixed", items:["移除额外滚动容器引发的 backdrop-filter 色差接缝。"]}
      ]
    },
    {
      version:"3.1.0", date:"2026-07-13", kind:"minor",
      summary:"加入三款设备专属 EQ，并尝试处理中等窗口宽度的裁切。",
      sections:[
        {title:"Added", items:["新增 Bose QC35、Bose QC Earbuds 2024、Poly Sync 40 补偿曲线。","设备预设可继续手动微调并转为自定义状态。"]},
        {title:"Notes", items:["设备曲线基于常见声音特征，并非厂商官方测量数据。","本版窗口兜底改动在 3.1.1 撤回。"]}
      ]
    },
    {
      version:"3.0.1", date:"2026-07-10", kind:"patch",
      summary:"清理设置界面与原生滚动条的视觉干扰。",
      sections:[
        {title:"Changed", items:["隐藏各界面和字体选择区域突兀的白色滚动条，同时保留滚动能力。"]},
        {title:"Removed", items:["移除“清除听歌记录”和“恢复默认设置”按钮及其事件处理。"]}
      ]
    },
    {
      version:"3.0.0", date:"2026-07-10", kind:"major",
      summary:"重做进度交互、音效系统、设置页和全局视图尺寸管理。",
      sections:[
        {title:"Added", items:["新增真实 7 段 Web Audio EQ、基础预设、响度表和文件信息卡。","字体扩展到近 20 种并加入实时预览。","新增 ResizeObserver 驱动的活动视图尺寸检测。"]},
        {title:"Changed", items:["波形进度条改为 Apple 风格实心细条；可视化页替换为音效页。","每日推荐调整为 10 首，主题色改为更沉稳的方案。","封面取色加入 HSL 可读性约束，各主视图改为内部滚动。"]},
        {title:"Fixed", items:["修复 Edge 非全屏窗口变化时视图显示不完整。","修复系统主题切换后封面配色不刷新。"]}
      ]
    },
    {
      version:"2.2.0", date:"2026-07-09", kind:"minor",
      summary:"加入一套偏 iOS 的播放交互与快捷操作。",
      sections:[
        {title:"Added", items:["侧边栏 mini-player、全屏 Now Playing sheet 与 FLIP 封面过渡。","长按歌曲菜单、收藏、下一首播放插播与弹簧反馈。"]},
        {title:"Notes", items:["桌面鼠标模拟 iOS 手势的体验有限，后续重点转回桌面可用性。"]}
      ]
    },
    {
      version:"2.1.0", date:"2026-07-09", kind:"minor",
      summary:"针对动画、模糊与后台运行进行集中性能优化。",
      sections:[
        {title:"Performance", items:["修复离开播放页后可视化仍在后台运行的循环泄漏。","降低环境光斑、封面背景与玻璃面板的模糊半径。","窗口最小化或切到后台时暂停背景动画与可视化。"]}
      ]
    },
    {version:"2.0.6", date:"2026-07-09", kind:"patch", summary:"缩短每日推荐，降低列表高度与渲染压力。", sections:[{title:"Changed",items:["每日推荐由约 20 首缩短为 12 首。"]}]},
    {version:"2.0.5", date:"2026-07-09", kind:"patch", summary:"使用实测像素固定播放区域高度。", sections:[{title:"Fixed",items:["加载、resize 和重新进入播放页时由 JavaScript 重新测量可用高度。","进一步隔离左侧播放卡片与右侧推荐列表。"]}]},
    {version:"2.0.4", date:"2026-07-09", kind:"patch", summary:"移除导致浏览器高度计算失真的非标准缩放。", sections:[{title:"Fixed",items:["移除 zoom: 0.85，让固定高度和内部滚动在正常坐标系生效。"]}]},
    {version:"2.0.3", date:"2026-07-09", kind:"patch", summary:"修复 flex 子元素拒绝收缩的问题。", sections:[{title:"Fixed",items:["为播放卡片、右侧面板和面板内容补充 min-height: 0。"]}]},
    {version:"2.0.2", date:"2026-07-09", kind:"patch", summary:"修复随机播放总是命中最后一首的边界错误。", sections:[{title:"Fixed",items:["权重无效或出现 NaN 时改用均匀随机兜底，不再固定返回列表末尾。","为权重计算加入无效数值保护。"]}]},
    {version:"2.0.1", date:"2026-07-09", kind:"patch", summary:"限制推荐列表对整个播放页高度的影响。", sections:[{title:"Fixed",items:["播放行改为受控高度，推荐内容过长时仅在右侧面板内部滚动。"]}]},
    {
      version:"2.0.0", date:"2026-07-08", kind:"major",
      summary:"播放核心升级为双通道 Web Audio 架构，并加入本地推荐系统。",
      sections:[
        {title:"Added", items:["实时频谱、睡眠定时、交叉淡入淡出、自适应封面配色与波形拖拽。","本地每日推荐和基于跳过/听完、语言、genre 的加权随机。"]},
        {title:"Changed", items:["播放核心由单一 audio 元素升级为双通道 Web Audio 引擎。"]},
        {title:"Removed", items:["移除歌词界面、LRC 导入、解析、高亮与滚动逻辑。"]}
      ]
    },
    {
      version:"1.2.0", date:"2026-07-08", kind:"minor",
      summary:"重做听歌排行并完善播放器品牌图标。",
      sections:[
        {title:"Added", items:["前三名领奖台与封面，第 4-50 名横向排行。","按歌曲和日期记录实际听歌秒数，新增动态 favicon。"]},
        {title:"Changed", items:["排行榜改为按所选时间范围内的听歌时长排序。"]},
        {title:"Fixed", items:["加固设置标题可见性，并为单曲循环增加数字 1 角标。"]}
      ]
    },
    {version:"1.1.1", date:"2026-07-08", kind:"patch", summary:"完善本地音频元数据与早期交互细节。", sections:[{title:"Added",items:["自动读取 MP3/FLAC 标题、艺人、genre 与内嵌封面。"]},{title:"Changed",items:["缩小播放卡片，移除外部艺人/歌词搜索按钮。"]},{title:"Fixed",items:["修复光晕反馈未明显生效。"]}]},
    {
      version:"1.1.0", date:"2026-07-07", kind:"minor",
      summary:"从单页播放器扩展为带侧边栏的完整桌面音乐应用。",
      sections:[
        {title:"Added", items:["Windows 横屏布局和播放、歌单、听歌记录、设置四个独立视图。","封面静态/旋转模式、ripple 反馈和持久化听歌记录。"]},
        {title:"Changed", items:["顺序、随机、单曲循环与列表循环合并为一个多状态按钮。","音量控制改为长方形滑块。"]}
      ]
    },
    {
      version:"1.0.0", date:"2026-07-07", kind:"major",
      summary:"Glass Player 的首个可用版本。",
      sections:[
        {title:"Added", items:["播放/暂停、上一首/下一首、进度拖拽、音量、静音、随机和循环。","文件、文件夹和拖放导入，按歌名/艺人搜索。","深色/浅色/自动主题、主题色、字体和字体大小设置。","iOS 风格玻璃卡片、动态背景光斑和旋转唱片。"]},
        {title:"Known limitations", items:["刷新后必须重新导入音频文件。","不显示歌词。"]}
      ]
    }
  ];

  const RELEASE_EN={
    "Unreleased":"GP Gen 8–9+ roadmap: cached acoustic features continue to improve recommendations before the Electron, SQLite and EXE migration in Gen 9+.",
    "7.6.2":"REBRAND UPDATE debuts GP Bionic Engine 1.0, unifying track recognition, acoustic analysis, listening modeling and queue flow under a refreshed engine identity.",
    "7.6.1":"HOTFIX BUILD collapses the Sidebar only when the window becomes too narrow, then restores the saved Sidebar preference when the width recovers.",
    "7.6.0":"KINETIC GLASS keeps startup, artwork, motion, favorites, and PiP stable through rapid view and metadata changes.",
    "7.5.1":"HOTFIX BUILD completely redesigns the standalone Annual Report scroll, removes History range selector background, compacts font picker popup, and fixes centered player title and lossless badge geometry.",
    "7.5.0":"REPLAY ATLAS brings a chaptered Annual Report story scroll, complete CJK serif and monospace font fallback stacks, and centered player title and settings layout.",
    "7.4.3":"HOTFIX BUILD continues the consistency fixes for playlist playback, legacy listening totals, Annual Report layout, restored settings and background audio analysis.",
    "7.4.2":"HOTFIX BUILD fixes playlist starts, legacy listening totals, Annual Report layout and restored settings, and shares audio resources for analysis.",
    "7.4.1":"HOTFIX BUILD fixes Library empty states, Annual Report language, track endings and Settings consistency.",
    "7.4.0":"COLLECTION UPDATE adds user playlists with likes, a yearly report in Listening History, a lossless badge and font-switch feedback.",
    "7.3.2":"STABILITY UPDATE removes Music Galaxy, fixes end-of-track auto-pause and post-import switching, and moves audio analysis behind the import dialog.",
    "7.3.1":"GALAXY UPDATE adds Music Galaxy for exploring acoustic and tempo relationships, with Daily Mix reusing the same similarity model.",
    "7.3.0":"HOTFIX BUILD improves spatial clarity, recommendation variety, scroll intent, EQ control, ambient transitions and Library artwork.",
    "7.2.2":"HOTFIX BUILD keeps imports moving after minimize, reduces Daily Mix spinner jank, and continues 7.2.2 with a shared 1360px canvas, Russian UI, no Library filter, fixed font-picker rows, stronger distinct ambient modes and independent History scrolling.",
    "7.2.1":"HOTFIX BUILD unifies taskbar icon strokes, moves EQ, Loudness, Spatial Audio and Track Information into Settings > Audio, and splits Listening History into Top 10 plus ranks 11–50 with right-only scrolling.",
    "7.2.0":"VISIONAL UPDATE reshapes the Library, Listening History and Settings surfaces into bounded, compact layouts with GP Motion Engine 4.1.",
    "7.1.1":"STABILITY UPDATE repairs responsive layout, fuzzy search, imported-track playback, calendar history, keyboard transport and the hierarchical Changelog.",
    "7.1.0":"RESIZE UPDATE expands every primary surface and shared control while adding Apple and Microsoft system fonts and restoring Theme glider motion.",
    "7.0.2":"HOTFIX BUILD introduces GP Motion Engine 4.0 with click-only compact Sidebar recovery, smooth horizontal ranges, non-overshooting EQ and History curves, and a native 120 Hz motion contract.",
    "7.0.1":"HOTFIX BUILD corrects semantic Changelog consolidation, rebuilds Music Galaxy icon motion, lightens shared button glass and dismisses contextual popovers when the surrounding page scrolls.",
    "7.0.0":"GALAXY UPDATE begins Glass Player Gen 7 with the first Music Galaxy product entry, GP Fusion Engine 3.0, GP Motion Engine 3.4 and a lighter control-glass balance.",
    "6.7.1":"HOTFIX BUILD makes Recent Favorites genuinely recent, restores audible loudness leveling, and repairs Search, Manual Queue, Daily Mix and Queue motion.",
    "6.7.0":"LOGIC UPDATE introduces GP Core 4.1 and GP Fusion Engine 2.2 with a single Changelog entry, synchronized theme backgrounds, mode-aware Manual Queue, fuzzy search and refined compact controls.",
    "6.6.5":"SPECTRUM UPDATE introduces GP Spectrum Engine 2.2 with range-aware play counts and a 75% cumulative-play threshold.",
    "6.6.4":"HOTFIX BUILD removes redundant hidden-view rendering and gives pending input priority during import without changing UI, interaction, animation or data results.",
    "6.6.3":"HOTFIX BUILD restores unrestricted manual Queue scrolling and removes the duplicate first-play alignment that caused visible snapping.",
    "6.6.2":"HOTFIX BUILD removes the empty-state background grid, makes Queue positioning self-correcting and completes artwork decoding inside the import boundary.",
    "6.6.1":"HOTFIX BUILD completes true artwork crossfades and the import initialization boundary while repairing transport motion, Queue scrolling, playback-speed placement and four-band meter response.",
    "6.6.0":"SNOW LEOPARD 3.0 reschedules post-import work, rebuilds Queue positioning inside a fixed viewport and removes background flashes and transport stalls during track changes.",
    "6.5.7":"HOTFIX BUILD repairs legacy playback-rate migration, same-frame Accent synchronization, pixel-sampled title contrast, post-import input responsiveness and reliable smooth Queue positioning.",
    "6.5.6":"HOTFIX BUILD re-release unifies high-coverage adaptive popovers, promotes EQ Presets to the top-level portal, replaces the speed range with a segmented preset glider and stabilizes bass through measured full-response EQ headroom.",
    "6.5.5":"UI UPDATE introduces GP Fusion Engine 2.1 with a smooth curve Equalizer, adaptive listening-insight layout, twelve-week artist history and pixel-stable 4K ambient motion.",
    "6.5.4":"HOTFIX BUILD repairs Poly-sensitive output headroom, native-pixel 4K transitions, live meter motion and several interface-state regressions while correcting Loudness and listening-rhythm logic.",
    "6.5.3":"HOTFIX BUILD introduces GP Motion Engine 3.3, removing turntable state-change stalls and 4K ambient contour texture while improving import responsiveness, recommendation freshness and FLAC/Spatial stability.",
    "6.5.2":"HOTFIX BUILD restores a soft continuous ambient background with one static blur surface, removing the exposed giant circles and texture regression from 6.5.1.",
    "6.5.1":"MOTION UPDATE introduces GP Motion Engine 3.2 with a shared 120Hz visual ceiling and event-scoped compositing that releases idle GPU layers.",
    "6.5.0":"EXPERIENCE UPDATE adds unified enhancement headroom, restores reliable playback feedback and stabilizes adaptive text, scanning motion and high-resolution composition.",
    "6.4.4":"HOTFIX BUILD rebuilds import motion, aligns and animates library scanning, stabilizes Sound information popovers and completes Crossfade localization.",
    "6.4.3":"HOTFIX BUILD redraws Changelog and folder-import geometry, fully fills Accent swatches and gives the Founder’s Note a proper right-aligned signature.",
    "6.4.2":"HOTFIX BUILD improves frame pacing without changing the visible design, adds concise Loudness guidance, repairs icon geometry and completes import, recommendation and history interaction polish.",
    "6.4.1":"NEURAL BOOST introduces GP Spectrum Engine 2.1 and GP Neural Engine 2.1 with an offline genre relationship graph, fixed cached loudness balance and a stricter recommendation confidence gate.",
    "6.4.0":"PEREGRINE UPDATE introduces Peregrine Lake and GP Core 4.0, moving the verified source into formal Core, Adapter, Engine, Service, UI, Data and Bootstrap layers with permanent governance and browser Ports.",
    "6.3.2":"HARMONIC ENHANCE introduces GP Core 3.2, migrating low-risk language, changelog, fixed Spatial preset, pure PiP rendering and utility boundaries into explicit GP module APIs without changing runtime behavior.",
    "6.3.1":"HARMONIC ENHANCE introduces GP Core 3.1, slicing the maintainable source into ordered fragments and rebuilding the exact first-stage app.js bytes through one deterministic single-file build chain.",
    "6.3.0":"HARMONIC UPDATE introduces GP Core 3.0, physically separating the single-file player into index.html, app.css and app.js without changing playback behavior, data contracts, cascade order or script timing.",
    "6.2.2":"HOTFIX BUILD introduces GP Spatial Engine 1.1: fixed presets, true dry bypass and a 400 ms equal-power A/B bus transition remove dynamic width, image drift, tonal jumps and gain breathing.",
    "6.2.1":"HOTFIX BUILD connects the Spatial Audio information popover to the same adaptive glass material used by Snooze, Library Sort and Font selection.",
    "6.2.0":"AUDIO UPDATE introduces GP Spatial Engine 1.0 with seven reusable, phase-protected sound fields, a reorganized Sound interface and a properly softened yet sharper-foreground traditional PiP.",
    "6.1.0":"SNOW LEOPARD 2.0 removes superseded and unreachable legacy runtime code while preserving every visual, feature, local listening record and learned user-model value.",
    "6.0.4":"HOTFIX BUILD fixes PiP resize feedback, separates cached static rendering from 60fps foreground motion and adds a complete long-title marquee.",
    "6.0.3":"HOTFIX BUILD fixes paused PiP frame synchronization, adds a compact clarity-first layout and scales rendering load from the real floating-window size.",
    "6.0.2":"HOTFIX BUILD adds live PiP settings synchronization, clearly separated background modes and adaptive output up to 3840 × 2160.",
    "6.0.1":"HOTFIX BUILD replaces address-bearing Document PiP with borderless traditional video PiP and rebuilds the floating visual as a sharp 1280 × 720 canvas.",
    "6.0.0":"ACCESSIBILITY UPDATE introduces a native always-on-top Document PiP player with responsive artwork, synchronized controls, adaptive Glass styling and a size-aware Up Next queue.",
    "5.9.0":"HOTFIX BUILD removes repeated full-library history matching, keeps every preference view reliably refreshed and unifies five listening periods.",
    "5.8.6":"HOTFIX BUILD rebalances Player spacing and artwork size, separates Playback Mode from the centered transport axis and makes the active Accent range thumb genuinely see-through.",
    "5.8.5":"HOTFIX BUILD corrects Player vertical geometry, transport-row alignment and the default-versus-dragged range-thumb state.",
    "5.8.4":"HOTFIX BUILD introduces a pixel-exact four-band meter, persistent translucent range glass and a larger responsive cover above a bottom-anchored interaction stack.",
    "5.8.3":"HOTFIX BUILD removes overlapping Player-sector shadows, restores genuinely translucent active range thumbs and replaces title scrolling with a deterministic measured motion cycle.",
    "5.8.2":"HOTFIX BUILD repairs responsive player geometry, Queue stability, selector alignment, title marquee continuity, glass-material separation and zoom-level text raster quality.",
    "5.8.1":"HOTFIX BUILD recalibrates transition timing, EQ selection, playback motion, marquee behavior, popover glass and turntable/needle synchronization.",
    "5.8.0":"FINAL PANTHER REFORM introduces GP Motion Engine 3.1, completing Queue reliability, overlapping view transitions, physical turntable slowdown, marquee titles and drag-capable settings controls.",
    "5.7.0":"FOUNDATION UPDATE introduces GP Core 2.2 and GP Motion Engine 3.0: a declarative UI registry lets future views compose SSE, gliders, popovers, press feedback and stable motion through shared class contracts.",
    "5.6.3":"HOTFIX BUILD removes the final geometric page-settle jump and rebuilds Daily Mix as an automatically generated Spectrum ID, Genre, MFCC, BPM and Energy feature cluster.",
    "5.6.2":"HOTFIX BUILD makes every Accent theme-safe, schedules Auto theme for 05:00–18:00 Light and 18:00–05:00 Dark, stabilizes page entry and adds live four-band progress activity plus list micro-interactions.",
    "5.6.1":"HOTFIX BUILD repairs adaptive-accent contrast after theme round trips and stabilizes the turntable rotation and acrylic composition path without changing its visual design.",
    "5.6.0":"PANTHER UPDATE introduces GP Motion Engine 2.4 and GP Fusion Engine 1.1, unifying adaptive Glass contrast, reversible Shuffle history, stable Queue drag-and-drop and concurrent notifications.",
    "5.5.9":"HOTFIX BUILD improves light-mode surface contrast and adaptive accent readability, refines Snooze and Skip motion, introduces held button feedback and repairs Queue state cleanup.",
    "5.5.8":"HOTFIX BUILD adds semantic Snooze and Skip micro-interactions and moves Snooze glass into a reusable Motion Engine popover material shared by Library Sort.",
    "5.5.7":"HOTFIX BUILD introduces GP Motion Engine 2.3, a reusable anti-twitch sector lifecycle for Changelog, Listening History and the Sleep Timer.",
    "5.5.6":"STABALIZATION RELEASE introduces GP Motion Engine 2.2, a bottom-level primary-view lifecycle that fades complete panels and sectors without disturbing SSE, glass or internal controls.",
    "5.5.5":"HOTFIX BUILD removes Edge's native black focus ring, releases the Play haze from rectangular SVG clipping and gently strengthens Sleep Timer glass blur.",
    "5.5.4":"HOTFIX BUILD removes false trailing slashes from ID3 metadata, makes Rescan repair cached display information and recalibrates Play, Library, Listening History and hover timing.",
    "5.5.3":"HOTFIX BUILD standardizes sidebar motion at 500 ms, rebuilds the Play haze pulse with a symmetric return path, stabilizes SVG strokes and improves Listening History, the Settings build card and right-panel transitions.",
    "5.5.2":"HOTFIX BUILD rebuilds the GP Motion Engine 2.1 trigger path, restores the Play pulse at three times its source area, removes the Listening Data y-axis end flash and applies final per-icon timing.",
    "5.5.1":"HOTFIX BUILD restores the classic three-bar product icon, standardizes all five sidebar micro-interactions at 800 ms, corrects the Play pulse to exactly twice the triangle area and synchronizes graph tracing with axis growth.",
    "5.5.0":"UI UPDATE introduces GP Motion Engine 2.1, a new accent-aware Glass Player note identity, five semantic sidebar icon micro-interactions and additional Queue clearance for Now Playing.",
    "5.4.1":"HOTFIX BUILD keeps Now Playing one full visible row below Queue's top SSE and revises the roadmap around Gen 6 Time Machine, Gen 7 Music Galaxy, Gen 8 galaxy-aware recommendations and Gen 9+ Electron Lake.",
    "5.4.0":"HARMONIC REFORM introduces GP Core 2.1 and GP Motion Engine 2.0. Scroll surfaces are rebuilt as stationary panel shells plus transparent moving viewports, allowing complete sectors to dissolve into the real panel background without blur overlays.",
    "5.3.9":"HOTFIX BUILD rebuilds SSE around Apple's iOS 26 Scroll Edge Effect principles, combining content-opacity dissolution with a narrow live variable blur instead of colored overlays or glow.",
    "5.3.8":"HOTFIX BUILD applies SSE uniformly at real scroll-viewport boundaries, restores correct top/bottom activation and exact geometry, samples the surface immediately outside each boundary and repairs continuous function-key control.",
    "5.3.7":"HOTFIX BUILD removes the artificial SSE color veil, samples and desaturates the live boundary backdrop, keeps both soft edges active at scroll endpoints and makes F9/F10/F11 reusable.",
    "5.3.6":"HOTFIX BUILD compresses and strengthens SSE in Queue, Sound and Listening Data, centers the Disk Reader pivot, improves scaled text rendering, realigns the Changelog selector and adds F9/F10/F11 playback controls.",
    "5.3.5":"HOTFIX BUILD fixes Acrylic Edge Frame position, size and radius mismatches under responsive scaling and replaces the abrupt blur boundary with a longer low-contrast acrylic transition.",
    "5.3.4":"HOTFIX BUILD fixes the sidebar selector restarting from the top and rebuilds Soft Scroll Edge as an Acrylic Edge Frame aligned to each real scrolling viewport.",
    "5.3.3":"HOTFIX BUILD moves selector motion onto compositor-only transforms, makes import progress proportional across identity, data and commit stages, and anchors Soft Scroll Edge directly to each sector boundary.",
    "5.3.2":"HOTFIX BUILD introduces GP Motion Engine 1.3 with fully static ambient backgrounds, a lower-cost 4K composition path, blocking staged import progress and no-op handling for already selected segmented controls.",
    "5.3.1":"HOTFIX BUILD removes Changelog glider overshoot, updates the Settings identity to Glass Player Gen 5 / Ver. 3.1, centers the Repeat One badge and adds a wall-proximity Monitor Speakers EQ.",
    "5.3.0":"NEURAL INTERLINK UPDATE introduces GP Neural Engine 2.0 — Resonance Boost: persistent behavior capture, decayed long-term and session preference models, confidence-gated recommendations, diversity and freshness scoring, plus a true uniform-random fallback before the model is mature.",
    "5.2.0":"MOTION UPDATE introduces GP Motion Engine 1.2, balances horizontal and vertical glass-glider motion, softens navigation glow, restores Spectrum-linked renamed-history synchronization and keeps one before/after metadata identity snapshot per rescan.",
    "5.1.2":"HOTFIX BUILD fully restores the 5.1.0 listening-time, period-statistics and history behavior, withdraws every 5.1.1 history experiment, and retains only the approved glass record spindle.",
    "5.1.1":"SPECTRUM ID PATCH (withdrawn) attempted listening-history and renamed-track recovery changes that were fully rolled back in 5.1.2 after a period-total regression.",
    "5.1.0":"HOTFIX BUILD rebuilds Soft Scroll Edge as an adaptive, full-width background transition, repairs identity-safe history migration, and refines Recent Favorites, ten-day charts and evidence-based listening insights.",
    "5.0.0":"NEURAL UPDATE introduces GP Neural Engine 1.0 — Resonance Boost, local listening insights, identity-safe history, intelligent queue positioning and iOS 26-inspired soft scroll edges.",
    "4.4.2":"HOTFIX BUILD adds a controlled full-library metadata rescan that refreshes stale file data under the same Spectrum ID while preserving every acoustic feature and listening-history record.",
    "4.4.1":"SPECTRUM ID UPDATE formalizes GP Spectrum ID 1.0 with conservative evidence thresholds, stable personalization links and a permanently available, independently persisted Custom EQ curve.",
    "4.4.0":"RECOG UPDATE introduces GP Recognition Engine 1.0, a metadata-independent audio-essence identity with three permanent stream anchors, FLAC PCM MD5 verification and lossless migration of every existing cached feature.",
    "4.3.1":"HOTFIX BUILD removes the collapsing default-Pop classifier, adds multi-feature multi-genre scoring and replaces misleading Dark · Soft summaries with structural timbre and motion labels.",
    "4.3.0":"SPECTRUM UPDATE advances GP Spectrum Engine to 2.0 with persistent local MFCC timbre analysis, compact sound profiles, mood inference and automatic Genre completion.",
    "4.2.1":"HOTFIX BUILD unifies every visible and analyzed song property into a read-once IndexedDB snapshot, removes the legacy duplicate decoder and restores strong cover-accent readability.",
    "4.2.0":"SPECTRUM UPDATE introduces GP Spectrum Engine 1.0 with automatic Energy and BPM detection, persistent feature caching and a stronger minimum accent-to-background contrast.",
    "4.1.2":"HOTFIX BUILD replaces forced saturation with a dynamic OKLab harmony algorithm derived from the cover palette and the actual rendered background color.",
    "4.1.1":"HOTFIX BUILD formalizes the Snow Leopard architecture as GP Core 2.0 and updates the interaction compatibility layer to GP Motion Engine 1.1.",
    "4.1.0":"SNOW LEOPARD UPDATE replaces repeated full-library initialization with an append-only IndexedDB track cache, bounded import workers, one render commit per batch, persistent cover thumbnails and on-demand audio analysis.",
    "4.0.0":"GP Neural establishes zero-visual-change Core, Analyzer, UI and Storage boundaries plus a lazy IndexedDB contract for future metadata, MFCC, Energy, BPM, behavior, user-model and recommendation data.",
    "GP Gen 4 Pre-Release Update":"Formalized the product generations: Gen 1 Foundation with GP Core 1.0, Gen 2 Experience with GP Fusion Engine 1.0, and Gen 3 Design with GP Motion Engine 1.0.",
    "3.5.3":"FINAL HOTFIX RELEASE polished iOS-inspired glider motion, preserved the record angle on pause, synchronized playback state against real audio events, added an animated Disk Reader and rebuilt settings toggles as smooth horizontal controls.",
    "3.5.2":"HOTFIX rebuilt Cover Color motion with a live animation loop and restored the sidebar indicator's stretch, slide and settle feedback.",
    "3.5.1":"HOTFIX restored visible Cover Color motion and the sidebar glass indicator, realigned indicators after typography changes, and disabled manual accent selection while cover matching is active.",
    "3.5.0":"AESTHETIC UPDATE added continuous typography and crossfade controls, reliable first-frame glass indicators, animated ambient backgrounds, a glass changelog selector and complete TXT export.",
    "3.4.3":"Fixed initial and sidebar indicator positioning, unified lighter glass shadows and made font-weight changes continuously visible.",
    "3.4.2":"Restored the language-switch animation, highlighted the selected EQ preset and added a sliding glass indicator to sidebar navigation.",
    "3.4.1":"Fixed misaligned glass selection indicators and completed English coverage across UI labels, helper text, runtime messages and changelog content.",
    "3.4.0":"Added Chinese and English interface modes, queue-first playback, mode restoration and animated glass selection indicators.",
    "3.3.3":"Prevented duplicate manual-queue entries, rebuilt drag visuals as a rounded floating card and simplified the font list.",
    "3.3.2":"Revised duplicate import checks, stable player borders, full queue rendering and typography controls.",
    "3.3.1":"Added library sorting, queue feedback, manual-queue semantics and handle-based reordering.",
    "3.3.0":"Introduced the independent playback queue with reordering, immediate playback and queue-aware navigation.",
    "3.2.2":"Aligned main-view and sidebar borders and restored glow feedback on changelog version tags.",
    "3.2.1":"Restored the original glow system and fixed spacing, EQ layout, font picker styling and rounded corners.",
    "3.2.0":"Improved responsive window fitting and added the built-in versioned changelog sidebar.",
    "3.1.1":"Polished responsive layout, borders and control spacing for normal Edge windows.",
    "3.1.0":"Expanded audio controls, preferences and visual presentation.",
    "3.0.1":"Fixed layout and interaction regressions introduced by the 3.0 redesign.",
    "3.0.0":"Upgraded progress interaction, real EQ, settings and global view sizing.",
    "2.2.0":"Added iOS-inspired playback interactions, mini player and full-screen now-playing presentation.",
    "2.1.0":"Improved local recommendations, listening behavior weights and playback transitions.",
    "2.0.6":"Reduced Daily Mix length to lower list height and rendering cost.",
    "2.0.5":"Stabilized player height using measured available pixels.",
    "2.0.4":"Removed non-standard page zoom that distorted browser height calculations.",
    "2.0.3":"Fixed flex children refusing to shrink by applying correct minimum heights.",
    "2.0.2":"Fixed weighted shuffle repeatedly selecting the final track.",
    "2.0.1":"Contained long recommendation lists inside the right panel.",
    "2.0.0":"Moved playback to a dual-deck Web Audio engine and added local recommendations, spectrum, sleep timer and crossfade.",
    "1.2.0":"Rebuilt listening rankings with a podium, cover art, date ranges and accurate listening-time totals.",
    "1.1.1":"Improved local audio metadata, embedded artwork and early interaction details.",
    "1.1.0":"Expanded the single-page player into a desktop app with sidebar views and persistent listening history.",
    "1.0.0":"Initial usable release with playback, imports, search, themes, typography and glass visuals."
  };

  const RELEASE_EN_DETAIL={
    "Unreleased":{
      summary:"GP Gen 8–9+ continues galaxy-aware recommendation work before Electron Lake, SQLite and EXE delivery in Gen 9+.",
      sections:[
        {title:"Gen 8 — Galaxy-Aware Recommendation",items:["Cached MFCC + BPM distance from Music Galaxy substantially improves Shuffle and Daily Mix so each generated list remains coherent in style, timbre and tempo.","Freshness, diversity and randomness remain independent constraints, preventing one artist or one small cluster from dominating every result.","MFCC, BPM, 2D coordinates and cluster results remain cached in IndexedDB and are not recomputed when the audio file has not changed."]},
        {title:"Gen 9+ — Electron Lake",items:["Electron Lake, SQLite and migration from single-file HTML to desktop EXE move from the former Gen 5+ roadmap to Gen 9 and later.","The Core / UI / Storage boundary remains: storage/sqlite.js can replace storage/indexeddb.js without rewriting the player UI, Neural model or upper product logic."]}
      ]
    },
    "7.1.0":{
      summary:"RESIZE UPDATE expands every primary surface and shared control while adding Apple and Microsoft system fonts and restoring Theme glider motion.",
      sections:[
        {title:"Full-width Responsive Surfaces",items:["Library, Listening History, Music Galaxy, Settings and Changelog no longer inherit the old 980 / 1120 px page caps; each now fills the available main area like Player.","Responsive safety spacing, rounded geometry, SSE, Edge 110% scaling and compact-window behavior remain intact rather than forcing sectors against the window edge."]},
        {title:"Unified Control Scale",items:["Navigation, segmented selectors, import and sort actions, transport controls, switches, list actions, Settings controls and Changelog controls are moderately larger with matching real hit targets.","Control growth uses real layout geometry instead of visual scaling, preserving pointer accuracy, icon centering and native 120 Hz motion."]},
        {title:"Fonts and Motion",items:["The font selector now includes Apple System Font and Microsoft System Font, preferring SF Pro Display / SF Pro Text and Segoe UI Variable / Segoe UI with safe platform fallbacks.","Light, Dark and Auto now retain the old selector position through theme refresh so the shared glider visibly travels to the new option instead of appearing instantly. GP Motion Engine remains at 4.0."]}
      ]
    },
    "7.0.2":{
      summary:"HOTFIX BUILD introduces GP Motion Engine 4.0 with click-only compact Sidebar recovery, smooth horizontal ranges, non-overshooting EQ and History curves, and a native 120 Hz motion contract.",
      sections:[
        {title:"GP Motion Engine 4.0",items:["The Chinese Library navigation label becomes 歌曲库 while English remains Library.","A new control beside the Glass Player wordmark moves the Sidebar's right edge inward, leaving only the complete GP badge and opaque navigation icons. The shape control disappears in compact mode, and the GP badge itself restores the full Sidebar when clicked.","The compact rail inherits the shared adaptive popover glass. Its selected glass block and Sidebar geometry follow the same 520 ms timeline to eliminate desynchronization and end-frame twitch.","Collapsing locks the current pointer cycle: overlay preview cannot open until the pointer has first left the compact rail and deliberately entered it again. The preview then overlays the widened content without pushing it back.","During first import, large Resonance Boost behavior histories are processed in bounded batches that yield paint frames. The scan glyph is promoted to its own composited layer, so it no longer appears frozen while the complete model still finishes before import is released."]},
        {title:"Unified Horizontal Ranges",items:["Playback progress, Volume, Crossfade, Font Size and Font Weight now share one Range contract: a solid rounded track, an Accent completed segment and a restrained remaining segment.","Drag input follows the pointer directly without interpolation or repeated animation restarts. A simple click uses a short 100 ms linear transition, continues after the pointer is released, and lands exactly on the requested stepped value. Volume preferences write only on commit rather than on every drag event.","The resting track and pointer hit region are slightly slimmer. Hover thickness uses a fast composited scale transition instead of repainting the native track height."]},
        {title:"Click-only Sidebar and Curve Motion",items:["The compact Sidebar no longer expands when the pointer crosses the rail. It remains compact until the GP badge is clicked. Holding the pointer over that badge for 550 ms fades it into an expansion hint; a click before the threshold expands immediately without playing the hint first.","Collapsed and expanded navigation share fixed icon coordinates. During collapse, the Glass Player wordmark and every navigation label remain intact until the moving right border approaches the widest live label, then fade out together. The contact point is measured from the current font, language and scale instead of using a fixed delay.","When the visible hint is clicked, the hint travels smoothly back to the normal control position while the real shape control takes over through a short crossfade instead of a one-frame replacement.","Equalizer and Listening Data share a restrained monotone cubic curve. It follows the control points without the reverse bends or overshoot produced by the former smoothing formula."]},
        {title:"120 Hz Motion Contract",items:["All visual animation is scheduled by CSS motion, Web Animations or requestAnimationFrame and follows the display refresh cadence up to 120 Hz.","Motion timing uses elapsed time instead of frame counts, preserving the same path and duration across 60, 90 and 120 Hz displays. Fixed 60 Hz visual timers are prohibited by the governance contract and checked automatically."]},
        {title:"Daily Mix and Metadata",items:["Playing an individual Daily Mix track now clears its pressed and selected overlay after playback commits instead of leaving the row covered.","Repeated values in multi-value ID3/Vorbis Artist tags are deduplicated through normalized exact comparison. Sabrina Carpenter / Sabrina Carpenter becomes Sabrina Carpenter while legitimate names such as AC/DC remain intact."]}
      ]
    },
    "7.0.1":{
      summary:"HOTFIX BUILD corrects semantic Changelog consolidation, rebuilds Music Galaxy icon motion, lightens shared button glass and dismisses contextual popovers when the surrounding page scrolls.",
      sections:[
        {title:"Semantic Release History",items:["Repeated patches inside one minor line now collapse into one valid x.x.x release rather than a displayed version range.","Later independent patches move forward to the next available display number. Original RELEASES data remains intact; only the Changelog index and exported history use the compact sequence.","Repeated Queue, SSE, icon-motion, Player-layout, Language, Accent, Recognition and PiP maintenance across 3.x–5.x is now selectively consolidated alongside 6.x.","GP Gen 4 Pre-Release Update is removed, 4.0.0 Beta becomes 4.0.0, 3.3.2 RE becomes 3.3.2, and 3.3.2 again appears before 3.3.1 in descending history."]},
        {title:"Music Galaxy Icon",items:["The icon becomes a three-ring elliptical galaxy fixed at a 29-degree tilt, removing dense rings, the solid core and additional glow while retaining three clear stars and matching the visual area of other Sidebar glyphs.","Its motion is now a stronger scale-only expansion: all three ellipses retain their fixed angle, the stars scale with the galaxy, and every element returns along the identical path."]},
        {title:"Lighter Glass Material",items:["Shared segmented controls, primary tabs, Snooze, Picture-in-Picture, Clear and Font controls become slightly clearer again while selected hierarchy and text contrast remain intact.","Base Glass panels, strong-glass selectors, contextual popovers, hover tooltips, selection windows, dialogs and data surfaces become more transparent. Shared popover blur drops from 18px to 10px so background colour and detail pass through more naturally."]},
        {title:"Popover Scroll Dismiss",items:["The shared manager listens for page-level scrolling. Any scroll outside the active popover closes it through the standard exit motion.","Scrolling inside a popover remains available and does not dismiss it. Font, EQ, Snooze, Sort, Playback Speed and information popovers inherit the same rule."]}
      ]
    },
    "7.0.0":{
      summary:"GALAXY UPDATE begins Glass Player Gen 7. Music Galaxy enters the product for the first time, establishing a home for the future explorable music sky while GP Fusion Engine 3.0 and GP Motion Engine 3.4 advance the shared experience foundation.",
      sections:[
        {title:"Music Galaxy — First Light",items:["Music Galaxy joins the primary sidebar immediately above Settings. It reuses the single navigation state, primary-view transition and Accent selection glider without creating another router or runtime.","The Galaxy currently appears as a deliberately clean preview: no Sector, card or simulated feature is shown—only “Coming Soon” centered over the live Glass Player background.","The entry reserves a real product home for future glowing song stars, MFCC and BPM distance, and style galaxies. This release starts no Canvas/WebGL rendering and no additional analysis workload."]},
        {title:"GP Fusion Engine 3.0",items:["Navigation, themes, language, ambient background and the page lifecycle can now accept a new-generation experience surface while continuing to share the existing Peregrine Lake state and services.","The Music Galaxy preview does not touch playback, Queue, EQ, Spatial, Spectrum, Neural, listening history or IndexedDB data. Entering and leaving it never interrupts music."]},
        {title:"GP Motion Engine 3.4",items:["The Music Galaxy navigation icon receives a semantic micro-interaction: its orbit turns gently, the core breathes and its stars pulse in sequence, following the existing 300 ms Hover delay, click replay and Reduce Motion rules.","The new page inherits the established Primary View exit, background interval and entry lifecycle, so the full Galaxy can arrive later without inventing another transition system."]},
        {title:"Lighter Control Glass",items:["Segmented selectors, main panel tabs, Snooze, Picture-in-Picture, Clear, Font selection and common contextual controls receive only a slight transparency adjustment, reducing heavy fog while preserving visible hierarchy.","The Changelog back button moves from 18 px to 15 px blur with a small transparency increase. Popovers, SSE, primary panels, content cards and ambient rendering remain unchanged."]}
      ]
    },
    "6.7.1":{
      summary:"HOTFIX BUILD makes Recent Favorites genuinely recent, restores audible loudness leveling, and repairs Search, Manual Queue, Daily Mix and Queue motion.",
      sections:[
        {title:"Intelligent Recent Affinity",items:["Recent Favorites chooses the shortest evidence-rich window among 7, 14, 21, 30 and 45 days, expanding only when recent listening is sparse.","Song, artist, album and Genre ranking now combines time-decayed listening, recent qualified plays and short-term momentum, so old lifetime totals cannot dominate a new preference."]},
        {title:"Loudness Leveling",items:["The incorrect peak-headroom estimate that collapsed most boosts to 0 dB is removed. Quiet tracks now receive a smooth Deck-level gain relative to the loudest analyzed track in the library.","Boost remains capped at 7 dB and does not rewrite files, alter displayed source loudness, or change EQ, Spatial and master-volume settings."]},
        {title:"Queue and Daily Mix",items:["Changing a Manual Queue between Sequential and Repeat One no longer rebuilds its Sector. Shuffle only fades number and drag controls in place, and restores them in place when leaving Shuffle.","Daily Mix Play writes the complete recommendation set into the shared Manual Queue, follows all Manual Queue modes and controls, and confirms the action through a notification.","Every Queue alignment now uses the browser's native smooth scrolling. Short travel no longer uses a separate animation and therefore matches long-distance movement exactly."]},
        {title:"Search Control",items:["Edge's native blue search cancel control is suppressed and replaced by the same rounded Glass Player close glyph used elsewhere."]}
      ]
    },
    "6.7.0":{
      summary:"LOGIC UPDATE introduces GP Core 4.1 and GP Fusion Engine 2.2, consolidating navigation and strengthening playback, search, theme and motion logic.",
      sections:[
        {title:"GP Core 4.1 — Single Changelog Entry",items:["The Changelog sidebar button and its selection mask are removed. The version card at the top of Settings is now the only entry and retains the established full-view transition.","A rounded Glass back button beside the Changelog title returns through the same foundation transition without creating a second navigation state."]},
        {title:"Theme and Background Synchronization",items:["Light, Dark and Auto recompose the current ambient raster and crossfade it through the two existing Canvas surfaces. Blurred Cover no longer retains the previous theme tone.","The Theme glider is measured after state and layout commit across two frames, restoring its motion reliably."]},
        {title:"GP Fusion Engine 2.2 — Mode-aware Manual Queue",items:["Manual Queue now follows Sequential, Shuffle and Repeat One. Shuffle draws randomly from remaining queued tracks, while Repeat One keeps the current track instead of forcing queue advancement.","Shuffle hides queue numbers and drag handles. Returning to another mode restores them through the shared Queue content crossfade.","When playback is stopped and a Manual Queue exists, the main Play control reliably starts its next valid target, including newly dropped and imported files.","Daily Mix Play now writes the current recommendation set into the same Manual Queue, then lets Sequential, Shuffle or Repeat One own every following transition instead of maintaining a separate recommendation playback path."]},
        {title:"Fuzzy Search",items:["Track, artist and album matching adds Unicode normalization, compact subsequence matching and bounded edit distance after the exact substring path.","Matching remains entirely local and adds no network service or persistent search index."]},
        {title:"Compact Speed and Queue Motion",items:["Playback Speed becomes a shorter five-stop Glass selector. Its popup contains only tactile stops while the player button below remains the value readout.","The popup is promoted to a body-level portal and fixed directly above its icon, preventing clipping at unusual zoom or aspect ratios.","Short Queue corrections use a dedicated cubic ease-in/ease-out path. Longer travel retains native Smooth Scroll."]},
        {title:"Crossfade and EQ Scaling",items:["Crossfade is constrained to 0.5–3.0 seconds. Older persisted values above the new ceiling are safely normalized to 3.0 seconds.","The EQ curve uses an aspect-preserving SVG coordinate system and inverse pointer mapping into its fixed ViewBox, keeping grid proportions, drag targeting and circular control points stable at browser zoom."]}
      ]
    },
    "6.6.5":{
      summary:"SPECTRUM UPDATE introduces GP Spectrum Engine 2.2 with range-aware play counts and a 75% cumulative-play threshold.",
      sections:[
        {title:"GP Spectrum Engine 2.2",items:["Qualified playback and daily play counts now share one history contract: reaching 75% confirms a play and records it against that date.","Listening time and play counts use the same range aggregation foundation instead of mixing the selected period with lifetime totals."]},
        {title:"Range-aware Play Counts",items:["Today shows only plays completed today. Week, Month and Year aggregate their matching date windows, while All preserves the complete lifetime count.","Daily play counts are persisted beside daily listening time, so time and count always use the same selected range.","Legacy records without daily counts are restored from their lifetime count and real per-day listening duration. If both the old count and duration are missing but real listening time exists, at least one play is restored instead of displaying every historical track as zero."]},
        {title:"75% Qualified-play Rule",items:["A track counts once after the media time actually played during that lifecycle accumulates to 75% of its duration. Seeking may skip sections, but unplayed sections are not credited merely because the playhead moved forward.","Each playback lifecycle can count only once. Manual transitions, automatic Crossfade and natural ending share the same duplicate guard."]},
        {title:"Roadmap Cleanup",items:["Music Time Machine / Timeline is removed from Unreleased. Music Galaxy, Galaxy-Aware Recommendation and the Gen 9+ Electron Lake plan remain.","Existing listening time, lifetime counts, identity links and IndexedDB user data remain intact."]}
      ]
    },
    "6.6.4":{
      summary:"HOTFIX BUILD makes scheduling input-aware and limits rendering work to visible surfaces while preserving every product behavior.",
      sections:[
        {title:"Input-priority Scheduling",items:["Import still completes the same Spectrum ID, metadata, artwork, MFCC, Energy, BPM, history synchronization, Resonance Boost and Daily Mix pipeline, but yields pending pointer and keyboard input between batches.","Concurrency remains available; it is no longer increased indiscriminately at the expense of the main thread. Large WMA payload scans are safely sliced.","Progress, caches, recognition output, recommendations and the import completion boundary remain unchanged."]},
        {title:"Visible-surface Rendering",items:["The hidden Player stops painting its four-band Canvas and progress DOM. Returning to Player restores the exact current state in the first frame while audio, history and behavior capture continue normally.","Hidden selectors and SSE surfaces are excluded from global geometry measurement and are remeasured through the same foundation when they become visible.","Viewport fitting refreshes the active view instead of rescanning every hidden view and every UI Registry component."]},
        {title:"Layout Deduplication",items:["Redundant startup selector initialization and the duplicate resize path are removed while preserving initial layout, font-ready correction and final viewport settlement.","Animation timing, easing, blur, themes, Player layout, Queue placement, SSE, EQ, Spatial, listening history and IndexedDB schemas are unchanged."]}
      ]
    },
    "6.6.3":{
      summary:"HOTFIX BUILD restores free manual Queue scrolling while keeping one deliberate alignment on playback events.",
      sections:[
        {title:"One-shot Queue Alignment",items:["The delayed post-scroll verification is removed, so first playback cannot receive a second positioning command halfway through its motion.","If Queue is still at the top on first playback, one native smooth alignment moves to Now Playing without an instant flash or a second command.","Play, Pause, track changes and returning to Queue each align Now Playing exactly once. When that animation ends, the player releases the scroll surface completely for unrestricted manual browsing.","The centred number-to-play glyph crossfade introduced in 6.6.2 remains unchanged."]}
      ]
    },
    "6.6.2":{
      summary:"HOTFIX BUILD removes the empty-state background grid, makes Queue positioning self-correcting and completes cover loading during import.",
      sections:[
        {title:"Deterministic Queue Position",items:["Queue alignment now measures the current row's real rendered rectangle instead of multiplying its index by an assumed height.","Pause, track changes and repeated input issue one authoritative positioning request. Native smooth scrolling settles Now Playing on the second fully visible row and verifies the result after motion ends.","A completed import alignment cancels the first-play fallback, preventing competing scroll chains. Track numbers and the playback glyph share one fixed centred box and crossfade in place."]},
        {title:"Responsive Import",items:["Cover and thumbnail URLs are decoded before the import dialog can complete, keeping first interaction free of deferred artwork decoding.","Recognition and song-data workers receive a restrained concurrency increase while frame yields remain between completed jobs. The active progress fill keeps a short-lived compositor hint."]},
        {title:"Clean Empty Background",items:["The empty-library three-field background is drawn directly at physical viewport resolution instead of enlarging a 384-pixel gradient raster, removing visible grid structure on high-density displays."]}
      ]
    },
    "6.6.1":{
      summary:"HOTFIX BUILD completes true artwork crossfades and a fully truthful import boundary while restoring fluid transport, Queue and meter motion.",
      sections:[
        {title:"Transport & Queue",items:["The complete 300ms Previous/Next motion owns its visual window. Queue reconciliation, colour extraction, ambient work, waveform and information updates can no longer begin halfway through it.","Native smooth Queue scrolling starts after the transport response, preserving acceleration and terminal deceleration. First-play alignment no longer issues a duplicate scroll request.","Playback markers continue to touch only the old and new rows instead of scanning the full Library."]},
        {title:"True Artwork Crossfade",items:["The incoming artwork is preloaded first. An outgoing artwork copy and the new artwork then fade in opposite directions at the same time, so neither the grey disc substrate nor an empty Static Cover can appear.","Record mode changes only the image inside the disc. Disc angle, rotation timeline, spindle and reader remain completely continuous."]},
        {title:"Complete Import Boundary",items:["Spectrum, MFCC, Energy, BPM, persistent cache, history identity reconciliation, behaviorEvents loading, Resonance Boost model refresh, Daily Mix generation and persistence, Library, Queue, ambient and current-track information all finish inside the import dialog.","The progress bar reaches 100% only after that work is complete, then visually settles at the endpoint before Import Complete appears. No work from that import batch continues after entering the Player.","The dark overlay and explicit dialog border are removed. A slightly brighter shared Glass surface retains the system blur without a hard rim."]},
        {title:"Control & Meter Detail",items:["The playback-speed popover sits closer to its trigger.","The four-band meter regains visible amplitude while separating slower target sampling from up-to-120Hz visual interpolation. Small jitter is filtered without flattening bass, percussion or treble movement."]}
      ]
    },
    "6.6.0":{
      summary:"SNOW LEOPARD 3.0 reschedules post-import work, rebuilds deterministic Queue motion inside a fixed viewport and preserves visual continuity during track changes.",
      sections:[
        {title:"Import Interaction Scheduling",items:["The completion dialog remains open until Done is pressed; overlay clicks and Escape cannot dismiss it.","History synchronization, Daily Mix refresh and Spectrum analysis begin only after confirmation and ten continuous seconds without pointer, touch, wheel or keyboard input; any new interaction restarts the timer.","Visible Library and Queue work commits before background analysis resumes, protecting the first seconds after a large import.","The shared blurred import surface remains intact while its hard black outer rim is replaced by restrained Accent depth and an inner highlight."]},
        {title:"Fixed-Viewport Queue",items:["The Queue viewport never moves; only its list content scrolls, with Now Playing settling as the second fully visible row.","A direct signed target derived from list origin, uniform row height and track index prevents wraparound: moving from track 100 to track 20 now scrolls upward.","The proven 6.0.2 native smooth-scroll path once again owns acceleration and terminal deceleration; request tokens only discard stale mounting retries instead of rewriting scrollTop every frame."]},
        {title:"Track-Change Continuity",items:["Blurred Cover transitions bridge through the cover-derived transition colour rather than exposing a light or dark base surface.","Track title and artist now crossfade in place during a song change; the temporary left-aligned title state that looked like a lateral entrance is removed.","In record mode the physical disc, its angle and rotation timeline remain untouched. Only the artwork inside the disc fades, while Static Cover uses the same in-place opacity transition.","The first two compositor frames are reserved for the transport, metadata and artwork response. Queue reconciliation, Accent extraction, ambient rendering, file information, waveform and PiP refresh move behind that visual commit.","Playback markers update only the old and new rows instead of scanning every Library and Queue row twice on each track change.","Skip controls retain a protected 340 ms compositor window before high-resolution ambient drawing begins.","Transport keyframes use stable translate3d motion and allocate compositing hints only while the animation is active.","The empty-library state restores the three soft Accent fields from 6.0.2 as one precomposed static low-frequency Canvas, without restoring persistent CSS blur or animated background load.","The first Play action after import explicitly aligns the default Queue around the selected song instead of waiting for a later track change."]}
      ]
    },
    "6.5.7":{
      summary:"HOTFIX BUILD repairs playback-rate migration, same-frame Accent colour, direct title contrast sampling, post-import input responsiveness and Queue positioning.",
      sections:[
        {title:"Playback Speed",items:["Only the five supported rates—0.5x, 0.75x, 1x, 1.5x and 2x—are restored. Legacy 0–1000 range positions can no longer be clamped into an accidental 2x default; unsupported old values migrate to 1x.","The speed button, value and segmented glider refresh in the same Accent commit frame instead of retaining the previous track colour."]},
        {title:"Direct Background Readability",items:["Listening History Top 50 and every view title sample the current ambient Canvas directly beneath the title centre, then choose black or white from that real pixel surface rather than a page-wide background estimate."]},
        {title:"Import Responsiveness",items:["Library commit batches shrink from 28 to 12 rows per frame and default Queue batches from 32 to 16, reserving regular input and animation opportunities throughout the commit.","A successful import releases its full-screen progress backdrop after 120ms. History reconciliation, Daily Mix and Spectrum work then wait 6.5–9 seconds before entering later idle windows, preserving immediate input response."]},
        {title:"Queue Positioning",items:["Returning from Sound or Daily Mix smoothly scrolls from the user's previous Queue position to the current track instead of jumping instantly.","Track changes use the same controlled 320–680ms motion. Row positions are accumulated in unscaled CSS layout coordinates, preventing responsive app scaling from pushing the playing song above the viewport.","If the current row is still arriving through incremental rendering, positioning waits and retries for up to two seconds so the playing track cannot remain missing."]},
        {title:"Popover Harmony",items:["The shared Snooze-derived popover surface now mixes the active Glass surface and current Accent instead of a fixed cool grey base, so EQ Presets and every system popover stay visually integrated with warm, cool, light and dark backgrounds."]}
      ]
    },
    "6.5.6":{
      summary:"HOTFIX BUILD re-release rebuilds shared popovers, adds a measured playback-speed glider, stabilizes bass output and commits imported Library and Queue rows across frames.",
      sections:[
        {title:"Curve Equalizer Polish",items:["Snooze's theme acrylic, 18px contextual depth, border and shadow now live on the single gp-motion-popover foundation. Sort, Font, Spatial, Loudness and future popovers inherit it without a type whitelist or separate material.","The shared surface is calculated from the active theme base and Accent with high coverage. It is neither pure white nor pure black, while underlying text, curves and colour blocks can no longer bleed through like wet paper.","EQ Presets abandon their independent open/close implementation and join the same Popover Manager, material, motion and exclusivity contract used everywhere else.","EQ Presets are promoted to the page-level portal while open, escaping the curve card's local compositing layer so the graph cannot pass through its blur.","The redundant Manual Control caption is removed. The active Preset name still fades to Manual after any direct curve adjustment.","Vertical grid lines connect every frequency node and all seven points use restrained translucent Accent styling."]},
        {title:"4K Moiré Hard Stop",items:["Ambient canvases return to the viewport's true physical pixel dimensions, removing the remaining 2x enlargement path.","Track backgrounds no longer overlap as two partially transparent textures. The outgoing static surface fully fades to the theme base before the completed incoming surface fades in, so only one texture is ever composited.","The ambient layer explicitly rejects transforms and CSS filters. Page and control motion reuse the completed static raster without resampling or reblurring it."]},
        {title:"Four-band Motion Continuity",items:["The live four-band target changes from a coarse ~20Hz quantized ladder to a restrained ~31Hz smoothed signal. Small noise remains filtered without making the bars jump between visible steps.","Canvas heights retain subpixel precision while the visual layer continues interpolating on requestAnimationFrame. Separate continuous attack and release constants keep movement fluid without restoring nervous vibration."]},
        {title:"Playback Controls & Audio Stability",items:["Playback Speed stays as a lightweight button symmetrical to Playback Mode. Its popover now contains only five direct presets—0.5x, 0.75x, 1x, 1.5x and 2x—with no duplicate range, endpoint labels or current-value row.","The five rates form one measured Glass segmented glider. Its selected surface uses the same real button geometry and movement system as Queue / Sound / Daily Mix while pitch preservation and preference persistence remain active.","An Accent commit now refreshes the EQ Preset trigger, contextual controls, curve fill and four-band colour in the same frame instead of retaining the previous track's colour.","EQ headroom now measures the complete cascaded response of all seven Biquad filters across 96 logarithmic frequencies instead of using only the largest single-band value. Overlapping bass boosts therefore receive their real preamp budget.","The continuously active fast compressor is removed from normal playback. A fixed linear output, measured EQ preamp and the existing -1.5dB trim avoid bass-cycle gain chatter without hiding upstream errors behind pumping.","Background Spectrum analysis fully yields while playback is active so long MFCC or BPM work cannot compete with local FLAC decoding.","Imported Library and default Queue rows mount in small frame-yielding batches. Offscreen rows use content-visibility, while history synchronization and Daily Mix refresh move into a later browser idle window.","Returning to Queue from Sound or Daily Mix always restores the current track's default readable position when Manual Queue is inactive. Manual Queue retains the user's scroll position."]},
        {title:"Hover Hierarchy Cleanup",items:["Preselection-like hover surface masks are removed from navigation, Changelog releases, track rows, popover options and inline actions. Real active gliders and selected states remain unchanged.","Existing delayed hover triggers, icon micro-interactions, text and icon color feedback, drag affordances and click feedback remain intact."]},
        {title:"Single Popover & Transition Texture Repair",items:["The global Popover Manager permits exactly one visible small popover. Opening another immediately removes the previous surface and synchronizes every trigger's expanded state, while same-trigger and outside clicks use one exit path.","Primary view fades never insert a solid colour bridge. The current song background remains unchanged from the outgoing fade through the completed destination instead of flashing grey.","Dark Blurred Cover uses a denser preblur sample and a narrower low-luminance range, reducing the banded texture most visible on dark 4K output."]},
        {title:"Localization Repair",items:["The Queue cache signature now includes the active interface language, so its empty-library message rerenders when Chinese is restored at startup or selected during the session instead of retaining English."]}
      ]
    },
    "6.5.5":{
      summary:"UI UPDATE advances GP Fusion Engine 2.1 and GP Motion Engine 3.3 with a continuous curve Equalizer, clearer listening insights and pixel-stable high-resolution motion.",
      sections:[
        {title:"GP Fusion Engine 2.1 — Curve Equalizer",items:["The seven-band EQ becomes one continuous Accent curve. Every frequency remains directly draggable while a smooth cubic Bezier path presents the complete gain contour.","Presets move into the shared Glass popover. Classical and Podcast are removed; Sound, Device and a final Manual option remain. Adjusting any active preset gently crossfades its name to Manual.","A preset change interpolates all seven points and the curve over 360ms while Web Audio filters ramp to the same target, eliminating visual and audible parameter jumps.","The Manual curve remains independently persisted and follows existing Light, Dark, localization and cover-derived Accent settings."]},
        {title:"Listening Insight Layout",items:["Listening Rhythm uses an adaptive two-zone layout. Each confidence-qualified period becomes a wrapping information block, preventing period and Genre text from collapsing into one oversized line.","Favorite Artists expands from ten to twelve weeks.","The ten-day listening chart uses a smooth curve while retaining exact data points, dates, hover detail and the Accent area fill."]},
        {title:"4K Motion Stability",items:["4K ambient surfaces use an exact 2x physical-pixel grid: a static 1920x1080 low-frequency field maps cleanly to 3840x2160 instead of compositing two full-size canvases across fractional Edge DPI grids.","Ambient blending becomes a linear 420ms transition without a temporary will-change layer. 1080p remains 1:1, while foreground UI, artwork and typography stay native-resolution everywhere.","The four-band meter separates a stable ~20Hz RMS target sampler from up-to-120Hz visual interpolation. Quantized dead zones, 105ms peak hold and slower release suppress insignificant changes while both rise and fall decelerate naturally into their targets."]}
      ]
    },
    "6.5.4":{
      summary:"HOTFIX BUILD repairs Poly-sensitive output headroom, native-pixel 4K transitions, live meter motion and several interface-state regressions while correcting Loudness and listening-rhythm logic.",
      sections:[
        {title:"Audio Output Integrity",items:["The verified graph is singular: both Decks pass through Crossfade, per-track Gain, EQ and Spatial before one final output. No duplicate AudioContext or duplicate connection remains.","Positive EQ receives equal negative preamp compensation. A fixed -1.5dBFS margin follows Spatial, then one final limiter catches exceptional overs only; user volume remains after protection.","Loudness now references the loudest track in the current library and only raises quieter tracks. It never turns a louder track down, and every gain remains finite, capped and smoothly ramped.","Short gain envelopes protect play, pause, Seek, Deck changes and Crossfade. Volume and mute no longer jump between sample values.","A read-only diagnostic ring records Mix, EQ, Spatial, Final, standard mono average and unsafe channel sum, including first-exceed location, peak, RMS, EQ, Loudness, Spatial, limiter reduction and context latency."]},
        {title:"4K Motion & Background",items:["Blurred Cover still starts as a low-frequency colour field, but its final Canvas now uses a viewport × devicePixelRatio backing store instead of stretching a 1280 × 720 surface to 4K.","Ambient transitions change opacity only and explicitly reject transforms, preventing dynamic spatial aliasing from becoming visible moire at lower refresh rates.","The four-band playback meter uses stronger spectrum smoothing, separate attack and release inertia, and a small dead zone for fluid movement without nervous frame-by-frame vibration."]},
        {title:"Interface & State Repair",items:["The Settings build card uses one real Accent border; the transparent base border and overlay edge that leaked a white strip are removed.","Spatial and Loudness information portals position on the two frames after their visible state commits, keeping them attached to their buttons.","Library DOM commits before the first imported track is selected, so an active player cannot coexist with an empty Library view.","Queue remembers a pending current-track alignment while hidden and resolves it when shown, without resetting unrelated user scrolling.","Listening Rhythm can report up to three confidence-qualified periods and combines each with its Neural time-specific Genre preference instead of returning only a bare Evening label."]}
      ]
    },
    "6.5.3":{
      summary:"HOTFIX BUILD introduces GP Motion Engine 3.3, removing turntable stalls and 4K transition texture while improving import responsiveness, recommendation freshness and FLAC stability during both track changes and continuous playback.",
      sections:[
        {title:"GP Motion Engine 3.3",items:["Playback and pause state changes update only the active-row indicator; they no longer rebuild the full Library and Queue while the record and tonearm are moving.","Blurred Cover is reduced to a low-frequency colour field and softened before it is enlarged to display resolution, so page fades cannot expose cover text, rings or oversized contours.","Import recognition, cache restoration and UI commits yield rendering frames. CSS, Web Animations and requestAnimationFrame continue to follow the display refresh rate up to 120Hz."]},
        {title:"Import Responsiveness",items:["An exact cache match no longer rewrites IndexedDB. Recognition records are updated only when Spectrum ID or fingerprint anchors actually change.","Library rows commit as one HTML batch and share delegated interaction handlers instead of performing hundreds of individual parses and listener attachments.","New full-track decoding, MFCC and BPM analysis waits while music is playing, then resumes after playback pauses. Cached features still restore immediately."]},
        {title:"Recommendation Freshness",items:["Shuffle and Daily Mix use a hard short-term exclusion window covering the latest session tracks and the bounded Shuffle timeline.","Long-term preference, Genre, MFCC, BPM and Energy still rank eligible candidates, but cannot override immediate-repeat protection."]},
        {title:"Lossless FLAC & Continuous Playback",items:["FLAC remains natively decoded to PCM by Edge without transcoding, recompression or source-file modification. Both Decks preload audio and the AudioContext uses a continuous-playback buffer policy.","The delayed parallel Compressor route and the always-on 12:1 Spatial Bus compressor are removed from the signal path, preventing phase transients, nonlinear peak clicks and gain breathing.","Play, pause and Deck-transition gain envelopes begin only after the new decoder is actually producing audio; pause fades before stopping instead of cutting a non-zero PCM sample.","Listening time still accumulates continuously, while full-history JSON and localStorage persistence is batched into idle time and forced to disk when the page hides or closes."]}
      ]
    },
    "6.5.2":{
      summary:"HOTFIX BUILD removes the remaining interaction-time background texture by replacing retained full-screen CSS blur with native-resolution static raster surfaces.",
      sections:[
        {title:"Ambient Background Repair",items:["The oversized gray discs and the finer texture or moire are treated as separate failures: the first came from exposed color fields, while the second came from Edge repeatedly resampling retained full-screen CSS filters.","Glow, Color Background and Blurred Cover now render only when their source changes, into two native-resolution raster surfaces that cross-blend without re-blurring during page or control motion.","The raster scales to the real viewport and device pixel ratio, with a guarded 4096 x 2304 ceiling, so a 4K display receives a stable pixel-aligned background instead of a transformed low-resolution texture."]},
        {title:"Default & Theme Balance",items:["Before music is imported, ambient strength stays below half of the normal playback background so monochrome Accent cannot wash across Player and Queue.","Imported music retains its cover/theme atmosphere. Color Background remains stronger but bounded, while Glow remains more restrained.","Theme, cover and resize changes regenerate the cached surface once; ordinary animation reuses that result and cannot bring the texture back."]},
        {title:"Motion Contract",items:["GP Motion Engine 3.2 keeps its 120Hz ceiling for progress, four-band activity, record motion and PiP.","This patch changes only ambient input and composition; audio, Queue, Spectrum, listening history and the user model are untouched."]}
      ]
    },
    "6.5.1":{
      summary:"MOTION UPDATE introduces GP Motion Engine 3.2, moving every live visual scheduler to a 120Hz ceiling while releasing persistent idle-background GPU layers for a more balanced CPU/GPU workload.",
      sections:[
        {title:"GP Motion Engine 3.2",items:["A shared 120Hz Motion clock drives the Canvas four-band meter, playback progress, record timeline and traditional PiP through requestAnimationFrame at up to 8.33ms intervals.","CSS and Web Animations carry no artificial 60fps cap and follow the display compositor. The deliberately stepped low-frame sampling is removed from button haze feedback.","Playback progress moves from low-frequency timeupdate painting to an independent 120Hz visual loop, while the time label changes only on whole seconds to avoid redundant DOM writes."]},
        {title:"Balanced Rendering",items:["The three oversized color fields no longer retain separate blur, hue-rotate and will-change GPU surfaces. Hue is calculated once on the CPU when the static background is generated.","Blurred Cover promotes itself only during its 560ms cross-blend and releases the compositor hint immediately afterward, so an idle view does not retain unnecessary GPU textures.","Traditional PiP accepts a 120fps carrier and foreground ceiling while continuing to cache its expensive blurred or colorized background."]},
        {title:"Frame Safety",items:["120Hz is a ceiling, not a busy loop: a 60Hz display naturally receives 60 callbacks, a 120Hz display can receive 120, and hidden tabs stop the playback visual loop.","Only genuinely moving progress and spectrum data enters the high-frequency path. SSE, adaptive title color, palette extraction, recommendation and listening analysis remain event-driven or cached."]}
      ]
    },
    "6.5.0":{
      summary:"EXPERIENCE UPDATE rebalances the enhanced audio path and concentrates on playback feedback, scanning motion, adaptive title readability and stable high-resolution composition.",
      sections:[
        {title:"Audio Experience",items:["Loudness normalization, positive EQ and Spatial Audio now share fixed headroom so stacked gain can no longer create clipping, crackle or sudden peak distortion.","EQ parameters use short smooth transitions. The final safety stage is transparent when enhancements are off and catches only rare out-of-range peaks when they are active.","Positive loudness correction is constrained by cached peak information and a fixed ceiling. Original Loudness remains visible and no audio file or stored Spectrum analysis is changed."]},
        {title:"Playback & Controls",items:["The four-band playback meter no longer caches hidden 1 × 1 geometry; returning to Player forces a real-pixel measurement and restores stable higher-rate drawing.","ON / OFF switches are excluded from global press scaling, so click and drag feedback stays horizontal without occasional vertical movement.","Import and Rescan share a tighter symmetric two-arrow cycle whose continuous rotation slows to a calmer 1.35 seconds per revolution."]},
        {title:"Rendering & Readability",items:["Page titles refresh against their direct surface after theme changes, cover blends, view settling and resize, selecting black or white with a restrained inverse shadow for difficult frames.","View transitions commit through two compositor frames instead of a synchronous forced layout, while the four-band meter returns to a 60fps sampling cadence.","Ambient blur and hue work moves to independent composited layers, blurred covers stay on stable GPU surfaces, and longer radial gradients remove interaction-time texture resampling and moiré."]}
      ]
    },
    "6.4.4":{
      summary:"HOTFIX BUILD gives the folder interaction a physically continuous, restrained sheet reveal and repairs the bilingual settings heading.",
      sections:[
        {title:"Scanning Feedback & Control Consistency",items:["Initial import and Rescan Music Library now share one precisely centered two-arrow cycle. The icon rotates continuously while work is active and returns cleanly to rest when processing finishes.","Clicking an already open Spatial Audio or Loudness information button no longer restarts its motion or jolts the popover. It closes only after the pointer leaves both the button and the information surface.","Chinese mode labels Crossfade as “交叉淡入淡出”, while English mode shows “Crossfade”. Duration stays on the left, the switch stays on the right, and disabling it reuses the Accent selector’s gray transition while completely locking the range control.","Founder’s Note no longer waits on a 400 ms close timer; its close-mark feedback and modal exit begin together."]},
        {title:"Folder Paper Motion",items:["The sheet is now one solid rounded rectangle behind a dedicated reveal mask. Only the portion above the folder is visible, while the same sheet continues into the folder at maximum extension.","At rest the sheet is fully hidden. Maximum travel is reduced from 5 px to about 3.55 px, and the counter-moving folder settles more gently.","Near-solid opacity removes the hollow outline appearance while preserving the existing 500 ms response."]},
        {title:"Chinese Localization",items:["Chinese mode now shows only “界面语言”; English mode renders “Interface Language” through the normal translation system.","Changing language now rerenders the Daily Mix empty state immediately, preventing the English minimum-song message from surviving a switch back to Chinese.","The redundant Crossfade helper sentence is removed, and Rescan All Songs is renamed Rescan Music Library.","Listening Data expands its weekly Favorite Artist chart from five to ten weeks while the Recent Favorites card keeps its concise original label.","Song, Artist, Album and Genre in Recent Favorites share the confidence-aware window: approximately one month, adaptively selected from 21, 30, 45 or 60 days.","The repeated listening-range caption under the large duration is removed; the selected range and comparison already provide that context."]}
      ]
    },
    "6.4.3":{
      summary:"HOTFIX BUILD corrects three visible geometry and typography defects without changing import, theme or modal behavior.",
      sections:[
        {title:"Changelog & Import Icon Geometry",items:["The Changelog document becomes one continuous rounded outline whose folded corner meets the outer frame exactly.","The folder interaction now places a wider sheet behind an opaque foreground folder face, pulls it visibly farther upward and counter-moves the folder before a restrained elastic return.","The Add Files plus-shaped haze and both native picker flows remain unchanged."]},
        {title:"Accent Swatches",items:["Native button appearance and default padding are removed. A dedicated circular layer now fills every swatch edge-to-edge without white strips.","The monochrome option remains recognizable without allowing a bright diagonal face to break the circular perimeter."]},
        {title:"Founder’s Note Typography",items:["Body copy and attribution become separate semantic elements. “—— CT” stays on one line and aligns to the right like a proper quotation signature.","The shared glass, close-only behavior and centered close rotation are unchanged."]}
      ]
    },
    "6.4.2":{
      summary:"HOTFIX BUILD reduces avoidable main-thread and compositor work while preserving the existing visual, audio and persistence contracts.",
      sections:[
        {title:"Frame Pacing & Rendering",items:["Mini EQ geometry and color are cached, SSE and chart tooltip work are frame-coalesced, and Daily Mix reuses one feature snapshot per track.","Bounded Genre-resolution caches remove repeated fuzzy comparisons without adding runtime networking or changing recommendation weights.","Blurred-cover compositor hints now exist only during an actual blend; the final image and timing remain unchanged."]},
        {title:"Sound Guidance & Founder’s Note",items:["Loudness receives the same inverted-exclamation control and shared glass popover as Spatial Audio, with concise copy explaining the non-destructive fixed playback gain.","The Founder’s Note close mark is a symmetric centered SVG, and the signature moves onto its own line as “—— CT”."]},
        {title:"Icon Geometry & Motion",items:["Opaque single-alpha geometry, separated joins and rounded endpoints remove pale overlap seams across music notes, history axes and transport/list controls.","Add Files emits a plus-shaped haze; Add Folder lifts a sheet while the folder counter-moves and settles; Daily Mix Play reuses the rounded triangular pulse while its label remains still.","Existing previous, next, play, pause, sidebar and row-action motion follows the revised rounded silhouettes."]},
        {title:"Listening History Layout",items:["Listening History again uses the same centered maximum width and side breathing room as the other primary views.","Pointer feedback remains visually identical while high-frequency movement is consolidated to one update per frame."]}
      ]
    },
    "6.4.1":{
      summary:"NEURAL BOOST introduces GP Spectrum Engine 2.1 and GP Neural Engine 2.1, making recommendation relationships more coherent while keeping every decision and lookup local.",
      sections:[
        {title:"GP Neural Engine 2.1 — Offline Genre Intelligence",items:["The recommendation intervention gate rises from 0.56 to 0.70. Shuffle remains genuinely uniform until the local model has enough evidence.","A bundled Genre/Style graph connects broad families, subgenre aliases and fixed proximity weights. Unknown labels fall back to local name similarity; no runtime MusicBrainz, Discogs or other network request exists.","Genre proximity now informs long-term preference, time context, session response, Shuffle and Daily Mix clustering without replacing MFCC, BPM, Energy, freshness or diversity."]},
        {title:"GP Spectrum Engine 2.1 — Fixed Loudness Balance",items:["Spectrum analysis derives a conservative per-track gain from original loudness and stores it beside existing IndexedDB features. Existing loudness caches can be upgraded without decoding the song again.","A switch at the right of Loudness applies the fixed gain through one lightweight node per deck. It never changes the file or the original Loudness display and remains independent of Crossfade, EQ and Spatial Audio."]},
        {title:"History & Interaction Repair",items:["Favorite Artist uses a fixed ten-week window and Listening History opens on Today. Strict width containment prevents long history periods from widening a windowed layout.","Library and Queue actions receive larger real hit targets without changing their icons or selected glass. The Current Version pill opens a localized project-origin message using the shared glass dialog material.","Decorative helper copy is removed while required confirmations, values and live progress remain visible."]}
      ]
    },
    "6.4.0":{
      summary:"PEREGRINE UPDATE introduces Peregrine Lake and GP Core 4.0: the verified third-stage source moves into formal layers with explicit factories, Ports, ownership and architecture validation while product behavior stays unchanged.",
      sections:[
        {title:"Peregrine Lake — Formal Architecture",items:["The completed third-stage project is the only baseline. Real implementations move from src/js and src/modules into formal directories; the old directories are removed without rebuilding from original or app.js and without creating a second runtime.","SOURCE_ORDER.txt remains the sole execution-order authority, build.ps1 still emits only build/app.js and index.html remains a synchronous file:// application. No modules, npm, bundler, Electron, SQLite or IPC are introduced.","Factories register through window.GPModules and bootstrap/main.js creates one explicit Context. window.GP remains compatible and now exposes a read-only public facade."]},
        {title:"Core, Ports & Ownership",items:["Core provides Module Registry, Event Bus, Actions, Store, Selectors, Contracts and App Context, separating commands, persistent state, transient events and environment access.","Browser Storage, File, PiP, Media Session and Clock adapters establish the Port boundary needed by a future Electron adapter replacement.","AudioContext, dual decks, AudioNodes, Crossfade automation, PiP Canvas and IndexedDB transactions remain private runtime resources and never enter the serializable Store."]},
        {title:"Service & Engine Contracts",items:["Playback, Queue, Library, History, Spectrum, Neural, Settings and PiP expose explicit service contracts; Audio, Spatial, Recognition, Spectrum Analyzer and Motion expose explicit engine contracts.","Queue, Shuffle Timeline, Spectrum ID, MFCC/BPM/Energy, listening history, user model, recommendations, Spatial A/B buses and PiP lifecycle retain one real implementation. Algorithms, audio parameters, schemas and user data are unchanged.","MODULE_API.md records maturity, parameters, results, errors, side effects, callers, tests and compatibility for every public interface. New interfaces begin as Experimental."]},
        {title:"Permanent Governance & Validation",items:["MODULE_GOVERNANCE.md becomes the permanent authority for ownership, responsibilities, access and allowed dependencies. Dedicated documents cover state, dependencies, events and Store schema.","validate-architecture.ps1 checks source existence, unique ownership, required module fields, API contracts, Stable-test records and declared cycle freedom without changing source.","CSS, DOM, layout, Motion values, EQ, Spatial tuning, recommendation weights, identity algorithms, storage keys, IndexedDB definitions and listening data are unchanged."]}
      ]
    },
    "6.3.2":{
      summary:"HARMONIC ENHANCE introduces GP Core 3.2: the first low-risk Harmonic Lake modularization pass establishes explicit service boundaries while playback, audio, data and visible behavior remain unchanged.",
      sections:[
        {title:"GP Core 3.2 — Low-Risk Module Boundaries",items:["A compatibility-preserving window.GP.modules namespace now hosts GP.utils, GP.i18n, GP.changelog, GP.spatialPresets and GP.pipRenderer. They are still concatenated into the single build/app.js in SOURCE_ORDER.txt order, with no ES Modules or third-party tooling.","Each implementation was migrated from its second-stage src/js location rather than copied. Old implementations were removed, real callers now use module APIs, and the remaining clamp, fmtTime, tr, translateTree and applyLanguage aliases are stateless forwarders only.","ui-static.js was intentionally not created because the current source contains no independently reusable static template with a real caller."]},
        {title:"Stable Product Services",items:["GP.i18n privately owns the complete UI_EN dictionary and original-text WeakMaps while continuing to use the one existing uiLanguage state. Language switching and every existing dynamic refresh remain unchanged.","GP.changelog privately owns the single RELEASES dataset plus English summaries and details, exposing read-only queries, rendering and export. Full bilingual records for 6.3.1 and 6.3.2 are included.","GP.spatialPresets exposes read-only fixed mode data and copy only. GP.pipRenderer contains only stateless rounded paths, text fitting, cover drawing and layout calculations."]},
        {title:"Zero Runtime Drift",items:["Dual Deck, Crossfade, playback state, Queue, Shuffle, IndexedDB, Spectrum ID, metadata, MFCC/BPM/Energy, listening time, Neural recommendation, Spatial Bus Runtime and PiP lifecycle were not modularized or rewritten.","app.css, the first-stage app.js and original/Glass Player 6.2.2.html remain unchanged. Storage keys, database definitions and user-data schemas are unchanged.","build.ps1 still concatenates UTF-8 source strictly by SOURCE_ORDER.txt; index.html still synchronously loads only ./build/app.js inside one outer IIFE."]}
      ]
    },
    "6.3.1":{
      summary:"HARMONIC ENHANCE introduces GP Core 3.1: maintainable contiguous source slices and a deterministic single-file build are added on top of the 6.3.0 physical split.",
      sections:[
        {title:"GP Core 3.1 — Source Slicing",items:["The immutable first-stage app.js remains the verification baseline. Maintainable source was divided into eleven original-order src/js fragments covering the existing functional boundaries.","The fragments are physical source boundaries only: no import/export, declaration movement, formatting, renaming, scope change, hoisting change or timing change was introduced."]},
        {title:"Deterministic Single-File Build",items:["SOURCE_ORDER.txt became the only build-order authority. build.ps1 reads its listed UTF-8 files without BOM and concatenates them into the single build/app.js.","index.html loads only ./build/app.js, never the baseline app.js or individual source fragments, and retains file:// relative paths.","At completion, build/app.js matched the first-stage app.js in SHA-256, text and bytes; declaration, listener, RELEASES, IIFE and data-key counts also matched."]}
      ]
    },
    "6.3.0":{
      summary:"HARMONIC UPDATE introduces GP Core 3.0: a zero-logic-change physical separation of the original single-file player into index.html, app.css and app.js.",
      sections:[
        {title:"GP Core 3.0 — Physical Separation",items:["The complete main style content moves to app.css in its original order. Every selector, override and cascade boundary remains unchanged.","The complete main script content moves to app.js in its original order. The outer IIFE, strict mode, body-end position and synchronous execution timing are preserved.","index.html links the files with a normal stylesheet link and a non-module, non-defer, non-async script. No modularization, refactor, renaming or formatting is included."]},
        {title:"Harmonic Baseline",items:["The complete Glass Player 6.2.2 single-file build is preserved as the immutable original/Glass Player 6.2.2.html baseline for exact reconstruction and later regression checks.","Dual Deck, Crossfade, EQ, GP Spatial Engine, PiP, Queue, Shuffle timeline, Spectrum ID, MFCC, BPM, Energy, listening history, recommendation, Motion Engine, SSE, themes and localization retain their existing implementations.","localStorage keys, IndexedDB name/version, object stores, indexes, schema, metadata, behaviorEvents, userModel, recommendations and trackCache are not migrated, renamed or cleaned."]},
        {title:"Zero-Logic Contract",items:["This release does not include performance optimization, legacy cleanup, duplicate CSS consolidation or architecture modularization. Apart from 6.3.0 release metadata and this changelog entry, runtime logic is unchanged.","The split is checked against source hashes, CSS/JavaScript ordering, IIFE boundaries, script syntax, external tag placement and relative resource paths."]}
      ]
    },
    "6.2.2":{
      summary:"HOTFIX BUILD introduces GP Spatial Engine 1.1, replacing all playback-driven tuning with fixed presets and a predictable 400 ms A/B transition.",
      sections:[
        {title:"GP Spatial Engine 1.1 — Static Presets",items:["Realtime correlation polling, 100 ms retuning, dynamic Width, adaptive Reflection/Reverb/Chorus/HRTF protection, Haas and automatic Makeup Gain are removed. Genre, BPM, MFCC, Energy, playback state, track changes, Seek and Crossfade cannot alter Spatial parameters.","Desktop Speakers, Studio Monitors, Wide Stage, Front Binaural, Live Hall, Cinema and Dreamscape use release-fixed values. The disabled switch is the eighth state: No Spatial Audio.","Low Side, Mid/High Width, Crossfeed, HRTF, four reflections, Side Reverb, Chorus, Pre Gain and Output Trim remain constant for the full lifetime of a selected mode."]},
        {title:"400 ms Equal-Power A/B Bus",items:["Two lightweight buses are prebuilt. Only the active bus receives audio during normal playback. A user mode change configures the idle bus, fades it from 0 to 1 and fades the old bus from 1 to 0 with equal-power curves.","After 400 ms the old input is physically disconnected and any old Dreamscape LFO is stopped. Rapid repeated selections queue only the latest requested mode instead of rewriting an audible bus midway.","Pause, resume, Seek, track changes and dual-deck Crossfade never rebuild or re-fade the Spatial bus."]},
        {title:"True Bypass & Stable Output",items:["No Spatial Audio uses the original post-EQ Dry Master route. Both Spatial Bus inputs are disconnected, and Width, HRTF, reflections, Convolver and Chorus receive no audio; the Chorus LFO is stopped.","Every bus uses a fixed 0.72 Pre Gain and a fixed per-mode Output Trim. There is no peak-following gain, loudness compensation or dynamic makeup.","The always-on Master compressor is removed. Each Spatial Bus retains only a -1 dB, 12:1, 0-knee, 3 ms attack and 60 ms release peak safety stage; the Dry route bypasses it completely."]},
        {title:"Deterministic Space",items:["Haas is removed from every mode. Desktop and Studio favor restrained Crossfeed with HRTF off; Front favors HRTF; Wide relies mainly on static M/S Width; Hall and Cinema use limited reflections and Side Reverb; only Dreamscape runs a 0.18 Hz, 1 ms-depth Chorus.","The four reflections remain fixed at 8/13/21/31 ms with pans -0.55/+0.45/-0.35/+0.65 and immutable internal gains.","Deterministic 0.55, 0.60 and 0.75 second IRs are generated once at engine initialization from fixed seeds and permanently shared by both buses. They are never regenerated for a track, theme, mode switch or playback event."]},
        {title:"UI & Preference Hotfix",items:["The Spatial switch remembers the last selected mode and restores it when enabled again. The existing seven-button layout, switch, storage keys and localized labels remain unchanged.","The inverted-exclamation popover is promoted to the page layer, escaping the Sound sector's nested compositing context so its shared Snooze glass samples the final page background correctly.","EQ, Crossfade, Spectrum, MFCC, BPM, Energy, Queue, recommendations, behavior modeling and listening history are untouched and receive no migration or reanalysis."]}
      ]
    },
    "6.2.1":{
      summary:"HOTFIX BUILD repairs the Spatial Audio information popover by moving it onto the shared GP Motion Engine glass contract.",
      sections:[
        {title:"Spatial Popover Glass",items:["The inverted-exclamation information panel now directly reuses the gp-popover foundation shared by Snooze, Library Sort and Font selection instead of maintaining an independent blur surface.","Its adaptive translucent surface, contextual 8 px blur, restrained saturation, border and shadow now follow the current theme and background automatically.","All seven descriptions, the 100 ms hover response and immediate click behavior remain unchanged. The Spatial audio graph, mode parameters and local user data are untouched."]}
      ]
    },
    "6.2.0":{
      summary:"AUDIO UPDATE introduces GP Spatial Engine 1.0, widening and moving stereo sound forward without a second playback engine, head tracking or Dolby Atmos claims.",
      sections:[
        {title:"GP Spatial Engine 1.0",items:["The shared chain is now Crossfade Output → Existing EQ → Spatial Engine → Limiter → Master Gain. The original AudioContext and two Decks remain the only playback runtime.","Panner, Delay, Filter, Convolver and Gain nodes are created once. Seven modes use 120 ms AudioParam ramps instead of reconnecting the graph.","Turning Spatial off bypasses both its wet graph and protection limiter for a genuine post-EQ stereo path."]},
        {title:"Seven Spatial Modes",items:["Desktop Speakers, Studio Monitors, Wide Stage, Front Binaural, Live Hall, Cinema and Dreamscape target seven clear listening uses.","A 120 Hz Mid/Side bass guard, multiband width, Crossfeed, parallel HRTF, four early reflections, Side-only reverb and restrained Chorus/Haas are combined per mode.","The switch defaults to Desktop Speakers. While off, the selector remains available without its glider; selecting any mode fades the glider in at that exact position and enables Spatial."]},
        {title:"Phase & Output Protection",items:["Stereo correlation is sampled at most every 100 ms only during playback. High Side and wet depth retreat smoothly as correlation weakens; negative correlation also forces Low Side to zero.","Analysis stops while paused or disabled and falls to no more than twice per second while hidden. Reflection count and the single 0.9-second stereo IR stay fixed.","Internal -3 dB or -4.5 dB headroom plus a -2 dB, 20:1 limiter protects peaks without using loudness as an effect."]},
        {title:"Sound UI & Motion",items:["EQ is reorganized into separate Sound and Device groups. Device compensation for QC35, QC Earbuds, Poly Sync 40 and wall-adjacent monitor speakers is no longer mixed into the general tone row.","Spatial Audio sits between EQ and Loudness. Its inverted-exclamation control animates immediately and reveals seven plain-language descriptions after a 100 ms hover or a click.","The shared segmented-control contract adds slightly more inter-button space and safe text padding while keeping each button naturally sized.","The selector now uses one continuous position-and-width interpolation without a midpoint stretch or second settling step. Rapid changes continue from the live visual position, while turning Spatial off immediately clears its glider, emphasized label and press residue.","Sequential, Shuffle and Repeat One now crossfade in place on a fixed 22 px icon canvas, removing vertical path-swap jitter. View and sector fade lifecycles are exposed through the shared GP.motion contract."]},
        {title:"Traditional PiP Clarity",items:["Blurred Cover now follows the main background's approximately 58 px softness with overscanned sampling, removing readable cover detail and exposed blur edges.","Artwork bounds and foreground geometry snap to device pixels for clearer compact rendering while the fixed 1080p carrier, cached background and 60fps foreground remain intact."]}
      ]
    },
    "6.1.0":{
      summary:"SNOW LEOPARD 2.0 reduces the single-file runtime without changing its interface, behavior or locally learned understanding of the listener.",
      sections:[
        {title:"Dead Runtime Removal",items:["Removed the retired Document PiP document, styling, queue mirror and synchronization lifecycle after traditional video PiP fully superseded it. The current fixed-1080p, 60fps foreground and cached-background implementation remains unchanged.","Removed an unreachable sidebar WAAPI branch after an unconditional return, together with helper functions that had no callers."]},
        {title:"Parser & History Consolidation",items:["Removed standalone legacy ID3 and FLAC Genre parsers already superseded by the unified metadata pipeline. Current import, rescan, artwork and file-information paths remain intact.","Removed renderHistoryLegacy after the indexed 5.9.0 Listening History renderer replaced it. Current statistics, preferences, time-period modeling and visualizations remain unchanged."]},
        {title:"User Data Safety Contract",items:["No localStorage or IndexedDB database, store or key is cleared, migrated or renamed. Listening history, behaviorEvents, userModel, recommendations and identity links are preserved.","Spectrum ID, MFCC, BPM, Energy, Genre, file snapshots and before/after rescan identity compatibility remain intact, so analyzed tracks are not reprocessed because of this release."]},
        {title:"Zero Visual Change",items:["All active CSS and its layered override order are retained. SSE, Glass materials, responsive geometry and final Motion Engine output are unchanged.","Only JavaScript proven unreachable by reference audit was removed; playback, import, Queue, Listening History, Settings, Changelog and traditional PiP keep their existing user paths."]}
      ]
    },
    "6.0.0":{
      summary:"ACCESSIBILITY UPDATE begins Glass Player Gen 6 with an always-on-top, freely resizable Document Picture-in-Picture player synchronized with the existing local playback runtime.",
      sections:[
        {title:"GP Core 2.3 — Multi-Document Runtime",items:["The main page remains the only Audio and Web Audio owner. PiP never duplicates playback, Spectrum analysis or cached track state.","Track, artwork, progress, playback, theme, Accent, typography, language and queue state are projected into the same-origin PiP document through one lightweight synchronization layer.","Closing either context releases observers, resize timers and temporary references without leaving a second runtime behind."]},
        {title:"GP Fusion Engine 2.0 — Floating Player",items:["A text-free circular launcher sits to the right of Snooze while the combined utility group remains centered.","Edge keeps the Document PiP window above other apps; users can drag it and resize it, while the last width and height become the next opening suggestion.","Static artwork, title, artist, progress and Previous/Play/Next form the core. A concise five-to-eight-track Up Next appears only when both width and height can support it.","A native Glass dialog reports unsupported environments, denied permission and request failures instead of silently doing nothing."]},
        {title:"GP Motion Engine 3.1 — Responsive PiP Motion",items:["After a 300 ms hover dwell or on click, the rear window moves upper-right and the front window lower-left before both settle without an end-frame twitch.","PiP controls preserve the Player's circular hierarchy, Accent treatment and restrained 500 ms micro-interactions.","Tiny, compact, portrait, standard, ultra-wide-short and large queue layouts respond to the real PiP width and height. Very narrow tall windows keep artwork above the controls; wide short windows use a low horizontal composition.","Glow, Cover Color and Blurred Cover reuse the current background and theme variables without rerunning color extraction or creating a second ambient animation."]}
      ]
    },
    "6.0.4":{
      summary:"HOTFIX BUILD stabilizes traditional PiP geometry, restores smooth dynamic motion without repeating expensive background work and introduces a complete title marquee.",
      sections:[
        {title:"Stable PiP Geometry",items:["The video track stays at 1920 × 1080 for its entire lifetime. Resizing changes only the internal composition and no longer asks Edge to renegotiate the source dimensions or enlarge the window.","Abrupt 440px and 320px layout breakpoints are replaced by continuous interpolation of artwork size, placement and typography."]},
        {title:"Layered Rendering",items:["Background, Cover Color and Blurred Cover are cached as a static layer and rebuild only when track or appearance state changes; expensive filters never run per frame.","Artwork, title, progress, time and playback state compose in a separate foreground layer, while the video carrier returns from 3fps to a maximum 60fps.","A fixed supersampled 1080p source keeps compact windows sharp without forcing a full 4K background render on every motion frame."]},
        {title:"Title Marquee",items:["Titles that fit remain stationary. Overflowing titles pause for 1.1 seconds, then loop at one constant speed.","A deliberate gap separates the tail from the next copy. Track, font, weight or width changes reset the marquee cleanly to the beginning."]}
      ]
    },
    "6.0.3":{
      summary:"HOTFIX BUILD makes traditional PiP settings genuinely live while paused, sharpens compact layouts and prevents high-resolution rendering from competing with playback.",
      sections:[
        {title:"True Live Synchronization",items:["When the PiP carrier is paused, theme, background, typography or Accent changes briefly push one updated frame and return to pause without starting the main audio or reopening the window.","The real Picture-in-Picture window is observed for resize, allowing composition and pixel density to respond immediately."]},
        {title:"Compact Clarity",items:["Small PiP sizes enlarge artwork, title and artist while removing secondary copy instead of shrinking the full desktop composition into a soft thumbnail.","The center-dot artwork placeholder is removed completely; missing artwork now uses only a clean translucent surface.","Blurred Cover uses a smaller background blur radius in compact layouts, while foreground original artwork remains filter-free."]},
        {title:"Playback-First Performance",items:["Canvas density follows the real PiP window at roughly 2.15x supersampling, starting at 1600px and reaching 4K only for genuinely large floating windows.","The carrier is capped at 3fps and progress rendering at roughly one update per 480ms. Direct setting changes remain immediate without continuous 4K filter work."]}
      ]
    },
    "6.0.2":{
      summary:"HOTFIX BUILD rebuilds traditional PiP synchronization, background rendering and pixel density so visual settings update immediately and 4K displays receive a genuinely higher-resolution source.",
      sections:[
        {title:"Live Settings Sync",items:["Dark, Light and Auto theme, Accent, background mode, language, font family, font size and font weight share one PiP redraw signal and update inside the open window.","Asynchronous adaptive Accent results also trigger a refresh, while multiple setting changes in one animation frame collapse into one render."]},
        {title:"Distinct Background Modes",items:["Ambient Glow uses restrained Accent light fields; Cover Color uses a three-color palette extracted from artwork; only Blurred Cover draws the enlarged artwork background.","The outer glass-panel border and enclosed frame are removed so artwork, typography and background form one uninterrupted composition."]},
        {title:"Adaptive High Resolution",items:["The PiP canvas now follows physical display density from 1920 through 2K up to 3840 × 2160 instead of using one fixed 1280 × 720 source on every monitor.","Foreground artwork keeps the original coverUrl with high-quality sampling and no background filter. Soft text shadowing is removed for cleaner glyph edges."]}
      ]
    },
    "6.0.1":{
      summary:"HOTFIX BUILD replaces Document Picture-in-Picture with traditional video PiP, removing the file-origin bar while retaining synchronized native playback control.",
      sections:[
        {title:"Borderless Video PiP",items:["The address-bearing Document PiP path is disabled in favor of Edge's native video Picture-in-Picture shell, so the floating player no longer shows the local file address bar.","Previous, Play/Pause and Next remain connected through native PiP controls and the existing Media Session handlers; GP still owns one Audio, Web Audio and Spectrum runtime."]},
        {title:"High-Resolution Visual Surface",items:["A 1280 × 720 canvas generates the PiP video frame. Foreground artwork prioritizes the original coverUrl instead of scaling the low-resolution thumbUrl.","Artwork, title, artist, progress, playback state, theme, Accent and typography update together, with redraws limited to meaningful state changes."]},
        {title:"Lifecycle Hotfix",items:["Closing PiP stops the temporary canvas video track, removes hidden media elements and disconnects the theme observer to prevent background GPU work.","Unsupported environments, denied permission and creation failures still report their real cause in the Glass fallback dialog."]}
      ]
    },
    "5.9.0":{
      summary:"HOTFIX BUILD rebuilds Listening History's data path for responsive entry, reliable preference refresh and one shared five-period time model.",
      sections:[
        {title:"History Performance",items:["Spectrum ID, legacy keys and Artist/Title aliases are indexed once, eliminating repeated full-library searches for every history record.","Top 50 rows use native off-screen content skipping while preserving the current markup and appearance.","Rankings, favorites and charts commit DOM in one batch; SSE ignores intermediate mutations and measures once after the content settles."]},
        {title:"Reliable Preference Refresh",items:["Visible Listening History refreshes at most once every 30 seconds in an idle frame when new listening data arrives.","Favorite Song, Artist, Album, Genre, listening period, rankings, charts and insights all invalidate from the same history revision.","The long-term Neural model still rebuilds from meaningful behavior at most once per minute and reloads when stale or version-mismatched."]},
        {title:"Five Listening Periods",items:["Late Night 22:00–04:59; Early Morning 05:00–09:59; Midday 10:00–14:59; Afternoon 15:00–17:59; Evening 18:00–21:59.","Listening History and Neural time context now call the same period function. Existing behavior events are reclassified when the model rebuilds for 5.9.0."]}
      ]
    },
    "5.8.6":{
      summary:"HOTFIX BUILD rebalances Player spacing, artwork size, transport grouping and active range-thumb transparency.",
      sections:[
        {title:"Responsive Player Spacing",items:["The Player restores the exact internal spacing model used by 5.8.1 and earlier: larger panel padding, a 190–330 px record range and an independent metadata-to-progress gap.","Playback Mode, Previous, Play and Next return to one centered four-item control group matching the supplied reference geometry.","Artwork, metadata, progress, transport, volume and Snooze are once again vertically centered as one composition, producing naturally balanced space above and below."]},
        {title:"Transparent Accent Range Thumb",items:["The dragged thumb shrinks from 18 px to 15 px, only one pixel larger than its idle state, while preserving the current Accent hue.","Lower fill opacity and a much lighter backdrop filter allow the range track to remain visibly continuous through the glass thumb. Release still restores the solid idle Accent thumb immediately."]}
        ,{title:"Paused Turntable Seam Repair",items:["The empty turntable replaces angular conic lighting with continuous radial acrylic shading, so no diagonal bright strip can radiate from the center at any paused angle.","The tonearm's one-pixel exterior border is replaced with an internal subpixel contour, preventing Edge scaling from rasterizing its diagonal edge as a white strip while preserving its geometry and timing."]}
      ]
    },
    "5.8.5":{
      summary:"HOTFIX BUILD corrects Player vertical geometry, transport-row alignment and range-thumb interaction state.",
      sections:[
        {title:"Player Geometry Correction",items:["Artwork is moved visibly lower inside the left Player sector while continuing to scale from the sector's real width and height. The bottom interaction stack preserves its safe inset.","Previous, Play and Next now form the genuinely centered transport axis. Playback Mode is independently positioned, so its label can no longer shift the whole row vertically or horizontally."]},
        {title:"Range Thumb State Repair",items:["The idle state returns to a clear solid Accent thumb. A translucent glass thumb retaining the same Accent hue exists only while the pointer is held and dragging.","Pointer release, cancellation, release outside the control and blur all remove the temporary glass layer immediately, preventing a stale selected state after the pointer moves away."]}
      ]
    },
    "5.8.4":{
      summary:"HOTFIX BUILD rebuilds the progress-side spectrum meter, selected range material and Player space distribution.",
      sections:[
        {title:"Pixel-Exact Spectrum Meter",items:["Four independent 2.5 px CSS bars are replaced by one high-DPI Canvas. Integer backing-store geometry is recalculated from the real displayed size and devicePixelRatio.","Every page-fit scale, Edge zoom and DPI combination therefore shares one exact integer bar width and gap. Resize redraws the centered meter while the existing four-band loudness analysis remains unchanged."]},
        {title:"Persistent Range Glass",items:["Duration, Font Size and Font Weight retain the real glass overlay while focused or dragged instead of revealing a black Accent thumb immediately after pointer release.","The unfocused native thumb also receives a translucent gradient, restrained border and shadow, remaining legible on dark surfaces without becoming an opaque black disc."]},
        {title:"Responsive Player Rebalance",items:["Progress, transport, volume and Snooze form a bottom-anchored interaction stack, returning the upper area to artwork and track information.","Record and Static Cover size from the left sector's own width, height and remaining control space. They expand in full screen, shrink proportionally in narrow or short windows, remain square and preserve frame clearance."]}
      ]
    },
    "5.8.3":{
      summary:"HOTFIX BUILD repairs Player surface composition, active range glass and every lifecycle path of the long-title marquee.",
      sections:[
        {title:"Player Surface Repair",items:["Independent exterior shadows are removed from the two adjacent Player glass sectors. Their inner borders remain, while the center gap and four outer corners no longer receive a background-mismatched double shadow.","Player geometry, surface transparency, radii, accent behavior and internal content remain unchanged."]},
        {title:"Range Glass Foundation",items:["Duration, Font Size and Font Weight hide every part of the native solid thumb while dragging, including its fill, border, shadow and active scale. A separate overlay is now the only visible thumb.","Light and Dark modes receive explicit low-alpha surfaces, restrained borders and a 9 px backdrop blur. Range glass remains intentionally separate from popover glass."]},
        {title:"Deterministic Title Marquee",items:["Every new selection shows the title start and holds briefly. Only a measured overflow builds the duplicate track; every moving frame uses one constant perceived speed adjusted for the current responsive page scale.","An 88 px copy gap and a shared 14 px start/end inset make one full cycle geometrically identical. Measurement and transform distance now share pre-zoom CSS coordinates, eliminating compact-window under-travel, forward snaps and displaced endpoints.","Selection, first-import long titles, font readiness, Player entry and resize each create a new measurement revision. Stale animation is cancelled and hidden layouts retry instead of silently losing the marquee."]}
      ]
    },
    "5.8.2":{
      summary:"HOTFIX BUILD closes the geometry, motion and text-raster regressions discovered after 5.8.1.",
      sections:[
        {title:"Player Geometry & Queue",items:["The Player now uses genuinely shrinkable columns. Long titles, Queue content and the right panel can no longer widen the complete Player beyond its border.","Default Queue rows remain mounted while playback advances; only playing state and scroll position change, preventing a full DOM rebuild and right-border twitch.","Record and Static Cover sizing now considers both available width and height, preserving border clearance in a resized Edge window. Segment gliders remeasure after container, zoom or font changes."]},
        {title:"Motion & Typography",items:["Page, panel, Queue, EQ, play-mode and popover fades are proportionally shorter while retaining every original phase and easing path.","Artificial text strokes and forced whole-panel GPU bitmap layers are removed. Device-pixel-aware fit steps keep Edge glyph rasterization stable at fractional window scales.","The title marquee starts and ends at the same inset, inserts a clean blank gap, completes one full loop and decelerates smoothly before its hold."]},
        {title:"Glass Controls",items:["Font Picker is promoted to the page-level glass layer so Snooze surface, blur, border and shadow are reproduced without nested-panel composition.","Range thumbs use a separate, more transparent glass material instead of the denser popover surface. The live four-band display is rebuilt as an equal-width, equal-gap grid."]}
      ]
    },
    "5.8.1":{
      summary:"HOTFIX BUILD repairs the visual and interaction regressions found after FINAL PANTHER REFORM.",
      sections:[
        {title:"Motion Timing Repair",items:["Primary pages, Player panels, Listening History and Changelog now fully fade out, expose the real background for a short beat, then fade the destination in.","Queue / Sound / Daily Mix selection responds on the first click and commits only the latest requested tab, removing the one-step-behind bug.","EQ selection now animates its actual selected material out, holds the background briefly and animates the new material in."]},
        {title:"Playback Motion Repair",items:["Daily Mix Play shrinks before expanding with a foggy triangular pulse. Sidebar Play adds the same anticipation while retaining its existing circle and triangle effects.","Record deceleration and needle return share one 720 ms start and finish boundary, removing asymptotic stopping and the final needle twitch.","Previous and Next respond over 300 ms with earlier anticipation and impact; the four live frequency bars use corrected visual spacing."]},
        {title:"Typography & Glass Controls",items:["Titles scroll only when their natural width truly exceeds the available space. Overflowing titles use two identical copies for a faster seamless loop that pauses only after the second copy reaches the exact starting position.","Font Picker forcefully reuses the same surface, blur, border and shadow variables as Snooze and Sort.","Progress and Settings ranges replace the active native thumb with a real floating Snooze-material glass dot. The empty turntable removes the music-note symbol and keeps only the glass spindle."]}
      ]
    },
    "5.8.0":{
      summary:"FINAL PANTHER REFORM introduces GP Motion Engine 3.1 and closes the Panther cycle with faster transitions, stable Queue identity and more physical playback motion.",
      sections:[
        {title:"GP Motion Engine 3.1 — Overlap Bridge",items:["Sidebar pages, Player panels, Listening History, Changelog and EQ now share an opacity-only overlap bridge. The destination begins entering near the end of the outgoing fade, removing the old dead interval without changing settled geometry.","Clearing Queue uses the same bridge and commits directly at the current track instead of visibly scrolling down from the top.","Play-mode and EQ state changes share the overlapping fade rhythm; the Font picker now uses the standard Snooze glass popover material."]},
        {title:"Queue & Playback Reliability",items:["Queue rejects duplicate audio through Spectrum ID and stable audio identity, and reports that the song is already in the queue.","Sequential, Shuffle and Repeat One remain Accent-aware. Clearing a manual Queue immediately restores Library Order around the current track.","The rotating record now decelerates physically and preserves its angle without a backward twitch. Long titles use a measured marquee pass with a pause before repeating."]},
        {title:"Control & Settings Polish",items:["Previous and Next react on pointer-down: each triangle anticipates away from the bar, rebounds into it and returns with a restrained echo. The four live frequency bars are evenly spaced.","Daily Mix animates only its Play triangle while the label remains still. Static Cover is slightly larger and lifted toward the record center.","Settings toggles support click or horizontal drag. Range thumbs are centered and use the selection-glass treatment while active. The product logo can render outside its SVG box without bottom clipping."]}
      ]
    },
    "5.7.0":{
      summary:"FOUNDATION UPDATE introduces GP Core 2.2 and GP Motion Engine 3.0, turning proven interface behavior into declarative, composable UI infrastructure without changing the current product surface.",
      sections:[
        {title:"GP Core 2.2 — Declarative UI Registry",items:["GP.ui now exposes register, mount, refresh and observe lifecycles. Each component mounts exactly once, preventing duplicate listeners and observers.","A frame-batched MutationObserver discovers dynamically appended views and controls. Known class and data contracts replace the need to extend fixed ID arrays for every future page.","Public switchView, transitionSector and setPopover entry points expose the proven lifecycle while preserving Galaxy, Timeline and the existing playback boundary."]},
        {title:"GP Motion Engine 3.0 — Class-composed Motion",items:["gp-sse and data-gp-sse automatically receive Harmonic Reform shell/viewport preparation, endpoint detection, ResizeObserver and content remeasurement.","gp-segmented and data-gp-glider receive the shared selector; gp-action receives held press feedback; gp-popover receives the Snooze glass material and motion lifecycle.","gp-adaptive-title and gp-context-control provide direct-surface readability for future views. Primary and sector transitions remain opacity-only, preserving final geometry."]},
        {title:"Zero-regression Compatibility",items:["Player, Library, Queue, Sound, Listening History, Settings, Changelog, themes and responsive layout retain the 5.6.3 markup and visual values while the registry assumes initialization duties.","Spectrum ID still runs immediately during import. MFCC, BPM, Energy and Loudness remain cache-first background analysis stored in IndexedDB; recognition, recommendation and playback logic are unchanged."]}
      ]
    },
    "5.6.3":{
      summary:"HOTFIX BUILD commits page geometry before a pure-opacity transition and makes each Daily Mix acoustically coherent before personalization is applied.",
      sections:[
        {title:"Stable View Commit",items:["Primary pages and switchable sectors animate opacity only; transform, scale, zoom and text raster positions remain fixed.","The destination commits height and selector geometry while invisible, then uses animationend for the real lifecycle boundary instead of guessing the settle moment with a timer."]},
        {title:"Feature-clustered Daily Mix",items:["A single feature-rich Spectrum ID becomes the mix anchor. Genre and MFCC dominate similarity, while BPM, Energy and mature user preference refine ordering.","Known cross-Genre tracks are rejected unless MFCC supplies unusually strong acoustic evidence, preventing unrelated Electronic and singer-songwriter Pop from alternating.","Import generates the mix automatically and completed background Spectrum analysis refreshes it. The Generate button and row numbers are removed; Play becomes a triangle plus label."]},
        {title:"Queue Interaction Repair",items:["Adding a track clears residual pressed, glow and focus states from Library actions.","The Queue bars rebound to 5 degrees, and the drag ghost reuses the exact Snooze popover surface, blur, border and shadow material."]}
      ]
    },
    "5.6.2":{
      summary:"HOTFIX BUILD rebuilds theme round trips around canonical Accent sources and polishes direct-surface contrast, stable entry motion and contextual controls.",
      sections:[
        {title:"Theme-safe Accent Pairing",items:["Every manual palette now has a darker Light-theme Accent and a lighter Dark-theme Accent while retaining the same hue identity.","Adaptive cover color always starts from an untouched per-track palette. It never reprocesses the previous theme's output or samples the body's 500 ms transition frame.","Auto uses Light from 05:00 to 18:00 and Dark from 18:00 to 05:00, switching again at the next boundary without reloading."]},
        {title:"Direct Surface Readability",items:["Each primary page title evaluates the cover-derived surface at its own screen position and independently selects black or white.","Daily Mix, import, sort and Changelog controls receive only a restrained surface tint derived from their local background."]},
        {title:"Motion & Live Spectrum",items:["Primary destinations commit their final layout before the left fade begins, eliminating the last-frame page twitch.","The four progress-side bars now represent live low, low-mid, upper-mid and high-frequency loudness; rendering sleeps while playback or the document is inactive.","Library and Daily Mix remove the delete control. Next, Add to Queue, manual Queue Remove and the drag-order handle receive delayed-hover and click micro-interactions."]}
      ]
    },
    "5.6.1":{
      summary:"HOTFIX BUILD repairs theme-safe accent commits and the turntable composition timeline while reducing rotating-layer GPU sampling.",
      sections:[
        {title:"Theme-safe Adaptive Accent",items:["One commit path now updates --accent, --accent-rgb, --accent-contrast and the derived turntable color together.","The last cover palette is cached per track. A theme change immediately recalculates from that palette against the new background, while one generation-checked async request verifies the result; stale theme work cannot overwrite it.","Manual and adaptive colors both recompute the black/white foreground contrast instead of inheriting the previous theme's value."]},
        {title:"Stable Turntable Composition",items:["A persistent 14-second CSS timeline owns record rotation. View switches, theme changes and pause/resume only change its play state, preserving the exact angle.","The record, spindle and reader share one stable derived accent RGB and receive one atomic color update, removing the intermediate bright flash.","Live backdrop sampling is removed from the rotating spindle and reader base while the existing gradients, transparency and shadows remain, preventing per-frame resampling of the 4K background."]}
      ]
    },
    "5.6.0":{
      summary:"PANTHER UPDATE introduces GP Motion Engine 2.4 and GP Fusion Engine 1.1 across adaptive visuals, navigation history, drag motion and feedback.",
      sections:[
        {title:"Adaptive Glass & Contrast",items:["Light-mode toolbar controls lose the accidental white inner stroke; Changelog actions now share one font size and 32 px height.","Recent Favorites preserves the live accent hue and adjusts only its lightness against the composited card tone. Card borders no longer produce side strips or a false shadow between sectors.","Primary view titles choose black or white from the live cover/background tone, while generation tokens prevent stale cover-accent calculations from surviving a rapid theme round trip.","The Disk Reader pivot uses a stable accent-acrylic layer that no longer flashes white during view transitions."]},
        {title:"GP Motion Engine 2.4",items:["Previous and Next use a 600 ms directional sequence with a short anticipation, smooth impact and restrained echo.","Queue rows make room only while dragging. On release, the dragged card lands directly in place; the full list no longer performs a second crossing animation and the source leaves no shadow.","Library and Queue remove controls share the existing action shader and report removal or clearing through notifications."]},
        {title:"GP Fusion Engine 1.1",items:["Shuffle retains a bounded 21-position timeline, preserving up to 20 previous songs. Previous walks backward; Next after a rewind walks forward through the same random path before generating a new choice.","Notifications form a concurrent FIFO visual stack: new messages enter from the right at the bottom, older messages rise, and an accent progress line reports remaining lifetime before a rightward exit.","Notification lifetime is independent from Queue insertion, so rapid additions never wait for an earlier message to finish."]}
      ]
    },
    "5.5.9":{
      summary:"HOTFIX BUILD improves light-mode contrast, makes semantic motion calmer and repairs Queue insertion and cleanup state.",
      sections:[
        {title:"Light Mode Contrast",items:["Add Files, Add Folder, Sort, the Listening History mode bar, Export Log and Current Version receive a whiter but still translucent surface in light mode.","Recent Favorites estimates each card tone from the active backdrop palette, glass composite and accent tint, then selects black or white answer text by the higher contrast ratio.","Adaptive cover accent now caps OKLab lightness and chroma and evaluates readability against its own translucent selection surface, preventing pale or overly conspicuous selected text in light mode."]},
        {title:"Motion Refinement",items:["Snooze shortens the three Z trajectories and changes their final direction from 30 degrees to a gentler 15 degrees right of vertical, with less lateral jitter while remaining inside the button.","Previous and Next no longer animate on hover. Their 300 ms click motion reaches maximum travel and reverses immediately; the echo fades over a much shorter distance and finishes within the first 68 percent.","Every pressable control now holds the feedback animation at its midpoint for as long as the pointer remains down. Release or cancellation completes the return and fade instead of allowing feedback to finish while held."]},
        {title:"Queue Reliability",items:["Add to Queue now permits multiple independent occurrences of the same track. Play Next preserves its existing behavior and moves an already queued track to the front.","Removing the final queued item, clearing Queue or removing the final related library item also releases playingQueuedTrack and queueResumeIndex, so Next immediately follows the active playback mode rather than a cleared Queue context."]}
      ]
    },
    "5.5.8":{
      summary:"HOTFIX BUILD adds semantic Snooze and Skip motion and standardizes Snooze and Library Sort on one reusable Motion Engine popover material.",
      sections:[
        {title:"Snooze & Skip Micro-interactions",items:["Snooze now runs a 400 ms clock sway with three staggered Z marks that follow an S-shaped path and fade about 30 degrees toward the upper right. Hover waits 300 ms; click replays immediately. The English product label is now Snooze instead of Sleep Timer.","Previous and Next receive 400 ms directional motion. The outer bar springs outward and returns along the same path while a restrained echo remains at maximum travel and fades farther in that direction."]},
        {title:"GP Motion Engine — Shared Popover Material",items:["Snooze and Library Sort now use the same gp-motion-popover primitive, translucent material and exit cleanup lifecycle, giving future popovers a reusable baseline.","The surface is mixed from the current glass and page background instead of a strong white glass layer, reducing whitening while retaining an 8 px contextual blur."]}
      ]
    },
    "5.5.7":{
      summary:"HOTFIX BUILD introduces GP Motion Engine 2.3 and moves stable fade transitions into a reusable bottom-level sector lifecycle.",
      sections:[
        {title:"GP Motion Engine 2.3 — Unified Sector Lifecycle",items:["Primary views and switchable sectors now share exit, commit, enter and stable-settle phases, so future pages inherit the anti-twitch behavior automatically.","Entry reaches its final geometry at 88 percent and holds it through completion. The composited layer remains for one additional paint after the animation class is removed, eliminating terminal pops and overshoot.","Rapid input is arbitrated through the shared controller instead of cancelling opacity or transform layers midway."]},
        {title:"Changelog & Listening History",items:["Changelog version details now fade out before their content is replaced and fade back in only after the new release is ready.","Listening Time, Recent Favorites and Listening Data use the same sector transition. Statistics and SSE refresh only after the requested pane becomes active."]},
        {title:"Sleep Timer",items:["The Sleep Timer enters from below and closes along the reverse vertical path instead of arriving from the left.","Backdrop blur is rebalanced from 10 px and 118 percent saturation to 6 px and 110 percent, midway between the earlier transparent surface and the over-blurred revision."]}
      ]
    },
    "5.5.6":{
      summary:"STABALIZATION RELEASE introduces GP Motion Engine 2.2 and embeds complete primary-view transitions into the Harmonic Lake lifecycle.",
      sections:[
        {title:"GP Motion Engine 2.2 — Primary View Lifecycle",items:["Play, Library, Listening History, Settings and Changelog now share one bottom-level Primary View controller instead of switching display directly inside sidebar handlers.","The complete current view fades out over 130 ms to 99.7 percent scale; the destination enters over 280 ms from transparency, 99.4 percent scale and a 3 px vertical offset.","Only opacity and transform are composited. Large glass panels are not blurred, SSE shells remain stationary and internal controls are not animated individually."]},
        {title:"Stable Transition Arbitration",items:["Rapid clicks during exit coalesce to the latest destination. A request during entry waits for the current settle and then continues automatically, preventing interrupted-layer flashes.","Clicking the active navigation item can replay its icon motion but never rerenders or re-enters the current view.","Viewport fitting, selector alignment and SSE refresh run only after a real destination becomes active; Listening History schedules statistics only when it is the final target."]},
        {title:"Rendering Contract",items:["will-change exists only during the 410 ms lifecycle and is released with the transition class, so hidden views do not retain GPU layers.","Reduced Motion switches immediately while preserving the same layout and data refresh path.","Runtime identity advances to GP Motion Engine 2.2 without changing playback, Queue, SSE, themes, metadata cache or listening-history storage."]}
      ]
    },
    "5.5.5":{
      summary:"HOTFIX BUILD removes browser-native focus artifacts and polishes Play motion and Sleep Timer glass.",
      sections:[
        {title:"Focus Ring Removal",items:["All :focus and :focus-visible states suppress Edge's native outline, so mouse, keyboard, F10 media control and retained focus can never produce the black ring.","Browser tap highlight is disabled for buttons, inputs, selects, links and tabindex elements.","Glass Player active states, accent feedback, selectors and click motion remain unchanged."]},
        {title:"Rounded Play Haze",items:["The enlarged Play ring previously exceeded its 24 by 24 SVG viewport and was clipped at four rectangular edges.","Sidebar SVG overflow is now visible, allowing the circular and triangular haze to expand without square corner cuts.","The 600 ms mirrored return, three-times triangle area and static Play artwork remain unchanged."]},
        {title:"Sleep Timer Glass",items:["The Sleep Timer menu uses the stronger glass surface with a restrained 10 px backdrop blur and 118 percent saturation.","The background is less transparent without introducing a heavy fog layer or changing menu interaction."]}
      ]
    },
    "5.5.4":{
      summary:"HOTFIX BUILD repairs ID3 terminator handling and cached metadata refresh while recalibrating GP Motion Engine 2.1 timing.",
      sections:[
        {title:"Metadata Terminator Repair",items:["Trailing NUL bytes in ID3 text frames are now removed as field terminators instead of being converted to a visible slash. This covers the affected Where Did U Go and selected Mao Buyi, Joker Xue and Khalil Fong MP3 files.","Only NUL bytes inside a value remain multi-value separators. Genuine multiple FLAC ARTIST fields continue to display as Artist A / Artist B.","Title, Artist, Album, Date and Genre share the same trailing-separator cleanup before entering the library or IndexedDB."]},
        {title:"Rescan & History Synchronization",items:["Rescan All Songs rereads the current files and overwrites slash-tainted cached metadata with the cleaned Title, Artist and Album.","Spectrum ID, MFCC, Energy, BPM, technical data, play counts and listening time remain unchanged; current display metadata is synchronized to existing history through Spectrum ID.","Old slash-tainted strings remain only as identity aliases for safe history reconnection and are no longer shown as current metadata."]},
        {title:"Motion Timing Calibration",items:["Play and Library use 600 ms; Listening History axes and line use 400 ms; Settings and Changelog remain at 500 ms.","Hover dwell changes from 400 ms to 300 ms, cancels on pointer exit and remains immediate on click.","The shared run state clears at 620 ms so the longest animation retains its final frame."]}
      ]
    },
    "5.5.3":{
      summary:"HOTFIX BUILD refines GP Motion Engine 2.1 with consistent 500 ms icon timing, stable vector rendering and faster, more reliable panel interaction.",
      sections:[
        {title:"500 ms Motion System",items:["Play, Library, Listening Data, Settings and Changelog now use one 500 ms timeline each, with the run state cleared at 520 ms so the final frame is never clipped.","Sidebar hover motion now requires a 400 ms dwell and is cancelled on pointer exit; clicks remain immediate and clear the pending hover timer.","Play expands from 0–50% and follows mirrored keyframes back from 50–100%, eliminating the jump from maximum size to rest.","A restrained blur and current-color shadow give both triangle and outer-ring pulses a soft haze while the static icon remains sharp."]},
        {title:"Stable SVG Stroke",items:["Library and Settings lock their animated strokes to 1.8 px with non-scaling-stroke and geometric precision, preventing a thick animated line from flashing thin at completion.","Listening Data axes and the existing chart trajectory all finish in 500 ms; the y-axis retains its flicker-free dash trace.","The first Changelog text line reveals a short lead segment before continuing, and the second line follows behind within the same 500 ms document timeline."]},
        {title:"Listening History Responsiveness",items:["The top mode control remains fit-content and left-aligned after responsive zoom instead of filling the page width.","Identity-to-history metadata reconciliation now runs after import or manual rescan, not on every history-tab click.","A click updates the selected button and pane first, then schedules rankings, charts and insights two paint frames later. Rapid clicks cancel stale pending renders."]},
        {title:"Media Key Reliability",items:["When Edge supports Media Session, F10 playback and pause are handled only by the system Media Session path instead of being processed by both keydown and the media event.","One physical press can no longer toggle on both press and release, fixing the pause-to-play-to-pause double action. The keyboard media-key path remains only as a fallback for browsers without Media Session."]},
        {title:"Panel & Build Card Polish",items:["The Settings product card now uses one opaque live-accent perimeter above every glass highlight, so its left, right, top and bottom edges keep exactly the same accent colour.","Queue, Sound and Daily Mix end on the same persistent translate3d layer and hold their final state through the last 12% of entry motion, removing the terminal twitch."]}
      ]
    },
    "5.5.2":{
      summary:"HOTFIX BUILD replaces the unreliable hover-and-clone trigger path with repeatable CSS keyframes and corrects the visibility, geometry and timing of sidebar icon motion.",
      sections:[
        {title:"Reliable Motion Trigger",items:["The 5.5.1 combination of hover state and SVG cloning is removed. A single icon-motion-run state restarts pure CSS keyframes without requiring the SVG Web Animations API.","Pointer enter and click both remove, commit and reapply the run state, even while the pointer remains over the button. Static SVG artwork stays in the DOM and returns exactly after completion."]},
        {title:"Play Pulse Visibility & Area",items:["The Play pulse uses a clearly visible 2.6 px rounded triangle outline while the original static triangle remains visible throughout. A restrained circular pulse now expands outside the static outer ring at the same time.","Its maximum area is three times the source triangle. The correct linear scale is √3, or 1.73205081, rather than scale(3).","The Play sequence runs for 800 ms, including appearance, expansion, a short hold and complete fade-out."]},
        {title:"Listening Data Trace",items:["Both axes start together and finish in 800 ms. The chart line starts at the same moment and traces the existing M7 15 → L11 11 → L14 14 → L19 8 path over 1000 ms.","The y-axis now draws through an 18-unit stroke dash rather than a composited scale transform, preventing the final-frame flash when the animation layer is released."]},
        {title:"Final Timing",items:["Play and Settings each run for 800 ms. Library and Changelog each run for 500 ms while retaining their internal draw and unfold order."]},
        {title:"Fn / Media Key Separation",items:["Browsers do not expose Fn as a detectable modifier, so Fn+F11 reaches the page as ordinary F11 and cannot be distinguished reliably.","Raw F9, F10 and F11 interception plus fullscreen Keyboard Lock are removed. Fn+F11 now remains available to Edge fullscreen.","Glass Player responds only to true MediaTrackPrevious, MediaPlayPause and MediaTrackNext events while retaining Media Session transport controls."]}
      ]
    },
    "5.5.1":{
      summary:"HOTFIX BUILD restores the classic Glass Player product icon and corrects the duration and geometry of GP Motion Engine 2.1 sidebar interactions.",
      sections:[
        {title:"Product Icon Rollback",items:["The sidebar brand, Settings product card and browser tab all return to the classic three-bar circular icon from 5.4.1.","The circle continues to follow the live accent color and the three bars use accent contrast. The single-line note introduced in 5.5.0 is no longer displayed as the product mark."]},
        {title:"800 ms Motion Timing",items:["Play, Library note, Listening Data, Settings gear and Changelog document now each complete their full sequence in exactly 800 ms.","Sequenced note and document sub-actions retain their intended order while their final sub-action aligns precisely with the 800 ms endpoint."]},
        {title:"Geometry & Trace Corrections",items:["The Play pulse reaches exactly twice the source triangle area. Because area scales with the square of linear size, the correct linear scale is √2, or 1.41421356.","The Listening Data line traces the existing M7 15 → L11 11 → L14 14 → L19 8 path rather than substituting another trajectory.","Both axes and the chart line start together at 0 ms and finish together at 800 ms, making trace time exactly equal to axis-extension time."]}
      ]
    },
    "5.5.0":{
      summary:"UI UPDATE introduces GP Motion Engine 2.1: a new dynamic music-note identity, five meaning-driven sidebar micro-interactions and a clearer Queue position for Now Playing beyond the SSE fade.",
      sections:[
        {title:"New Glass Player Identity",items:["The former three-bar mark is replaced in the sidebar, Settings product card and browser tab by the new single-line music-note identity.","The note remains inside a complete circular carrier. Its background follows the live accent color and the note uses the calculated accent contrast across light, dark and cover-matched themes.","Native SVG geometry preserves sharp 4K rendering without bitmap backgrounds, network assets or expensive filters."]},
        {title:"GP Motion Engine 2.1 — Semantic Icon Motion",items:["Play emits a restrained triangular pulse to approximately 1.618 times the source triangle before returning within 440 ms.","Library draws its resonance circle, connecting stem and upper note in sequence; Listening History grows both axes from the origin while revealing its data line.","Settings rotates only the outer gear while its center remains stationary; Changelog unfolds from the upper-left and writes both document lines during the final quarter.","Hover and click trigger every sequence. Pointer exit and completion return to the exact original static SVG, and Reduce Motion is respected."]},
        {title:"Queue Now Playing Clearance",items:["Library Order and original track numbers remain unchanged, as do Manual Queue and drag behavior.","Auto-positioning now reserves more than two complete track rows above Now Playing, moving the active item beyond the strongest SSE region while keeping its artwork, metadata and controls fully visible.","Tracks near the beginning still clamp safely to scrollTop 0 without artificial empty space."]}
      ]
    },
    "5.4.1":{
      summary:"HOTFIX BUILD fixes Queue auto-positioning so Now Playing no longer occupies the first row under the top SSE. It also records the Gen 6–8 Time Machine, Music Galaxy and galaxy-aware recommendation roadmap and postpones Electron Lake to Gen 9+.",
      sections:[
        {title:"Queue Now Playing Visibility",items:["Default Library Order preserves the original playlist order and position numbers; no track data is moved or reordered.","Auto-positioning reserves one complete row plus 6 px above Now Playing. The previous track may enter the SSE fade while the active row rests in the second visible position and remains fully readable.","The first library track still clamps safely to scrollTop 0. Manual Queue ordering, drag behavior, queue priority and click-to-play are unchanged."]},
        {title:"Unreleased Roadmap Revision",items:["Gen 6 plans a horizontally draggable Time Machine driven by metadata Year, Artist and Album.","Gen 7 plans Music Galaxy using MFCC, BPM, Genre distance, 2D coordinates, Canvas/WebGL rendering, cluster labels and low-cost hover behavior.","Gen 8 plans galaxy-cached MFCC + BPM improvements for Shuffle and Daily Mix while preserving freshness, diversity and randomness.","Electron Lake, SQLite and EXE migration move from Gen 5+ to Gen 9+."]}
      ]
    },
    "5.4.0":{
      summary:"HARMONIC REFORM introduces GP Core 2.1 and GP Motion Engine 2.0. The Soft Scroll Edge subsystem is redesigned around stationary panel surfaces and moving transparent viewports instead of patching the 5.3.10 overlay architecture.",
      sections:[
        {title:"Architecture Reset",items:["All SSE implementations from 5.3.3 through 5.3.10 are physically removed: sticky pseudo-elements, body-level fixed frames, edge caps, getBoundingClientRect positioning, sampled boundary colours, content clones and backdrop-blur overlays.","5.4.0 retains player features and data logic but rebuilds scroll motion from a clean subsystem rather than appending another compatibility layer."]},
        {title:"GP Core 2.1 — Shell / Viewport Separation",items:["Every scroll surface is divided into a stationary gp-sse-shell and a transparent gp-sse-viewport. The shell exclusively owns panel background, border, radius and shadow; the viewport exclusively owns scrolling.","Listening ranking, Settings and both Changelog columns receive dedicated fixed shells, with their existing glass surface moved intact from the scrolling element to the shell.","Queue, Sound and Daily Mix reuse side-panel; Library reuses library-panel; Favorites and Listening Data reuse their history panes without creating floating frames."]},
        {title:"GP Motion Engine 2.0 — Whole-Sector Dissolve",items:["The mask processes the viewport's final rendered content, so complete song rows, EQ sections, setting groups, charts and data cards dissolve together instead of separating text from card backgrounds.","The disappearing pixels reveal the already-rendered stationary panel surface. No black, white, preset theme colour or separate blur rectangle is placed above the content.","The top edge disables at scroll start, the bottom edge disables at scroll end, both operate independently in the middle, and non-scrollable surfaces remain untouched."]},
        {title:"Frame Contact & Performance",items:["Former Library and side-panel outer spacing moves inside the viewport, allowing moving content to reach the real frame edge before dissolving.","The new system performs no per-frame geometry reads, DOM cloning or large-area backdrop filtering; ordinary scrolling updates only two boolean edge states."]}
      ]
    },
    "5.3.9":{
      summary:"HOTFIX BUILD follows Apple's official iOS 26 Liquid Glass and Scroll Edge Effect model: scrolling content dissolves into its real surface while a narrow live blur maintains separation from floating interface layers.",
      sections:[
        {title:"Apple Scroll Edge Model",items:["Apple's Scroll Edge Effect separates floating Liquid Glass interface from dynamically scrolling content. Content should gently dissolve into the background instead of meeting a solid gradient block or illuminated edge.","Queue, Sound and Listening Data now apply an alpha-dissolve mask directly to scrolling content: boundary pixels are fully transparent and recover through five stages to full opacity within 32 px.","Transparent content naturally exposes the sector's real surface, so theme, cover color, glass transparency and adjacent background no longer need to be guessed or copied by JavaScript."]},
        {title:"Variable Blur Layer",items:["Above the dissolve, a single viewport-width live backdrop pass remains. It uses an 8 px blur and 68% saturation with no white, black or theme-colored fill.","Blur and alpha mask share the same endpoint state: top disables at scroll top, bottom disables at scroll end and both run in the middle.","Queue, Sound and Listening Data each own one edge effect; the outer player panel and individual cards are no longer treated as additional SSE layers."]},
        {title:"Geometry & Media Controls",items:["The three core SSE surfaces use their own scroll viewport getBoundingClientRect geometry, keeping frame, mask and clipping boundaries identical.","Function keys retain lock-free timestamp debounce. Media Session now receives current playback state plus title, artist, album and artwork, preserving a stable system-media session."]}
      ]
    },
    "5.3.8":{
      summary:"HOTFIX BUILD rebuilds SSE around each complete scrolling viewport rather than any particular label or control, restores correct endpoint behavior and dimensions, samples the live surface immediately outside each edge, and makes playback keys continuously reusable.",
      sections:[
        {title:"Viewport-Level SSE",items:["SSE applies to complete Queue, Sound, Listening Data and other enabled scrolling viewports. Song rows, BPM, charts, labels and controls are ordinary content passing through the same boundary, with no item-specific treatment.","Queue and Sound no longer borrow the outer player panel's width or bottom position, and Listening Data uses its own scrolling rectangle, preventing frames from exceeding or entering adjacent sectors.","The top SSE disables at scroll top, the bottom SSE disables at scroll end, both appear in the middle, and neither appears when the sector cannot scroll."]},
        {title:"Boundary Surface Sampling",items:["The top samples the DOM surface two pixels above its viewport and the bottom samples two pixels below, converting the matched surface color into the opaque RGB starting point.","That start first hides clipped content, then releases through a compact live desaturated backdrop blur and finally reaches zero blur and fully clear content.","Theme, cover background and Ambient changes resample every SSE boundary; no fixed white glow or generic preset tint is used."]},
        {title:"Continuous Playback Keys",items:["The held-key set and 700 ms state lock that could become stuck after a swallowed keyup are removed in favor of a short timestamp debounce that filters only automatic repeats.","Every new F9/F10/F11 keydown independently triggers Previous, Play/Pause or Next.","Playback and pause events synchronize Media Session playbackState so operating-system media keys continue dispatching after the first action."]}
      ]
    },
    "5.3.7":{
      summary:"HOTFIX BUILD replaces the whitening SSE color overlay with direct live-boundary sampling, prevents hard clipping at the beginning and end of scrollable sectors, and repairs one-shot playback function keys.",
      sections:[
        {title:"Realtime Boundary Sampling",items:["The frame-opaque layer mixed from glass-bg-strong and bg-base is removed. That synthetic color could not match the already composited pixels on screen and caused white or incorrectly tinted edges.","SSE now uses only a nearly transparent neutral activation surface, allowing backdrop-filter to sample the live pixels directly behind each boundary.","The sampled image is reduced to 54% saturation, blurred by 15 px and given a slight contrast convergence. Cover-derived color, the active theme and the sector's current background therefore participate naturally."]},
        {title:"Persistent Soft Boundary",items:["SSE is now treated as a scroll-viewport boundary rather than a remaining-direction indicator. Both caps stay active whenever the sector is scrollable.","Reaching the first or last item no longer disables the corresponding filter, preventing text, artwork and rows from being cut by a sharp line at the rounded border.","The seven-stop alpha mask controls only live blur strength and introduces no white, black or preset theme fill."]},
        {title:"Reusable Function Keys",items:["F9/F10/F11 now run at window capture level and recognize event.code, event.key and the three Media key names.","Independent pressed/released state is cleared by keyup, window blur and page visibility changes.","A 700 ms safety release ensures the next independent press still works even when Edge or the operating system swallows a keyup event."]}
      ]
    },
    "5.3.6":{
      summary:"HOTFIX BUILD integrates SSE more tightly with Queue, Sound and Listening Data surfaces, corrects Disk Reader physics, preserves sharper glyph rendering under responsive scaling, stabilizes the Changelog selector and adds function-key playback control.",
      sections:[
        {title:"SSE Surface Integration",items:["Visible SSE depth is reduced to roughly sixty percent of the previous implementation so blur no longer consumes excessive Queue, Sound or Listening Data content space.","The outermost edge is now a fully opaque live mix of the current glass surface and background, followed by a compact transition into clear content so the effect appears to extend from the sector itself.","Blur is tuned to 13 px. Separate but synchronized multi-stop curves control occlusion, blur visibility and alpha release, increasing gradient character without a hard terminal line.","Queue and Sound remain bound to the complete side sector's true lower boundary, while Listening Data uses its complete scrolling region rather than an individual data card."]},
        {title:"Disk Reader Geometry",items:["Horizontal placement, vertical placement and transform-origin now derive from the same half-diameter used by the circular pivot base.","The arm therefore rotates through the exact center of the base instead of a displaced point below it."]},
        {title:"Typography & Changelog Fit",items:["Responsive fitting now uses Chromium layout zoom instead of scaling the entire shell as one texture, allowing glyphs to be rasterized at their displayed size and reducing rough text edges.","After every viewport fit, the main navigation, segmented controls, Changelog selector and SSE frames are measured together. A ResizeObserver also corrects the Changelog index whenever its own geometry changes."]},
        {title:"Playback Function Keys",items:["F9, F10 and F11 control Previous, Play/Pause and Next, with held-key repeats suppressed.","Fullscreen attempts to retain these keys through Keyboard Lock, while Media Session handlers expose Previous, Play, Pause and Next to supported system media controls."]}
      ]
    },
    "5.3.5":{
      summary:"HOTFIX BUILD corrects every Acrylic Edge Frame coordinate under responsive scaling and rebuilds the blur-to-clear boundary as a longer, lower-contrast transition without opaque dark blocks.",
      sections:[
        {title:"Viewport-Accurate Alignment",items:["The 5.3.4 mismatch was traced to mixed coordinate systems: getBoundingClientRect returned scaled viewport geometry while the frame was positioned inside an already scaled parent, applying the scale twice.","Every Edge Frame now lives at the page root and uses fixed viewport coordinates matching the sector's final on-screen rectangle exactly.","Border radius and edge depth are recalculated from the effective layout scale. Queue, Sound and Library use their actual outer panel geometry so the content sector and acrylic frame cannot disagree in size."]},
        {title:"Continuous Acrylic Transition",items:["The opaque dark edge tint is removed in favor of the current translucent glass surface, preventing rectangular black patches in dark themes.","Blur increases to 18 px, transition depth grows by roughly 28%, and a seven-stop alpha mask gradually releases the backdrop into fully clear content.","A separate five-stop low-contrast color veil recedes alongside blur and opacity, eliminating the previously visible line where the blurred region ended.","Frames for hidden sectors are disabled automatically, while resize, layout fitting and view changes continue to trigger geometry measurement."]}
      ]
    },
    "5.3.4":{
      summary:"HOTFIX BUILD eliminates the sidebar selector's top-origin jump and replaces the inset sticky Soft Scroll Edge with a separately clipped Acrylic Edge Frame measured from each real scroll sector.",
      sections:[
        {title:"Sidebar Navigation",items:["The main navigation selector is now a real DOM element whose position and size come directly from the active button, replacing a pseudo-element driven indirectly through reset-prone CSS custom properties.","Rapid navigation cancels the previous unfinished motion and performs a transform-only FLIP from the current selection instead of treating the top of the page as a new origin.","The restrained expansion and settle remain, while temporary compositor promotion is released when motion finishes."]},
        {title:"Acrylic Edge Frame",items:["Sticky pseudo-elements inside the scrolling content have been retired. Every target sector receives a separate absolute edge frame clipped to its true outer rectangle.","The frame reads its live rectangle, computed border radius, depth and adaptive surface tint, eliminating the visible gap between the fade and the sector outline.","A narrow 14 px Gaussian blur and multi-stop alpha mask transition continuously from an opaque boundary into fully clear content instead of ending as a black block or fixed white fog.","ResizeObserver, window resizing, view changes and Queue/Sound switching realign the frame, while frames belonging to hidden views are disabled."]}
      ]
    },
    "5.3.3":{
      summary:"HOTFIX BUILD corrects selector animation scheduling, rebuilds import progress around real work stages and replaces the floating white Soft Scroll Edge overlay with a theme-adaptive fade that grows inward from each sector's actual border.",
      sections:[
        {title:"Motion Composition",items:["Main navigation, segmented controls and the Changelog selector now animate compositor-only transforms. FLIP scaling absorbs size differences without animating left, top, width or height on every frame.","will-change is enabled only during movement and released on finish or cancellation, avoiding permanent extra compositor layers.","Waveform, Daily Mix and Listening History rendering is deferred beyond the selector's first animation frame so heavy DOM work does not compete with motion startup."]},
        {title:"Proportional Import Progress",items:["Progress now reserves 35% for audio identity, 55% for IndexedDB and song-data restoration, and 10% for committing and rendering the library.","A completed song count ends its own phase instead of implying the whole import is finished; saving and interface-update states are shown explicitly.","The importer yields paint frames between 93%, 97% and 100%, eliminating the incomplete-bar pause followed by a sudden completion jump."]},
        {title:"Border-Anchored Soft Scroll Edge",items:["The inset rounded white overlay is removed. Queue, Sound, Library, Listening History Top 50, Settings and both Changelog sectors now extend their own boundary color inward over scrolling content.","Top and bottom fades appear only when more content exists in that direction, while the initial bottom edge is available before the first scroll.","Edge tint is dynamically mixed from the current background and glass surface, remaining visible on dark neutral themes without becoming fixed white fog.","Per-sector padding offsets make the fade meet the real rounded outline and prevent content from remaining visible in a gap underneath the border."]}
      ]
    },
    "5.3.2":{
      summary:"HOTFIX BUILD introduces GP Motion Engine 1.3, eliminating continuous full-screen background motion and repeated large-surface backdrop sampling for substantially lower GPU 3D pressure at 2K and 4K. It also adds blocking staged import progress and prevents redundant refreshes when an active segmented option is clicked again.",
      sections:[
        {title:"GP Motion Engine 1.3",items:["Ambient Glow, Cover Color and Blurred Cover are now fully static. Blob wander, parent drift, background-position animation and the Cover Color JavaScript animation-frame loop have been removed.","Cover-derived color, blurred artwork, saturation and visual depth remain. Text, controls, artwork, record and borders still render at native 4K resolution with no foreground downsampling.","Only the selected background mode participates in rendering. Inactive Glow or Blurred Cover layers use display:none instead of retaining compositing layers at zero opacity.","Ambient overscan is reduced from 20–24% to 12%, enough to cover the 58 px blur boundary while reducing 4K offscreen texture area."]},
        {title:"4K Composition Path",items:["Large Glass panels no longer reapply full-size backdrop-filter over an already heavily blurred background; translucent fills, borders, shadows and hierarchy remain intact.","Main navigation, segmented selectors and the Changelog selector remove their 38 px backdrop filters while preserving color, outline and motion.","Soft scroll edges use only gradients and masks instead of continuously sampling a 15 px blurred backdrop while scrolling.","Record rotation, Disk Reader and foreground micro-interactions remain. The optimization is restricted to expensive full-screen and large-area composition."]},
        {title:"Blocking Import Progress",items:["File and folder imports immediately open the same blocking progress surface used by Rescan. It cannot be dismissed through the backdrop, Escape, cancel controls or the underlying UI while work is active.","The first half reports Spectrum ID and audio-identity recognition; the second half reports IndexedDB restoration plus metadata, artwork and duration processing.","Completion summarizes processed songs, cache hits, new records and duplicates. An interrupted import retains songs that were already completed.","Background Spectrum analysis remains queued after the playable library is committed, so MFCC, Energy and BPM do not delay first playback."]},
        {title:"Idempotent Segmented Controls",items:["Clicking an already selected Queue, Sound, Daily Mix, theme, background, cover mode, history range, language, history mode or EQ preset is now a true no-op and does not rebuild the current view.","Switching elsewhere and returning still performs the normal refresh, data load and selector motion.","This prevents redundant DOM replacement, scroll resets, repeated sound-information reads and repeated selector animation."]}
      ]
    },
    "5.3.1":{
      summary:"HOTFIX BUILD fixes Changelog vertical-glider overshoot and settling jitter, refreshes the Gen 5 product identity, centers the Repeat One badge and adds a conservative EQ for monitor speakers placed close to a wall.",
      sections:[
        {title:"Changelog Glider",items:["The Changelog selector no longer scales its visible bounds while travelling. Position and size interpolate continuously without moving past the destination row.","Motion now uses a non-overshooting 360 ms ease-out. Rapid version changes continue from the current interpolated position instead of competing through enlarge, overshoot and shrink phases.","Vertical selectors remain free of external glow; the main navigation's restrained motion is unchanged."]},
        {title:"Product Information & Repeat One",items:["Settings now identifies the product as Glass Player Gen 5 with Ver. 3.1 in English and 版本 3.1 in Chinese.","The release badge reads HOTFIX BUILD and opens the 5.3.1 release notes.","Repeat One's number badge now retains a fixed 14 px grid, explicit line height and tabular numeral centering instead of being changed to block layout at runtime."]},
        {title:"Monitor Speakers EQ",items:["Sound adds Monitor Speakers for built-in display speakers or small desktop speakers positioned close to a rear wall.","60 Hz, 150 Hz and 400 Hz are reduced by 3.5 dB, 4 dB and 2.5 dB to reduce boundary gain, cabinet resonance and muddy low mids.","The 1 kHz–15 kHz bands receive a restrained 0.5–2.5 dB lift for clearer speech, vocals and air. This affects only the live seven-band EQ and never rewrites MFCC, BPM, Energy, Spectrum ID or cached analysis.","It is a conservative model-independent starting point; Custom remains available for room- and monitor-specific adjustment."]}
      ]
    },
    "5.3.0":{
      summary:"NEURAL INTERLINK UPDATE connects local behavior capture, long-term preference, session intent, exploration evidence and recommendation scoring through GP Neural Engine 2.0 — Resonance Boost. Until the evidence gate is passed, playback remains genuinely uniform-random.",
      sections:[
        {title:"GP Neural Engine 2.0 — Resonance Boost",items:["behaviorEvents now continuously persists skips, completed plays, replays, seeks, searches, explicit library selections, queue additions, loop and Shuffle toggles, mode changes and real listened duration.","Track events carry Spectrum ID plus MFCC, BPM, Energy, Genre, Artist and Album snapshots; the current library can refresh surface metadata by the same Spectrum ID without changing acoustic identity.","Listened seconds are constrained by both media-time and wall-time progress. Periodic, pause, hidden-page and exit checkpoints exclude seeks, background pauses and abnormal jumps."]},
        {title:"Preference Is Not Recommendation",items:["The User Preference Model stores decayed Artist, Album and Genre weights, BPM and Energy centers, an MFCC centroid, time-slot tendencies, per-track evidence and last-played time.","Recommendation Score is a separate contextual layer combining long-term preference, current session intent, time match, acoustic similarity, freshness, diversity and controlled exploration.","Search selection, direct selection, queue addition and replay are strong signals; completion and real dwell are medium signals. Skip penalty is dynamic, so a five-second skip is far more negative than leaving after 90%."]},
        {title:"Evolution, Session & Exploration",items:["Long-term preference uses a 45-day half-life. Session intent decays over minutes and can temporarily favor related Artist, Album, Genre and MFCC without rewriting long-term taste.","Shuffle and recommendation discoveries remain weak evidence for the first three accepted plays and first four skips, preventing one unusual session or one rejected follow-up from changing the stable model.","The manual queue retains absolute priority and is never reordered by Neural scoring."]},
        {title:"Confidence Gate & Safe Shuffle",items:["Maturity requires at least 20 effective behavior events, five active dates and 0.56 confidence based on decayed evidence, active days and acoustic-feature coverage.","Before maturity, Shuffle and Daily Mix explicitly use uniform-random-fallback; the legacy hidden Genre/Language multiplier no longer participates.","After maturity, bounded weighted random retains chance while adding freshness and diversity. Recommendation weights stay between 0.35 and 3.4, and Daily Mix snapshots store model confidence and selection mode in IndexedDB."]},
        {title:"Motion & Listening History Fixes",items:["Main and Changelog vertical gliders, including future vertical navigation, no longer use glow or an independent stretch animation. A single size-and-position interpolation removes the end-of-motion snap.","Undated legacy totals are never fabricated as today's activity. A selected period with no reliable data shows a small No listening data for this period message and no invented top song.","Undated totals are retained as legacyUndatedSeconds but excluded from date-range rankings."]}
      ]
    },
    "5.2.0":{
      summary:"MOTION UPDATE introduces GP Motion Engine 1.2 with balanced glass-glider scale, stretch and timing, while restoring Spectrum-linked renamed-history synchronization and retaining one before/after metadata identity snapshot for every manual rescan.",
      sections:[
        {title:"GP Motion Engine 1.2",items:["The main vertical navigation glider now combines restrained horizontal scale with a subtle vertical stretch and settles naturally before arrival.","The Changelog version glider now shares the main navigation's 430 ms easing and CSS motion instead of using a faster-looking independent jump path.","Horizontal segmented gliders emphasize visible in-motion scale without stretching across the entire travel distance, smoothly interpolating toward the target width.","Navigation and Changelog resting shadows are substantially softer, and clicks leave only a gentle visible accent outline."]},
        {title:"Spectrum Identity Snapshots",items:["Every manual rescan retains exactly one before and one after metadata identity snapshot containing Title, Artist, Album, Genre, file identity and timestamp.","Snapshots do not duplicate artwork blobs, MFCC, Energy or BPM, preventing a second expensive song cache.","A matching Spectrum ID now checks filename, size, modification time and relative path. Changed surface data refreshes automatically while acoustic analysis remains cached."]},
        {title:"Renamed History Recovery",items:["History can reconnect through Spectrum ID, audioEssenceKey, legacy content keys, Artist aliases, Title aliases and the two rescan snapshots.","History merges preserve identity aliases alongside play counts and seconds; a successful match immediately uses the current title, artist, album, Genre and artwork.","Pre-Spectrum orphan records whose Title and Artist both changed are not guessed into a match, preventing incorrect personal-history merges."]},
        {title:"Resonance Boost Confidence",items:["When listening-period evidence is still insufficient, the panel shows only that it is learning your rhythm.","The stable-conclusion line remains hidden until a real period conclusion meets the activity and confidence thresholds."]},
        {title:"Compatibility",items:["The original listening-time collection, save interval and reporting behavior restored in 5.1.2 remain unchanged.","The glass record spindle, playback, queue, EQ, Spectrum analysis cache, themes and localization remain compatible."]}
      ]
    },
    "5.1.2":{
      summary:"HOTFIX BUILD completely rolls listening-time collection, period calculations, history identity and metadata refresh behavior back to the original 5.1.0 implementation. Only the approved glass-mechanical record spindle remains.",
      sections:[
        {title:"Complete History Rollback",items:["The original 5.1.0 listening delta guard, eight-second save interval, daily data structure and reporting behavior are restored unchanged.","Calendar-range rewriting, background-time changes, crossfade-tail accounting, undated legacy migration, metadataVersions, titleAliases and automatic metadata refresh from 5.1.1 are removed.","This release makes no further attempt to repair existing gray historical entries."]},
        {title:"Record Spindle",items:["The harsh black center point is replaced by the smaller approved glass-mechanical spindle.","Its translucent, flat and subtly tactile material matches the Disk Reader while remaining visible without dominating the artwork."]},
        {title:"Safety",items:["5.1.2 is rebuilt directly from the original 5.1.0 file rather than partially deleting code from 5.1.1.","Playback, Spectrum analysis, IndexedDB, queue, EQ, themes and the 5.1.0 user-data format remain unchanged."]}
      ]
    },
    "5.1.1":{
      summary:"SPECTRUM ID PATCH (withdrawn) attempted listening-history and renamed-track recovery changes. Its implementation was fully removed in 5.1.2 after existing weekly totals regressed.",
      sections:[{title:"Withdrawn",items:["The timing, calendar ranges, two-generation metadata snapshots and history recovery changes are no longer active features.","5.1.2 preserves this entry only to document why the release was rolled back."]}]
    },
    "5.1.0":{
      summary:"HOTFIX BUILD replaces the opaque white edge overlay with a background-adaptive graduated blur, restores renamed tracks and artwork through stable identity migration, and rebuilds the personal report around a true 2 × 2 favorites matrix, a compact ten-day chart and multiple evidence-based insights.",
      sections:[
        {title:"Adaptive Soft Scroll Edge",items:["Removed the strong glass fill that produced a white rectangular veil. Transparent backdrop blur, a graduated mask and a low-strength contextual tint now dissolve content into its own surface.","The effect spans the complete width of grid-based history dashboards, fixing the missing fade on the right half.","Queue, Sound, Library, Listening History, Settings and both Changelog surfaces use container-matched curvature and activate only after scrolling when content remains in that direction."]},
        {title:"Identity-safe Listening History",items:["History reconciliation now follows Spectrum ID, audioEssenceKey, legacy content keys, embedded identity records, artist aliases and filename-derived titles instead of relying only on the current Artist + Title string.","Before a metadata rescan changes visible tags, any legacy history key is bound to the stable Spectrum ID; the completed scan then updates Title, Artist, Album and Genre without losing listening time.","Artwork recovery uses the same identity resolver, eliminating stale gray covers when the imported file is still available."]},
        {title:"Recent Favorites & Listening Data",items:["Favorite Song, Artist, Album and Genre now form a true 2 × 2 matrix, while Listening Rhythm lives in a separate summary strip.","Favorite answers use larger responsive typography with safe wrapping for long titles.","The line chart now covers ten days, preserves its aspect ratio so axis labels remain readable, and uses a shorter visual height.","Resonance Boost selects the shortest reliable 4, 6, 8, 12 or 16-week evidence window and produces up to five grounded observations across artists, albums, songs, listening-time movement and active weekdays."]}
      ]
    },
    "5.0.0":{
      summary:"NEURAL UPDATE formally introduces GP Neural Engine 1.0 — Resonance Boost, connecting stable track identity, queue context and private listening behavior into Glass Player's first personal insight layer, while iOS 26-inspired soft glass edges refine every major scroll surface.",
      sections:[
        {title:"GP Neural Engine 1.0 — Resonance Boost",items:["Resonance Boost uses Spectrum ID for identity and locally aggregates daily listening time, plays, current metadata and time-of-day distribution.","Recent Favorites summarizes song, artist, album, Genre and listening period. It expands its observation window when evidence is sparse and stays in a learning state if confidence remains insufficient.","Listening Data adds a seven-day listening line, five weekly favorite-artist bars, twelve monthly favorite-artist bars and a readable eight-week insight."]},
        {title:"Liquid Scroll Edges",items:["Queue, Sound, Library, Listening History, Settings and both Changelog modules now use a soft scroll edge effect.","The resting state remains clean. Once scrolling begins, content dissolves through graduated blur and opacity instead of being cut by a hard boundary.","Each edge activates only when more content exists in that direction, avoiding decorative or stacked blur."]},
        {title:"Queue Intelligence",items:["The default queue preserves the real fixed order from track 1 to the end; the current track is no longer rotated into the first row.","Track changes position the current row just below the soft edge while leaving a partially obscured previous row for context.","When Shuffle is active, a newly imported library receives a random starting point instead of always selecting track 1."]},
        {title:"Listening History Identity",items:["A metadata rescan immediately synchronizes historical Title and Artist by Spectrum ID.","History artwork also resolves by Spectrum ID, so superficial metadata edits no longer produce gray covers.","Today, week, month and year ranges now show a green upward or red downward comparison against the preceding equivalent period."]},
        {title:"Performance Contract",items:["Reports aggregate existing local listening seconds without decoding audio or rerunning MFCC, Energy or BPM.","Charts use lightweight SVG and reveal detailed values only on hover; time-of-day evidence is recorded incrementally during normal playback.","IndexedDB analysis cache, Spectrum ID, queue priority, drag behavior, EQ, themes and playback remain compatible."]}
      ]
    },
    "4.4.2":{
      summary:"HOTFIX BUILD adds a full-library current-data rescan. Fresh file metadata replaces stale IndexedDB values under the same Spectrum ID, with clear confirmation, progress and completion dialogs and zero loss of acoustic analysis or listening history.",
      sections:[
        {title:"Added",items:[
          "Settings now includes Rescan All Songs for a controlled refresh of the currently imported library.",
          "A confirmation dialog explains the exact scope, live progress reports completed songs, and the result dialog lists scans, updates, real-Genre matches and failures.",
          "The rescan reads Title, Artist, Album, date and one or more Genre values from MP3 ID3 and FLAC Vorbis Comment metadata."
        ]},
        {title:"Changed",items:[
          "Filename, Title, Artist, Album, date, Genre, duration, artwork, thumbnail, file size and modification time are merged back into the existing track cache.",
          "A real file Genre replaces the visible spectrum-inference result. Files without Genre continue using their existing cached Spectrum inference without decoding again.",
          "Artist changes append to artistAliases under the same Spectrum ID; current genreIds follows the file Genre while canonicalArtistId is preserved."
        ]},
        {title:"Preserved",items:[
          "Spectrum ID, audioEssenceKey, all three audio anchors, FLAC PCM MD5 and legacyContentKeys remain unchanged.",
          "MFCC, Energy, Loudness, BPM, sample rate, channels, waveform, mood, recommendation data and listening history are neither deleted nor recomputed.",
          "At most two songs are scanned concurrently and the library UI commits one consolidated refresh when the batch finishes."
        ]},
        {title:"Fixed",items:[
          "Fixed stale IndexedDB metadata permanently masking a newly edited Genre, Artist or artwork when the same audio matched an existing Spectrum ID.",
          "Changing a folder path, filename or file tags can now be reflected without creating a second song identity or discarding its learned data."
        ]}
      ]
    },
    "4.4.1":{
      summary:"SPECTRUM ID UPDATE formalizes the audio-essence system as GP Spectrum ID 1.0, makes recovery more conservative, reserves stable Artist/Genre/listening-time relationships and completes persistent Custom EQ behavior.",
      sections:[
        {title:"GP Spectrum ID 1.0",items:[
          "gpsid:v1 is derived only from encoded-audio payload length, head/middle/tail SHA-256 anchors and the FLAC PCM MD5 when available.",
          "Filename, Title, Artist, Genre, Album, artwork, padding and modification time never participate in Spectrum ID.",
          "audioEssenceKey remains a compatibility alias while 4.4.0 and legacy content keys migrate without discarding cached analysis."
        ]},
        {title:"Conservative Matching",items:[
          "A complete Spectrum ID match or FLAC PCM MD5 match is accepted as verified evidence.",
          "Anchor recovery now requires an identical payload structure, the middle anchor, and at least one of the head or tail anchors; arbitrary two-of-three voting is removed.",
          "Insufficient evidence creates an unresolved identity instead of merging by title, artist, bitrate, duration or Genre."
        ]},
        {title:"Personal Listening Foundation",items:[
          "track cache adds spectrumId and identityLinks with reserved canonicalArtistId, artistAliases and genreIds relationships.",
          "Listening history now prefers Spectrum ID over artist + title. A legacy history entry migrates when the track next records listening and preserves earlier Artist aliases.",
          "These relationships prepare Favorite Artist and time-based Artist/Genre statistics without adding a visible feature page yet."
        ]},
        {title:"Persistent Custom EQ",items:[
          "Custom is permanently visible in the Equalizer preset row.",
          "Manual changes immediately update an independent customEQGains curve; selecting a built-in preset no longer destroys it.",
          "Selecting Custom restores all seven saved bands, including migration from a 4.4.0 custom eqGains preference."
        ]},
        {title:"Compatibility",items:[
          "GP Spectrum Engine 2.0, Spectrum Algorithm 2.1.0, MFCC, Energy, BPM, Genre and technical metadata behavior remain intact.",
          "IndexedDB advances to database v5 and track cache schema v6 with a Spectrum ID index. Existing records remain append-only.",
          "No Live-versus-studio disambiguation layer is added because those versions do not coexist in the current library; different audio streams still naturally receive different IDs."
        ]}
      ]
    },
    "4.4.0":{
      summary:"RECOG UPDATE introduces GP Recognition Engine 1.0. Songs are now identified by their audio stream rather than filename, Artist, Title, Genre, artwork or modification time, while every existing MFCC, Energy, BPM, waveform, artwork and technical cache remains reusable.",
      sections:[
        {title:"Audio-Essence Identity",items:[
          "audioEssenceKey locates the real encoded-audio payload, then combines its payload length with three independent SHA-256 anchors from the head, middle and tail of the stream.",
          "The anchors exclude ID3, FLAC comments, MP4 metadata, WAV LIST tags and artwork. Renaming files or editing Artist, Title, Genre, Album or artwork therefore leaves the song identity unchanged.",
          "Bitrate, duration, sample rate and channels remain technical evidence but are not unique enough to serve as a primary song identity."
        ]},
        {title:"FLAC Four-Layer Failsafe",items:[
          "FLAC adds the PCM MD5 stored in STREAMINFO as a fourth authoritative signal beyond the three encoded-stream anchors.",
          "Resolution order is complete audioEssenceKey, FLAC PCM MD5, then a two-of-three anchor vote. One abnormal anchor may drift without discarding the original song cache.",
          "All 328 FLAC and 13 MP3 files in the current library passed real-file three-anchor recognition and produced 341 distinct audio identities."
        ]},
        {title:"Container-Aware Boundaries",items:[
          "MP3 skips ID3v2, ID3v1 and APE tags; FLAC skips every metadata block; MP4/M4A uses mdat; WAV uses the data chunk. Ogg/Opus and WMA receive format-specific header handling.",
          "Identity import reads headers plus at most three 64KB payload samples. It does not decode a full track and does not compete with playback initialization.",
          "Unknown containers are marked unreliable instead of presenting a metadata-sensitive fallback as permanent recognition."
        ]},
        {title:"Lossless Cache Migration",items:[
          "IndexedDB advances to database v4 and track cache schema v5 with indexes for audioEssenceKey, all three anchors and FLAC PCM MD5. Old records remain append-only.",
          "On the first 4.4.0 import of an unchanged legacy file, fileIdentity locates its 4.3.1 record and copies MFCC, Energy, Loudness, BPM, sample rate, channels, waveform, artwork and Genre results to the new identity.",
          "Spectrum Algorithm 2.1.0 and feature schema v4 remain unchanged, so identity migration does not request acoustic reanalysis. The old key remains in legacyContentKeys."
        ]},
        {title:"Metadata-Edit Foundation",items:[
          "recognition and legacyContentKeys prepare future verified Genre writes, canonical Artist naming, Title edits and file renames without changing the underlying track identity.",
          "Future metadata may replace visible inferred labels while MFCC, BPM and Energy stay attached to audioEssenceKey for recommendations and similarity.",
          "No player UI, animation, playback behavior or existing Genre/MFCC presentation changes in this release."
        ]}
      ]
    },
    "4.3.1":{
      summary:"HOTFIX BUILD removes the 4.3.0 design that defaulted uncertain tracks to Pop, rebuilds Genre as multi-feature multi-class scoring, and fixes obvious failures such as BEYOND's Glory Days being labeled Pop with Dark · Soft.",
      sections:[
        {title:"Genre Collapse Fix",items:[
          "The default Pop branch is deleted. Every class must earn acoustic or explicit text evidence; insufficient evidence resolves to Mixed instead of a fabricated Pop label.",
          "The classifier preserves class scores, top-versus-runner-up margin, Top 3 results and confidence. Close classes may display a dual label rather than hiding uncertainty.",
          "A fixed regression requires BEYOND / Glory Days to resolve as Rock with Warm · Driving and forbids Pop or Dark · Soft from returning."
        ]},
        {title:"Expanded Acoustic Evidence",items:[
          "Representative MFCC frames increase from 72 to 120 while remaining distributed across the full track and sharing the one Energy/BPM audio decode.",
          "Beyond 13-dimensional MFCC means and deviations, the cache now includes spectral rolloff, bandwidth, zero-crossing rate, low/mid/high energy ratios, spectral flux, crest factor, dynamic range and frame-to-frame MFCC change.",
          "Genre scoring combines Energy, RMS Loudness, BPM, rhythm confidence, MFCC, band distribution, dynamics and spectral change instead of allowing one centroid/flatness threshold to decide a track."
        ]},
        {title:"Multi-Genre Scoring",items:[
          "Pop, Rock, Metal, Electronic, Hip-Hop, R&B/Soul, Jazz, Classical, Ambient, Folk/Country, Soundtrack, Reggae, Blues and Mixed receive independent scores.",
          "Rock emphasizes midrange, dynamics, spectral change, loudness and tempo range; Electronic emphasizes stable rhythm, energy and band structure; dynamic range and rhythm stability better separate Classical from Ambient.",
          "This lightweight implementation does not pretend to be a CNN. It is an explainable scorer suitable for a standalone HTML player, informed by open GTZAN work showing that genre classification requires standardized multi-dimensional acoustic features."
        ]},
        {title:"Offline Artist & Title Knowledge",items:[
          "The offline clue table now includes BEYOND, Wong Ka Kui, Glory Days, Boundless Oceans Vast Skies and more Chinese and international Rock, Metal, Classical, Jazz, Electronic, Hip-Hop, R&B, Ambient and Soundtrack artists.",
          "Explicit clues add strong weight to their class while acoustic scores remain visible. Real file metadata Genre still wins and is never overwritten."
        ]},
        {title:"MFCC Summary Semantics",items:[
          "Dark · Soft-style combinations are removed. Timbre now uses Bright, Warm or Deep, while motion/structure uses Driving, Dynamic, Punchy, Calm, Smooth or Balanced.",
          "Rock and Metal prefer Driving or Dynamic, and the Soft label is deleted entirely. The summary describes sound structure instead of pretending to infer emotion."
        ]},
        {title:"Cache Migration",items:[
          "Spectrum Algorithm advances to 2.1.0 and feature/track cache to schema v4. Incorrect 4.3.0 Genre and missing descriptors receive one corrective analysis.",
          "All corrected descriptors, Top 3 scores, dual labels, summaries and confidence are permanently stored in IndexedDB and are not recomputed on later launches."
        ]}
      ]
    },
    "4.3.0":{
      summary:"SPECTRUM UPDATE advances GP Spectrum Engine to 2.0. Persistent local MFCC timbre analysis now joins Energy, Loudness and BPM to produce compact sound profiles, mood inference and automatic Genre completion.",
      sections:[
        {title:"GP Spectrum Engine 2.0",items:[
          "Feature storage advances to schema v3 and Spectrum Algorithm 2.0.0. Existing Energy/BPM records receive one controlled MFCC upgrade, then restore directly on every later import.",
          "Energy, RMS Loudness, BPM, MFCC, mood, inferred Genre, confidence, Sample Rate, Channels and waveform share the same single AudioBuffer decode.",
          "Analysis still begins after the initial library render and decodes only one track at a time; requestIdleCallback slices computation around available main-thread time."
        ]},
        {title:"MFCC Pipeline",items:[
          "The native pipeline implements a Hann window, 1024-point radix-2 FFT, power spectrum, 40-band Mel filterbank, log-Mel conversion and orthonormal DCT-II to produce 13 MFCC coefficients.",
          "Its structure follows the Mel spectrogram/MFCC sequence documented by librosa and the low-level MFCC statistics used by Essentia MusicExtractor, implemented in dependency-free JavaScript.",
          "Up to 72 representative frames are spread uniformly across the full track. IndexedDB stores 13-dimensional means and standard deviations, valid-frame count, analysis sample rate, FFT size, Mel count, spectral centroid and spectral flatness."
        ]},
        {title:"Mood & Genre Inference",items:[
          "Energy, RMS Loudness, BPM, MFCC statistics, spectral centroid and spectral flatness combine into bright/warm/dark and calm/energetic/intense atmosphere profiles.",
          "Genre inference first checks explicit local artist, title and filename clues, then selects among Pop, Rock, Electronic, Hip-Hop, R&B/Soul, Jazz, Classical, Ambient, Folk/Country and Soundtrack from acoustic features.",
          "Automatic completion runs only when the file has no Genre. Results are marked spectrum-inference with confidence and never overwrite real metadata tags.",
          "This is a deterministic local heuristic rather than an online lookup or pretrained model: it provides reproducible useful grouping without claiming professional classifier accuracy."
        ]},
        {title:"Sound UI",items:[
          "A compact MFCC summary now appears below Energy and BPM, such as Warm · Soft or Bright · Energetic, and switches instantly with interface language.",
          "Missing Genre is filled when analysis completes and is restored before the first library render on a cache hit."
        ]},
        {title:"Persistent & Future-Ready",items:[
          "Both trackFeatures and the complete trackCache preserve MFCC statistics, summary codes, mood, Genre, source, confidence and algorithm version; removing a song does not delete them.",
          "Future preference learning and recommendation revisions can consume cached feature vectors without decoding the library again. Only an explicit Spectrum algorithm-version upgrade triggers one controlled migration.",
          "The fixed 72-frame MFCC ceiling decouples FFT/DCT work from track duration and prevents a return to the unbounded pre-Snow-Leopard initialization path."
        ]}
      ]
    },
    "4.2.1":{
      summary:"HOTFIX BUILD unifies file data, metadata, artwork, technical parameters, waveform, Energy and BPM into one complete IndexedDB song snapshot. The legacy Sound-view decoder is removed, and adaptive accents now remain readable against both the page and glass surfaces.",
      sections:[
        {title:"Complete IndexedDB Song Snapshot",items:[
          "Each permanent contentKey record now stores filename, size, MIME type, modification time, relative path, format, duration, estimated bitrate, title, artist, Genre, original artwork and thumbnail.",
          "The first Spectrum pass adds Sample Rate, Channels, a lightweight 160-point waveform, Energy, Energy dB, BPM, BPM confidence, algorithm version and completion state to the same record.",
          "Track cache schema advances to v2 with an informationComplete marker. Removing a track from the current library still does not delete its permanent IndexedDB information."
        ]},
        {title:"Read Once, Restore Everything",items:[
          "After restart, selecting the same file first resolves fileIdentity/contentKey and restores every visible property before the initial library render.",
          "Existing 4.2.0 trackFeatures records are merged into the primary trackCache on their first hit, completing a compatibility migration without decoding the audio again.",
          "An undetectable BPM no longer invalidates the record: Sample Rate, Channels, Energy and completion state are retained while BPM explicitly reports Not detected."
        ]},
        {title:"Duplicate Decode Removal",items:[
          "The independent AudioContext, full-file arrayBuffer and decodeAudioData queue have been removed from loadWaveformFor(). Opening Sound now only draws cached waveform data and updates text.",
          "GP Spectrum Engine is the sole full-audio decode path; that one pass produces technical parameters, waveform, Energy and BPM together.",
          "Format, duration and bitrate render from the persistent snapshot, while Sample Rate and Channels no longer re-decode when changing tracks or reopening Sound."
        ]},
        {title:"Accent Readability",items:[
          "Adaptive cover-accent minimum contrast increases to 4.5:1 and is checked against both the page background and the composited strong-glass surface.",
          "OKLab cover harmony and the low-chroma cap remain, so readability is achieved through dynamic lightness correction rather than presets or neon saturation.",
          "A roughly 7.5:1 high-contrast guard remains to preserve a defined balance between clarity and visual softness."
        ]},
        {title:"Compatibility",items:[
          "GP Spectrum Engine 1.0 Energy/BPM detection remains unchanged; this hotfix targets persistence completeness, duplicate reads and accent legibility.",
          "Player layout, Glass UI, animation, queue, EQ and existing controls remain unchanged."
        ]}
      ]
    },
    "4.2.0":{
      summary:"SPECTRUM UPDATE introduces GP Spectrum Engine 1.0. Local tracks now receive real Energy and BPM analysis whose results are stored in IndexedDB and restored after restart without decoding the same audio again.",
      sections:[
        {title:"GP Spectrum Engine 1.0",items:[
          "A dedicated acoustic-feature pipeline now supports Energy and BPM, with an algorithm version, completion state and confidence stored against each track contentKey.",
          "Analysis starts only after the imported library has completed its first render and runs strictly one track at a time, preventing simultaneous decodes from recreating initialization stalls and memory spikes.",
          "Each track is bounded to 180 seconds of analysis; long tracks begin at 15 seconds to avoid unusually long silence or fade-ins while keeping the workload finite."
        ]},
        {title:"Energy Detection",items:[
          "Audio is sampled into a 100 Hz time envelope. Multi-channel RMS is measured per block and combined into an overall mean-square energy value.",
          "RMS is converted to dB and mapped to a 0–100 Energy score. The value comes from decoded audio rather than a genre, filename or randomized estimate.",
          "Lightweight waveform peaks from the same pass are reused for the current session, avoiding a second decode for the same track."
        ]},
        {title:"BPM Detection",items:[
          "Positive envelope changes form an onset-flux signal, and normalized autocorrelation searches for the dominant beat period across 60–200 BPM.",
          "Double- and triple-tempo correction reduces 120 or 180 BPM material being reported as a 60 BPM half- or third-time result; BPM confidence is persisted as well.",
          "Tracks with insufficient duration or no stable pulse report Not detected instead of inventing a random BPM."
        ]},
        {title:"Persistent Feature Cache",items:[
          "Energy, source dB, BPM, confidence, sample rate, channel count, algorithm version and completion state are written to the IndexedDB trackFeatures store.",
          "The append-only contentKey identity remains in effect: removing a track from the current library does not delete its analysis, and reselecting the same file after restart restores it directly.",
          "Feature records are restored before the first list render. Cache misses are queued afterward, and a completed track updates only the visible track information card instead of rebuilding the library."
        ]},
        {title:"Sound UI",items:[
          "Energy and BPM rows now appear directly below Genre in the Sound view, with explicit analyzing, unavailable and completed states.",
          "Energy is shown from 0–100 and tempo as an integer BPM, with complete Chinese and English labels."
        ]},
        {title:"Accent Contrast Hotfix",items:[
          "Cover-derived accents still harmonize the actual cover palette with the rendered background, but minimum accent-to-background contrast increases from 2.35 to 3.25.",
          "The maximum contrast guard remains, preventing a return to harsh neon colors while restoring a clear readability floor without substituting any preset accent."
        ]},
        {title:"Scope",items:[
          "MFCC and acoustic-feature recommendations are not included yet. Future MFCC data will use the same persistent trackFeatures contract.",
          "Player layout, Glass UI, animation parameters, queue behavior and playback controls are unchanged by Spectrum Engine 1.0."
        ]}
      ]
    },
    "4.1.2":{
      summary:"HOTFIX BUILD rebuilds Match UI accent to current cover. The accent is no longer forced to high saturation or selected from presets; it is dynamically harmonized from a multi-color cover palette and the actual current background.",
      sections:[
        {title:"Adaptive Accent Harmony",items:[
          "Up to five dominant cover colors are sampled instead of relying on one top bucket, reducing errors caused by a large flat background in the artwork.",
          "Colors are converted to perceptual OKLab and combined through rank and useful-chroma weighting, preserving the unique hue relationships of each cover.",
          "The algorithm reads the currently rendered background-color and blends it with the cover center in OKLab, producing coordinated but distinct results for light, dark and automatic themes.",
          "Only perceptual chroma is capped. No preset accent replaces the result, so neutral covers remain neutral and colorful covers retain their own softened hue."
        ]},
        {title:"Contrast & Comfort",items:[
          "Real relative luminance measures accent-to-background contrast; insufficient results move progressively along the OKLab lightness axis until the visibility threshold is met.",
          "Highly saturated red, blue, yellow and green artwork keeps its source hue while losing the neon appearance across controls, glow and version labels.",
          "Black or white foreground is selected using WCAG contrast rather than a fixed brightness cutoff."
        ]},
        {title:"Compatibility",items:[
          "Manual Accent Color presets remain unchanged. The new algorithm runs only while Match UI accent to current cover is enabled.",
          "Artwork, background modes, Glass UI, animation and the GP Core 2.0 cache pipeline remain unchanged."
        ]}
      ]
    },
    "4.1.1":{
      summary:"HOTFIX BUILD formally assigns new engine versions to the Snow Leopard architecture: GP Core 2.0 and GP Motion Engine 1.1. Current build identity, runtime metadata and both changelog languages now use the same definitions.",
      sections:[
        {title:"GP Core 2.0",items:[
          "The append-only IndexedDB library cache, bounded import pipeline, two-level cache recovery and single-render commit introduced in 4.1.0 are now formally defined as GP Core 2.0.",
          "Core 2.0 owns track identity, metadata, artwork thumbnails, persistent cache and import scheduling while audio remains supplied by user-authorized local files.",
          "The Storage Adapter contract remains stable for a future Electron Lake transition from IndexedDB to SQLite."
        ]},
        {title:"GP Motion Engine 1.1",items:[
          "Motion Engine advances to 1.1, confirming that Glass selectors, queue dragging, the record, Disk Reader and settings switches remain compatible with the single-render lifecycle.",
          "Motion 1.1 does not redesign the visual language; it is the Gen 3 motion system compatibility revision for the GP Core 2.0 data flow.",
          "CSS, animation timing, responsive layout and interaction feedback retain the Snow Leopard Update visual result."
        ]},
        {title:"Build Identity",items:[
          "The current release is Glass Player 4.1.1 and the build name is HOTFIX BUILD.",
          "The build card, window.GP.engines, Chinese and English release notes, and TXT export title now use the same engine numbering.",
          "4.1.0 SNOW LEOPARD UPDATE remains available as the full architecture release in changelog history."
        ]}
      ]
    },
    "4.1.0":{
      summary:"SNOW LEOPARD UPDATE focuses on internal efficiency rather than adding another visible page. It rewrites local-library import, caching and rendering so that track information and artwork enter an append-only IndexedDB cache, repeated folder imports recover cached data after restart, and each file batch commits the complete list only once.",
      sections:[
        {title:"Architecture — IndexedDB Becomes the Import Backbone",items:[
          "The IndexedDB boundary reserved in 4.0.0 is now connected to the real import path through a new trackCache store and schema v3.",
          "trackCache uses contentKey as a permanent primary key and stores file identity, metadata, duration, Genre, original artwork Blob, a 192px thumbnail Blob and cache time.",
          "The cache is append-only. Removing a track from the current library releases session URLs but never deletes its persistent information.",
          "The database facade intentionally exposes cache reads and addTrackCache without a player-facing track-cache deletion method."
        ]},
        {title:"Two-Level Cache — Fast Recovery After Restart",items:[
          "Level one combines file size, modified time, type and folder-relative path into fileIdentity, allowing the same folder to hit cache without reading audio bytes.",
          "If identity changes, level two reads only 64KB from the beginning, middle and end to calculate a SHA-256 contentKey and recover cache by audio content.",
          "A hit restores title, artist, duration, Genre, artwork and thumbnail without repeating ID3, FLAC or MP4 parsing.",
          "Only track information and images are cached. Audio files are not copied, so users still reselect their local folder after refresh or restart."
        ]},
        {title:"Import Pipeline — Bounded Work",items:[
          "File identity and fingerprint work is limited to four concurrent tasks; metadata, artwork and Genre parsing is limited to two tracks.",
          "Temporary Audio probes pause, remove src and reload immediately after metadata, failure or timeout so their media resources can be released.",
          "M4A / MP4 artwork parsing no longer reads the full media file. It scans top-level Atom headers, locates moov and reads at most a 32MB metadata box.",
          "One unsupported file falls back to filename metadata without stopping the batch or reprocessing completed tracks."
        ]},
        {title:"Rendering Complexity — Removing Initialization O(n²)",items:[
          "The old path rebuilt both full lists after every duration result and every artwork result, producing roughly 2n O(n) list generations for n tracks.",
          "4.1.0 finishes the bounded background batch first and then commits state once, so every imported batch causes exactly one full-library render.",
          "Parsing remains O(n), render-commit count becomes O(1), and the necessary final creation of n visible rows remains honestly O(n).",
          "GP.performance.lastImport records cache hits, misses, writes, duplicates, render commits and duration for direct verification."
        ]},
        {title:"Artwork & Memory",items:[
          "Original artwork is cached once for the record and static-cover views, while a separate 192×192 WebP thumbnail serves the library, queue and history.",
          "Small rows no longer ask Edge to decode full-resolution artwork; thumbnails use lazy loading and asynchronous decoding.",
          "A repeated import restores both Blobs from IndexedDB instead of scanning audio or regenerating the thumbnail.",
          "Session audio, cover and thumbnail URLs are revoked when a track leaves the current library, while persistent cache remains."
        ]},
        {title:"On-Demand Audio Analysis",items:[
          "Loading a track no longer immediately reads and decodes the full audio solely for loudness and channel information.",
          "Analysis starts only when Sound is opened and runs through one sequential queue; stale fast-switch requests exit before heavy work.",
          "The redundant full ArrayBuffer copy before decodeAudioData has been removed."
        ]},
        {title:"Compatibility & Storage Rules",items:[
          "Glass UI, motion, playback queue, themes, Dual Deck, EQ and Crossfade retain their existing interaction behavior.",
          "Removing tracks or importing a smaller folder never clears historical track cache. Only explicit Edge site-data clearing or unavailable IndexedDB removes it.",
          "The same Storage Adapter boundary remains ready for Electron Lake to replace IndexedDB with SQLite without rewriting the upper import flow."
        ]}
      ]
    },
    "4.0.0":{
      summary:"The first engineering blueprint for GP Neural. Gen 4 begins the move from playing and presenting music to understanding it. This Beta establishes portable, cacheable and testable foundations while preserving the current player UI, motion, queue behavior and interaction feel.",
      sections:[
        {title:"Beta Mission — From Playback to Understanding",items:[
          "GP Neural is the central direction of Glass Player Gen 4: measurable audio features will replace unsupported random assumptions in similarity, clustering and recommendation decisions.",
          "The first phase establishes architecture and data contracts without exposing unfinished analysis results or allowing experimental signals to degrade the existing recommendation experience.",
          "4.0.0 follows a Zero-Visual-Change contract. Apart from version information and release notes, the 3.5.3 DOM, CSS, layout, themes, motion, queue and playback behavior remain intact.",
          "Gen 4 continues on the browser-based Harmonic Lake architecture. It prepares for Electron Lake without starting a high-risk full rewrite."
        ]},
        {title:"Harmonic Lake — Gen 4 Module Boundaries",items:[
          "/src/core/audio.js is a compatibility bridge for the existing dual-deck runtime, Web Audio chain, EQ, crossfade, playback state and queue calls.",
          "/src/core/database.js is the shared data-access facade, allowing upper layers to request records without depending on IndexedDB syntax.",
          "/src/core/analyzer.js defines the cache-first GP Neural entry point, feature-record schema and analysis version contract for later audio computation.",
          "/src/storage/indexeddb.js owns local browser persistence. /src/ui/galaxy.js and /src/ui/timeline.js currently expose module boundaries only and create no new visible UI.",
          "The split is designed to isolate audio, analysis, storage and future visualizations so that one subsystem can evolve without destabilizing the entire player."
        ]},
        {title:"IndexedDB — Local Data Foundation",items:[
          "The database is lazy-loaded and does not open during initial page startup. A connection is created only when a future module actually requests persistent data.",
          "trackFeatures uses contentKey to identify audio and is designed to store metadata, MFCC, Energy, BPM, analysis time and schemaVersion for cache reuse.",
          "behaviorEvents reserves local events such as completion, skipping, replay and queue actions; userModel stores aggregated preferences instead of an unbounded raw-event history.",
          "recommendations reserves reproducible snapshots with generation time and model version, making future results inspectable instead of inexplicably random on every refresh.",
          "Songs, audio features and listening behavior remain on the local device. This Beta does not upload them."
        ]},
        {title:"Analysis Pipeline — Planned Processing Flow",items:[
          "The target flow is import → stable contentKey → cache lookup → metadata read → required audio decode → Energy / BPM / MFCC analysis → IndexedDB save → recommendation and visualization access.",
          "A valid cache hit skips repeated decoding and computation. Missing records or schema-version changes trigger a controlled reanalysis.",
          "Analysis will be separated from first-play readiness: tracks should become visible, searchable and playable before background jobs progressively complete their features.",
          "Future scheduling will cap concurrent analyses, release AudioBuffers promptly and yield between tasks to reduce Edge main-thread stalls and peak memory use.",
          "An unsupported or damaged track must not block the full import batch. Metadata success and feature-analysis success will remain separate states."
        ]},
        {title:"MFCC + Energy + BPM — The Three Core Signals",items:[
          "Energy represents loudness, density and dynamic intensity. It helps separate calm and high-impact material but is not treated as a simple volume control.",
          "BPM represents dominant tempo and requires confidence plus half-time / double-time correction so related 70 BPM and 140 BPM rhythms are not separated incorrectly.",
          "MFCC represents spectral envelope and timbral structure for measuring listening-distance between tracks; it is not a direct genre-label generator.",
          "The three feature families will be normalized before becoming a similarity vector so that one BPM or loudness value cannot dominate every result.",
          "Every record carries an analysis version, enabling selective recomputation after algorithm upgrades without silently mixing incompatible data."
        ]},
        {title:"User Model & Recommendations — Planned Direction",items:[
          "The planned data flow is track features + local behavior → user model → recommendation candidates → Daily Mix and weighted-shuffle improvements.",
          "Completion, intentional replay and queue addition can provide positive signals. A quick skip remains a weak negative signal so one accidental action cannot permanently suppress a track.",
          "Daily Mix will favor coherent timbre, Energy and Tempo while reserving limited exploration slots to prevent the recommendation space from collapsing.",
          "Shuffle remains available but evolves into a choice constrained by the current track, user preferences and recent-repeat penalties.",
          "The manual queue always retains highest priority. GP Neural must never reorder an explicitly arranged next-up sequence."
        ]},
        {title:"Performance & Cache Strategy — Outlook",items:[
          "Analyze the same audio once is the primary rule. Stable fingerprints, cached features and schema versions directly reduce work on repeated library imports.",
          "Progressive scheduling will prioritize the current and next tracks, processing the rest during idle opportunities rather than monopolizing the CPU.",
          "Memory limits will cap simultaneous decode buffers and release large objects after analysis, retaining only compact feature vectors and necessary statistics.",
          "Galaxy and Timeline will consume prepared coordinates or summaries instead of recomputing audio distances every frame; fast pointer motion will not force expensive detail rendering.",
          "Performance gains may not come from removing motion, weakening interaction feedback or reducing the established visual hierarchy. Smooth user experience remains an acceptance requirement."
        ]},
        {title:"Electron Lake Readiness — Gen 5+",items:[
          "A future desktop build can replace storage/indexeddb.js with storage/sqlite.js while preserving the core/database.js interface, leaving Analyzer and UI unaware of the storage-engine change.",
          "Electron Lake targets EXE delivery, SQLite and more reliable background analysis, but the migration belongs to Gen 5+ and is not claimed as a Beta capability.",
          "Validating schemas, cache rules and module responsibilities in Harmonic Lake reduces the risk of changing UI, algorithms and storage simultaneously during the desktop transition."
        ]},
        {title:"Beta Scope — Implemented and Not Yet Implemented",items:[
          "Implemented in this Beta: Core / UI / Storage contracts, the Audio Runtime compatibility bridge, a lazy IndexedDB schema, the feature-record format and the matching physical /src scaffold.",
          "Not yet implemented: real MFCC, Energy or BPM computation; import-time cache hits; the user model; neural recommendations; Music Galaxy; Music Time Machine; Electron; and SQLite.",
          "Planned items remain explicit roadmap work rather than placeholder APIs presented as completed features. Each must pass correctness, performance and UI-regression checks before release.",
          "The Beta succeeds by making future Neural work possible without breaking the mature player experience, not by making the interface merely look newer."
        ]}
      ]
    },
    "GP Gen 4 Pre-Release Update":{
      summary:"A complete retrospective before Gen 4. The first three Glass Player generations are not replacement products; they are a continuous progression from a reliable local core, to a fused listening experience, to a complete design language. GP Core, GP Fusion and GP Motion now form Harmonic Lake together.",
      sections:[
        {title:"Why This Retrospective",items:[
          "Version numbers record changes; Generations record stages where the product itself gains a new class of capability. This retrospective turns the 1.x–3.x feature history into a clear product narrative.",
          "Gen 1 asked whether a local player could work reliably. Gen 2 asked whether separate playback capabilities could become one continuous experience. Gen 3 asked whether every screen and interaction could speak one design language.",
          "3.5.3 FINAL HOTFIX RELEASE closes the 3.x line and establishes a stable baseline for playback, immersive features and the Motion design system.",
          "The earlier engines are not removed in Gen 4. GP Neural adds a fourth layer for music understanding, caching and recommendations."
        ]},
        {title:"Glass Player Gen 1 — Foundation Generation",items:[
          "Built the foundation of local music experience.",
          "Gen 1 began with the essential local path: import files, identify tracks, display information, search the library, control playback and keep content on the user device.",
          "Playback established play / pause, seeking, previous / next, volume and state. Music Library turned disconnected files into a browsable collection.",
          "Metadata and artwork promoted filenames into recognizable titles, artists and albums. Search removed the need to manually scan the library.",
          "Basic Glass UI introduced translucent surfaces, soft depth and cover-driven ambience, creating the visual origin of the later Glass language.",
          "The value of this generation was a trustworthy minimum loop: after importing a track, the user could find it, understand it and play it reliably."
        ]},
        {title:"GP Core 1.0 — The Harmonic Lake Foundation",items:[
          "1.x introduced GP Core 1.0 and defined the responsibilities of the player core and its browser-local operating model. Harmonic Lake became the architecture name.",
          "GP Core owned the basic data flow between track objects, playback state, library, metadata and interface without tying playback to one specific screen.",
          "Core versions advance for architectural changes in responsibilities, runtime model or critical data flow, not for routine UI fixes or individual features.",
          "Gen 1 also exposed the next limitation: audio effects, queueing, statistics and recommendations were useful but still behaved like separate islands."
        ]},
        {title:"Glass Player Gen 2 — Experience Generation",items:[
          "Transformed playback into an immersive experience.",
          "Web Audio expanded playback into a controllable signal chain. EQ, Spectrum and Crossfade began to shape listening and transitions directly.",
          "Dual Deck playback prepared adjacent tracks and enabled smoother handoffs while reducing abrupt stop-and-switch behavior.",
          "Queue and Mini Player connected what is playing now, what plays next and how playback remains controllable away from the main view.",
          "Listening Statistics converted duration, counts and history into personal records; Recommendations began organizing future tracks from local behavior.",
          "Sleep Timer, Daily Mix and playback modes helped turn the player from a utility into an environment designed for longer listening sessions."
        ]},
        {title:"GP Fusion Engine 1.0 — Fusing the Journey",items:[
          "2.x introduced GP Fusion Engine 1.0. Fusion meant more than placing features together: audio, queue, transitions, statistics and recommendations began sharing one coherent state.",
          "One playback action could update the active track, queue position, listening record and recommendation signal; one transition coordinated both Decks, Crossfade and UI feedback.",
          "Manual queue intent evolved toward the highest playback priority, while the selected playback mode resumed after that queue completed.",
          "Gen 2 solved fragmented listening, but rapid growth exposed inconsistent selectors, motion, shadows, responsive behavior and state feedback across screens."
        ]},
        {title:"Glass Player Gen 3 — Design Generation",items:[
          "Established the complete Glass design language.",
          "Glass UI System organized blur, glow, radius, shadows, depth and Accent Color into a consistent visual system instead of isolated effects.",
          "Animations and micro-interactions connected selectors, queue drag, switches, controls, the record and Disk Reader so state no longer changed as an unexplained flash.",
          "Dynamic Themes integrated Color Blob, Blurred Cover and cover-derived color while resolving readability and manual-accent conflicts.",
          "Responsive Layouts kept the complete player usable in full-screen Edge, normal windows and reduced windows without depending on 90% browser zoom.",
          "Localization and product polish completed Chinese / English coverage, typography, weight controls, changelog export, the build card and a long tail of interaction fixes."
        ]},
        {title:"GP Motion Engine 1.0 — Interaction as a System",items:[
          "3.x introduced GP Motion Engine 1.0 and promoted animation from decoration to state communication: selectors show where a choice moved, and drag feedback shows where a track will land.",
          "A shared stretch → slide → settle motion language reached the sidebar, segmented controls and changelog, with restrained shadow and glass feedback during travel.",
          "Queue dragging gained a dedicated handle, rounded lifted card, animated space-making and settle feedback. Record pause preserves its angle while Disk Reader follows real playback state.",
          "Playback controls synchronize against actual audio events, preventing rapid input from leaving a playing icon attached to stopped audio.",
          "The Gen 3 achievement is not simply more animation; it is consistent rhythm, weight, depth and causality across interactive surfaces."
        ]},
        {title:"Three Generations, One Product",items:[
          "Gen 1 / GP Core 1.0 supplies the reliable local-music core; Gen 2 / GP Fusion Engine 1.0 connects the listening journey; Gen 3 / GP Motion Engine 1.0 unifies visible and felt interaction.",
          "Core defines how the player works, Fusion defines how capabilities cooperate, and Motion defines how that cooperation is perceived and understood.",
          "All three run together in Harmonic Lake: Core is the foundation, Fusion the connection layer and Motion the experience layer.",
          "A new Generation does not erase the previous one. GP Neural consumes tracks from Core, behavior from Fusion and protects the experience boundaries established by Motion."
        ]},
        {title:"Handoff to Gen 4 — GP Neural",items:[
          "The first three generations solved what to play and how to play it well. Gen 4 begins addressing why tracks sound similar and what the user may want next.",
          "MFCC, Energy and BPM will create comparable local track features, while behavior adds personal preference; recommendations require both sources.",
          "Feature results must be cached in IndexedDB so that each library import does not decode the entire collection again. Performance, memory and main-thread responsiveness become core Gen 4 metrics.",
          "Music Galaxy, Music Time Machine and more coherent Daily Mixes are future expressions of GP Neural, released only after features, caching and performance are trustworthy.",
          "The retrospective ends here. 4.0.0 Beta continues the same product line while refusing to trade away the mature Gen 3 UI for a foundation update."
        ]}
      ]
    }
  };

  const MERGED_PATCH_GROUPS=[
    {
      versions:["6.6.4","6.6.3","6.6.2","6.6.1"],
      release:{version:"6.6.1",date:"2026-07-26",kind:"patch",summary:"合并维护记录：围绕导入完成边界、播放队列首次定位、封面/背景交叉淡化和前台流畅度进行的连续修复被整理为一次完整稳定化过程。",sections:[
        {title:"导入与初始化",items:["导入进度覆盖封面解码、Spectrum、Resonance Boost、每日推荐与最终界面提交；完成前不退出，完成后不继续用后台工作阻塞触控。"]},
        {title:"Queue 定位与播放反馈",items:["首次播放、暂停恢复、切歌与返回 Queue 时统一定位当前歌曲；修复重复归位、闪跳、错误方向和手动滚动被锁定的问题。"]},
        {title:"视觉连续性",items:["封面、唱片内容、标题、艺人和背景采用重叠淡化，避免灰闪、白闪与唱片回转；运输按钮和四段反馈在切歌期间保持连续。"]}
      ],english:{summary:"Consolidated maintenance: the repeated work on import completion, first-play Queue positioning, artwork/background crossfades and foreground responsiveness is presented as one stabilization cycle.",sections:[
        {title:"Import and Initialization",items:["Import progress covers artwork decoding, Spectrum, Resonance Boost, Daily Mix and the final UI commit. The dialog remains until completion and no hidden work blocks input afterward."]},
        {title:"Queue Position and Playback Feedback",items:["First play, pause/resume, track changes and returning to Queue share one current-track placement path, removing duplicate alignment, snaps, wrong-direction travel and locked manual scrolling."]},
        {title:"Visual Continuity",items:["Artwork, record content, metadata and ambient background overlap through fades instead of grey or white flashes, while transport and four-band feedback remain continuous during track changes."]}
      ]}}
    },
    {
      versions:["6.5.7","6.5.6"],
      release:{version:"6.5.3",date:"2026-07-26",kind:"patch",summary:"合并维护记录：统一弹窗材质、倍速分段选择和播放队列返回定位，并修复旧倍速、Accent 同步与导入后触控问题。",sections:[
        {title:"控件与弹窗",items:["EQ、Snooze、排序与倍速弹窗共享同一玻璃表面和唯一弹窗管理；倍速改为五段选择并修复默认跳到 2×、滑块错位和 Accent 延迟。"]},
        {title:"导入与 Queue",items:["导入完成后立即恢复输入响应；默认播放队列在切歌和返回页面时可靠回到当前歌曲，保留正常手动滚动。"]}
      ],english:{summary:"Consolidated maintenance: popover material, segmented playback speed and Queue restoration are unified while legacy speed, Accent synchronization and post-import input issues are repaired.",sections:[
        {title:"Controls and Popovers",items:["EQ, Snooze, Sort and Playback Speed share one Glass material and single-popover manager. Speed becomes a five-stop selector with correct legacy migration, placement and live Accent."]},
        {title:"Import and Queue",items:["Input responsiveness returns immediately after import, and the default Queue reliably restores the current track after navigation or track changes without removing manual scrolling."]}
      ]}}
    },
    {
      versions:["6.5.4","6.5.3","6.5.2","6.5.1"],
      release:{version:"6.5.1",date:"2026-07-26",kind:"patch",summary:"合并维护记录：Motion 120 Hz、4K 背景稳定、导入流畅度与音频输出诊断的多轮修复被整理为一个性能和播放质量阶段。",sections:[
        {title:"Motion 与 4K",items:["移除重复的高成本背景合成和转场纹理来源，限制隐藏页面绘制，让播放、唱针、进度和界面切换在高分辨率显示器上保持稳定。"]},
        {title:"音频输出",items:["保持单一 Audio Graph，加入 EQ 真实响应余量、响度平滑、Spatial 路径预算和关键节点诊断，处理鼓点、设备折叠声道与切换参数瞬跳导致的爆音风险。"]},
        {title:"导入与反馈",items:["导入和重新扫描分帧提交，双箭头动效、四段频谱和标题对比恢复连续响应，不再通过硬控鼠标掩盖主线程压力。"]}
      ],english:{summary:"Consolidated maintenance: the Motion 120 Hz, 4K ambient stability, import responsiveness and audio-output diagnosis fixes are presented as one performance and playback-quality phase.",sections:[
        {title:"Motion and 4K",items:["Repeated expensive ambient composition and transition texture sources are removed, hidden-view painting is limited, and transport, Disk Reader, progress and page transitions remain stable at high resolution."]},
        {title:"Audio Output",items:["One Audio Graph is preserved while measured EQ headroom, smooth loudness gain, Spatial path budgets and key-node diagnostics address drum transients, device mono folding and parameter discontinuities."]},
        {title:"Import and Feedback",items:["Import and rescan commit work across frames; scan arrows, the four-band meter and title contrast recover continuous response without freezing pointer input to hide main-thread pressure."]}
      ]}}
    },
    {
      versions:["6.4.4","6.4.3","6.4.2"],
      release:{version:"6.4.2",date:"2026-07-23",kind:"patch",summary:"合并维护记录：弹窗材质、EQ 曲线、图标几何、Founder’s Note、中文本地化与听歌记录布局的重复视觉修复被统一整理。",sections:[
        {title:"统一视觉",items:["EQ Presets 复用 Snooze 玻璃弹窗；曲线、网格、半透明控制点和 Accent 同步得到统一，浅深色与缩放保持稳定。"]},
        {title:"图标与文案",items:["文件/文件夹、播放和导航图标的圆角、交叠颜色与抽纸动效得到校准；Founder’s Note 署名、中文文案和重新扫描命名完成修正。"]},
        {title:"听歌记录",items:["移除错误灰层和额外阴影，恢复页面留白、卡片布局、曲线图与十二周艺人数据的完整显示。"]}
      ],english:{summary:"Consolidated maintenance: repeated visual fixes for popover material, the EQ curve, icon geometry, Founder’s Note, Chinese localization and listening-history layout are unified.",sections:[
        {title:"Unified Visuals",items:["EQ Presets reuse the Snooze Glass popover, while curve geometry, grid lines, translucent control points and live Accent remain stable across themes and zoom."]},
        {title:"Icons and Copy",items:["File, Folder, Play and navigation glyph corners, overlaps and paper motion are recalibrated; Founder’s Note attribution, Chinese copy and Rescan naming are corrected."]},
        {title:"Listening History",items:["Incorrect grey layers and extra shadows are removed, restoring page spacing, cards, curved charts and complete twelve-week artist data."]}
      ]}}
    },
    {
      versions:["6.2.2","6.2.1"],
      release:{version:"6.2.1",date:"2026-07-20",kind:"patch",summary:"合并维护记录：空间音效从动态调音收敛为固定、可预测的八种模式，并统一说明弹窗、开关记忆与 A/B Bus 切换。",sections:[
        {title:"GP Spatial Engine 1.1",items:["删除实时 RMS、相关性、Genre/BPM/MFCC 动态改参；模式只在用户主动切换时通过 400 ms equal-power A/B Bus 淡化，关闭时真正回到原始 Dry 路径。"]},
        {title:"界面与持久化",items:["空间音效说明使用系统通用 Snooze 弹窗材质，开关记住上一次模式，关闭状态隐藏选择滑块且不留下错误高亮。"]}
      ],english:{summary:"Consolidated maintenance: Spatial Audio moves from dynamic tuning to eight fixed predictable modes while its information popover, remembered selection and A/B Bus switching are unified.",sections:[
        {title:"GP Spatial Engine 1.1",items:["Realtime RMS, correlation and Genre/BPM/MFCC parameter changes are removed. Modes change only through a user-triggered 400 ms equal-power A/B Bus crossfade, and Off returns to the true Dry path."]},
        {title:"UI and Persistence",items:["Spatial information uses the system Snooze popover material, the toggle remembers the previous mode, and disabled state hides selection without retaining an incorrect highlight."]}
      ]}}
    },
    {
      versions:["6.0.4","6.0.3","6.0.2"],
      release:{version:"6.0.2",date:"2026-07-20",kind:"patch",summary:"合并维护记录：传统视频画中画的小尺寸清晰度、实时设置同步、背景层次与窗口缩放稳定性被作为一次完整 PiP 稳定化整理。",sections:[
        {title:"清晰度与构图",items:["PiP 使用固定高分辨率画布和紧凑响应式构图，小尺寸不再模糊；封面去掉中心装饰点，宽、窄、横向窗口均保持可读。"]},
        {title:"实时同步与稳定",items:["主题、背景、字体、粗细与播放状态无需重开即可同步；静态和动态内容分层刷新，修复手动缩放后的自放大、边界抽搐和暂停冻结。"]}
      ],english:{summary:"Consolidated maintenance: small-window clarity, live settings synchronization, background hierarchy and resize stability are presented as one complete traditional-PiP stabilization.",sections:[
        {title:"Clarity and Composition",items:["PiP uses a fixed high-resolution canvas and compact responsive composition, keeping small windows sharp. The cover loses its center ornament and remains readable in wide, narrow and horizontal shapes."]},
        {title:"Live Sync and Stability",items:["Theme, background, font, weight and playback state synchronize without reopening. Static and dynamic layers refresh separately, fixing resize expansion, edge twitch and paused-frame freezing."]}
      ]}}
    },
    {
      versions:["5.8.6","5.8.5","5.8.4","5.8.3","5.8.2","5.8.1"],
      release:{version:"5.8.1",date:"2026-07-18",kind:"patch",summary:"合并维护记录：播放器布局、标题滚动、半透明滑动圆点、唱片/静态封面比例以及播放控制对齐的连续修复被整理为一次播放器视觉稳定化。",sections:[
        {title:"播放器布局",items:["统一恢复播放器居中构图和响应式留白，封面、唱片、唱针、进度、播放控制、音量与 Snooze 在窗口缩放时保持比例和视觉中心。"]},
        {title:"标题与控制反馈",items:["长标题只在真实溢出时等速完整循环；滑动圆点保持半透明 Accent 玻璃并在松手后清除选中态；四段频谱与运输按钮修复错位和不连续反馈。"]}
      ],english:{summary:"Consolidated maintenance: repeated Player layout, title marquee, translucent range thumb, artwork sizing and transport alignment fixes become one visual stabilization release.",sections:[
        {title:"Player Layout",items:["The centered responsive composition preserves proportional clearance around artwork, record, tonearm, progress, transport, volume and Snooze at every supported window size."]},
        {title:"Titles and Feedback",items:["Long titles move only when genuinely clipped and complete a constant-speed loop; range thumbs retain translucent Accent glass and release their active state; meter and transport geometry remain continuous."]}
      ]}}
    },
    {
      versions:["5.6.3","5.6.2","5.6.1"],
      release:{version:"5.6.1",date:"2026-07-17",kind:"patch",summary:"合并维护记录：Panther 后续围绕主题对比、页面落位、手动队列、每日推荐、拖拽排序与弹窗材质的重复修复统一收敛。",sections:[
        {title:"主题与页面稳定",items:["Accent 在深浅主题切换后重新计算可读对比，唱针亚克力与页面入场保持稳定，不再在最终落位时闪色或抽搐。"]},
        {title:"Queue 与 Daily Mix",items:["手动队列、每日推荐入队、拖拽落位和操作按钮反馈复用同一状态，不重建整个歌曲 Sector，也不遗留选中遮罩。"]}
      ],english:{summary:"Consolidated maintenance: Panther follow-up fixes for theme contrast, view settling, Manual Queue, Daily Mix, drag ordering and popover material converge into one patch.",sections:[
        {title:"Theme and View Stability",items:["Accent contrast is recalculated across light and dark themes while the tonearm acrylic and entering views settle without flashes or final-frame jumps."]},
        {title:"Queue and Daily Mix",items:["Manual Queue, Daily Mix insertion, drag placement and row actions share one state path without rebuilding the complete song sector or retaining stale selection masks."]}
      ]}}
    },
    {
      versions:["5.5.9","5.5.8","5.5.7"],
      release:{version:"5.5.3",date:"2026-07-17",kind:"patch",summary:"合并维护记录：页面淡入淡出、Snooze 与排序弹窗、按钮透明度、浅色对比和 Queue 清理逻辑的连续修复统一为 Motion 稳定化补丁。",sections:[
        {title:"Motion 与弹窗",items:["页面、Changelog、听歌记录和 Snooze 共用无抽搐的淡入淡出；Snooze、排序与后续情境弹窗使用同一背景取色、透明度和模糊模板。"]},
        {title:"按钮与 Queue",items:["浅色模式按钮、最近最爱答案、上一首/下一首动画和 Queue 添加/清空状态获得统一对比与可靠反馈。"]}
      ],english:{summary:"Consolidated maintenance: repeated page fades, Snooze and Sort popovers, button transparency, light-theme contrast and Queue cleanup fixes become one Motion stabilization patch.",sections:[
        {title:"Motion and Popovers",items:["Primary views, Changelog, Listening History and Snooze share a twitch-free fade lifecycle; Snooze, Sort and later contextual popovers share one sampled surface, transparency and blur template."]},
        {title:"Controls and Queue",items:["Light-theme controls, Recent Favorites answers, Previous/Next motion and Queue add/clear state receive consistent contrast and reliable feedback."]}
      ]}}
    },
    {
      versions:["5.5.5","5.5.4","5.5.3","5.5.2","5.5.1"],
      release:{version:"5.5.1",date:"2026-07-16",kind:"patch",summary:"合并维护记录：侧边栏、播放、歌单、听歌记录、设置与更新日志图标的时长、圆角、轨迹和回弹经过多轮校准后统一。",sections:[
        {title:"图标动效校准",items:["所有图标动效使用稳定时间轴和原路回落；播放脉冲、听歌数据轨迹、Library/Settings 线宽与 Changelog 双横线不再在结束帧闪烁或变形。"]}
      ],english:{summary:"Consolidated maintenance: timing, rounded geometry, traced paths and return motion for Sidebar, Play, Library, Listening History, Settings and Changelog icons are unified after repeated calibration.",sections:[
        {title:"Icon Motion Calibration",items:["Every icon returns through a stable timeline; Play pulses, Listening Data traces, Library/Settings strokes and Changelog lines no longer flash or deform on their final frame."]}
      ]}}
    },
    {
      versions:["5.3.9","5.3.8","5.3.7","5.3.6","5.3.5","5.3.4","5.3.3"],
      release:{version:"5.3.3",date:"2026-07-16",kind:"patch",summary:"合并维护记录：连续七次 Soft Scroll Edge 修复被整理为一个完整阶段，最终确立以真实滚动视口、固定外壳和内容溶解遮罩实现的 SSE。",sections:[
        {title:"Soft Scroll Edge",items:["移除白条、黑边、悬浮框、错位采样和超宽遮罩；SSE 严格贴合真实 Sector 边界，并根据上下滚动端点独立启停。","内容在固定面板背景上通过窄幅渐变溶解，不在内容上叠加黑白色块或发光边缘；Queue、Sound、Library、History、Settings 与 Changelog 共享同一底层。"]}
      ],english:{summary:"Consolidated maintenance: seven consecutive Soft Scroll Edge fixes become one complete phase, establishing real scroll viewports, stationary shells and content-dissolve masks as the final SSE model.",sections:[
        {title:"Soft Scroll Edge",items:["White bars, black edges, floating frames, incorrect sampling and oversized masks are removed. SSE follows the real sector boundary and independently responds to its top and bottom endpoints.","Content dissolves over the stationary panel surface through a compact gradient, never through a black, white or glowing overlay; Queue, Sound, Library, History, Settings and Changelog share the same foundation."]}
      ]}}
    },
    {
      versions:["4.4.2","4.4.1"],
      release:{version:"4.4.1",date:"2026-07-15",kind:"patch",summary:"合并维护记录：Spectrum ID 的保守身份匹配、扫描前后 metadata 快照、Custom EQ 记忆和重新扫描曲库入口被统一整理。",sections:[
        {title:"Recognition 与 Rescan",items:["Spectrum ID 以稳定音频特征关联改名前后歌曲，扫描前后各保留一版 metadata；重新扫描曲库可显式刷新显示信息而不破坏音频分析缓存。"]},
        {title:"Custom EQ",items:["Custom 始终可见并记住用户最后一次手动曲线，重新选择时平滑恢复。"]}
      ],english:{summary:"Consolidated maintenance: conservative Spectrum ID matching, before/after metadata snapshots, remembered Custom EQ and the Rescan Library entry are unified.",sections:[
        {title:"Recognition and Rescan",items:["Spectrum ID links renamed tracks through stable audio features and retains before/after metadata snapshots; Rescan Library refreshes visible information without discarding analysis caches."]},
        {title:"Custom EQ",items:["Custom remains available and recalls the last manually adjusted curve with a smooth restore."]}
      ]}}
    },
    {
      versions:["4.1.2","4.1.1"],
      release:{version:"4.1.1",date:"2026-07-15",kind:"patch",summary:"合并维护记录：Snow Leopard 架构后的 Core/Motion 标识与封面自适应 Accent 算法在同一次维护阶段完成校准。",sections:[
        {title:"Core 与 Adaptive Accent",items:["GP Core 2.0、GP Motion Engine 1.1 标识完成同步；封面主题色由真实封面与背景共同计算，抑制过艳颜色并保留必要对比。"]}
      ],english:{summary:"Consolidated maintenance: post–Snow Leopard Core/Motion identity and cover-adaptive Accent tuning are calibrated in one maintenance phase.",sections:[
        {title:"Core and Adaptive Accent",items:["GP Core 2.0 and GP Motion Engine 1.1 identity is synchronized; cover Accent is derived from real artwork and background, restraining excessive saturation while preserving contrast."]}
      ]}}
    },
    {
      versions:["3.5.3","3.5.2","3.5.1"],
      release:{version:"3.5.1",date:"2026-07-14",kind:"patch",summary:"合并维护记录：动态封面背景、侧边栏滑块、字体滑块对齐与自适应 Accent 冲突的重复修复归为 Final Hotfix 阶段。",sections:[
        {title:"Aesthetic Stability",items:["封面取色背景、侧边栏选择滑块和字体控制恢复稳定；启用 Match UI Accent 时手动 Accent 正确禁用，关闭后恢复触控。"]}
      ],english:{summary:"Consolidated maintenance: repeated fixes for cover-derived backgrounds, the Sidebar selector, font alignment and adaptive Accent conflicts form the final hotfix phase.",sections:[
        {title:"Aesthetic Stability",items:["Cover-derived background, Sidebar selection and typography controls remain stable; manual Accent disables while Match UI Accent is active and returns when it is turned off."]}
      ]}}
    },
    {
      versions:["3.4.3","3.4.2","3.4.1"],
      release:{version:"3.4.1",date:"2026-07-14",kind:"patch",summary:"合并维护记录：中英文完整覆盖、分段毛玻璃滑块、EQ 选中状态、侧边栏对齐和无级字体粗细在同一语言与 UI 稳定化阶段完成。",sections:[
        {title:"Language 与 Controls",items:["英文模式补齐按钮、说明与更新日志；语言、EQ、主侧边栏和其他分段控件共享平滑玻璃滑块，首次载入即可正确显示。"]}
      ],english:{summary:"Consolidated maintenance: complete Chinese/English coverage, segmented Glass selectors, EQ selection, Sidebar alignment and continuous font weight are delivered as one language and UI stabilization phase.",sections:[
        {title:"Language and Controls",items:["English mode covers controls, annotations and Changelog; Language, EQ, Sidebar and other segmented controls share a smooth Glass selector visible from first paint."]}
      ]}}
    },
    {
      versions:["3.3.3","3.3.2"],
      release:{version:"3.3.2",date:"2026-07-14",kind:"patch",summary:"合并维护记录：重复导入与播放队列拦截、拖拽圆角/排序稳定、字体列表和播放器边框的连续 Hotfix 被统一整理。",sections:[
        {title:"Queue 与 Typography",items:["同一音频文件无法重复加入并提供明确提示；拖拽歌曲保持圆角和稳定占位；字体列表收敛为有效且中英文兼容的选择。"]}
      ],english:{summary:"Consolidated maintenance: duplicate import and Queue prevention, rounded stable drag ordering, the font list and Player borders become one Hotfix record.",sections:[
        {title:"Queue and Typography",items:["The same audio file cannot be imported or queued twice and receives a clear notice; dragged tracks remain rounded with stable placement; fonts and Player borders remain consistent."]}
      ]}}
    },
    {
      versions:["3.2.2","3.2.1"],
      release:{version:"3.2.1",date:"2026-07-14",kind:"patch",summary:"合并维护记录：播放器/侧边栏边距、更新日志标签光晕与 Queue 初期交互问题被整理为一次早期界面稳定化。",sections:[
        {title:"Layout 与 Queue",items:["播放器、侧边栏与上下边框恢复一致留白；更新日志版本标签恢复可见光晕；Queue 的位置、添加与移除反馈得到修正。"]}
      ],english:{summary:"Consolidated maintenance: Player and Sidebar spacing, Changelog tag glow and early Queue interaction fixes become one interface-stability patch.",sections:[
        {title:"Layout and Queue",items:["Player, Sidebar and frame spacing are aligned; Changelog version tags regain restrained glow; Queue position, add and remove feedback are repaired."]}
      ]}}
    }
  ];
  const mergedPatchLookup=new Map(),mergedPatchEntries=new Map();
  MERGED_PATCH_GROUPS.forEach(group=>group.versions.forEach(version=>{mergedPatchLookup.set(version,group.release);mergedPatchEntries.set(group.release.version,group.release);}));
  const DISPLAY_VERSION_REMAP=new Map([
    ["6.6.5","6.6.2"],
    ["6.5.5","6.5.2"],
    ["5.5.6","5.5.2"]
  ]);
  const HIDDEN_RELEASE_VERSIONS=new Set(["GP Gen 4 Pre-Release Update"]);
  const DISPLAY_RELEASES=[];const emittedMergedReleases=new Set();
  RELEASES.forEach(release=>{
    if(HIDDEN_RELEASE_VERSIONS.has(release.version))return;
    const merged=mergedPatchLookup.get(release.version);
    if(!merged){
      const displayVersion=DISPLAY_VERSION_REMAP.get(release.version);
      DISPLAY_RELEASES.push(displayVersion?{...release,version:displayVersion,english:RELEASE_EN_DETAIL[release.version]}:release);
      return;
    }
    if(emittedMergedReleases.has(merged.version))return;
    emittedMergedReleases.add(merged.version);DISPLAY_RELEASES.push(merged);
  });

  function selectRelease(index,animate=true){
    const releases=GP.changelog.getReleases(),release=releases[index]||releases[1];
    $$(".release-button").forEach((button, i) => button.classList.toggle("active", i === index));
    const english=uiLanguage!=="zh";
    const englishDetail=english?(release.english||RELEASE_EN_DETAIL[release.version]):null;
    const displaySummary=english?(englishDetail?.summary||RELEASE_EN[release.version]||"Maintenance and interface improvements."):release.summary;
    const displaySections=english?(englishDetail?.sections||[{title:"Changes",items:[RELEASE_EN[release.version]||"Maintenance and interface improvements."]}]):release.sections;
    const sections = displaySections.map(section => `
      <section class="release-section">
        <h3>${escapeHTML(section.title)}</h3>
        <ul>${section.items.map(item => `<li>${escapeHTML(item)}</li>`).join("")}</ul>
      </section>`).join("");
    const detail=$("#releaseDetail");
    const commit=()=>{detail.innerHTML = `
      <div class="release-kicker">${release.kind === "ideas" ? "IDEA BACKLOG" : "RELEASE NOTES"}</div>
      <div class="release-title-row">
        <h2 class="release-title">${escapeHTML(release.version)}</h2>
        <time class="release-date">${escapeHTML(english&&release.date==="待定"?"TBD":release.date)}</time>
      </div>
      <p class="release-summary">${escapeHTML(displaySummary)}</p>
      ${sections}`;
    detail.scrollTop = 0;return detail;};
    transitionMotionSector(detail,()=>detail,commit,animate);
  }
  function toggleReleaseBranch(details){
    const body=details?.querySelector(":scope>.release-generation-body,:scope>.release-minor-body");if(!body)return;
    details._gpBranchMotion?.cancel();
    if(details.open){
      const selected=details.querySelector(".release-button.active");if(selected)selected.classList.remove("active");
      const height=body.getBoundingClientRect().height||body.scrollHeight;
      const motion=body.animate([{height:`${height}px`,opacity:1},{height:"0px",opacity:0}],{duration:150,easing:"cubic-bezier(.4,0,.6,1)"});details._gpBranchMotion=motion;
      motion.onfinish=()=>{details.open=false;body.style.removeProperty("height");body.style.removeProperty("opacity");details._gpBranchMotion=null;};
      return;
    }
    details.open=true;const height=body.scrollHeight;
    const motion=body.animate([{height:"0px",opacity:0},{height:`${height}px`,opacity:0,offset:.7},{height:`${height}px`,opacity:1}],{duration:480,easing:"cubic-bezier(.2,.78,.2,1)"});details._gpBranchMotion=motion;
    motion.onfinish=()=>{body.style.removeProperty("height");body.style.removeProperty("opacity");details._gpBranchMotion=null;};
  }
  function renderChangelog(){
    const index = $("#releaseIndex"),releases=GP.changelog.getReleases();
    const direct=[],generations=new Map();
    releases.forEach((release,i)=>{
      const match=/^(\d+)\.(\d+)\.(\d+)$/.exec(release.version);if(!match){direct.push({release,i});return;}
      const generation=match[1],minor=`${match[1]}.${match[2]}`;
      if(!generations.has(generation))generations.set(generation,new Map());
      const minors=generations.get(generation);if(!minors.has(minor))minors.set(minor,[]);minors.get(minor).push({release,i});
    });
    const releaseButton=({release,i})=>`<button class="release-button ripple-target" data-release-index="${i}"><strong>${escapeHTML(release.version)}</strong></button>`;
    const tree=[...generations.entries()].map(([generation,minors])=>`<details class="release-generation" ${generation==="7"?"open":""}><summary>Gen ${generation}</summary><div class="release-generation-body">${[...minors.entries()].map(([minor,items])=>`<details class="release-minor" ${minor==="7.4"?"open":""}><summary>${escapeHTML(minor)}</summary><div class="release-minor-body">${items.map(releaseButton).join("")}</div></details>`).join("")}</div></details>`).join("");
    index.innerHTML = `<div class="release-index-label">${tr("选择版本","Select Version")}</div>${direct.map(releaseButton).join("")}${tree}`;
    if(!index.dataset.wired){index.addEventListener("click", e => {const summary=e.target.closest("summary");if(summary&&index.contains(summary)){e.preventDefault();toggleReleaseBranch(summary.parentElement);return;}const button = e.target.closest(".release-button");if(button)selectRelease(Number(button.dataset.releaseIndex),true);});index.dataset.wired="1";}
    selectRelease(1,false);
  }
  function buildChangelogText(){
    const english=uiLanguage!=="zh";
    const lines=[`Glass Player ${english?"Complete Changelog":"完整更新日志"}`,`${english?"Current Version":"当前版本"}: 7.6.2 — REBRAND UPDATE`,""];
    GP.changelog.getReleases().forEach(release=>{
      const date=english&&release.date==="待定"?"TBD":release.date;
      const englishDetail=english?(release.english||RELEASE_EN_DETAIL[release.version]):null;
      const summary=english?(englishDetail?.summary||RELEASE_EN[release.version]||"Maintenance and interface improvements."):release.summary;
      const sections=english?(englishDetail?.sections||[{title:"Changes",items:[RELEASE_EN[release.version]||"Maintenance and interface improvements."]}]):release.sections;
      lines.push(`## ${release.version} (${date})`);
      lines.push(summary,"");
      sections.forEach(section=>{lines.push(`### ${section.title}`);section.items.forEach(item=>lines.push(`- ${item}`));lines.push("");});
    });
    return lines.join("\r\n").trim()+"\r\n";
  }
  function exportChangelog(){
    const blob=new Blob(["\uFEFF",buildChangelogText()],{type:"text/plain;charset=utf-8"});
    const url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download="Glass Player Changelog 7.6.2 REBRAND UPDATE.txt";document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
    showToast(tr("完整更新日志已导出","Complete changelog exported"));
  }
    function cloneRelease(release){if(!release)return null;return Object.freeze({...release,sections:Object.freeze(release.sections.map(section=>Object.freeze({...section,items:Object.freeze([...section.items])})))});}
    function getReleases(){return Object.freeze(DISPLAY_RELEASES.map(cloneRelease));}
    function getRelease(version){if(HIDDEN_RELEASE_VERSIONS.has(version))return null;return cloneRelease(DISPLAY_RELEASES.find(release=>release.version===version)||RELEASES.find(release=>release.version===version));}
    return Object.freeze({getReleases,getRelease,render:renderChangelog,exportLog:exportChangelog});
  })();
  /* ================= GP Neural Engine 2.1: offline genre graph =================
     Built from broad genre/style hierarchies (Discogs, MusicBrainz and the
     AcousticBrainz multi-label taxonomy). Runtime lookup is deliberately local:
     this module performs no network request and stores no remote identifier. */
  GP.genreRelations=(()=>{
    const families=Object.freeze({
      pop:["pop","dance-pop","synth-pop","art pop","indie pop","cantopop","mandopop","c-pop","k-pop","j-pop","adult contemporary"],
      rock:["rock","alternative rock","indie rock","hard rock","soft rock","art rock","progressive rock","psychedelic rock","electronic rock"],
      metal:["metal","heavy metal","alternative metal","progressive metal","metalcore","nu metal"],
      punk:["punk","punk rock","post-punk","pop punk","hardcore punk","new wave"],
      electronic:["electronic","electronica","edm","electro","idm","downtempo","trip hop","future bass","electropop"],
      house:["house","deep house","progressive house","electro house","future house","acid house","afro house"],
      techno:["techno","minimal techno","acid techno","industrial techno","hard techno"],
      trance:["trance","progressive trance","psytrance","goa trance","uplifting trance"],
      "drum and bass":["drum and bass","drum & bass","dnb","jungle","liquid funk","breakbeat"],
      ambient:["ambient","dark ambient","drone","chillout","new age","space music"],
      "hip hop":["hip hop","hip-hop","rap","trap","boom bap","abstract hip hop","cloud rap"],
      "r&b":["r&b","rnb","rhythm and blues","contemporary r&b","neo soul"],
      soul:["soul","motown","northern soul","gospel","blue-eyed soul"],
      funk:["funk","disco","boogie","p-funk","afro-funk"],
      jazz:["jazz","smooth jazz","bebop","hard bop","cool jazz","fusion","jazz fusion","latin jazz"],
      blues:["blues","rhythm & blues","electric blues","acoustic blues","blues rock"],
      classical:["classical","baroque","romantic","modern classical","opera","chamber music","orchestral"],
      folk:["folk","singer-songwriter","folk rock","acoustic","traditional","world","folk world country"],
      country:["country","country rock","americana","bluegrass","alt-country"],
      reggae:["reggae","dub","ska","dancehall","roots reggae"],
      latin:["latin","salsa","bossa nova","reggaeton","latin pop","latin jazz"],
      soundtrack:["soundtrack","stage and screen","film score","video game music","musical","score"]
    });
    const display=Object.freeze({
      pop:"Pop",rock:"Rock",metal:"Metal",punk:"Punk",electronic:"Electronic",house:"House",techno:"Techno",trance:"Trance",
      "drum and bass":"Drum & Bass",ambient:"Ambient","hip hop":"Hip-Hop","r&b":"R&B",soul:"Soul",funk:"Funk",jazz:"Jazz",
      blues:"Blues",classical:"Classical",folk:"Folk",country:"Country",reggae:"Reggae",latin:"Latin",soundtrack:"Soundtrack"
    });
    const edges=[
      ["pop","rock",.58],["pop","electronic",.68],["pop","r&b",.67],["pop","soul",.55],["pop","folk",.46],["pop","soundtrack",.42],
      ["rock","metal",.72],["rock","punk",.76],["rock","blues",.68],["rock","folk",.54],["rock","electronic",.48],
      ["metal","punk",.53],["punk","electronic",.42],["punk","pop",.44],
      ["electronic","house",.88],["electronic","techno",.84],["electronic","trance",.82],["electronic","drum and bass",.76],["electronic","ambient",.65],["electronic","hip hop",.44],
      ["house","techno",.78],["house","trance",.72],["house","drum and bass",.45],["house","funk",.57],["house","pop",.62],
      ["techno","trance",.68],["techno","drum and bass",.54],["techno","ambient",.48],
      ["trance","ambient",.55],["drum and bass","hip hop",.48],["drum and bass","ambient",.38],
      ["hip hop","r&b",.78],["hip hop","soul",.62],["hip hop","funk",.67],["hip hop","electronic",.52],
      ["r&b","soul",.9],["r&b","funk",.72],["r&b","jazz",.59],["soul","funk",.84],["soul","jazz",.68],["soul","gospel",.76],
      ["funk","jazz",.7],["funk","disco",.86],["jazz","blues",.77],["jazz","latin",.57],["blues","folk",.56],["blues","country",.6],
      ["folk","country",.82],["folk","classical",.35],["country","rock",.51],["reggae","ska",.88],["reggae","latin",.42],["reggae","hip hop",.43],
      ["latin","pop",.52],["latin","jazz",.6],["soundtrack","classical",.67],["soundtrack","ambient",.55],["soundtrack","electronic",.43]
    ];
    const aliases=new Map(),graph=new Map(),resolveCache=new Map(),similarityCache=new Map();
    function cacheSet(cache,key,value,limit){if(cache.size>=limit)cache.delete(cache.keys().next().value);cache.set(key,value);return value;}
    const normalize=value=>String(value||"").normalize("NFKD").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
    Object.entries(families).forEach(([canonical,names])=>{aliases.set(normalize(canonical),canonical);names.forEach(name=>aliases.set(normalize(name),canonical));graph.set(canonical,new Map([[canonical,1]]));});
    function connect(a,b,weight){if(!graph.has(a)||!graph.has(b))return;graph.get(a).set(b,weight);graph.get(b).set(a,weight);}
    edges.forEach(edge=>connect(...edge));
    function dice(a,b){
      if(a===b)return 1;if(a.length<2||b.length<2)return 0;
      const counts=new Map();for(let i=0;i<a.length-1;i++){const pair=a.slice(i,i+2);counts.set(pair,(counts.get(pair)||0)+1);}
      let matches=0;for(let i=0;i<b.length-1;i++){const pair=b.slice(i,i+2),count=counts.get(pair)||0;if(count){matches++;counts.set(pair,count-1);}}
      return 2*matches/((a.length-1)+(b.length-1));
    }
    function resolveOne(value){
      const normalized=normalize(value);if(!normalized)return null;
      if(resolveCache.has(normalized))return resolveCache.get(normalized);
      if(aliases.has(normalized)){const id=aliases.get(normalized);return cacheSet(resolveCache,normalized,{id,label:display[id],confidence:1,matched:normalized},512);}
      let best=null;
      for(const [name,id] of aliases){const score=dice(normalized,name);if(!best||score>best.confidence)best={id,label:display[id],confidence:score,matched:name};}
      return cacheSet(resolveCache,normalized,best&&best.confidence>=.48?best:null,512);
    }
    function resolve(value){
      const parts=String(value||"").split(/[\/,;|+]+/).map(resolveOne).filter(Boolean);
      return parts.length?parts.sort((a,b)=>b.confidence-a.confidence)[0]:resolveOne(value);
    }
    function graphSimilarity(a,b){
      if(a===b)return 1;
      const direct=graph.get(a)?.get(b);if(Number.isFinite(direct))return direct;
      let best=0;
      for(const [middle,left] of graph.get(a)||[]){const right=graph.get(middle)?.get(b);if(Number.isFinite(right))best=Math.max(best,left*right*.88);}
      return best;
    }
    function similarity(left,right){
      const leftKey=normalize(left),rightKey=normalize(right),cacheKey=leftKey<rightKey?`${leftKey}\u0000${rightKey}`:`${rightKey}\u0000${leftKey}`;
      if(similarityCache.has(cacheKey))return similarityCache.get(cacheKey);
      const a=resolve(left),b=resolve(right);if(!a||!b)return cacheSet(similarityCache,cacheKey,.12*dice(leftKey,rightKey),2048);
      const relation=graphSimilarity(a.id,b.id),certainty=Math.sqrt(a.confidence*b.confidence);
      return cacheSet(similarityCache,cacheKey,Math.max(.08,Math.min(1,relation*certainty+(1-certainty)*dice(leftKey,rightKey)*.38)),2048);
    }
    function relatedScore(map,genre){
      if(!map||!genre)return 0;
      const values=Object.values(map).map(value=>Math.abs(Number(value)||0)),max=Math.max(1,...values);let weighted=0,weight=0;
      Object.entries(map).forEach(([candidate,value])=>{const relation=similarity(candidate,genre);if(relation<.18)return;weighted+=(Number(value)||0)*relation;weight+=relation;});
      return Math.max(-1,Math.min(1,weight?weighted/(max*Math.max(1,Math.sqrt(weight))):0));
    }
    return Object.freeze({version:"1.0.0",source:"offline-static",families,resolve,similarity,relatedScore});
  })();
  /* ================= built-in changelog ================= */
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
  /* Motion Engine 3.3 sector primitive: fade out, expose the real background
     for a short beat, then fade the committed destination in. */
  const gpSectorMotionStates=new WeakMap();
  function transitionMotionSector(host,getCurrent,commit,animate=true){
    if(!host||typeof commit!=="function")return;
    if(!animate||matchMedia("(prefers-reduced-motion: reduce)").matches){
      const incoming=commit();incoming?.classList.remove("gp-sector-exit","gp-sector-enter");return;
    }
    let state=gpSectorMotionStates.get(host);
    if(!state){state={phase:"idle",pending:null,timer:0,settleTimer:0};gpSectorMotionStates.set(host,state);}
    state.pending={getCurrent,commit};
    if(state.phase!=="idle")return;
    const run=()=>{
      const task=state.pending;if(!task){state.phase="idle";return;}
      state.pending=null;
      const outgoing=task.getCurrent?.();state.phase="exit";
      outgoing?.classList.remove("gp-sector-enter");
      outgoing?.classList.add("gp-motion-stable","gp-sector-exit");
      clearTimeout(state.timer);clearTimeout(state.settleTimer);
      state.timer=setTimeout(()=>{
        outgoing?.classList.remove("gp-sector-exit");
        const incoming=task.commit();
        if(!incoming){state.phase="idle";if(state.pending)run();return;}
        incoming.classList.add("gp-motion-stable","gp-sector-gap");state.phase="gap";
        state.timer=setTimeout(()=>{
          incoming.classList.remove("gp-sector-gap");incoming.classList.add("gp-sector-enter");state.phase="enter";
          state.settleTimer=setTimeout(()=>{
            incoming.style.willChange="opacity";incoming.classList.remove("gp-sector-enter");
            requestAnimationFrame(()=>incoming.style.removeProperty("will-change"));
            state.phase="idle";if(state.pending)run();
          },155);
        },42);
      },130);
    };
    run();
  }
  $("#exportChangelogBtn").addEventListener("click",GP.changelog.exportLog);
  function syncVersionStoryText(){
    $("#versionStoryText").textContent=tr(
      "一切始于那个寻常的下午。伟大的项目从不诞生于万事俱备，而始于有人愿意先迈出第一步。",
      "It began on an ordinary afternoon. Great projects are not born when everything is ready, but when someone has the courage to take the first step."
    );
  }
  function setVersionStory(open){
    const modal=$("#versionStoryModal");syncVersionStoryText();modal.classList.toggle("show",!!open);modal.setAttribute("aria-hidden",String(!open));
    if(open)requestAnimationFrame(()=>$("#versionStoryClose").focus());
  }
  $("#currentVersionBtn").addEventListener("click",()=>setVersionStory(true));
  const versionStoryClose=$("#versionStoryClose");
  bindMicroMotion(versionStoryClose,"version-close-motion",400);
  versionStoryClose.addEventListener("click",()=>setVersionStory(false));
  /* ================= glow feedback ================= */
  const heldPressTargets=new Map();
  const pressReleaseTimers=new WeakMap();
  const gpMotionRestartTokens=new WeakMap();
  function restartCssMotion(element,className){
    if(!element)return;const token=(gpMotionRestartTokens.get(element)||0)+1;gpMotionRestartTokens.set(element,token);
    element.getAnimations?.({subtree:true}).forEach(animation=>animation.cancel());element.classList.remove(className);
    requestAnimationFrame(()=>{if(gpMotionRestartTokens.get(element)===token)element.classList.add(className);});
  }
  function releaseHeldPress(pointerId){
    const el=heldPressTargets.get(pointerId);if(!el)return;heldPressTargets.delete(pointerId);
    el.classList.remove("gp-press-held");restartCssMotion(el,"gp-press-release");
    clearTimeout(pressReleaseTimers.get(el));
    pressReleaseTimers.set(el,setTimeout(()=>{el.classList.remove("gp-press-release");pressReleaseTimers.delete(el);},230));
  }
  document.addEventListener("pointerdown",event=>{
    const el=event.target.closest("button,.ripple-target");if(!el||el.matches(":disabled,.toggle-switch"))return;
    clearTimeout(pressReleaseTimers.get(el));el.classList.remove("glow-pulse","gp-press-release");el.classList.add("gp-press-held");
    heldPressTargets.set(event.pointerId,el);
  },true);
  window.addEventListener("pointerup",event=>releaseHeldPress(event.pointerId));
  window.addEventListener("pointercancel",event=>releaseHeldPress(event.pointerId));
  /* ================= pause background work when tab is hidden ================= */
  document.addEventListener("visibilitychange", () => {
    document.body.classList.toggle("tab-hidden", document.hidden);
    if(!document.hidden && bgMode==="color" && playlist[currentIndex]?.coverUrl) startCoverColorMotion();
  });

  /* ================= sidebar navigation ================= */
  function updateNavGlider(animate=true){
    const sidebar=$(".sidebar"),active=sidebar?.querySelector(".nav-item.active");if(!sidebar||!active)return;
    const y=active.offsetTop,w=active.offsetWidth,h=active.offsetHeight;
    if(!w||!h){sidebar.classList.remove("nav-glider-ready");return;}
    let glider=sidebar.querySelector(":scope>.nav-glider");
    if(!glider){glider=document.createElement("div");glider.className="nav-glider";sidebar.prepend(glider);}
    const oldY=Number(glider.dataset.y||y),oldH=Number(glider.dataset.h||h);
    glider.style.height=`${h}px`;glider.style.transform=`translate3d(0,${y}px,0)`;
    if(animate&&Math.abs(oldY-y)>.5){
      glider.getAnimations().forEach(animation=>animation.cancel());
      glider.style.willChange="transform";
      const motion=glider.animate([
        {transform:`translate3d(0,${oldY}px,0) scale(1,${oldH/h})`},
        {transform:`translate3d(0,${oldY+(y-oldY)*.62}px,0) scale(1.018,1.028)`,offset:.58},
        {transform:`translate3d(0,${y}px,0) scale(1)`}
      ],{duration:420,easing:"cubic-bezier(.2,.82,.2,1)"});
      motion.onfinish=motion.oncancel=()=>{glider.style.willChange="auto";};
    }
    glider.dataset.y=y;glider.dataset.h=h;
    sidebar.classList.add("nav-glider-ready");
  }
  /* Shared semantic micro-interaction trigger. Hover requires a deliberate
     300 ms dwell; click always restarts the complete motion immediately. */
  function replayMicroMotion(element,className,duration=400){
    if(!element||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    restartCssMotion(element,className);
    clearTimeout(element._gpMicroResetTimer);
    element._gpMicroResetTimer=setTimeout(()=>element.classList.remove(className),duration+40);
  }
  function bindMicroMotion(element,className,duration=400){
    if(!element)return;
    element.addEventListener("pointerenter",()=>{
      clearTimeout(element._gpMicroHoverTimer);
      element._gpMicroHoverTimer=setTimeout(()=>{element._gpMicroHoverTimer=0;replayMicroMotion(element,className,duration);},300);
    });
    element.addEventListener("pointerleave",()=>{clearTimeout(element._gpMicroHoverTimer);element._gpMicroHoverTimer=0;});
    element.addEventListener("click",()=>{clearTimeout(element._gpMicroHoverTimer);element._gpMicroHoverTimer=0;replayMicroMotion(element,className,duration);});
  }
  function bindImmediateMotion(element,className,duration=300){
    if(!element)return;
    element.addEventListener("pointerdown",event=>{if(event.button===0)replayMicroMotion(element,className,duration);});
  }
  function playSidebarIconMotion(btn){
    if(!btn||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    /* CSS keyframes are the compatibility source of truth. Removing and
       re-adding this class restarts hover/click motion without SVG WAAPI. */
    restartCssMotion(btn,"icon-motion-run");
    clearTimeout(btn._iconMotionTimer);
    const resetAfter=620;
    btn._iconMotionTimer=setTimeout(()=>btn.classList.remove("icon-motion-run"),resetAfter);
  }
  const GP_VIEW_EXIT_MS=150,GP_VIEW_GAP_MS=32,GP_VIEW_ENTER_MS=180;
  let gpViewPhase="idle",gpPendingView=null,gpViewExitTimer=0,gpViewEnterTimer=0,gpViewTransitionToken=0;
  function refreshPrimaryViewLayout(viewName){
    requestAnimationFrame(()=>{
      fitActiveView($(`.view[data-view="${viewName}"]`));updateAllGliders(false);updateNavGlider(true);refreshScrollEdgeFrames();updateAdaptiveTextColors();updateContextualControlColors();syncSidebarCompactMode();
      if(viewName==="history")requestAnimationFrame(()=>{scheduleHistoryRender();refreshScrollEdgeFrames();updateAdaptiveTextColors();updateContextualControlColors();if(typeof maybeAutoOpenAnnualReport==="function")maybeAutoOpenAnnualReport();});
      if(viewName==="player")requestAnimationFrame(()=>{$("#curTime").textContent=fmtTime(audio.currentTime);if(audio.duration)seekProgress=Math.max(0,Math.min(1,audio.currentTime/audio.duration));drawWaveform();syncDiscRotationTimeline(!audio.paused&&!audio.ended);drawDiscRotation();miniEqGeometry=null;drawMiniEq();syncMiniEqMeter();refreshNowTitleMarquee();if(typeof syncPlaybackMotion120==="function")syncPlaybackMotion120();});
      else{if(typeof syncPlaybackMotion120==="function")syncPlaybackMotion120();if(typeof syncMiniEqMeter==="function")syncMiniEqMeter();}
    });
  }
  function switchPrimaryView(viewName){
    const current=$(".view.active"),requested=$(`.view[data-view="${viewName}"]`);
    if(!requested||!current||requested===current)return false;
    gpPendingView=viewName;
    if(matchMedia("(prefers-reduced-motion: reduce)").matches){
      clearTimeout(gpViewExitTimer);clearTimeout(gpViewEnterTimer);gpViewPhase="idle";
      document.body.classList.remove("gp-view-transitioning");
      $$(".view").forEach(view=>{view.classList.remove("active","gp-view-exit","gp-view-enter");view.style.removeProperty("will-change");});
      requested.classList.add("active");refreshPrimaryViewLayout(viewName);return true;
    }
    /* Fade the complete outgoing view to the actual app background, hold that
       background briefly, then commit and fade in the destination. */
    if(gpViewPhase==="exit"||gpViewPhase==="enter")return true;
    const transitionToken=++gpViewTransitionToken;
    const destination=$(`.view[data-view="${gpPendingView}"]`)||current;
    gpViewPhase="exit";
    current.classList.remove("gp-view-enter");current.classList.add("gp-view-exit");
    clearTimeout(gpViewExitTimer);clearTimeout(gpViewEnterTimer);
    gpViewExitTimer=setTimeout(()=>{
      if(transitionToken!==gpViewTransitionToken)return;
      current.classList.remove("active","gp-view-exit");gpViewPhase="gap";
      gpViewEnterTimer=setTimeout(()=>{
        if(transitionToken!==gpViewTransitionToken)return;
        destination.style.opacity="0";destination.classList.add("active");fitActiveView(destination);updateAllGliders(false);
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          if(transitionToken!==gpViewTransitionToken)return;
          destination.classList.add("gp-view-enter");destination.style.removeProperty("opacity");gpViewPhase="enter";refreshPrimaryViewLayout(destination.dataset.view);
          document.body.classList.remove("gp-view-transitioning");
          gpViewEnterTimer=setTimeout(()=>{
          if(transitionToken!==gpViewTransitionToken)return;
          destination.classList.remove("gp-view-enter");destination.style.removeProperty("will-change");
          document.body.classList.remove("gp-view-transitioning");
          $$(".view").forEach(view=>{if(view!==destination)view.classList.remove("active","gp-view-overlay","gp-view-enter","gp-view-exit");});
          gpViewPhase="idle";const latest=gpPendingView;if(latest&&latest!==destination.dataset.view)switchPrimaryView(latest);
          },GP_VIEW_ENTER_MS+24);
        }));
      },GP_VIEW_GAP_MS);
    },GP_VIEW_EXIT_MS+8);
    return true;
  }
  function mountPrimaryNavButton(btn){
    if(!btn||btn.dataset.gpNavMounted==="1")return;btn.dataset.gpNavMounted="1";
    btn.addEventListener("pointerenter",()=>{
      clearTimeout(btn._iconHoverTimer);
      btn._iconHoverTimer=setTimeout(()=>{btn._iconHoverTimer=0;playSidebarIconMotion(btn);},300);
    });
    btn.addEventListener("pointerleave",()=>{clearTimeout(btn._iconHoverTimer);btn._iconHoverTimer=0;});
    btn.addEventListener("click", () => {
      clearTimeout(btn._iconHoverTimer);btn._iconHoverTimer=0;
      playSidebarIconMotion(btn);
      if(btn.classList.contains("active"))return;
      $$(".nav-item").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      switchPrimaryView(btn.dataset.view);
      requestAnimationFrame(()=>updateNavGlider(true));
    });
  }
  $$(".nav-item").forEach(mountPrimaryNavButton);
  const sidebarShell=$("#appShell"),sidebar=$(".sidebar"),sidebarToggle=$("#sidebarToggle"),sidebarBrand=$(".brand"),sidebarBrandLogo=$(".brand-logo");
  let sidebarSettleTimer=0,sidebarBrandHintTimer=0,sidebarHintHandoffTimer=0,sidebarLabelFadeFrame=0,sidebarCompactMode=false;
  const sidebarHintIcon=document.createElement("span");
  sidebarHintIcon.className="sidebar-expand-hint-icon";
  sidebarHintIcon.setAttribute("aria-hidden","true");
  sidebarHintIcon.innerHTML=sidebarToggle?.querySelector("svg")?.outerHTML||"";
  sidebarBrand?.appendChild(sidebarHintIcon);
  function clearSidebarBrandHint(){
    clearTimeout(sidebarBrandHintTimer);sidebarBrandHintTimer=0;
    sidebar?.classList.remove("sidebar-brand-hint");
  }
  function refreshBrandOverflow(){
    const host=sidebarBrand?.querySelector(".brand-name"),track=host?.querySelector(".brand-name-track");if(!host||!track)return;
    const overflow=Math.max(0,track.scrollWidth-host.clientWidth);
    host.style.setProperty("--brand-scroll-distance",`${overflow}px`);
    host.classList.toggle("brand-name-overflow",overflow>2&&!sidebarShell?.classList.contains("sidebar-collapsed"));
  }
  const brandResizeObserver=typeof ResizeObserver==="function"?new ResizeObserver(()=>requestAnimationFrame(refreshBrandOverflow)):null;
  [sidebar,sidebarBrand,sidebarBrand?.querySelector(".brand-name")].filter(Boolean).forEach(node=>brandResizeObserver?.observe(node));
  document.fonts?.ready?.then(()=>requestAnimationFrame(refreshBrandOverflow));
  function settleSidebarGeometry(){
    clearTimeout(sidebarSettleTimer);
    sidebarSettleTimer=setTimeout(()=>{updateNavGlider(false);fitActiveView();refreshScrollEdgeFrames();},540);
  }
  function cancelSidebarLabelFadeWatch(){
    if(sidebarLabelFadeFrame)cancelAnimationFrame(sidebarLabelFadeFrame);
    sidebarLabelFadeFrame=0;
  }
  function watchSidebarLabelContact(triggerRight){
    cancelSidebarLabelFadeWatch();
    const watch=()=>{
      if(!sidebarShell?.classList.contains("sidebar-collapsed")){sidebarLabelFadeFrame=0;return;}
      if(sidebar.getBoundingClientRect().right<=triggerRight){
        sidebarShell.classList.add("sidebar-label-fade-out");
        sidebarLabelFadeFrame=0;
        return;
      }
      sidebarLabelFadeFrame=requestAnimationFrame(watch);
    };
    sidebarLabelFadeFrame=requestAnimationFrame(watch);
  }
  function setSidebarCollapsed(collapsed,persist=true){
    collapsed=Boolean(collapsed);
    const wasCollapsed=sidebarShell?.classList.contains("sidebar-collapsed");
    const labelRects=collapsed&&!wasCollapsed?[...sidebar.querySelectorAll(".brand-name,.nav-label")].map(label=>label.getBoundingClientRect()).filter(rect=>rect.width>0):[];
    const labelContactRight=labelRects.length?Math.max(...labelRects.map(rect=>rect.right))+6:0;
    clearSidebarBrandHint();
    cancelSidebarLabelFadeWatch();
    if(!collapsed)sidebarShell?.classList.remove("sidebar-label-fade-out");
    sidebarShell?.classList.toggle("sidebar-collapsed",collapsed);
    if(collapsed){
      if(!persist||wasCollapsed||!labelContactRight)sidebarShell?.classList.add("sidebar-label-fade-out");
      else watchSidebarLabelContact(labelContactRight);
    }
    if(sidebarToggle){
      sidebarToggle.setAttribute("aria-expanded",String(!collapsed));
      const label=collapsed?tr("展开侧边栏","Expand Sidebar"):tr("收起侧边栏","Collapse Sidebar");
      sidebarToggle.setAttribute("aria-label",label);sidebarToggle.title=label;
    }
    if(sidebarBrandLogo){
      sidebarBrandLogo.setAttribute("role","img");
      sidebarBrandLogo.setAttribute("tabindex","-1");
      sidebarBrandLogo.setAttribute("aria-label","Glass Player");
    }
    if(sidebarBrand){
      sidebarBrand.setAttribute("role",collapsed?"button":"group");
      sidebarBrand.setAttribute("tabindex",collapsed?"0":"-1");
      sidebarBrand.setAttribute("aria-label",collapsed?tr("展开侧边栏","Expand Sidebar"):"Glass Player");
    }
    if(persist)GPBrowserStorage.setLocal("glassPlayerSidebarCollapsed",collapsed?"1":"0");
    settleSidebarGeometry();requestAnimationFrame(refreshBrandOverflow);
  }
  function expandSidebarFromHint(){
    clearTimeout(sidebarHintHandoffTimer);sidebarHintHandoffTimer=0;
    clearSidebarBrandHint();sidebar.classList.remove("sidebar-hint-flight");
    setSidebarCollapsed(false);
  }
  if(sidebarToggle&&sidebarShell&&sidebar){
    setSidebarCollapsed(GPBrowserStorage.getLocal("glassPlayerSidebarCollapsed")==="1",false);
    bindMicroMotion(sidebarToggle,"sidebar-toggle-motion",500);
    sidebarToggle.addEventListener("click",event=>{
      event.stopPropagation();
      const collapsing=!sidebarShell.classList.contains("sidebar-collapsed");
      setSidebarCollapsed(collapsing);
    });
    const expandFromBrand=event=>{
      if(!sidebarShell.classList.contains("sidebar-collapsed"))return;
      event.stopPropagation();
      const hinted=sidebar.classList.contains("sidebar-brand-hint");
      if(hinted)expandSidebarFromHint();else{clearSidebarBrandHint();setSidebarCollapsed(false);}
    };
    sidebarBrand?.addEventListener("click",expandFromBrand);
    sidebarBrand?.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();expandFromBrand(event);}});
    sidebarBrand?.addEventListener("pointerenter",()=>{
      if(!sidebarShell.classList.contains("sidebar-collapsed"))return;
      clearTimeout(sidebarBrandHintTimer);
      sidebarBrandHintTimer=setTimeout(()=>{
        sidebarBrandHintTimer=0;
        if(sidebarShell.classList.contains("sidebar-collapsed")&&sidebarBrand.matches(":hover"))sidebar.classList.add("sidebar-brand-hint");
      },550);
    });
    sidebarBrand?.addEventListener("pointerleave",clearSidebarBrandHint);
  }
  /* Fold from the capped Now Playing card, not the outer viewport. The
     separate enter/exit thresholds keep a sidebar resize from chattering. */
  const GP_SIDEBAR_COLLAPSE_PLAYER_WIDTH=760,GP_SIDEBAR_COLLAPSE_RATIO=1.65,GP_SIDEBAR_EXPAND_RATIO=1.35;
  function syncSidebarCompactMode(){
    const playerSection=$(".now-playing"),width=playerSection?.offsetWidth||0,height=playerSection?.offsetHeight||0;
    if(!width||!height)return;
    const ratio=height/Math.max(1,width);
    const next=sidebarCompactMode
      ? ratio>=GP_SIDEBAR_EXPAND_RATIO
      : width<GP_SIDEBAR_COLLAPSE_PLAYER_WIDTH&&ratio>GP_SIDEBAR_COLLAPSE_RATIO;
    if(next===sidebarCompactMode)return;
    sidebarCompactMode=next;
    if(next)setSidebarCollapsed(true,false);
    else setSidebarCollapsed(GPBrowserStorage.getLocal("glassPlayerSidebarCollapsed")==="1",false);
  }
  window.addEventListener("gp:viewport-fit",()=>syncSidebarCompactMode(),{passive:true});

  function activateSidebarView(viewName){
    $$(".nav-item").forEach(button=>button.classList.toggle("active",button.dataset.view===viewName));
    requestAnimationFrame(()=>updateNavGlider(true));
  }
  $("#buildBadgeBtn").addEventListener("click",()=>{
    activateSidebarView("settings");
    if(typeof activateSettingsCategory==="function")activateSettingsCategory("about");
    switchPrimaryView("changelog");
    GP.changelog.render();
  });
  $("#changelogBackBtn").addEventListener("click",()=>{
    activateSidebarView("settings");
    if(typeof activateSettingsCategory==="function")activateSettingsCategory("about");
    switchPrimaryView("settings");
  });
  bindMicroMotion($("#changelogBackBtn"),"changelog-back-motion",400);

  /* ================= panel tabs (queue / sound / recommend) ================= */
  const GLIDER_SELECTORS=["#panelTabs","#themeSeg","#bgSeg","#coverSeg","#rangeSeg","#languageSeg","#historyModeSeg","#spatialModeSeg","#eqSoundPresetSeg","#eqDevicePresetSeg"];
  GLIDER_SELECTORS.forEach(selector=>$(selector)?.setAttribute("data-gp-glider",""));
  const NOOP_ACTIVE_SEGMENTS=[...GLIDER_SELECTORS,"#eqPresetSeg",".gp-segmented","[data-gp-glider]"];
  document.addEventListener("click",event=>{
    const group=event.target.closest?.(NOOP_ACTIVE_SEGMENTS.join(","));
    const button=event.target.closest?.("button");
    if(group?.id==="spatialModeSeg"&&!spatialEnabled)return;
    if(group&&button&&group.contains(button)&&button.classList.contains("active")){
      // Clicking the already selected option is a true no-op. Switching away
      // and returning still runs the normal refresh path.
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },true);
  function updateGlider(group,animate=true){
    if(!group)return;const active=group.querySelector("button.active");if(!active)return;
    let glider=group.querySelector(":scope>.segment-glider");if(!glider){glider=document.createElement("div");glider.className="segment-glider";group.prepend(glider);}
    const x=active.offsetLeft,y=active.offsetTop,w=active.offsetWidth,h=active.offsetHeight;
    if(!w||!h){group.classList.remove("glider-ready");return;}
    const targetKey=[x,y,w,h].join(":");if(glider._gpMotion?.playState==="running"&&glider._gpTargetKey===targetKey)return;
    let oldX=Number(glider.dataset.x||x),oldY=Number(glider.dataset.y||y),oldW=Number(glider.dataset.w||w),oldH=Number(glider.dataset.h||h);
    if(glider._gpMotion?.playState==="running"){
      const groupRect=group.getBoundingClientRect(),gliderRect=glider.getBoundingClientRect(),scaleX=group.offsetWidth?groupRect.width/group.offsetWidth:1,scaleY=group.offsetHeight?groupRect.height/group.offsetHeight:scaleX;
      oldX=(gliderRect.left-groupRect.left)/Math.max(scaleX,.001);oldY=(gliderRect.top-groupRect.top)/Math.max(scaleY,.001);oldW=gliderRect.width/Math.max(scaleX,.001);oldH=gliderRect.height/Math.max(scaleY,.001);
      glider._gpMotion.cancel();glider._gpMotion=null;
    }
    glider.style.width=`${w}px`;glider.style.height=`${h}px`;glider.style.transform=`translate3d(${x}px,${y}px,0)`;glider._gpTargetKey=targetKey;
    if(animate&&(Math.abs(oldX-x)>.5||Math.abs(oldY-y)>.5||Math.abs(oldW-w)>.5||Math.abs(oldH-h)>.5)){
      const spatialOnly=group.id==="spatialModeSeg";
      glider.style.willChange=spatialOnly?"transform,width,height":"transform";
      const frames=spatialOnly?[
        {transform:`translate3d(${oldX}px,${oldY}px,0)`,width:`${oldW}px`,height:`${oldH}px`},
        {transform:`translate3d(${x}px,${y}px,0)`,width:`${w}px`,height:`${h}px`}
      ]:[
        {transform:`translate3d(${oldX}px,${oldY}px,0) scale(${oldW/w},${oldH/h})`},
        {transform:`translate3d(${oldX+(x-oldX)*.58}px,${oldY+(y-oldY)*.58}px,0) scale(${oldW/w*1.045},${oldH/h*1.025})`,offset:.5},
        {transform:`translate3d(${x}px,${y}px,0) scale(1)`}
      ];
      const motion=glider.animate(frames,{duration:spatialOnly?260:310,easing:spatialOnly?"cubic-bezier(.22,.72,.22,1)":"cubic-bezier(.2,.82,.2,1)",fill:"both"});glider._gpMotion=motion;
      motion.onfinish=()=>{if(glider._gpMotion!==motion)return;glider._gpMotion=null;glider.style.willChange="auto";motion.cancel();};
    }
    glider.dataset.x=x;glider.dataset.y=y;glider.dataset.w=w;glider.dataset.h=h;
    group.classList.add("glider-ready");
  }
  function gpElementIsRenderable(element){
    if(!element?.isConnected)return false;
    const view=element.closest?.(".view");
    if(view&&!view.classList.contains("active")&&!view.classList.contains("gp-view-overlay"))return false;
    return element.getClientRects().length>0;
  }
  function updateAllGliders(animate=true){$$('[data-gp-glider],.gp-segmented').forEach(group=>{if(gpElementIsRenderable(group))updateGlider(group,animate);});}
  function initializeSelectionGliders(){updateAllGliders(false);updateNavGlider(false);}
  document.addEventListener("click",e=>{const group=e.target.closest?.('[data-gp-glider],.gp-segmented');if(group&&e.target.closest("button"))requestAnimationFrame(()=>updateGlider(group,true));});

  /* GP Core 2.1: the panel shell is stationary; only its viewport moves.
     GP Motion Engine 2.0: complete moving sectors dissolve into that shell. */
  const GP_SCROLL_EDGE_SELECTORS=["#queueBody","#recommendBody","#trackList","#historyRankingLeft","#historyRanks11to50","#settingsPanel","#releaseIndex","#releaseDetail","#favoritesGrid","#dataDashboard","#annualReportBody"];
  const GP_SCROLLBAR_SELECTOR=".panel-body,.track-list,.history-ranking-left,.history-ranks-list,.settings-panel,.font-picker-pop,.release-index,.release-detail,.favorites-grid,.data-dashboard,.annual-report-body";
  const GP_SCROLL_INTENT_WINDOW_MS=900;
  const gpScrollbarTimers=new WeakMap();
  const gpScrollIntentUntil=new WeakMap();
  function scrollSurfaceFromTarget(target){
    if(target instanceof Element)return target.closest(GP_SCROLLBAR_SELECTOR);
    return document.activeElement instanceof Element?document.activeElement.closest(GP_SCROLLBAR_SELECTOR):null;
  }
  function markScrollIntent(surface){
    if(!(surface instanceof Element)||surface.scrollHeight<=surface.clientHeight+1)return;
    gpScrollIntentUntil.set(surface,performance.now()+GP_SCROLL_INTENT_WINDOW_MS);
  }
  function revealLiquidScrollbar(surface){
    if(!(surface instanceof Element)||surface.scrollHeight<=surface.clientHeight+1||performance.now()>(gpScrollIntentUntil.get(surface)||0))return;
    clearTimeout(gpScrollbarTimers.get(surface));surface.classList.add("gp-scrollbar-active");
    gpScrollbarTimers.set(surface,setTimeout(()=>surface.classList.remove("gp-scrollbar-active"),500));
  }
  document.addEventListener("wheel",event=>markScrollIntent(scrollSurfaceFromTarget(event.target)),{capture:true,passive:true});
  document.addEventListener("touchstart",event=>markScrollIntent(scrollSurfaceFromTarget(event.target)),{capture:true,passive:true});
  document.addEventListener("pointerdown",event=>markScrollIntent(scrollSurfaceFromTarget(event.target)),{capture:true,passive:true});
  document.addEventListener("keydown",event=>{
    if(["ArrowUp","ArrowDown","PageUp","PageDown","Home","End","Space"].includes(event.code))markScrollIntent(scrollSurfaceFromTarget(event.target));
  },true);
  document.addEventListener("scroll",event=>revealLiquidScrollbar(scrollSurfaceFromTarget(event.target)),{capture:true,passive:true});
  const GP_OWN_SURFACE_IDS=new Set(["topList","settingsPanel","releaseIndex","releaseDetail"]);
  const GP_SHARED_SHELLS={queueBody:".side-panel",recommendBody:".side-panel",trackList:".library-panel",historyRankingLeft:".top-list",historyRanks11to50:".top-list",favoritesGrid:"#historyFavoritesPane",dataDashboard:"#historyDataPane",annualReportBody:".annual-report-dialog"};
  const gpEdgeUpdateFrames=new WeakMap();
  function prepareScrollSurface(el){
    if(!el)return null;
    let shell=null;
    if(GP_OWN_SURFACE_IDS.has(el.id)||el.matches('[data-gp-sse-shell="own"],.gp-sse-own')){
      if(el.parentElement?.classList.contains("gp-sse-owned-shell"))shell=el.parentElement;
      else{
        shell=document.createElement("div");
        shell.className=`gp-sse-shell gp-sse-owned-shell gp-sse-shell-${el.id}`;
        if(el.classList.contains("glass")){el.classList.remove("glass");shell.classList.add("glass");}
        el.parentNode.insertBefore(shell,el);shell.appendChild(el);
      }
    }else{
      const selector=GP_SHARED_SHELLS[el.id];
      shell=selector?el.closest(selector):el.closest('[data-gp-sse-shell]:not([data-gp-sse-shell="own"]),.gp-panel,.side-panel,.library-panel')||el.parentElement;
      shell?.classList.add("gp-sse-shell",`gp-sse-shell-${el.id}`);
    }
    el.classList.remove("gp-scroll-edge","gp-sse-native","edge-top","edge-bottom");
    el.classList.add("gp-sse-viewport");
    el.dataset.edgeReady="1";
    return shell;
  }
  function updateScrollEdge(el){
    if(!el)return;
    const scrollable=el.scrollHeight>el.clientHeight+3;
    const hasTop=scrollable&&el.scrollTop>1;
    const hasBottom=scrollable&&el.scrollTop+el.clientHeight<el.scrollHeight-1;
    el.classList.toggle("gp-has-top",hasTop);
    el.classList.toggle("gp-has-bottom",hasBottom);
    const shell=el.closest(".gp-sse-shell");
    shell?.classList.toggle(`gp-${el.id}-has-top`,hasTop);
    shell?.classList.toggle(`gp-${el.id}-has-bottom`,hasBottom);
  }
  function scheduleScrollEdgeUpdate(el){
    if(!gpElementIsRenderable(el))return;
    const old=gpEdgeUpdateFrames.get(el);if(old)cancelAnimationFrame(old);
    gpEdgeUpdateFrames.set(el,requestAnimationFrame(()=>{gpEdgeUpdateFrames.delete(el);updateScrollEdge(el);}));
  }
  function initializeScrollEdges(){
    GP_SCROLL_EDGE_SELECTORS.forEach(selector=>{
      const el=$(selector);if(el)el.setAttribute("data-gp-sse","");
    });
  }
  function mountScrollEdge(el){
    if(!el||el.dataset.gpSseMounted==="1")return;
    el.dataset.gpSseMounted="1";prepareScrollSurface(el);
    el.addEventListener("scroll",()=>scheduleScrollEdgeUpdate(el),{passive:true});
    if("ResizeObserver" in window)new ResizeObserver(()=>scheduleScrollEdgeUpdate(el)).observe(el);
    new MutationObserver(()=>{if(el.dataset.gpSseBatch!=="1")scheduleScrollEdgeUpdate(el);}).observe(el,{childList:true,subtree:true});
    requestAnimationFrame(()=>updateScrollEdge(el));
  }
  function refreshScrollEdgeFrames(){$$('[data-gp-sse],.gp-sse').forEach(element=>{if(gpElementIsRenderable(element))scheduleScrollEdgeUpdate(element);});}
  window.addEventListener("resize",()=>requestAnimationFrame(refreshScrollEdgeFrames),{passive:true});
  initializeScrollEdges();

  /* ================= 6.0.0 GP Core 2.3 / Motion Engine 3.1 =================
     Declarative UI registry. A component is mounted once, can be refreshed as
     layout changes, and is discovered automatically when future views append
     matching class/data contracts. Existing 5.6.3 markup remains authoritative. */
  const gpUIComponents=new Map(),gpUIMountState=new WeakMap();
  const gpUIPendingRoots=new Set();let gpUIObserver=null,gpUIMountFrame=0;
  function gpUIComponentTargets(root,selector){
    if(!root||!selector)return[];const targets=[];
    if(root.nodeType===1&&root.matches?.(selector))targets.push(root);
    root.querySelectorAll?.(selector).forEach(element=>targets.push(element));
    return targets;
  }
  const GPUIRegistry={
    version:"3.0",
    contracts:Object.freeze({action:"gp-action",view:"GP.motion.transitionView",sector:"GP.motion.transitionSector",sse:"gp-sse / data-gp-sse",glider:"gp-segmented / data-gp-glider",popover:"gp-popover / data-gp-popover",adaptiveTitle:"gp-adaptive-title",contextControl:"gp-context-control"}),
    register(name,definition){
      if(!name||!definition?.selector||typeof definition.mount!=="function")throw new Error("Invalid GP UI component registration");
      gpUIComponents.set(name,Object.freeze({...definition,name}));return this;
    },
    mount(root=document){
      gpUIComponents.forEach((component,name)=>{
        gpUIComponentTargets(root,component.selector).forEach(element=>{
          let mounted=gpUIMountState.get(element);if(!mounted){mounted=new Set();gpUIMountState.set(element,mounted);}
          if(mounted.has(name))return;mounted.add(name);
          try{component.mount(element,this);}catch(error){mounted.delete(name);console.warn(`GP UI mount failed: ${name}`,error);}
        });
      });return root;
    },
    refresh(root=document,animate=false){
      gpUIComponents.forEach((component,name)=>{
        if(typeof component.refresh!=="function")return;
        gpUIComponentTargets(root,component.selector).forEach(element=>{
          if(gpUIMountState.get(element)?.has(name))component.refresh(element,animate,this);
        });
      });return root;
    },
    observe(root=document.body){
      if(gpUIObserver||!root)return gpUIObserver;
      gpUIObserver=new MutationObserver(records=>{
        records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)gpUIPendingRoots.add(node);}));
        if(!gpUIPendingRoots.size||gpUIMountFrame)return;
        gpUIMountFrame=requestAnimationFrame(()=>{
          gpUIMountFrame=0;const roots=[...gpUIPendingRoots];gpUIPendingRoots.clear();
          roots.forEach(node=>this.mount(node));
        });
      });
      gpUIObserver.observe(root,{childList:true,subtree:true});return gpUIObserver;
    },
    switchView:switchPrimaryView,
    transitionSector:transitionMotionSector,
    setPopover:setMotionPopover
  };
  function mountRangeGlass(element){
    const eligible=!element.matches?.(".eq-slider");
    const settingsRange=element.matches?.("#crossfadeSlider,#fontSizeSlider,#fontWeightSlider");
    if(settingsRange)element.classList.add("gp-settings-range");
    let pointerId=null,pointerMoved=false,pointerDownX=0,pointerDownTarget=Number(element.value||0),targetValue=pointerDownTarget,visualValue=targetValue,rangeFrame=0,animationStart=0,animationFrom=targetValue,commitOnSettle=false;
    const limits=()=>({min:Number(element.min||0),max:Number(element.max||100),step:Number(element.step||0)});
    const clampValue=value=>{const {min,max}=limits();return Math.max(min,Math.min(max,Number(value)||0));};
    const snapValue=value=>{const {min,max,step}=limits();if(!(step>0))return Math.max(min,Math.min(max,value));return Math.max(min,Math.min(max,min+Math.round((value-min)/step)*step));};
    const syncProgress=()=>{
      if(element.id==="seek"||element.id==="vol")return;
      const min=Number(element.min||0),max=Number(element.max||100),value=Number(element.value||0),pct=max>min?(value-min)/(max-min):0;
      element.style.setProperty("--gp-range-pct",`${Math.max(0,Math.min(1,pct))*100}%`);
    };
    const emitValue=value=>{
      element.value=String(clampValue(value));syncProgress();
      element.dispatchEvent(new Event("input",{bubbles:true}));
    };
    const valueAtX=clientX=>{
      const rect=element.getBoundingClientRect(),{min,max}=limits(),ratio=rect.width?Math.max(0,Math.min(1,(clientX-rect.left)/rect.width)):0;
      return min+ratio*(max-min);
    };
    const settleRange=timestamp=>{
      if(!animationStart)animationStart=timestamp;
      const progress=Math.max(0,Math.min(1,(timestamp-animationStart)/100));
      visualValue=animationFrom+(targetValue-animationFrom)*progress;
      emitValue(visualValue);
      if(progress>=1){
        rangeFrame=0;visualValue=snapValue(targetValue);emitValue(visualValue);animationStart=0;
        if(pointerId===null)element.classList.remove("dragging");
        if(commitOnSettle){commitOnSettle=false;element.dispatchEvent(new Event("change",{bubbles:true}));}
        return;
      }
      rangeFrame=requestAnimationFrame(settleRange);
    };
    const animateTo=(value,commit=false)=>{
      const nextTarget=snapValue(clampValue(value));
      animationFrom=visualValue;targetValue=nextTarget;animationStart=0;
      commitOnSettle=commitOnSettle||commit;
      if(!rangeFrame)rangeFrame=requestAnimationFrame(settleRange);
    };
    element._gpAnimateRangeTo=(value,commit=true)=>animateTo(value,commit);
    const begin=event=>{
      if(!eligible||event.button!==0)return;
      event.preventDefault();
      if(rangeFrame)cancelAnimationFrame(rangeFrame);
      rangeFrame=0;animationStart=0;pointerId=event.pointerId;pointerMoved=false;pointerDownX=event.clientX;
      pointerDownTarget=snapValue(valueAtX(event.clientX));targetValue=pointerDownTarget;commitOnSettle=false;visualValue=Number(element.value||0);
      element.classList.add("dragging");element.focus({preventScroll:true});element.setPointerCapture?.(event.pointerId);
      animateTo(pointerDownTarget,false);
    };
    const move=event=>{
      if(pointerId!==event.pointerId)return;
      event.preventDefault();
      if(Math.abs(event.clientX-pointerDownX)>3)pointerMoved=true;
      if(!pointerMoved)return;
      if(rangeFrame)cancelAnimationFrame(rangeFrame);
      rangeFrame=0;animationStart=0;
      targetValue=snapValue(valueAtX(event.clientX));visualValue=targetValue;emitValue(visualValue);
    };
    const release=event=>{
      if(pointerId===null||event?.pointerId!==pointerId)return;
      const releasedPointerId=pointerId,dragged=pointerMoved;pointerId=null;pointerMoved=false;
      if(element.hasPointerCapture?.(releasedPointerId))element.releasePointerCapture(releasedPointerId);
      if(dragged){
        if(Number.isFinite(event.clientX))targetValue=snapValue(valueAtX(event.clientX));
        visualValue=targetValue;emitValue(visualValue);element.classList.remove("dragging");
        element.dispatchEvent(new Event("change",{bubbles:true}));
      }else{
        animateTo(pointerDownTarget,true);
      }
    };
    const cancel=event=>{
      if(pointerId===null||event?.pointerId!==pointerId)return;
      const dragged=pointerMoved;pointerId=null;pointerMoved=false;
      if(dragged){
        targetValue=visualValue=Number(element.value||0);element.classList.remove("dragging");
        element.dispatchEvent(new Event("change",{bubbles:true}));
      }else animateTo(pointerDownTarget,true);
    };
    element.addEventListener("pointerdown",begin);element.addEventListener("pointermove",move);
    element.addEventListener("pointerup",release);element.addEventListener("pointercancel",cancel);
    element.addEventListener("click",event=>{if(eligible)event.preventDefault();});
    element.addEventListener("input",()=>{
      syncProgress();
      if(pointerId===null&&!rangeFrame)targetValue=Number(element.value||0);
    });
    if(settingsRange){window.addEventListener("resize",syncProgress,{passive:true});}
    syncProgress();
  }
  GPUIRegistry
    .register("action",{selector:".gp-action",mount:element=>element.classList.add("ripple-target")})
    .register("primary-nav",{selector:".nav-item[data-view],.gp-nav-item[data-view]",mount:mountPrimaryNavButton})
    .register("range",{selector:'input[type="range"],.gp-range',mount:mountRangeGlass})
    .register("glider",{selector:"[data-gp-glider],.gp-segmented",mount:element=>{
      if(element.classList.contains("gp-segmented"))element.classList.add("segmented");
      requestAnimationFrame(()=>updateGlider(element,false));
      if(!element._gpGliderResizeObserver){
        element._gpGliderResizeObserver=new ResizeObserver(()=>requestAnimationFrame(()=>updateGlider(element,false)));
        element._gpGliderResizeObserver.observe(element);
      }
      document.fonts?.ready?.then(()=>requestAnimationFrame(()=>updateGlider(element,false)));
    },refresh:(element,animate)=>updateGlider(element,animate)})
    .register("sse",{selector:"[data-gp-sse],.gp-sse",mount:mountScrollEdge,refresh:element=>scheduleScrollEdgeUpdate(element)})
    .register("popover",{selector:"[data-gp-popover],.gp-popover",mount:element=>element.classList.add("gp-motion-popover")})
    .register("adaptive-title",{selector:".gp-adaptive-title",mount:()=>{},refresh:element=>{
      const surface=elementSurface(element),black=[17,18,22],white=[250,250,252];
      element.style.color=contrastRatio(black,surface)>=contrastRatio(white,surface)?"rgb(17,18,22)":"rgb(250,250,252)";
    }})
    .register("context-control",{selector:".gp-context-control",mount:()=>{},refresh:element=>{
      const surface=elementSurface(element),light=activeTheme()==="light",tone=mixRgb(surface,[255,255,255],light?.42:.1),accented=mixRgb(tone,currentAccentRgb(),light?.035:.065);
      element.style.setProperty("--context-control-bg",`rgba(${accented.join(",")},${light?.74:.62})`);
      element.style.setProperty("--context-control-border",`rgba(${currentAccentRgb().join(",")},${light?.09:.14})`);
    }});
  GP.ui=Object.assign(GP.ui||{},GPUIModules,{core:GPUIRegistry,mount:root=>GPUIRegistry.mount(root),refresh:(root,animate)=>GPUIRegistry.refresh(root,animate),observe:root=>GPUIRegistry.observe(root),switchView:switchPrimaryView,transitionSector:transitionMotionSector,setPopover:setMotionPopover});
  GP.motion=Object.freeze({version:"3.3",targetFps:GP_MOTION_TARGET_FPS,transitionView:switchPrimaryView,transitionSector:transitionMotionSector,setPopover:setMotionPopover});
  function transitionQueueContent(commit){
    const body=$("#queueBody");if(!body||typeof commit!=="function"){commit?.();return;}
    if(matchMedia("(prefers-reduced-motion: reduce)").matches){commit();return;}
    body.getAnimations().forEach(animation=>animation.cancel());
    const out=body.animate([{opacity:1},{opacity:0}],{duration:126,easing:"ease-out",fill:"forwards"});
    out.onfinish=()=>{
      commit();body.getAnimations().forEach(animation=>animation.cancel());body.style.opacity="0";
      setTimeout(()=>{body.style.removeProperty("opacity");body.animate([{opacity:0},{opacity:1}],{duration:155,easing:"cubic-bezier(.18,.74,.2,1)"});},42);
    };
  }
  document.addEventListener("click",event=>{
    const trigger=event.target.closest?.("[data-gp-popover-target]");if(!trigger)return;
    const target=trigger.getAttribute("data-gp-popover-target"),popover=target?(document.querySelector(target)||document.getElementById(target.replace(/^#/,""))):null;
    if(popover){event.stopPropagation();setMotionPopover(popover,!popover.classList.contains("show"));}
  });
  document.addEventListener("click",event=>{
    if(event.target.closest?.("[data-gp-popover-target]"))return;
    $$("[data-gp-popover].show,.gp-popover.show").forEach(popover=>{if(!popover.contains(event.target))setMotionPopover(popover,false);});
  });
  $("#panelTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button"); if(!btn) return;
    if(btn.classList.contains("active"))return;
    const tab = btn.dataset.tab;
    const bodies={queue:$("#queueBody"),recommend:$("#recommendBody")};
    const host=$("#panelTabs");
    $$("#panelTabs button").forEach(b => b.classList.toggle("active",b===btn));
    requestAnimationFrame(()=>updateGlider(host,true));
    transitionMotionSector(host,()=>Object.values(bodies).find(body=>body.style.display!=="none"),()=>{
      const finalTab=$("#panelTabs button.active")?.dataset.tab||tab;
      Object.entries(bodies).forEach(([key,body])=>{body.style.display=key===finalTab?"block":"none";body.classList.remove("panel-enter");});
      if(finalTab==="queue"&&!manualQueueActive)positionCurrentQueueRow(false);
      if(finalTab === "recommend")renderRecommendList();
      requestAnimationFrame(refreshScrollEdgeFrames);return bodies[finalTab];
    },true);
  });

  /* ================= helpers ================= */
  const fmtTime=(...args)=>GP.utils.formatTime(...args);
  function fmtDuration(totalSec){
    totalSec = Math.round(totalSec||0);
    const h = Math.floor(totalSec/3600), m = Math.floor((totalSec%3600)/60);
    if(h>0) return tr(`${h}小时${m}分钟`,`${h}h ${m}m`);
    if(m>0) return tr(`${m}分钟`,`${m} min`);
    return tr(`${totalSec}秒`,`${totalSec} sec`);
  }
  function hashString(str){ let h=0; for(let i=0;i<str.length;i++){ h=(h*31+str.charCodeAt(i))|0; } return Math.abs(h); }
  function parseName(filename){
    const clean = filename.replace(/\.[^/.]+$/, "");
    if(clean.includes(" - ")){ const [a,...rest]=clean.split(" - "); return {artist:a.trim(), title:rest.join(" - ").trim()}; }
    return {artist:"未知艺人", title:clean};
  }
  function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function trackKey(t){ return t.artist + "||" + t.title; }
  function todayKey(d){ d = d || new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
  function hexToRgbArr(hex){ const v=hex.replace("#",""); return [parseInt(v.slice(0,2),16),parseInt(v.slice(2,4),16),parseInt(v.slice(4,6),16)]; }

  /* ================= embedded cover extraction ================= */
  async function extractID3Cover(file){
    let sliceSize = Math.min(file.size, 1*1024*1024);
    let buf = await readFileBuffer(file,0,sliceSize);
    let view = new DataView(buf);
    if(buf.byteLength < 10) return null;
    if(String.fromCharCode(view.getUint8(0),view.getUint8(1),view.getUint8(2)) !== "ID3") return null;
    const majorVer = view.getUint8(3);
    const flags = view.getUint8(5);
    const tagSize = ((view.getUint8(6)&0x7f)<<21)|((view.getUint8(7)&0x7f)<<14)|((view.getUint8(8)&0x7f)<<7)|(view.getUint8(9)&0x7f);
    const tagEnd = 10 + tagSize;
    if(tagEnd > buf.byteLength){
      sliceSize = Math.min(file.size, tagEnd + 16);
      buf = await readFileBuffer(file,0,sliceSize);
      view = new DataView(buf);
    }
    let offset = 10;
    if(flags & 0x40){
      let extSize;
      if(majorVer === 4) extSize = ((view.getUint8(offset)&0x7f)<<21)|((view.getUint8(offset+1)&0x7f)<<14)|((view.getUint8(offset+2)&0x7f)<<7)|(view.getUint8(offset+3)&0x7f);
      else extSize = view.getUint32(offset);
      offset += extSize + (majorVer === 4 ? 0 : 4);
    }
    while(offset < tagEnd - 10 && offset < buf.byteLength - 10){
      let frameId, frameSize;
      if(majorVer >= 3){
        frameId = String.fromCharCode(view.getUint8(offset),view.getUint8(offset+1),view.getUint8(offset+2),view.getUint8(offset+3));
        if(!/^[A-Z0-9]{4}$/.test(frameId)) break;
        frameSize = majorVer === 4
          ? ((view.getUint8(offset+4)&0x7f)<<21)|((view.getUint8(offset+5)&0x7f)<<14)|((view.getUint8(offset+6)&0x7f)<<7)|(view.getUint8(offset+7)&0x7f)
          : view.getUint32(offset+4);
        offset += 10;
      } else {
        frameId = String.fromCharCode(view.getUint8(offset),view.getUint8(offset+1),view.getUint8(offset+2));
        if(!/^[A-Z0-9]{3}$/.test(frameId)) break;
        frameSize = (view.getUint8(offset+3)<<16)|(view.getUint8(offset+4)<<8)|view.getUint8(offset+5);
        offset += 6;
      }
      if(frameSize <= 0) break;
      const frameEnd = offset + frameSize;
      if(frameId === "APIC" || frameId === "PIC"){
        if(frameEnd > buf.byteLength){
          sliceSize = Math.min(file.size, frameEnd + 16);
          buf = await readFileBuffer(file,0,sliceSize);
          view = new DataView(buf);
        }
        let p = offset;
        const encoding = view.getUint8(p); p += 1;
        let mime;
        if(frameId === "APIC"){
          let e = p; while(e < buf.byteLength && view.getUint8(e) !== 0) e++;
          mime = new TextDecoder("latin1").decode(new Uint8Array(buf, p, e-p)); p = e+1;
        } else {
          mime = "image/" + new TextDecoder("latin1").decode(new Uint8Array(buf, p, 3)).toLowerCase(); p += 3;
        }
        p += 1; // picture type byte
        if(encoding === 1 || encoding === 2){
          while(p < buf.byteLength-1 && !(view.getUint8(p)===0 && view.getUint8(p+1)===0)) p += 2;
          p += 2;
        } else {
          while(p < buf.byteLength && view.getUint8(p) !== 0) p += 1;
          p += 1;
        }
        const imgBytes = buf.slice(p, frameEnd);
        if(imgBytes.byteLength < 50) return null;
        return URL.createObjectURL(new Blob([imgBytes], {type: mime || "image/jpeg"}));
      }
      offset = frameEnd;
    }
    return null;
  }

  async function extractFLACCover(file){
    let sliceSize = Math.min(file.size, 2*1024*1024);
    let buf = await readFileBuffer(file,0,sliceSize);
    let view = new DataView(buf);
    if(buf.byteLength < 4 || String.fromCharCode(view.getUint8(0),view.getUint8(1),view.getUint8(2),view.getUint8(3)) !== "fLaC") return null;
    let offset = 4;
    while(offset < buf.byteLength - 4){
      const header = view.getUint8(offset);
      const isLast = (header & 0x80) !== 0;
      const blockType = header & 0x7f;
      const blockSize = (view.getUint8(offset+1)<<16)|(view.getUint8(offset+2)<<8)|view.getUint8(offset+3);
      const blockStart = offset + 4;
      const blockEnd = blockStart + blockSize;
      if(blockType === 6){
        if(blockEnd > buf.byteLength){
          sliceSize = Math.min(file.size, blockEnd + 16);
          buf = await readFileBuffer(file,0,sliceSize);
          view = new DataView(buf);
          if(blockEnd > buf.byteLength) return null;
        }
        let p = blockStart;
        p += 4; // picture type
        const mimeLen = view.getUint32(p); p += 4;
        const mime = new TextDecoder("latin1").decode(new Uint8Array(buf, p, mimeLen)); p += mimeLen;
        const descLen = view.getUint32(p); p += 4; p += descLen;
        p += 16; // width, height, depth, colors
        const dataLen = view.getUint32(p); p += 4;
        if(p + dataLen > buf.byteLength){
          sliceSize = Math.min(file.size, p + dataLen + 8);
          buf = await readFileBuffer(file,0,sliceSize);
          view = new DataView(buf);
        }
        const imgBytes = buf.slice(p, p+dataLen);
        return URL.createObjectURL(new Blob([imgBytes], {type: mime || "image/jpeg"}));
      }
      offset = blockEnd;
      if(isLast) break;
    }
    return null;
  }

  async function extractMP4Cover(file){
    let offset=0,moovBuffer=null,guard=0;
    while(offset+8<=file.size&&guard++<4096){
      const header=await readFileBuffer(file,offset,Math.min(file.size,offset+16)-offset);
      if(header.byteLength<8)break;
      const headerView=new DataView(header);
      let size=headerView.getUint32(0),headerLen=8;
      const type=String.fromCharCode(headerView.getUint8(4),headerView.getUint8(5),headerView.getUint8(6),headerView.getUint8(7));
      if(size===1){if(header.byteLength<16)break;size=Number(headerView.getBigUint64(8));headerLen=16;}
      else if(size===0)size=file.size-offset;
      if(!Number.isFinite(size)||size<headerLen||offset+size>file.size)break;
      if(type==="moov"){
        if(size>32*1024*1024)return null;
        moovBuffer=await readFileBuffer(file,offset,size);break;
      }
      offset+=size;
    }
    if(!moovBuffer)return null;
    const buf=moovBuffer;
    const view=new DataView(buf);
    function walk(start, end, isMeta){
      let offset = start;
      while(offset < end - 8){
        let size = view.getUint32(offset);
        const type = String.fromCharCode(view.getUint8(offset+4),view.getUint8(offset+5),view.getUint8(offset+6),view.getUint8(offset+7));
        let headerLen = 8;
        if(size === 1){ size = Number(view.getBigUint64(offset+8)); headerLen = 16; }
        else if(size === 0){ size = end - offset; }
        if(size <= 0 || offset + size > end) break;
        if(type === "moov" || type === "udta"){
          const found = walk(offset+headerLen, offset+size, false);
          if(found) return found;
        } else if(type === "meta"){
          const found = walk(offset+headerLen+4, offset+size, true); // meta has 4-byte version/flags
          if(found) return found;
        } else if(type === "ilst"){
          const found = walk(offset+headerLen, offset+size, false);
          if(found) return found;
        } else if(type === "covr"){
          let p = offset + headerLen;
          const boxEnd = offset + size;
          while(p < boxEnd - 8){
            const dsize = view.getUint32(p);
            const dtype = String.fromCharCode(view.getUint8(p+4),view.getUint8(p+5),view.getUint8(p+6),view.getUint8(p+7));
            if(dsize <= 0) break;
            if(dtype === "data"){
              const dataFlags = view.getUint32(p+8);
              const dataStart = p+16;
              const dataLen = dsize-16;
              const mime = dataFlags === 14 ? "image/png" : "image/jpeg";
              return {mime, bytes: buf.slice(dataStart, dataStart+dataLen)};
            }
            p += dsize;
          }
        }
        offset += size;
      }
      return null;
    }
    const result = walk(0, buf.byteLength, false);
    if(result){
      return URL.createObjectURL(new Blob([result.bytes], {type: result.mime}));
    }
    return null;
  }

  async function extractEmbeddedCover(file){
    try{
      const name = file.name.toLowerCase();
      if(name.endsWith(".flac")) return await extractFLACCover(file);
      if(name.endsWith(".m4a") || name.endsWith(".mp4") || name.endsWith(".aac")) return await extractMP4Cover(file);
      return await extractID3Cover(file);
    }catch(e){ return null; }
  }

  /* ================= genre tag extraction (ID3 TCON / FLAC VORBIS GENRE) ================= */
  const ID3_GENRES = ["Blues","Classic Rock","Country","Dance","Disco","Funk","Grunge","Hip-Hop","Jazz","Metal","New Age","Oldies","Other","Pop","R&B","Rap","Reggae","Rock","Techno","Industrial","Alternative","Ska","Death Metal","Pranks","Soundtrack","Euro-Techno","Ambient","Trip-Hop","Vocal","Jazz+Funk","Fusion","Trance","Classical","Instrumental","Acid","House","Game","Sound Clip","Gospel","Noise","AlternRock","Bass","Soul","Punk","Space","Meditative","Instrumental Pop","Instrumental Rock","Ethnic","Gothic","Darkwave","Techno-Industrial","Electronic","Pop-Folk","Eurodance","Dream","Southern Rock","Comedy","Cult","Gangsta","Top 40","Christian Rap","Pop/Funk","Jungle","Native US","Cabaret","New Wave","Psychedelic","Rave","Showtunes","Trailer","Lo-Fi","Tribal","Acid Punk","Acid Jazz","Polka","Retro","Musical","Rock & Roll","Hard Rock"];
  function cleanMetadataText(value){
    /* NUL bytes at the ends of ID3 text frames terminate the field. Only NULs
       inside the decoded value represent multiple artists or values. */
    const cleaned=String(value||"")
      .replace(/^\uFEFF/,"")
      .replace(/^\u0000+|\u0000+$/g,"")
      .replace(/\u0000+/g," / ")
      .replace(/\s*\/\s*\/\s*/g," / ")
      .replace(/(?:\s*\/\s*)+$/g,"")
      .replace(/\s+/g," ")
      .trim();
    /* Multi-value tags may repeat the exact same artist (for example two
       identical TPE1/Vorbis ARTIST values). Deduplicate only spaced separators
       created by metadata parsing so legitimate names such as AC/DC remain
       untouched. */
    const values=cleaned.split(/\s+\/\s+/).map(part=>part.trim()).filter(Boolean);
    if(values.length<2)return cleaned;
    const seen=new Set();
    return values.filter(part=>{const key=part.normalize("NFKC").toLocaleLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).join(" / ");
  }
  function decodeID3Text(bytes,encodingByte){
    const encoding=encodingByte===1?"utf-16":encodingByte===2?"utf-16be":encodingByte===3?"utf-8":"windows-1252";
    try{return cleanMetadataText(new TextDecoder(encoding).decode(bytes));}
    catch(error){return cleanMetadataText(new TextDecoder("latin1").decode(bytes));}
  }
  async function extractID3Metadata(file){
    const result={title:null,artist:null,album:null,date:null,genre:null};
    try{
      const header=await readFileBuffer(file,0,10),head=new DataView(header);
      if(header.byteLength<10||String.fromCharCode(head.getUint8(0),head.getUint8(1),head.getUint8(2))!=="ID3")return result;
      const major=head.getUint8(3),tagSize=((head.getUint8(6)&0x7f)<<21)|((head.getUint8(7)&0x7f)<<14)|((head.getUint8(8)&0x7f)<<7)|(head.getUint8(9)&0x7f);
      const buffer=await readFileBuffer(file,0,Math.min(file.size,10+tagSize)),view=new DataView(buffer),tagEnd=Math.min(10+tagSize,buffer.byteLength);
      const frameMap={TIT2:"title",TT2:"title",TPE1:"artist",TP1:"artist",TALB:"album",TAL:"album",TDRC:"date",TYER:"date",TYE:"date",TCON:"genre",TCO:"genre"};
      let offset=10;
      while(offset<tagEnd-6){
        let id,size,headerLength;
        if(major===2){id=String.fromCharCode(view.getUint8(offset),view.getUint8(offset+1),view.getUint8(offset+2));if(!/^[A-Z0-9]{3}$/.test(id))break;size=(view.getUint8(offset+3)<<16)|(view.getUint8(offset+4)<<8)|view.getUint8(offset+5);headerLength=6;}
        else{id=String.fromCharCode(view.getUint8(offset),view.getUint8(offset+1),view.getUint8(offset+2),view.getUint8(offset+3));if(!/^[A-Z0-9]{4}$/.test(id))break;size=major>=4?((view.getUint8(offset+4)&0x7f)<<21)|((view.getUint8(offset+5)&0x7f)<<14)|((view.getUint8(offset+6)&0x7f)<<7)|(view.getUint8(offset+7)&0x7f):view.getUint32(offset+4);headerLength=10;}
        if(size<=0)break;const bodyStart=offset+headerLength,frameEnd=bodyStart+size;if(frameEnd>buffer.byteLength)break;
        const field=frameMap[id];
        if(field&&size>1){
          let value=decodeID3Text(new Uint8Array(buffer,bodyStart+1,size-1),view.getUint8(bodyStart));
          if(field==="genre"){const match=value.match(/^\(?(\d+)\)?$/);if(match)value=ID3_GENRES[Number(match[1])]||value;}
          if(value&&!result[field])result[field]=value;
        }
        offset=frameEnd;
      }
    }catch(error){}
    return result;
  }
  async function extractFLACMetadata(file){
    const result={title:null,artist:null,album:null,date:null,genre:null};
    try{
      const signature=new Uint8Array(await readFileBuffer(file,0,4));
      if(signature.length<4||String.fromCharCode(...signature)!=="fLaC")return result;
      let offset=4;
      while(offset+4<=file.size){
        const header=new Uint8Array(await readFileBuffer(file,offset,4));if(header.length<4)break;
        const isLast=Boolean(header[0]&0x80),type=header[0]&0x7f,size=(header[1]<<16)|(header[2]<<8)|header[3],start=offset+4,end=start+size;
        if(type===4){
          const block=await readFileBuffer(file,start,Math.min(file.size,end)-start),view=new DataView(block);if(block.byteLength<8)return result;
          let cursor=0;const vendorLength=view.getUint32(cursor,true);cursor+=4+vendorLength;if(cursor+4>block.byteLength)return result;const count=view.getUint32(cursor,true);cursor+=4;const values={TITLE:[],ARTIST:[],ALBUM:[],DATE:[],YEAR:[],GENRE:[]};
          for(let i=0;i<count&&cursor+4<=block.byteLength;i++){const length=view.getUint32(cursor,true);cursor+=4;if(cursor+length>block.byteLength)break;const text=new TextDecoder("utf-8").decode(new Uint8Array(block,cursor,length));cursor+=length;const eq=text.indexOf("=");if(eq>0){const key=text.slice(0,eq).toUpperCase(),value=cleanMetadataText(text.slice(eq+1));if(value&&values[key])values[key].push(value);}}
          result.title=values.TITLE[0]||null;result.artist=cleanMetadataText(values.ARTIST.join(" / "))||null;result.album=values.ALBUM[0]||null;result.date=values.DATE[0]||values.YEAR[0]||null;result.genre=Array.from(new Set(values.GENRE)).join(" / ")||null;return result;
        }
        offset=end;if(isLast)break;
      }
    }catch(error){}
    return result;
  }
  async function extractFileMetadata(file){
    const name=String(file?.name||"").toLowerCase();
    if(name.endsWith(".flac"))return extractFLACMetadata(file);
    if(name.endsWith(".mp3"))return extractID3Metadata(file);
    return {title:null,artist:null,album:null,date:null,genre:null};
  }
  async function extractGenre(file){return (await extractFileMetadata(file)).genre||null;}
  GP.core.metadata=Object.freeze({extractFileMetadata,extractGenre});
  /* ================= GP Neural Engine 2.2 — Listening DNA =================
     Preference and recommendation are deliberately separate. Until the model
     passes its evidence/confidence gate, shuffle and Daily Mix remain uniform. */
  const NEURAL_MODEL_VERSION=4;
  const NEURAL_HALF_LIFE_MS=45*86400000;
  const NEURAL_MIN_EVENTS=20;
  const NEURAL_MIN_DAYS=5;
  const NEURAL_MIN_CONFIDENCE=.70;
  const GP_DAILY_MIX_COHERENCE_EXPONENT=3.4;
  const GP_DAILY_MIX_SHORTLIST_RATIO=.45;
  const neuralSessionId=`session-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  let neuralModel=null,neuralBuildTimer=0,lastNeuralBuildAt=0,neuralRefreshPromise=null,pendingSelectionSource="automatic";
  let behaviorRuntime={trackId:null,startedAt:0,lastWallAt:0,lastMediaAt:0,listened:0,checkpoint:0,source:"automatic"};
  const sessionPreference={signals:[],recentTrackIds:[],exploration:{}};

  function finiteNumber(value,fallback=null){const n=Number(value);return Number.isFinite(n)?n:fallback;}
  const clamp=(...args)=>GP.utils.clamp(...args);
  function listeningPeriodForHour(value){
    const hour=((Number(value)||0)%24+24)%24;
    if(hour>=22||hour<5)return "late";
    if(hour<10)return "morning";
    if(hour<15)return "noon";
    if(hour<18)return "afternoon";
    return "evening";
  }
  function neuralTrackId(track){return track?.spectrumId||track?.audioEssenceKey||track?.contentKey||track?.id||trackKey(track);}
  function neuralArtistKey(track){return String(track?.artist||"").trim().toLocaleLowerCase()||`track:${neuralTrackId(track)}`;}
  function cleanMfcc(track){
    const raw=Array.isArray(track?.mfcc?.mean)?track.mfcc.mean:Array.isArray(track?.mfcc)?track.mfcc:[];
    return raw.slice(0,13).map(value=>finiteNumber(value,0));
  }
  function trackFeatureSnapshot(track){
    if(!track)return null;
    const rawEnergy=finiteNumber(track.energy),energy=Number.isFinite(rawEnergy)?(rawEnergy>1?rawEnergy/100:rawEnergy):null;
    return {spectrumId:neuralTrackId(track),artist:track.artist||"",album:track.album||"",genre:track.genre||track.inferredGenre||"Unknown",genreSecondary:track.genreSecondary||null,bpm:finiteNumber(track.bpm),energy,mfcc:cleanMfcc(track)};
  }
  function behaviorSignal(type,context={}){
    if(type==="search_select")return 2.8;
    if(type==="manual_select")return 2.4;
    if(type==="queue_add")return 2.6;
    if(type==="replay")return 2.5;
    // 7.4.0: an explicit like outweighs passive signals; unliking only flips
    // stored state (signal 0 persists without touching the model).
    if(type==="like")return context?.liked===false?0:3.0;
    if(type==="complete")return 1.35;
    if(type==="listen_duration")return clamp((finiteNumber(context.actualPlaybackSeconds,0)/180)*.65,0,.65);
    if(type==="skip"){
      const ratio=clamp(finiteNumber(context.progressRatio,0),0,1);
      if(ratio<.08)return-2.6;if(ratio<.25)return-1.65;if(ratio<.55)return-.8;if(ratio<.9)return-.2;return 0;
    }
    return 0;
  }
  function scheduleUserModelRefresh(){
    clearTimeout(neuralBuildTimer);
    const delay=Math.max(700,60000-(Date.now()-lastNeuralBuildAt));
    neuralBuildTimer=setTimeout(()=>refreshUserModel(),delay);
  }
  async function recordBehaviorEvent(type,track=null,context={}){
    const features=trackFeatureSnapshot(track);
    const event={id:`${Date.now()}-${Math.random().toString(36).slice(2,10)}`,type,timestamp:Date.now(),sessionId:neuralSessionId,spectrumId:features?.spectrumId||null,features,context:{...context},signal:behaviorSignal(type,context)};
    try{await GPDatabase.addBehaviorEvent(event);}catch(error){console.warn("Behavior event persistence failed",error);}
    if(event.signal&&features){
      sessionPreference.signals.push({timestamp:event.timestamp,signal:event.signal,features});
      if(sessionPreference.signals.length>80)sessionPreference.signals.splice(0,sessionPreference.signals.length-80);
      if(type==="complete"&&context.selectionSource==="shuffle")sessionPreference.exploration[features.genre]=(sessionPreference.exploration[features.genre]||0)+1;
    }
    if(event.signal) scheduleUserModelRefresh();return event;
  }
  function mapAdd(map,key,value){if(!key)return;map[key]=(map[key]||0)+value;}
  function weightedMeanAdd(acc,value,weight){if(!Number.isFinite(value)||weight===0)return;acc.sum+=value*weight;acc.weight+=Math.abs(weight);}
  function modelConfidence(effectiveEvents,activeDays,featureEvents,acousticEvents){
    const evidence=clamp(effectiveEvents/45,0,1),days=clamp(activeDays/10,0,1),features=featureEvents?clamp(acousticEvents/featureEvents,0,1):0;
    return clamp(evidence*.52+days*.28+features*.20,0,1);
  }
  async function buildUserPreferenceModel(){
    let events=[];try{events=await GPDatabase.getBehaviorEvents()||[];}catch(error){return neuralModel;}
    events=events.filter(event=>Date.now()-finiteNumber(event.timestamp,Date.now())<=270*86400000).sort((a,b)=>a.timestamp-b.timestamp).slice(-12000);
    const now=Date.now(),artist={},album={},genre={},timeGenre={},lastPlayed={},trackEvidence={};
    const bpm={sum:0,weight:0},energy={sum:0,weight:0},mfcc={sum:Array(13).fill(0),weight:0};
    const days=new Set(),explorationFeedback={};let effectiveEvents=0,featureEvents=0,acousticEvents=0;
    const byId=new Map(playlist.map(track=>[neuralTrackId(track),track]));
    let neuralEventsProcessed=0;
    for(const event of events){
      if(neuralEventsProcessed>0&&neuralEventsProcessed%32===0)await yieldToInputPriority();
      neuralEventsProcessed++;
      const live=byId.get(event.spectrumId),features=live?trackFeatureSnapshot(live):event.features;if(!features)continue;
      const raw=finiteNumber(event.signal,behaviorSignal(event.type,event.context||{}));if(!raw)continue;
      const age=Math.max(0,now-finiteNumber(event.timestamp,now)),decay=Math.pow(.5,age/NEURAL_HALF_LIFE_MS);
      let signal=raw*decay;
      const exploratory=["shuffle","recommendation"].includes(event.context?.selectionSource),genreKey=features.genre||"Unknown";
      explorationFeedback[genreKey]=explorationFeedback[genreKey]||{accepted:0,skipped:0};
      if(exploratory&&event.type==="complete"){
        if(explorationFeedback[genreKey].accepted<3)signal*=.28;
        explorationFeedback[genreKey].accepted++;
      }
      if(exploratory&&event.type==="skip"){
        if(explorationFeedback[genreKey].skipped<4)signal*=.18;
        explorationFeedback[genreKey].skipped++;
      }
      effectiveEvents+=Math.min(1,Math.abs(signal));featureEvents++;days.add(new Date(event.timestamp).toISOString().slice(0,10));
      mapAdd(artist,features.artist,signal);mapAdd(album,features.album,signal);mapAdd(genre,features.genre,signal);
      const slot=listeningPeriodForHour(new Date(event.timestamp).getHours());
      timeGenre[slot]=timeGenre[slot]||{};mapAdd(timeGenre[slot],features.genre,signal);
      if(signal>0){
        weightedMeanAdd(bpm,features.bpm,signal);weightedMeanAdd(energy,features.energy,signal);
        if(features.mfcc?.length){for(let i=0;i<13;i++)mfcc.sum[i]+=(features.mfcc[i]||0)*signal;mfcc.weight+=signal;acousticEvents++;}
      }
      const id=features.spectrumId;trackEvidence[id]=trackEvidence[id]||{support:0,skips:0,completes:0};trackEvidence[id].support+=signal;
      if(event.type==="skip")trackEvidence[id].skips++;if(event.type==="complete")trackEvidence[id].completes++;
      if(["complete","skip","listen_duration"].includes(event.type))lastPlayed[id]=Math.max(lastPlayed[id]||0,event.timestamp);
    }
    const confidence=modelConfidence(effectiveEvents,days.size,featureEvents,acousticEvents);
    const model={id:"default",version:NEURAL_MODEL_VERSION,updatedAt:now,confidence,effectiveEvidence:effectiveEvents,activeDays:days.size,mature:effectiveEvents>=NEURAL_MIN_EVENTS&&days.size>=NEURAL_MIN_DAYS&&confidence>=NEURAL_MIN_CONFIDENCE,preference:{artist,album,genre,bpm:bpm.weight?bpm.sum/bpm.weight:null,energy:energy.weight?energy.sum/energy.weight:null,mfcc:mfcc.weight?mfcc.sum.map(v=>v/mfcc.weight):[],timeGenre},lastPlayed,trackEvidence};
    try{await GPDatabase.saveUserModel(model);}catch(error){console.warn("User model persistence failed",error);}return model;
  }
  function refreshUserModel(){
    if(neuralRefreshPromise)return neuralRefreshPromise;
    clearTimeout(neuralBuildTimer);neuralBuildTimer=0;lastNeuralBuildAt=Date.now();
    neuralRefreshPromise=(async()=>{
      await yieldToInputPriority();
      neuralModel=await buildUserPreferenceModel()||neuralModel;
      await yieldToInputPriority();
      return neuralModel;
    })().finally(()=>{neuralRefreshPromise=null;});
    return neuralRefreshPromise;
  }
  function normalizedMapScore(map,key){
    if(!map||!key)return 0;const values=Object.values(map).map(Math.abs),max=Math.max(1,...values);return clamp((map[key]||0)/max,-1,1);
  }
  function genrePreferenceScore(map,key){return GP.genreRelations?.relatedScore(map,key)??normalizedMapScore(map,key);}
  function genreSimilarity(a,b){return GP.genreRelations?.similarity(a,b)??(a&&b&&a===b?1:0);}
  function mfccSimilarity(a,b){if(!a?.length||!b?.length)return 0;let distance=0;for(let i=0;i<Math.min(a.length,b.length);i++){const scale=Math.max(8,Math.abs(b[i]||0));distance+=Math.abs((a[i]||0)-(b[i]||0))/scale;}return Math.exp(-distance/Math.min(a.length,b.length));}
  function currentSessionScore(features){
    const now=Date.now();let total=0,weight=0;
    for(const item of sessionPreference.signals){const age=now-item.timestamp,decay=Math.exp(-age/(45*60000));if(decay<.02)continue;let sim=0;if(item.features.artist===features.artist)sim+=.3;if(item.features.album===features.album)sim+=.18;sim+=genreSimilarity(item.features.genre,features.genre)*.25;sim+=mfccSimilarity(features.mfcc,item.features.mfcc)*.27;total+=item.signal*decay*sim;weight+=decay;}
    return weight?clamp(total/weight,-1,1):0;
  }
  function recommendationScore(track,context={}){
    const model=neuralModel,features=context.features||trackFeatureSnapshot(track);if(!model?.mature||!features)return{score:1,parts:{fallback:"uniform"}};
    const p=model.preference,longTerm=normalizedMapScore(p.artist,features.artist)*.30+normalizedMapScore(p.album,features.album)*.13+genrePreferenceScore(p.genre,features.genre)*.25;
    const bpmMatch=Number.isFinite(features.bpm)&&Number.isFinite(p.bpm)?Math.exp(-Math.abs(features.bpm-p.bpm)/35):0;
    const energyMatch=Number.isFinite(features.energy)&&Number.isFinite(p.energy)?Math.exp(-Math.abs(features.energy-p.energy)/.3):0;
    const acoustic=mfccSimilarity(features.mfcc,p.mfcc);const slot=listeningPeriodForHour(new Date().getHours());
    const time=genrePreferenceScore(p.timeGenre?.[slot],features.genre)*model.confidence;
    const session=currentSessionScore(features),last=model.lastPlayed?.[features.spectrumId]||0,ageHours=(Date.now()-last)/3600000;
    const freshness=last?clamp((ageHours-8)/72,-1,.7):.7;
    const recent=sessionPreference.recentTrackIds.slice(-5).map(id=>playlist.find(t=>neuralTrackId(t)===id)).filter(Boolean);
    const diversity=recent.reduce((penalty,t)=>penalty+(t.artist===features.artist ? .15 : 0)+genreSimilarity(t.genre,features.genre)*.08,0);
    const exploration=model.trackEvidence?.[features.spectrumId]?.support?0:.12;
    const raw=longTerm+acoustic*.12+bpmMatch*.08+energyMatch*.07+time*.12+session*.34+freshness*.20+exploration-diversity;
    return{score:clamp(Math.exp(raw),.35,3.4),parts:{longTerm,acoustic,bpmMatch,energyMatch,time,session,freshness,diversity,exploration}};
  }
  function uniformPick(candidates){return candidates[Math.floor(Math.random()*candidates.length)];}
  function weightedRandom(candidates,weights){const total=weights.reduce((a,b)=>a+b,0);if(!(total>0))return uniformPick(candidates);let r=Math.random()*total;for(let i=0;i<candidates.length;i++){r-=weights[i];if(r<=0)return candidates[i];}return uniformPick(candidates);}
  function recentRecommendationIdSet({includeLastMix=false}={}){
    const limit=Math.min(16,Math.max(6,Math.ceil(playlist.length*.04))),ids=sessionPreference.recentTrackIds.slice(-limit);
    shuffleTimeline.slice(Math.max(0,shuffleTimelineCursor-limit+1),shuffleTimelineCursor+1).forEach(index=>{if(playlist[index])ids.push(neuralTrackId(playlist[index]));});
    if(includeLastMix&&Array.isArray(lastMix))lastMix.forEach(index=>{if(playlist[index])ids.push(neuralTrackId(playlist[index]));});
    return new Set(ids.filter(Boolean));
  }
  function recentRecommendationArtistSet(limit=2){
    const ids=sessionPreference.recentTrackIds.slice(-limit),artists=new Set();
    shuffleTimeline.slice(Math.max(0,shuffleTimelineCursor-limit+1),shuffleTimelineCursor+1).forEach(index=>{if(playlist[index])ids.push(neuralTrackId(playlist[index]));});
    ids.map(id=>playlist.find(track=>neuralTrackId(track)===id)).filter(Boolean).forEach(track=>artists.add(neuralArtistKey(track)));
    return artists;
  }
  function weightedPickIndex(excludeIdx,pool){
    let candidates=(pool||playlist.map((_,i)=>i)).filter(i=>i!==excludeIdx);if(!candidates.length)return excludeIdx;
    const recent=recentRecommendationIdSet(),fresh=candidates.filter(index=>!recent.has(neuralTrackId(playlist[index])));
    if(fresh.length)candidates=fresh;
    const alternateArtists=candidates.filter(index=>!recentRecommendationArtistSet().has(neuralArtistKey(playlist[index])));
    if(alternateArtists.length)candidates=alternateArtists;
    if(!neuralModel?.mature)return uniformPick(candidates);
    return weightedRandom(candidates,candidates.map(i=>recommendationScore(playlist[i],{surface:"shuffle"}).score));
  }
  function dailyGenreTokens(features){
    return [features?.genre,features?.genreSecondary].filter(Boolean).flatMap(value=>String(value).toLowerCase().split(/[\/,;&+|]+/)).map(value=>GP.genreRelations?.resolve(value)?.id||value.trim()).filter(value=>value&&value!=="unknown"&&value!=="mixed");
  }
  function dailyFeatureCompleteness(features){return (features?.spectrumId?1:0)+(features?.mfcc?.length>=8?2:0)+(dailyGenreTokens(features).length?1.5:0)+(Number.isFinite(features?.bpm)?.6:0)+(Number.isFinite(features?.energy)?.4:0);}
  function dailyFeatureSimilarity(anchor,candidate){
    if(!anchor||!candidate)return 0;
    // 7.3.2: pure local similarity from cached features only.
    const timbre=mfccSimilarity(anchor.mfcc,candidate.mfcc);
    const genre=genreSimilarity(anchor.genre,candidate.genre);
    const tempo=(Number.isFinite(anchor.bpm)&&Number.isFinite(candidate.bpm))?Math.exp(-Math.abs(anchor.bpm-candidate.bpm)/35):.5;
    return clamp(timbre*.55+genre*.25+tempo*.20,0,1);
  }
  function generateDailyMix(count){
    let remaining=playlist.map((track,index)=>{const features=trackFeatureSnapshot(track);return{index,features,completeness:dailyFeatureCompleteness(features)};}).filter(item=>item.index!==currentIndex),picked=[],pickedFeatures=[],artistCounts=new Map(),preferenceScores=new Map();
    const preferenceScoreFor=item=>{if(!neuralModel?.mature)return 1;if(preferenceScores.has(item.index))return preferenceScores.get(item.index);const score=recommendationScore(playlist[item.index],{surface:"daily",features:item.features}).score;preferenceScores.set(item.index,score);return score;};
    const recent=recentRecommendationIdSet({includeLastMix:true}),fresh=remaining.filter(item=>!recent.has(item.features?.spectrumId));
    if(fresh.length>=Math.min(count,remaining.length))remaining=fresh;
    if(!remaining.length)return picked;
    const currentFeatures=currentIndex>=0?trackFeatureSnapshot(playlist[currentIndex]):null;
    let anchor=currentFeatures&&dailyFeatureCompleteness(currentFeatures)>=3?currentFeatures:null;
    if(!anchor){
      const anchorPool=remaining.filter(item=>item.completeness>=2.5),pool=anchorPool.length?anchorPool:remaining;
      const anchorItem=weightedRandom(pool,pool.map(item=>Math.max(.1,item.completeness)*preferenceScoreFor(item)));
      anchor=anchorItem.features;
    }
    const targetCount=Math.min(count,remaining.length);
    while(picked.length<targetCount){
      const scored=remaining.map(item=>{
        const anchorScore=dailyFeatureSimilarity(anchor,item.features);
        const clusterScore=pickedFeatures.length?pickedFeatures.reduce((sum,features)=>sum+dailyFeatureSimilarity(features,item.features),0)/pickedFeatures.length:anchorScore;
        const coherence=anchorScore*.76+clusterScore*.24,preference=preferenceScoreFor(item),artist=neuralArtistKey(playlist[item.index]),artistRepeat=artistCounts.get(artist)||0,diversityPenalty=Math.pow(.48,artistRepeat);
        return{item,coherence,weight:Math.pow(Math.max(.025,coherence),GP_DAILY_MIX_COHERENCE_EXPONENT)*Math.sqrt(preference)*Math.max(.65,item.completeness/4.5)*diversityPenalty};
      }).sort((a,b)=>b.coherence-a.coherence);
      const shortlist=scored.slice(0,Math.max(3,Math.ceil(scored.length*GP_DAILY_MIX_SHORTLIST_RATIO))),choice=weightedRandom(shortlist,shortlist.map(entry=>entry.weight));
      picked.push(choice.item.index);pickedFeatures.push(choice.item.features);const artist=neuralArtistKey(playlist[choice.item.index]);artistCounts.set(artist,(artistCounts.get(artist)||0)+1);remaining.splice(remaining.indexOf(choice.item),1);
    }
    recommendationPersistPromise=GPDatabase.saveRecommendations({id:"daily",generatedAt:Date.now(),modelConfidence:neuralModel?.confidence||0,mode:"feature-clustered",anchorSpectrumId:anchor?.spectrumId||null,tracks:picked.map(i=>neuralTrackId(playlist[i]))}).then(()=>true).catch(()=>false);return picked;
  }
  async function generateDailyMixForImport(count){
    const remaining=[];
    for(let index=0;index<playlist.length;index++){
      if(index!==currentIndex){const features=trackFeatureSnapshot(playlist[index]);remaining.push({index,features,completeness:dailyFeatureCompleteness(features)});}
      if(index&&index%48===0)await yieldToInputPriority();
    }
    let pool=remaining,picked=[],pickedFeatures=[],artistCounts=new Map(),preferenceScores=new Map();const preferenceScoreFor=item=>{if(!neuralModel?.mature)return 1;if(preferenceScores.has(item.index))return preferenceScores.get(item.index);const score=recommendationScore(playlist[item.index],{surface:"daily",features:item.features}).score;preferenceScores.set(item.index,score);return score;};const recent=recentRecommendationIdSet({includeLastMix:true}),fresh=pool.filter(item=>!recent.has(item.features?.spectrumId));
    if(fresh.length>=Math.min(count,pool.length))pool=fresh;if(!pool.length)return picked;
    const currentFeatures=currentIndex>=0?trackFeatureSnapshot(playlist[currentIndex]):null;let anchor=currentFeatures&&dailyFeatureCompleteness(currentFeatures)>=3?currentFeatures:null;
    if(!anchor){const anchorPool=pool.filter(item=>item.completeness>=2.5),choices=anchorPool.length?anchorPool:pool;anchor=weightedRandom(choices,choices.map(item=>Math.max(.1,item.completeness)*preferenceScoreFor(item))).features;}
    const targetCount=Math.min(count,pool.length);
    while(picked.length<targetCount){
      const scored=[];let scoreSliceStarted=performance.now();
      for(const item of pool){
        const anchorScore=dailyFeatureSimilarity(anchor,item.features),clusterScore=pickedFeatures.length?pickedFeatures.reduce((sum,features)=>sum+dailyFeatureSimilarity(features,item.features),0)/pickedFeatures.length:anchorScore,coherence=anchorScore*.76+clusterScore*.24,preference=preferenceScoreFor(item);
        const artist=neuralArtistKey(playlist[item.index]),artistRepeat=artistCounts.get(artist)||0,diversityPenalty=Math.pow(.48,artistRepeat);
        scored.push({item,coherence,weight:Math.pow(Math.max(.025,coherence),GP_DAILY_MIX_COHERENCE_EXPONENT)*Math.sqrt(preference)*Math.max(.65,item.completeness/4.5)*diversityPenalty});
        if(performance.now()-scoreSliceStarted>=8){await yieldToInputPriority();scoreSliceStarted=performance.now();}
      }
      scored.sort((a,b)=>b.coherence-a.coherence);
      const shortlist=scored.slice(0,Math.max(3,Math.ceil(scored.length*GP_DAILY_MIX_SHORTLIST_RATIO))),choice=weightedRandom(shortlist,shortlist.map(entry=>entry.weight));picked.push(choice.item.index);pickedFeatures.push(choice.item.features);const artist=neuralArtistKey(playlist[choice.item.index]);artistCounts.set(artist,(artistCounts.get(artist)||0)+1);pool.splice(pool.indexOf(choice.item),1);
      await yieldToInputPriority();
    }
    recommendationPersistPromise=GPDatabase.saveRecommendations({id:"daily",generatedAt:Date.now(),modelConfidence:neuralModel?.confidence||0,mode:"feature-clustered",anchorSpectrumId:anchor?.spectrumId||null,tracks:picked.map(i=>neuralTrackId(playlist[i]))}).then(()=>true).catch(()=>false);return picked;
  }
  function settleBehaviorProgress(){
    if(!behaviorRuntime.trackId||!audio||(audio.paused&&!audio.ended))return;const now=performance.now(),media=finiteNumber(audio.currentTime,behaviorRuntime.lastMediaAt),mediaDelta=media-behaviorRuntime.lastMediaAt,wallDelta=(now-behaviorRuntime.lastWallAt)/1000,rate=Math.max(.5,finiteNumber(audio.playbackRate,1));
    if(mediaDelta>0&&mediaDelta<=Math.max(5,wallDelta*rate+1.5))behaviorRuntime.listened+=mediaDelta;behaviorRuntime.lastWallAt=now;behaviorRuntime.lastMediaAt=media;
  }
  function resetBehaviorMediaClock(){behaviorRuntime.lastWallAt=performance.now();behaviorRuntime.lastMediaAt=finiteNumber(audio.currentTime,0);}
  function beginBehaviorTrack(track,source="automatic"){
    behaviorRuntime={trackId:neuralTrackId(track),startedAt:Date.now(),lastWallAt:performance.now(),lastMediaAt:finiteNumber(audio.currentTime,0),listened:0,checkpoint:0,source,playCounted:false};sessionPreference.recentTrackIds.push(behaviorRuntime.trackId);if(sessionPreference.recentTrackIds.length>20)sessionPreference.recentTrackIds.shift();pendingSelectionSource="automatic";
  }
  function emitListeningCheckpoint(reason="periodic"){
    settleBehaviorProgress();const t=playlist[currentIndex];if(!t)return;const delta=behaviorRuntime.listened-behaviorRuntime.checkpoint;if(delta<8&&reason==="periodic")return;if(delta>0){behaviorRuntime.checkpoint=behaviorRuntime.listened;recordBehaviorEvent("listen_duration",t,{actualPlaybackSeconds:delta,totalActualPlaybackSeconds:behaviorRuntime.listened,reason,selectionSource:behaviorRuntime.source});}
  }
  function recordSkip(track,context={}){settleBehaviorProgress();const duration=finiteNumber(audio.duration,finiteNumber(track?.duration,0)),position=finiteNumber(audio.currentTime,0),ratio=duration?position/duration:0;recordBehaviorEvent("skip",track,{...context,position,duration,progressRatio:ratio,actualPlaybackSeconds:behaviorRuntime.listened,selectionSource:behaviorRuntime.source});behaviorRuntime.checkpoint=behaviorRuntime.listened;}
  function recordComplete(track,context={}){
    settleBehaviorProgress();const duration=finiteNumber(audio.duration,finiteNumber(track?.duration,0)),progressRatio=duration?behaviorRuntime.listened/duration:0;
    if(progressRatio<.75){recordSkip(track,{...context,progressRatio});return false;}
    if(behaviorRuntime.playCounted)return false;
    behaviorRuntime.playCounted=true;recordBehaviorEvent("complete",track,{...context,duration,progressRatio,actualPlaybackSeconds:behaviorRuntime.listened,selectionSource:behaviorRuntime.source});behaviorRuntime.checkpoint=behaviorRuntime.listened;incrementPlayCount();return true;
  }
  function judgeAndRecordTransition(reason="transition"){const t=playlist[currentIndex];if(!t||!audio.duration)return;settleBehaviorProgress();const ratio=behaviorRuntime.listened/audio.duration;if(ratio>=.75)recordComplete(t,{reason});else recordSkip(t,{reason,progressRatio:ratio});}
  setInterval(()=>emitListeningCheckpoint("periodic"),30000);
  setTimeout(async()=>{
    try{const cached=await GPDatabase.getUserModel("default");if(cached?.version===NEURAL_MODEL_VERSION)neuralModel=cached;if(!cached||cached.version!==NEURAL_MODEL_VERSION||Date.now()-cached.updatedAt>6*3600000)scheduleUserModelRefresh();}catch(error){scheduleUserModelRefresh();}
  },0);
  let overrideQueue = null; // array of playlist indices, used by 每日推荐 playback
  let lastMix = null,dailyMixRefreshTimer=0,dailyMixImportBatchPromise=null,recommendationPersistPromise=Promise.resolve();
  function refreshDailyMix(){
    if(dailyMixImportBatchPromise)return dailyMixImportBatchPromise;
    lastMix=playlist.length>=2?generateDailyMix(10):null;
    $("#playMixBtn").style.display=lastMix?.length?"inline-flex":"none";
    renderRecommendList();
    return lastMix;
  }
  async function finalizeDailyMixForImport(){
    if(dailyMixImportBatchPromise)return dailyMixImportBatchPromise;
    clearTimeout(dailyMixRefreshTimer);
    dailyMixImportBatchPromise=(async()=>{
      let mix=playlist.length>=2?await generateDailyMixForImport(10):null;lastMix=mix;$("#playMixBtn").style.display=mix?.length?"inline-flex":"none";renderRecommendList();
      await recommendationPersistPromise;
      await yieldToInputPriority();
      const expected=Math.min(10,Math.max(0,playlist.length-1));
      let rendered=$("#recommendList")?.querySelectorAll(".recommend-track").length||0;
      if(expected>0&&(!Array.isArray(mix)||mix.length===0||rendered!==mix.length)){
        renderRecommendList();
        await yieldToInputPriority();
        rendered=$("#recommendList")?.querySelectorAll(".recommend-track").length||0;
      }
      if(expected>0&&(!Array.isArray(mix)||mix.length===0||rendered!==mix.length))throw new Error("Daily Mix generation did not complete");
      return mix;
    })().finally(()=>{dailyMixImportBatchPromise=null;});
    return dailyMixImportBatchPromise;
  }
  function scheduleDailyMixRefresh(delay=80){clearTimeout(dailyMixRefreshTimer);dailyMixRefreshTimer=setTimeout(refreshDailyMix,delay);}
  function renderRecommendList(){
    const el = $("#recommendList");
    if(playlist.length < 2){
      el.innerHTML = `<div class="recommend-empty">${tr("歌单里至少要有 2 首歌才能生成推荐","At least 2 songs are required to generate a mix")}</div>`;
      return;
    }
    if(!lastMix){lastMix=generateDailyMix(10);$("#playMixBtn").style.display=lastMix.length?"inline-flex":"none";}
    el.innerHTML = "";
    lastMix.forEach(idx => el.insertAdjacentHTML("beforeend", trackRowHTML(playlist[idx], idx, {compact:true,rowClass:"recommend-track"})));
    wireRows(el);
  }
  bindMicroMotion($("#playMixBtn"),"gp-mix-play-motion",500);
  $("#playMixBtn").addEventListener("click", () => {
    if(!lastMix || !lastMix.length) return;
    const mixTrackIds=[...new Set(lastMix.map(index=>playlist[index]?.id).filter(Boolean))];
    if(!mixTrackIds.length)return;
    overrideQueue=null;
    playQueue.length=0;
    playQueue.push(...mixTrackIds);
    manualQueueActive=true;
    playingQueuedTrack=false;
    queueResumeIndex=null;
    mixTrackIds.forEach(trackId=>{
      const track=playlist.find(item=>item.id===trackId);
      if(track)recordBehaviorEvent("queue_add",track,{placement:"daily_mix",movedExisting:false});
    });
    renderMiniQueue();
    showToast(tr(`今日推荐已加入手动播放队列（${mixTrackIds.length} 首）`,`Daily Mix added to Manual Queue (${mixTrackIds.length} tracks)`));
    const firstMixIndex=takeNextQueuedIndex();
    if(firstMixIndex===null)return;
    beginQueuedPlayback();
    pendingSelectionSource="queue";
    loadTrack(firstMixIndex,true);
  });
  /* ================= ambient wallpaper (3 modes) ================= */
  const accentPalettes = {
    navy:  ["#2C4870","#5C7FA8","#8FA8C4"],
    slate: ["#4A5560","#6B7785","#98A2AC"],
    forest:["#3A5A45","#5C8065","#8AAE8F"],
    wine:  ["#7A3B42","#9C5761","#BF8489"],
    bronze:["#8A6A3C","#AD8A55","#CBAF7C"],
    teal:  ["#2E6B6B","#4E8F8F","#7FB3B3"],
    mono:  ["#000000","#8e8e93","#ffffff"]
  };
  let accentKey = "navy";
  let adaptiveColorOn = false;
  function activeTheme(){return document.body.getAttribute("data-theme")==="dark"?"dark":"light";}
  function themeBaseRgb(theme=activeTheme()){return theme==="dark"?[0,0,0]:[238,240,244];}
  function accentSeedForTheme(key,theme=activeTheme()){
    if(key==="mono")return theme==="dark"?"#ffffff":"#000000";
    return accentPalettes[key]?.[theme==="dark"?1:0]||accentPalettes.navy[theme==="dark"?1:0];
  }
  function setAccent(key,{refreshAmbient=true,persist=true}={}){
    accentKey = accentPalettes[key]?key:"navy";
    const hexToRgbArray = hex => { const v=hex.replace("#",""); return [parseInt(v.slice(0,2),16),parseInt(v.slice(2,4),16),parseInt(v.slice(4,6),16)]; };
    const primary=accentSeedForTheme(accentKey);
    commitAccentRgb(hexToRgbArray(primary));
    $$(".swatch").forEach(s => s.classList.toggle("active", s.dataset.k===accentKey));
    if(refreshAmbient)updateAmbient();if(persist)savePrefs();
  }
  function srgbToLinear(value){value=Math.max(0,Math.min(255,value))/255;return value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4);}
  function linearToSrgb(value){value=Math.max(0,Math.min(1,value));return Math.round(255*(value<=.0031308?12.92*value:1.055*Math.pow(value,1/2.4)-.055));}
  function rgbToOklab(r,g,b){
    r=srgbToLinear(r);g=srgbToLinear(g);b=srgbToLinear(b);
    const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
    const m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
    const s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
    return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
  }
  function oklabToRgb(L,a,b){
    const l=Math.pow(L+.3963377774*a+.2158037573*b,3);
    const m=Math.pow(L-.1055613458*a-.0638541728*b,3);
    const s=Math.pow(L-.0894841775*a-1.291485548*b,3);
    return [linearToSrgb(4.0767416621*l-3.3077115913*m+.2309699292*s),linearToSrgb(-1.2684380046*l+2.6097574011*m-.3413193965*s),linearToSrgb(-.0041960863*l-.7034186147*m+1.707614701*s)];
  }
  function readCurrentBackgroundRgb(){
    // Theme transitions animate the rendered body color for 500 ms. Accent
    // calculations must use the destination theme, never that transient frame.
    return themeBaseRgb();
  }
  function relativeLuminance([r,g,b]){return .2126*srgbToLinear(r)+.7152*srgbToLinear(g)+.0722*srgbToLinear(b);}
  function contrastRatio(rgbA,rgbB){const a=relativeLuminance(rgbA),b=relativeLuminance(rgbB);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
  function mixRgb(base,overlay,alpha){return base.map((value,index)=>Math.round(value*(1-alpha)+overlay[index]*alpha));}
  function rotateRgbHue(rgb,degrees){
    const [r,g,b]=rgb.map(value=>Math.max(0,Math.min(255,value))/255),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
    let hue=0,saturation=0,lightness=(max+min)/2;
    if(delta){saturation=delta/(1-Math.abs(2*lightness-1));if(max===r)hue=60*(((g-b)/delta)%6);else if(max===g)hue=60*((b-r)/delta+2);else hue=60*((r-g)/delta+4);}
    hue=(hue+degrees+360)%360;
    const chroma=(1-Math.abs(2*lightness-1))*saturation,x=chroma*(1-Math.abs((hue/60)%2-1)),m=lightness-chroma/2;
    let out=hue<60?[chroma,x,0]:hue<120?[x,chroma,0]:hue<180?[0,chroma,x]:hue<240?[0,x,chroma]:hue<300?[x,0,chroma]:[chroma,0,x];
    return out.map(value=>Math.round((value+m)*255));
  }
  function ambientBlobGradient(rgb,intensity){
    const alpha=Math.max(.08,Math.min(.72,intensity));
    return `radial-gradient(circle at 50% 50%,rgba(${rgb.join(",")},${(.62*alpha).toFixed(3)}) 0%,rgba(${rgb.join(",")},${(.4*alpha).toFixed(3)}) 30%,rgba(${rgb.join(",")},${(.14*alpha).toFixed(3)}) 58%,rgba(${rgb.join(",")},0) 82%)`;
  }
  let lastFavoriteBackdropPalette=null;
  function currentAccentRgb(){const values=getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").match(/[\d.]+/g);return values?.length>=3?values.slice(0,3).map(Number):[44,72,112];}
  function commitAccentRgb(rgb,{refreshFavorite=true}={}){
    const clean=rgb.slice(0,3).map(value=>Math.max(0,Math.min(255,Math.round(value))));
    const hex="#"+clean.map(value=>value.toString(16).padStart(2,"0")).join("");
    const contrast=contrastRatio([0,0,0],clean)>=contrastRatio([255,255,255],clean)?"#000000":"#ffffff";
    const root=document.documentElement,current=currentAccentRgb(),changed=current.some((value,index)=>Math.round(value)!==clean[index]);
    root.style.setProperty("--accent",hex);root.style.setProperty("--accent-rgb",clean.join(","));root.style.setProperty("--accent-contrast",contrast);root.style.setProperty("--turntable-accent-rgb",clean.join(","));
    if(changed)updateFavicon(hex,contrast);
    /* Accent consumers with contextual inline surfaces must be committed in the
       same frame as the root variables. Otherwise the EQ trigger can retain the
       previous cover colour until an unrelated layout refresh. */
    updateContextualControlColors();
    if(typeof GPUIRegistry!=="undefined")GPUIRegistry.refresh(document,false);
    $("#eqCurveFill")?.querySelectorAll("stop").forEach(stop=>stop.setAttribute("stop-color",hex));
    $("#playbackSpeedButton")?.style.setProperty("color",hex);
    const speedGlider=$(".playback-speed-presets");if(speedGlider&&typeof updateGlider==="function")requestAnimationFrame(()=>updateGlider(speedGlider,false));
    if(typeof renderEQCurve==="function")renderEQCurve();
    drawMiniEq();
    if(refreshFavorite)updateFavoriteAnswerContrast();
    if(typeof scheduleTraditionalPiPRefresh==="function")scheduleTraditionalPiPRefresh(true);
    return clean;
  }
  function weightedPaletteTone(palette){
    const colors=(palette||[]).filter(color=>Array.isArray(color)&&color.length>=3).slice(0,3);
    if(!colors.length)return readCurrentBackgroundRgb();
    const weights=[.52,.3,.18];let total=0,tone=[0,0,0];
    colors.forEach((color,index)=>{const weight=weights[index]||.12;total+=weight;for(let channel=0;channel<3;channel++)tone[channel]+=Math.max(0,Math.min(255,color[channel]))*weight;});
    return tone.map(value=>Math.round(value/Math.max(total,.01)));
  }
  function readableAccentTint(seed,surface,minimum=4.5){
    if(contrastRatio(seed,surface)>=minimum)return seed.map(Math.round);
    let [L,a,b]=rgbToOklab(...seed),best=seed,bestContrast=contrastRatio(seed,surface);
    const towardLight=contrastRatio([245,245,245],surface)>contrastRatio([16,16,18],surface);
    for(let step=0;step<34;step++){
      L=Math.max(.18,Math.min(.88,L+(towardLight?.022:-.022)));
      const candidate=oklabToRgb(L,a,b),ratio=contrastRatio(candidate,surface);
      if(ratio>bestContrast){best=candidate;bestContrast=ratio;}
      if(ratio>=minimum)break;
    }
    return best.map(value=>Math.max(8,Math.min(247,Math.round(value))));
  }
  function paletteForCurrentSurface(palette=lastFavoriteBackdropPalette){
    const colors=(palette||[]).filter(color=>Array.isArray(color)&&color.length>=3).slice(0,3);
    if(colors.length)return colors;
    return (accentPalettes[accentKey]||accentPalettes.navy).map(hexToRgbArr);
  }
  function visualSurfaceAt(x,y,palette=lastFavoriteBackdropPalette){
    const base=themeBaseRgb(),colors=paletteForCurrentSurface(palette),theme=activeTheme();
    if(bgMode==="blur")return mixRgb(base,weightedPaletteTone(colors),theme==="dark"?.48:.62);
    const points=[[.205,.205],[.845,.405],[.405,.795]],vw=Math.max(1,innerWidth),vh=Math.max(1,innerHeight);
    let surface=base.slice();
    points.forEach((point,index)=>{const dx=x/vw-point[0],dy=y/vh-point[1],distance=Math.hypot(dx,dy),weight=Math.pow(Math.max(0,1-distance/.58),1.7),alpha=weight*(theme==="dark"?.34:.46);surface=mixRgb(surface,colors[index%colors.length],alpha);});
    return surface;
  }
  function elementSurface(element,palette=lastFavoriteBackdropPalette){const rect=element?.getBoundingClientRect?.();return rect?visualSurfaceAt(rect.left+rect.width/2,rect.top+rect.height/2,palette):themeBaseRgb();}
  function sampledAmbientSurface(element){
    const rect=element?.getBoundingClientRect?.(),canvas=activeAmbientCanvas;
    if(!rect||!canvas?.width||!canvas?.height)return elementSurface(element);
    try{
      const x=Math.max(0,Math.min(canvas.width-1,Math.round((rect.left+rect.width/2)/Math.max(1,innerWidth)*canvas.width)));
      const y=Math.max(0,Math.min(canvas.height-1,Math.round((rect.top+rect.height/2)/Math.max(1,innerHeight)*canvas.height)));
      const context=canvas.getContext("2d",{alpha:false}),radius=canvas.width>16?2:0,left=Math.max(0,x-radius),top=Math.max(0,y-radius);
      const data=context.getImageData(left,top,Math.min(canvas.width,x+radius+1)-left,Math.min(canvas.height,y+radius+1)-top).data;
      let red=0,green=0,blue=0,count=0;for(let index=0;index<data.length;index+=4){red+=data[index];green+=data[index+1];blue+=data[index+2];count++;}
      return count?[Math.round(red/count),Math.round(green/count),Math.round(blue/count)]:elementSurface(element);
    }catch(error){return elementSurface(element);}
  }
  function updateAdaptiveTextColors(palette=lastFavoriteBackdropPalette){
    const black=[12,12,14],white=[248,248,250];
    $$(".view-header h2").forEach(title=>{if(!title.offsetParent)return;const surface=sampledAmbientSurface(title),useLight=contrastRatio(white,surface)>=contrastRatio(black,surface),color=useLight?"#f8f8fa":"#0c0c0e";title.style.color=color;title.style.textShadow=useLight?"0 1px 3px rgba(0,0,0,.34)":"0 1px 2px rgba(255,255,255,.28)";});
  }
  function updateContextualControlColors(palette=lastFavoriteBackdropPalette){
    const selectors="#addFilesBtn,#addFolderBtn,#sortBtn,#rangeSeg,#playMixBtn,#eqPresetButton,.export-log-btn,.release-tag";
    $$(selectors).forEach(control=>{const surface=elementSurface(control,palette),light=activeTheme()==="light",tone=mixRgb(surface,light?[255,255,255]:[255,255,255],light?.42:.1),accented=mixRgb(tone,currentAccentRgb(),light?.035:.065);control.style.setProperty("--context-control-bg",`rgba(${accented.join(",")},${light?.74:.62})`);control.style.setProperty("--context-control-border",`rgba(${currentAccentRgb().join(",")},${light?.09:.14})`);});
  }
  function updateFavoriteAnswerContrast(palette=lastFavoriteBackdropPalette){
    const colors=(palette||[]).filter(color=>Array.isArray(color)&&color.length>=3).slice(0,3);
    if(colors.length)lastFavoriteBackdropPalette=colors.map(color=>color.slice(0,3));
    const source=colors.length?colors:(lastFavoriteBackdropPalette||[readCurrentBackgroundRgb()]);
    const ambient=weightedPaletteTone(source);
    const base=readCurrentBackgroundRgb(),influence=bgMode==="blur"?.46:(bgMode==="color"?.34:.24);
    const backdrop=mixRgb(base,ambient,influence),glass=mixRgb(backdrop,[255,255,255],.64),cardTone=mixRgb(glass,currentAccentRgb(),.075);
    const answer=readableAccentTint(currentAccentRgb(),cardTone,4.5);
    document.documentElement.style.setProperty("--favorite-answer-contrast",`rgb(${answer.join(",")})`);
    updateAdaptiveTextColors(source);updateContextualControlColors(source);
  }
  function accentContrastSurfaces(backgroundRgb){
    const dark=relativeLuminance(backgroundRgb)<.35;
    return [backgroundRgb,mixRgb(backgroundRgb,dark?[56,56,60]:[255,255,255],dark?.78:.84)];
  }
  function minimumSurfaceContrast(rgb,surfaces){return Math.min(...surfaces.map(surface=>contrastRatio(rgb,surface)));}
  function harmonizeCoverPalette(colors,backgroundRgb){
    const backgroundLab=rgbToOklab(...backgroundRgb);
    let totalWeight=0,coverL=0,coverA=0,coverB=0;
    colors.slice(0,5).forEach((color,index)=>{
      const lab=rgbToOklab(...color.map(value=>Math.max(0,Math.min(255,value))));
      const chroma=Math.hypot(lab[1],lab[2]);
      const weight=(1/(1+index*.72))*(.45+.55*Math.min(1,chroma/.14));
      totalWeight+=weight;coverL+=lab[0]*weight;coverA+=lab[1]*weight;coverB+=lab[2]*weight;
    });
    if(!totalWeight)return null;
    coverL/=totalWeight;coverA/=totalWeight;coverB/=totalWeight;
    // Blend the extracted cover centre with the actual rendered background in OKLab.
    // This preserves a unique cover hue while making it belong to the current theme.
    const backgroundInfluence=.16;
    let L=coverL*(1-backgroundInfluence)+backgroundLab[0]*backgroundInfluence;
    let a=coverA*(1-backgroundInfluence)+backgroundLab[1]*backgroundInfluence;
    let b=coverB*(1-backgroundInfluence)+backgroundLab[2]*backgroundInfluence;
    const chroma=Math.hypot(a,b),chromaCap=.06;
    if(chroma>chromaCap){const scale=chromaCap/chroma;a*=scale;b*=scale;}
    const backgroundIsDark=relativeLuminance(backgroundRgb)<.35;
    const contrastSurfaces=accentContrastSurfaces(backgroundRgb);
    L=backgroundIsDark?Math.max(.58,Math.min(.74,L)):Math.max(.3,Math.min(.54,L));
    const minimumContrast=4.8,maximumContrast=7;
    let rgb=oklabToRgb(L,a,b);
    const readableContrast=value=>Math.min(minimumSurfaceContrast(value,contrastSurfaces),contrastRatio(value,mixRgb(contrastSurfaces[1],value,.12)));
    for(let step=0;step<36&&readableContrast(rgb)<minimumContrast;step++){
      L=Math.max(.25,Math.min(.82,L+(backgroundIsDark?.022:-.022)));
      rgb=oklabToRgb(L,a,b);
    }
    for(let step=0;step<14&&contrastRatio(rgb,backgroundRgb)>maximumContrast;step++){
      const nextL=Math.max(.25,Math.min(.82,L+(backgroundIsDark?-.018:.018)));
      const nextRgb=oklabToRgb(nextL,a,b);
      if(readableContrast(nextRgb)<minimumContrast)break;
      L=nextL;rgb=nextRgb;
    }
    return rgb;
  }
  let adaptiveAccentRequestToken=0;
  let adaptivePaletteCache={trackId:null,colors:null};
  const adaptivePaletteByTrack=new Map();
  const failedArtworkUrls = new Set();
  function recordFailedArtworkUrl(url){
    if(typeof url!=="string"||!url)return;
    failedArtworkUrls.add(url);
    if(failedArtworkUrls.size>200){
      const oldest=failedArtworkUrls.keys().next().value;
      failedArtworkUrls.delete(oldest);
    }
  }
  function resolveTrackArtwork(track){
    if(!track)return null;
    const coverUrl=typeof track.coverUrl==="string"?track.coverUrl.trim():"";
    const thumbUrl=typeof track.thumbUrl==="string"?track.thumbUrl.trim():"";
    if(coverUrl&&!failedArtworkUrls.has(coverUrl))return coverUrl;
    if(thumbUrl&&!failedArtworkUrls.has(thumbUrl))return thumbUrl;
    return null;
  }
  function adaptivePaletteKey(track){return track&&(track.spectrumId||track.contentKey||track.id);}
  function refreshAdaptiveAccentForTheme(){
    if(!adaptiveColorOn)return;
    const track=playlist[currentIndex];
    const key=adaptivePaletteKey(track),palette=(key&&adaptivePaletteByTrack.get(key))||(track&&adaptivePaletteCache.trackId===track.id?adaptivePaletteCache.colors:null);
    if(palette?.length){const safe=harmonizeCoverPalette(palette,themeBaseRgb());if(safe)commitAccentRgb(safe);}
    else setAccent(accentKey,{refreshAmbient:false,persist:false});
  }
  async function applyAdaptiveAccent(requestToken=null){
    if(!adaptiveColorOn)return;
    if(requestToken===null)requestToken=++adaptiveAccentRequestToken;
    const themeSnapshot=document.body.getAttribute("data-theme"),t=playlist[currentIndex];
    const coverUrl=resolveTrackArtwork(t);
    if(!t||!coverUrl){setAccent(accentKey,{refreshAmbient:false,persist:false});return;}
    const colors=await getDominantColors(coverUrl,5);
    if(!colors?.length||playlist[currentIndex]!==t||requestToken!==adaptiveAccentRequestToken||document.body.getAttribute("data-theme")!==themeSnapshot)return;
    const canonicalColors=colors.map(color=>color.slice(0,3)),key=adaptivePaletteKey(t);
    adaptivePaletteCache={trackId:t.id,colors:canonicalColors};if(key)adaptivePaletteByTrack.set(key,canonicalColors);
    const harmonized=harmonizeCoverPalette(canonicalColors,themeBaseRgb(themeSnapshot));if(!harmonized)return;
    commitAccentRgb(harmonized,{refreshFavorite:false});updateFavoriteAnswerContrast(colors);
  }
  function updateFavicon(accent, contrast){
    accent = accent || "#0A84FF"; contrast = contrast || "#ffffff";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="${accent}"/><rect x="9" y="13" width="3" height="7" rx="1.5" fill="${contrast}"/><rect x="14.5" y="8" width="3" height="16" rx="1.5" fill="${contrast}"/><rect x="20" y="11" width="3" height="10" rx="1.5" fill="${contrast}"/></svg>`;
    const link = document.getElementById("faviconLink");
    if(link) link.href = "data:image/svg+xml," + encodeURIComponent(svg);
  }
  function getDominantColors(imgUrl, count){
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try{
          const w=40, h=40;
          const canvas = document.createElement("canvas");
          canvas.width=w; canvas.height=h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img,0,0,w,h);
          const data = ctx.getImageData(0,0,w,h).data;
          const buckets = {};
          for(let i=0;i<data.length;i+=4){
            const r=data[i],g=data[i+1],b=data[i+2],a=data[i+3];
            if(a<128) continue;
            const key = [Math.round(r/24)*24, Math.round(g/24)*24, Math.round(b/24)*24].join(",");
            buckets[key] = (buckets[key]||0)+1;
          }
          let sorted = Object.entries(buckets).sort((a,b)=>b[1]-a[1]).map(e=>e[0].split(",").map(Number));
          if(sorted.length===0){ resolve(null); return; }
          resolve(sorted.slice(0,count));
        }catch(e){ resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = imgUrl;
    });
  }
  let coverColorMotionFrame=0;
  function stopCoverColorMotion(){
    if(coverColorMotionFrame)cancelAnimationFrame(coverColorMotionFrame);coverColorMotionFrame=0;
  }
  function startCoverColorMotion(){
    // GP Motion Engine 1.3: every ambient background remains static.
    stopCoverColorMotion();
  }
  function syncCoverColorMotion(active){
    $("#ambientGlow").classList.remove("cover-color-motion");
    stopCoverColorMotion();
  }
  let activeAmbientCanvas=$("#ambientCanvas"),standbyAmbientCanvas=$("#ambientCanvasNext"),ambientRasterCleanupTimer=0,ambientResizeTimer=0,ambientRenderHoldUntil=0;
  function reserveAmbientTransitionWindow(duration=340){ambientRenderHoldUntil=Math.max(ambientRenderHoldUntil,performance.now()+duration);}
  async function waitForAmbientTransitionWindow(myToken){
    const remaining=ambientRenderHoldUntil-performance.now();
    if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
    return myToken===ambientToken;
  }
  const ambientCoverScratch=document.createElement("canvas");
  function ambientRasterMetrics(){
    const dpr=Math.max(.5,window.devicePixelRatio||1),physicalWidth=Math.max(1,Math.round(window.innerWidth*dpr)),physicalHeight=Math.max(1,Math.round(window.innerHeight*dpr));
    const integerDivisor=1,width=physicalWidth,height=physicalHeight;
    return {width,height,dpr,scale:dpr/integerDivisor,physicalWidth,physicalHeight,integerDivisor};
  }
  function fillAmbientBase(ctx,width,height){
    const base=themeBaseRgb();ctx.globalCompositeOperation="source-over";ctx.globalAlpha=1;ctx.filter="none";ctx.fillStyle=`rgb(${base.join(",")})`;ctx.fillRect(0,0,width,height);
  }
  function commitAmbientBridge(bridge){
    if(!Array.isArray(bridge)||bridge.length<3)return;
    const clean=bridge.slice(0,3).map(value=>Math.max(0,Math.min(255,Math.round(value))));
    document.documentElement.style.setProperty("--ambient-transition-color",`rgb(${clean.join(",")})`);
  }
  function drawAmbientPalette(canvas,palette,intensity,seed){
    const metrics=ambientRasterMetrics();canvas.width=metrics.width;canvas.height=metrics.height;
    const ctx=canvas.getContext("2d",{alpha:false});fillAmbientBase(ctx,metrics.width,metrics.height);
    /* Large low-alpha radial gradients quantize into visible contour bands on
       4K dark surfaces. A cover-derived harmonic field must be visually smooth,
       so precompose one uniform RGB surface instead of retaining any gradient
       geometry for Edge to resample. */
    const count=Math.max(1,palette.length),average=palette.reduce((sum,color)=>[
      sum[0]+color[0]/count,sum[1]+color[1]/count,sum[2]+color[2]/count
    ],[0,0,0]),base=themeBaseRgb(),dark=activeTheme()==="dark";
    const visibleAverage=dark&&relativeLuminance(average)<.045?mixRgb(average,currentAccentRgb(),.34):average;
    const strength=Math.max(0,Math.min(dark?.48:.28,intensity*(dark?.62:.38)));
    const harmonic=mixRgb(base,visibleAverage,strength);
    ctx.fillStyle=`rgb(${harmonic.join(",")})`;ctx.fillRect(0,0,metrics.width,metrics.height);
    return harmonic;
  }
  function drawEmptyAmbient602(canvas,palette,seed){
    const metrics=ambientRasterMetrics();canvas.width=metrics.width;canvas.height=metrics.height;
    const sampleWidth=metrics.width,sampleHeight=metrics.height;
    const sampleCtx=canvas.getContext("2d",{alpha:false}),base=themeBaseRgb(),dark=activeTheme()==="dark";
    sampleCtx.setTransform(1,0,0,1,0,0);sampleCtx.globalCompositeOperation="source-over";sampleCtx.globalAlpha=1;
    sampleCtx.fillStyle=`rgb(${base.join(",")})`;sampleCtx.fillRect(0,0,sampleWidth,sampleHeight);
    const points=[[.18,.18,.58],[.88,.41,.57],[.40,.90,.62]],opacity=dark?.63:.76;
    points.forEach((point,index)=>{
      const color=palette[index%palette.length],radius=Math.max(sampleWidth,sampleHeight)*point[2];
      const gradient=sampleCtx.createRadialGradient(sampleWidth*point[0],sampleHeight*point[1],0,sampleWidth*point[0],sampleHeight*point[1],radius);
      gradient.addColorStop(0,`rgba(${color.join(",")},${opacity})`);
      gradient.addColorStop(.54,`rgba(${color.join(",")},${opacity*.46})`);
      gradient.addColorStop(1,`rgba(${color.join(",")},0)`);
      sampleCtx.fillStyle=gradient;sampleCtx.fillRect(0,0,sampleWidth,sampleHeight);
    });
    sampleCtx.fillStyle=dark?"rgba(0,0,0,.12)":"rgba(255,255,255,.035)";sampleCtx.fillRect(0,0,sampleWidth,sampleHeight);
    const average=weightedPaletteTone(palette),bridge=mixRgb(base,average,dark?.22:.16);
    return bridge;
  }
  function drawAmbientCover(canvas,image){
    /* Blurred Cover is a low-frequency colour field, not a second readable
       copy of the artwork. Pre-blur a tiny sampling surface, then upscale it
       once. Page fades can no longer expose cover outlines, text, rings or
       full-resolution filter banding, and track changes avoid a 4K blur pass. */
    const metrics=ambientRasterMetrics();canvas.width=metrics.width;canvas.height=metrics.height;
    const ctx=canvas.getContext("2d",{alpha:false});fillAmbientBase(ctx,metrics.width,metrics.height);
    const sampleWidth=384,sampleHeight=Math.max(216,Math.round(sampleWidth*metrics.height/metrics.width)),scratch=ambientCoverScratch;
    if(scratch.width!==sampleWidth)scratch.width=sampleWidth;if(scratch.height!==sampleHeight)scratch.height=sampleHeight;
    const sampleCtx=scratch.getContext("2d",{alpha:false}),base=themeBaseRgb();
    sampleCtx.setTransform(1,0,0,1,0,0);sampleCtx.filter="none";sampleCtx.fillStyle=`rgb(${base.join(",")})`;sampleCtx.fillRect(0,0,sampleWidth,sampleHeight);
    const overscan=42,targetWidth=sampleWidth+overscan*2,targetHeight=sampleHeight+overscan*2,imageRatio=image.naturalWidth/image.naturalHeight,targetRatio=targetWidth/targetHeight;
    let drawWidth,drawHeight;if(imageRatio>targetRatio){drawHeight=targetHeight;drawWidth=drawHeight*imageRatio;}else{drawWidth=targetWidth;drawHeight=drawWidth/imageRatio;}
    sampleCtx.save();sampleCtx.filter=`blur(28px) saturate(${activeTheme()==="dark"?108:126}%) brightness(${activeTheme()==="dark"?.78:1.03})`;sampleCtx.drawImage(image,(sampleWidth-drawWidth)/2,(sampleHeight-drawHeight)/2,drawWidth,drawHeight);sampleCtx.restore();
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
    ctx.drawImage(scratch,0,0,metrics.width,metrics.height);
    ctx.fillStyle=activeTheme()==="dark"?"rgba(0,0,0,.14)":"rgba(238,240,244,.08)";ctx.fillRect(0,0,metrics.width,metrics.height);
  }
  function presentAmbientCanvas(incoming,myToken,instant=false,bridge=null){
    if(myToken!==ambientToken)return;
    clearTimeout(ambientRasterCleanupTimer);
    const outgoing=activeAmbientCanvas;
    if(instant){
      outgoing.classList.add("ambient-resize-swap");incoming.classList.add("ambient-resize-swap");
      incoming.classList.add("is-visible");incoming.classList.remove("is-blending");outgoing.classList.remove("is-visible","is-blending");
      activeAmbientCanvas=incoming;standbyAmbientCanvas=outgoing;commitAmbientBridge(bridge);updateAdaptiveTextColors();requestAnimationFrame(()=>{incoming.classList.remove("ambient-resize-swap");outgoing.classList.remove("ambient-resize-swap");refreshScrollEdgeFrames();});
      if(typeof scheduleTraditionalPiPRefresh==="function")scheduleTraditionalPiPRefresh(true);return;
    }
    incoming.classList.remove("is-visible","is-blending");
    outgoing.classList.add("is-visible","is-blending");
    incoming.classList.add("is-blending");
    /* The viewport keeps the completed old raster underneath while the new
       cover-derived raster fades over it. Both are already low-frequency,
       precomposed surfaces, so this overlap cannot expose a white/theme-base
       bridge or trigger a second live blur pass. */
    void incoming.offsetWidth;
    requestAnimationFrame(()=>{
      if(myToken!==ambientToken)return;
      incoming.classList.add("is-visible");
      outgoing.classList.remove("is-visible");
      commitAmbientBridge(bridge);
    });
    ambientRasterCleanupTimer=setTimeout(()=>{
      if(myToken!==ambientToken)return;
      activeAmbientCanvas=incoming;standbyAmbientCanvas=outgoing;
      outgoing.classList.remove("is-visible","is-blending");
      incoming.classList.remove("is-blending");
      updateAdaptiveTextColors();
      requestAnimationFrame(()=>{if(myToken===ambientToken)updateAdaptiveTextColors();});
    },220);
    if(typeof scheduleTraditionalPiPRefresh==="function")scheduleTraditionalPiPRefresh(true);
  }
  function loadAmbientImage(url){return new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=url;});}
  const GP_AMBIENT_GLOW_INTENSITY=.64,GP_AMBIENT_COLOR_INTENSITY=.84;
  async function updateAmbient(options={}){
    const myToken = ++ambientToken;
    const track = playlist[currentIndex];
    const cover = track && resolveTrackArtwork(track);
    syncCoverColorMotion(bgMode === "color" && !!cover);

    if(bgMode === "blur"){
      if(cover){
        const [image,colors]=await Promise.all([loadAmbientImage(cover),getDominantColors(cover,3)]);
        if(myToken!==ambientToken)return;
        if(colors?.length)updateFavoriteAnswerContrast(colors);
        if(image){const bridge=mixRgb(themeBaseRgb(),weightedPaletteTone(colors||[]),activeTheme()==="dark"?.42:.56);if(!await waitForAmbientTransitionWindow(myToken))return;drawAmbientCover(standbyAmbientCanvas,image);presentAmbientCanvas(standbyAmbientCanvas,myToken,options.instant===true,bridge);requestAnimationFrame(refreshScrollEdgeFrames);return;}
      }
    }

    let palette = null;
    if(bgMode === "color" && cover){
      palette = await getDominantColors(cover, 3);
      if(myToken !== ambientToken) return;
    }
    if(!palette){
      palette = accentPalettes[accentKey].map(hexToRgbArr);
      updateFavoriteAnswerContrast(palette);
    }else updateFavoriteAnswerContrast(palette);
    const seed=hashString(track?(track.artist+track.title):accentKey),intensity=bgMode==="color"?GP_AMBIENT_COLOR_INTENSITY:(track?.id?.toString?.().length?GP_AMBIENT_GLOW_INTENSITY:0);
    if(!await waitForAmbientTransitionWindow(myToken))return;
    const bridge=!track?drawEmptyAmbient602(standbyAmbientCanvas,palette,seed):drawAmbientPalette(standbyAmbientCanvas,palette,intensity,seed);
    presentAmbientCanvas(standbyAmbientCanvas,myToken,options.instant===true,bridge);
    requestAnimationFrame(refreshScrollEdgeFrames);
  }
  const scheduleAmbientRasterResize=()=>{
    clearTimeout(ambientResizeTimer);
    /* Keep the completed raster visible throughout browser zoom. Recompose
       only after the resize burst settles, then crossfade once. */
    ambientResizeTimer=setTimeout(()=>updateAmbient({instant:true}),220);
  };
  window.addEventListener("resize",scheduleAmbientRasterResize,{passive:true});

  /* ================= art / cover ================= */
  let discAngle=0,discVelocity=0,discTargetVelocity=0,discRotationFrame=0,discRotationStamp=0,discStopStarted=0,discStopVelocity=0,discStopElapsed=0;
  const DISC_CRUISE_VELOCITY=360/14,DISC_SETTLE_MS=720;
  function isPlayerViewActive(){
    return Boolean($(".view[data-view='player']")?.classList.contains("active"));
  }
  function isStaticCoverMode(){
    const t=playlist[currentIndex];
    const cover=t?resolveTrackArtwork(t):null;
    return (coverDisplayMode==="static"&&Boolean(cover))||Boolean($("#artStage")?.classList.contains("static-mode"));
  }
  function shouldDiscRotate(){
    if(!isPlayerViewActive())return false;
    if(document.hidden)return false;
    if(isStaticCoverMode())return false;
    return true;
  }
  function drawDiscRotation(){
    if(!isPlayerViewActive())return;
    const rotor=$("#discRotor");if(rotor)rotor.style.transform=`rotate(${discAngle.toFixed(3)}deg) translateZ(0)`;
  }
  function pauseDiscRotation(){
    if(discRotationFrame){
      cancelAnimationFrame(discRotationFrame);
      discRotationFrame=0;
    }
    discRotationStamp=0;
    if(discStopStarted>0){
      discStopElapsed=Math.min(DISC_SETTLE_MS,Math.max(0,performance.now()-discStopStarted));
      discStopStarted=0;
    }
  }
  function runDiscRotation(now){
    if(!shouldDiscRotate()){pauseDiscRotation();return;}
    const dt=Math.min(.05,Math.max(0,(now-(discRotationStamp||now))/1000));discRotationStamp=now;
    if(discTargetVelocity>0){
      discStopStarted=0;discStopElapsed=0;discVelocity+=(discTargetVelocity-discVelocity)*(1-Math.exp(-7.5*dt));
    }else if(discStopStarted>0){
      const progress=Math.min(1,(now-discStopStarted)/DISC_SETTLE_MS);discVelocity=discStopVelocity*Math.pow(1-progress,2.35);
      if(progress>=1){discVelocity=0;discStopStarted=0;discStopElapsed=0;}
    }else discVelocity=0;
    discAngle=(discAngle+discVelocity*dt)%360;drawDiscRotation();
    if(discTargetVelocity>0||discStopStarted>0)discRotationFrame=requestAnimationFrame(runDiscRotation);
    else{discVelocity=0;discRotationFrame=0;discRotationStamp=0;discStopElapsed=0;drawDiscRotation();}
  }
  function syncDiscRotationTimeline(playing){
    const isPlayingNow=Boolean(playing);
    if(!shouldDiscRotate()){
      pauseDiscRotation();
      if(isPlayingNow){
        discTargetVelocity=DISC_CRUISE_VELOCITY;
        discStopStarted=0;
        discStopElapsed=0;
      }else{
        discTargetVelocity=0;
      }
      return;
    }
    const now=performance.now();
    if(isPlayingNow){
      discTargetVelocity=DISC_CRUISE_VELOCITY;
      discStopStarted=0;
      discStopElapsed=0;
    }else{
      discTargetVelocity=0;
      if(discStopElapsed>0){
        discStopStarted=now-discStopElapsed;
        discStopElapsed=0;
      }else if(discVelocity>.001&&!discStopStarted){
        discStopVelocity=discVelocity;
        discStopStarted=now;
      }
    }
    if(discTargetVelocity>0||discStopStarted>0){
      if(!discRotationFrame){discRotationStamp=now;discRotationFrame=requestAnimationFrame(runDiscRotation);}
    }else{
      pauseDiscRotation();
      drawDiscRotation();
    }
  }
  function resetDiscRotationTimeline(){
    if(discRotationFrame)cancelAnimationFrame(discRotationFrame);
    discRotationFrame=0;discRotationStamp=0;discAngle=0;discVelocity=0;discTargetVelocity=0;discStopStarted=0;discStopVelocity=0;discStopElapsed=0;drawDiscRotation();
  }
  let currentNowTitleText="",titleMeasureTimer=0,titleResizeTimer=0,titleMarqueeRevision=0,titleMarqueeAnimation=null,lastTitleLayoutScale=0,nowPlayingMetaRevision=0,nowPlayingMetaAnimations=[];
  function syncTitleLanguage(){
    const language=document.documentElement.lang||(uiLanguage==="ru"?"ru":uiLanguage==="en"?"en":"zh-CN");
    $$("#nowTitle,#nowArtist,.view-header h2").forEach(node=>node?.setAttribute("lang",language));
    if(typeof refreshNowTitleMarquee==="function")refreshNowTitleMarquee();
  }
  function stopNowTitleMarquee(){
    clearTimeout(titleMeasureTimer);titleMeasureTimer=0;
    if(titleMarqueeAnimation){titleMarqueeAnimation.cancel();titleMarqueeAnimation=null;}
  }
  function renderNowTitleStart(host){
    host.classList.remove("is-marquee");host.classList.add("marquee-pending");
    const span=document.createElement("span");span.className="track-title-text";span.textContent=currentNowTitleText;
    host.replaceChildren(span);return span;
  }
  function measureNowTitleMarquee(revision,attempt=0){
    if(revision!==titleMarqueeRevision)return;
    const host=$("#nowTitle");if(!host)return;
    let span=host.querySelector(":scope > .track-title-text");
    if(!span)span=renderNowTitleStart(host);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(revision!==titleMarqueeRevision||!span.isConnected)return;
      const spanRect=span.getBoundingClientRect();
      const layoutScale=Number(getComputedStyle($("#appShell")).zoom)||1;
      /* getBoundingClientRect is post-zoom while CSS transforms use pre-zoom
         CSS pixels. Mixing the two under-travelled by ~30% in compact Edge. */
      const naturalWidth=layoutScale>0?spanRect.width/layoutScale:0,available=host.clientWidth;
      if(layoutScale>0)lastTitleLayoutScale=layoutScale;
      const maxAllowed=Math.min(parseFloat(getComputedStyle(host).maxWidth)||available,host.parentElement?.clientWidth||available);
      if(maxAllowed<=1||naturalWidth<=1){
        if(attempt<30)titleMeasureTimer=setTimeout(()=>measureNowTitleMarquee(revision,attempt+1),100);
        return;
      }
      if(naturalWidth<=maxAllowed-10){host.classList.remove("marquee-pending");return;}
      const track=document.createElement("span");track.className="track-title-marquee-track";
      track.style.setProperty("--title-copy-width",`${naturalWidth.toFixed(3)}px`);
      const copy=span.cloneNode(true);copy.setAttribute("aria-hidden","true");track.append(span,copy);host.replaceChildren(track);
      host.classList.remove("marquee-pending");host.classList.add("is-marquee");
      const gap=parseFloat(getComputedStyle(track).columnGap)||88,distance=naturalWidth+gap;
      /* Keep perceived speed stable after responsive CSS zoom. Movement is
         linear from the first moving frame to the last moving frame. */
      const visibleDistance=distance*layoutScale,initialHold=750,endHold=650;
      const travel=Math.max(3400,visibleDistance/40*1000),total=initialHold+travel+endHold;
      const start=initialHold/total,finish=(initialHold+travel)/total;
      titleMarqueeAnimation=track.animate([
        {transform:"translate3d(0,0,0)",offset:0,easing:"linear"},
        {transform:"translate3d(0,0,0)",offset:start,easing:"linear"},
        {transform:`translate3d(${-distance.toFixed(2)}px,0,0)`,offset:finish,easing:"linear"},
        {transform:`translate3d(${-distance.toFixed(2)}px,0,0)`,offset:1,easing:"linear"}
      ],{duration:total,iterations:Infinity,easing:"linear"});
    }));
  }
  function refreshNowTitleMarquee(){
    const host=$("#nowTitle");if(!host)return;
    stopNowTitleMarquee();const revision=++titleMarqueeRevision;renderNowTitleStart(host);measureNowTitleMarquee(revision);
  }
  function refreshNowTitleMarqueeForScale(){
    const host=$("#nowTitle");if(!host||!host.clientWidth)return;
    const scale=Number(getComputedStyle($("#appShell")).zoom)||1;
    if(!lastTitleLayoutScale||Math.abs(scale-lastTitleLayoutScale)>.002)refreshNowTitleMarquee();
  }
  function setNowPlayingTitle(text){
    const next=String(text??"").trim();
    currentNowTitleText=next||tr("未命名歌曲","Untitled Track");
    refreshNowTitleMarquee();
  }
  function syncNowFormatTag(track){
    const tag=$("#nowFormatTag");if(!tag)return;
    const lossless=String(track?.format||"").toUpperCase()==="FLAC";
    tag.hidden=!lossless;
    if(lossless)tag.textContent=tr("无损","Lossless");
  }
  function transitionNowPlayingMeta(title,artist){
    const revision=++nowPlayingMetaRevision,nodes=[$("#nowTitle"),$("#nowArtist")].filter(Boolean);
    stopNowTitleMarquee();
    nowPlayingMetaAnimations.forEach(animation=>{try{animation.cancel();}catch(error){}});
    nowPlayingMetaAnimations=[];
    const commit=()=>{
      if(revision!==nowPlayingMetaRevision)return;
      setNowPlayingTitle(title);$("#nowArtist").textContent=artist||"";
      nodes.forEach(node=>{node.style.opacity="";});
      nowPlayingMetaAnimations=nodes.map(node=>node.animate([{opacity:0},{opacity:1}],{duration:145,easing:"cubic-bezier(.2,.72,.2,1)",fill:"both"}));
      const incoming=[...nowPlayingMetaAnimations];
      Promise.all(incoming.map(animation=>animation.finished.catch(()=>null))).then(()=>{incoming.forEach(animation=>{try{animation.cancel();}catch(error){}});if(revision===nowPlayingMetaRevision)nowPlayingMetaAnimations=[];});
    };
    if(!nodes.length){commit();return;}
    const outgoing=nodes.map(node=>node.animate([{opacity:1},{opacity:0}],{duration:85,easing:"ease-out",fill:"both"}));
    nowPlayingMetaAnimations=outgoing;
    Promise.all(outgoing.map(animation=>animation.finished.catch(()=>null))).then(()=>{outgoing.forEach(animation=>{try{animation.cancel();}catch(error){}});commit();});
  }
  window.addEventListener("resize",()=>{clearTimeout(titleResizeTimer);titleResizeTimer=setTimeout(refreshNowTitleMarquee,110);},{passive:true});
  document.fonts?.ready?.then(()=>requestAnimationFrame(refreshNowTitleMarquee));
  let artDisplayRevision=0,artDisplayAnimations=[],artTransitionCopies=[],lastHandledErrorRevision=0;
  function clearArtTransition(){
    artDisplayAnimations.forEach(animation=>{try{animation.cancel();}catch(error){}});
    artDisplayAnimations=[];artTransitionCopies.forEach(node=>node.remove());artTransitionCopies=[];
    [$("#rotorCover"),$("#staticCover")].forEach(node=>node?.style.removeProperty("opacity"));
  }
  function visibleArtworkNode(rotorCover,staticCover){
    if(staticCover&&getComputedStyle(staticCover).display!=="none"&&staticCover.getAttribute("src"))return staticCover;
    if(rotorCover&&getComputedStyle(rotorCover).display!=="none"&&rotorCover.getAttribute("src"))return rotorCover;
    return null;
  }
  function recoverArtwork(track,revision){
    if(revision!==artDisplayRevision||playlist[currentIndex]!==track)return;
    updateArtDisplay({instant:true});
  }
  function handleArtworkElementError(imgElement){
    const t=playlist[currentIndex];
    if(!t)return;
    const failedUrl=imgElement.getAttribute("src")||imgElement.src;
    if(failedUrl)recordFailedArtworkUrl(failedUrl);
    if(artDisplayRevision!==lastHandledErrorRevision){
      lastHandledErrorRevision=artDisplayRevision;
      recoverArtwork(t,artDisplayRevision);
    }
  }
  function updateArtDisplay(options={}){
    const t = playlist[currentIndex];
    const rotorCover = $("#rotorCover"), staticCover = $("#staticCover"), discIcon = $("#discIcon"), discRotor = $("#discRotor");
    const cover = resolveTrackArtwork(t);
    const staticMode = coverDisplayMode === "static" && !!cover;
    const revision=++artDisplayRevision,previous=visibleArtworkNode(rotorCover,staticCover),previousUrl=previous?.getAttribute("src")||"";
    clearArtTransition();

    const targetNode=staticMode?staticCover:(cover?rotorCover:null);
    const isTargetHealthy=!cover||Boolean(targetNode&&targetNode.getAttribute("src")===cover&&targetNode.complete&&targetNode.naturalWidth>0);
    const alreadyCorrect=previous===targetNode&&previousUrl===(cover||"")&&isTargetHealthy;

    if(options.resync&&alreadyCorrect){
      $("#artStage")?.classList.toggle("static-mode",staticMode);
      if(discRotor)discRotor.style.visibility=staticMode?"hidden":"visible";
      $("#diskReader")?.classList.toggle("engaged",isPlaying&&!staticMode);
      if(staticMode){
        pauseDiscRotation();
      }else if(isPlaying||(!audio.paused&&!audio.ended)){
        syncDiscRotationTimeline(true);
      }
      return;
    }

    const commitDisplay=()=>{
      if(revision!==artDisplayRevision)return;
      $("#artStage")?.classList.toggle("static-mode",staticMode);
      if(coverDisplayMode === "static" && cover){
        if(discRotor)discRotor.style.visibility = "hidden";
        if(staticCover){staticCover.style.display = "block"; staticCover.src = cover;}
      } else {
        if(discRotor)discRotor.style.visibility = "visible";
        if(staticCover)staticCover.style.display = "none";
        if(cover){
          if(rotorCover){rotorCover.style.display="block"; rotorCover.src=cover;}
          if(discIcon)discIcon.style.display="none";
        } else {
          if(rotorCover){rotorCover.style.display="none";rotorCover.removeAttribute("src");}
          if(discIcon)discIcon.style.display="flex";
        }
      }
      $("#diskReader")?.classList.toggle("engaged",isPlaying&&!staticMode);
      if(staticMode){
        pauseDiscRotation();
      }else if(isPlaying||(!audio.paused&&!audio.ended)){
        syncDiscRotationTimeline(true);
      }
      return visibleArtworkNode(rotorCover,staticCover);
    };
    const beginCrossfade=()=>{
      if(revision!==artDisplayRevision)return;
      if(options.instant){
        commitDisplay();
        return;
      }
      let outgoingCopy=null;
      if(previous&&previousUrl){
        outgoingCopy=previous.cloneNode(false);outgoingCopy.removeAttribute("id");
        outgoingCopy.classList.add("art-cover-transition-copy");outgoingCopy.style.display="block";outgoingCopy.style.opacity="1";
        previous.after(outgoingCopy);artTransitionCopies=[outgoingCopy];
      }
      const incoming=commitDisplay();
      if(!incoming){if(outgoingCopy){
        const fade=outgoingCopy.animate([{opacity:1},{opacity:0}],{duration:180,easing:"ease-in-out",fill:"both"});artDisplayAnimations=[fade];
        fade.finished.catch(()=>null).then(()=>{if(revision!==artDisplayRevision)return;clearArtTransition();});
      }return;}
      if(!outgoingCopy){const fade=incoming.animate([{opacity:0},{opacity:1}],{duration:180,easing:"ease-in-out",fill:"both"});artDisplayAnimations=[fade];fade.finished.catch(()=>null).then(()=>{if(revision!==artDisplayRevision)return;clearArtTransition();});return;}
      incoming.style.opacity="0";
      const incomingFade=incoming.animate([{opacity:0},{opacity:1}],{duration:190,easing:"ease-in-out",fill:"both"});
      const outgoingFade=outgoingCopy.animate([{opacity:1},{opacity:0}],{duration:190,easing:"ease-in-out",fill:"both"});
      artDisplayAnimations=[incomingFade,outgoingFade];
      Promise.all(artDisplayAnimations.map(animation=>animation.finished.catch(()=>null))).then(()=>{if(revision!==artDisplayRevision)return;clearArtTransition();});
    };
    if(!cover||cover===previousUrl||options.instant){beginCrossfade();return;}
    const preload=new Image();
    preload.onload=()=>beginCrossfade();
    preload.onerror=()=>{
      if(revision!==artDisplayRevision||playlist[currentIndex]!==t)return;
      recordFailedArtworkUrl(cover);
      recoverArtwork(t,revision);
    };
    preload.src=cover;
  }
  const rotorCoverEl = $("#rotorCover");
  const staticCoverEl = $("#staticCover");
  if(rotorCoverEl){
    rotorCoverEl.addEventListener("error",()=>handleArtworkElementError(rotorCoverEl));
  }
  if(staticCoverEl){
    staticCoverEl.addEventListener("error",()=>handleArtworkElementError(staticCoverEl));
  }

  const playerSection = document.querySelector(".view[data-view='player']");
  let lastPlayerViewActive = isPlayerViewActive();
  if(playerSection){
    const playerViewObserver = new MutationObserver(()=>{
      const active = isPlayerViewActive();
      if(active !== lastPlayerViewActive){
        lastPlayerViewActive = active;
        if(active){
          updateArtDisplay({resync:true});
          syncDiscRotationTimeline(isPlaying||(!audio.paused&&!audio.ended));
        }else{
          pauseDiscRotation();
        }
      }
    });
    playerViewObserver.observe(playerSection,{attributes:true,attributeFilter:["class"]});
  }

  document.addEventListener("visibilitychange",()=>{
    if(document.hidden){
      pauseDiscRotation();
    }else{
      if(isPlayerViewActive()){
        updateArtDisplay({resync:true});
      }
      syncDiscRotationTimeline(isPlaying||(!audio.paused&&!audio.ended));
    }
  },{passive:true});
  function searchInputSafe(){ const el = $("#search"); return el ? el.value : ""; }
  function showToast(message){
    const lifetime=3000,toast=document.createElement("div");
    toast.className="toast-msg";toast.textContent=message;toast.style.setProperty("--toast-life",`${lifetime}ms`);
    $("#toastStack").appendChild(toast);
    setTimeout(()=>toast.classList.add("leaving"),lifetime);
    setTimeout(()=>toast.remove(),lifetime+260);
  }

  /* ================= rendering track lists ================= */
  let libraryRenderCommits=0;
  let libraryGridView=false;
  function trackRowHTML(t, idx,options={}){
    const rowClass=options.rowClass?` ${options.rowClass}`:"";
    const thumb=libraryGridView&&!options.compact?(t.coverUrl||t.thumbUrl):(t.thumbUrl||t.coverUrl);
    const cover = thumb ? `<img src="${thumb}" class="track-thumb" loading="lazy" decoding="async">` :
      `<div class="track-thumb"><svg class="single-alpha-icon rounded-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="18" r="3"/><path d="M9 17V5l12-2v12"/><circle cx="18" cy="16" r="3"/></svg></div>`;
    if(options.compact===true)return `<div class="track-item ripple-target${idx===currentIndex?' playing':''}${rowClass}" data-idx="${idx}">${cover}<div class="track-info"><div class="t-title">${escapeHtml(t.title)}</div><div class="t-artist">${escapeHtml(t.artist)}</div></div><div class="track-dur">${t.duration ? fmtTime(t.duration) : "--:--"}</div></div>`;
    const playCount=Number.isFinite(Number(options.playCount))?Number(options.playCount):0;
    return `
      <div class="track-item library-row ripple-target${idx===currentIndex?' playing':''}${rowClass}" data-idx="${idx}">
        <div class="library-rank">${Number(options.rank)||idx+1}</div>
        <div class="library-track-cell">${cover}<div class="track-info"><div class="t-title">${escapeHtml(t.title)}</div><div class="t-artist">${escapeHtml(t.artist)}</div></div></div>
        <div class="track-album" title="${escapeHtml(t.album||"")}">${escapeHtml(t.album||tr("未标注专辑","No Album"))}</div>
        <div class="track-plays">${playCount}</div>
        <div class="track-dur">${t.duration ? fmtTime(t.duration) : "--:--"}</div>
        <div class="track-actions">
          <button class="track-action track-like ripple-target${isLikedTrack(playlist[idx])?" active":""}" data-idx="${idx}" aria-pressed="${isLikedTrack(playlist[idx])}" title="${isLikedTrack(playlist[idx])?tr("取消喜欢","Unlike"):tr("喜欢","Like")}" aria-label="${isLikedTrack(playlist[idx])?tr("取消喜欢","Unlike"):tr("喜欢","Like")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>
          <button class="track-action queue-next ripple-target" data-idx="${idx}" title="${tr("下一首播放","Play Next")}" aria-label="${tr("下一首播放","Play Next")}"><svg class="rounded-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path class="list-next-triangle" d="M5.9 5.55c-.52-.36-.9-.12-.9.52v11.86c0 .64.38.88.9.52l8.45-5.93c.48-.34.48-.7 0-1.04z"/><path class="list-next-echo" d="M19 5.8v12.4"/><path class="list-next-bar" d="M19 5.8v12.4"/></svg></button>
          <button class="track-action queue-add ripple-target" data-idx="${idx}" title="${tr("加入播放队列","Add to Queue")}" aria-label="${tr("加入播放队列","Add to Queue")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><g class="queue-bars"><path d="M4 6h9M4 12h7M4 18h7"/></g><path class="queue-plus-wave" d="M17 11v8M13 15h8"/><path class="queue-plus" d="M17 11v8M13 15h8"/></svg></button>
          ${options.playlistRemove?"":`<button class="track-action playlist-add ripple-target" data-idx="${idx}" title="${tr("添加到歌单","Add to playlist")}" aria-label="${tr("添加到歌单","Add to playlist")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 6h9M4 12h9M4 18h5"/><path d="M17.5 13v7M14 16.5h7"/></svg></button>`}
          ${options.playlistRemove?`<button class="track-action playlist-remove ripple-target" data-idx="${idx}" title="${tr("从歌单移除","Remove from playlist")}" aria-label="${tr("从歌单移除","Remove from playlist")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`:""}
        </div>
      </div>`;
  }
  function wireRows(container){
    if(!container||container.dataset.gpRowsWired==="1")return;container.dataset.gpRowsWired="1";
    container.addEventListener("pointerdown",event=>{if(event.target.closest(".track-actions button"))event.stopPropagation();});
    container.addEventListener("click",event=>{
      const button=event.target.closest(".track-actions button");
      if(button&&container.contains(button)){
        event.stopPropagation();const idx=+button.dataset.idx;
        if(button.classList.contains("queue-next"))enqueueTrack(idx,"next");
        else if(button.classList.contains("queue-add"))enqueueTrack(idx,"end");
        else if(button.classList.contains("track-like"))toggleLike(idx,{source:container.id==="recommendList"?"recommendation":"library"});
        else if(button.classList.contains("playlist-add"))openRowPlaylistPop(idx,button);
        else if(button.classList.contains("playlist-remove"))removeTrackFromPlaylist(activePlaylistId(),idx);
        else if(button.classList.contains("track-remove"))removeTrack(idx);
        return;
      }
      const item=event.target.closest(".track-item");if(item&&container.contains(item)){
        playAt(+item.dataset.idx,container.id==="recommendList"?"recommendation":null);
        if(container.id==="recommendList")requestAnimationFrame(()=>{container.querySelectorAll(".recommend-track").forEach(row=>row.classList.remove("playing","gp-press-held","gp-press-release","glow-pulse"));});
      }
    });
  }
  /* ============ user playlists + liked songs (7.4.0 典藏更新) ============
     Queue Service owns the single manual queue AND user-defined playlists.
     Playlists persist as one record in the existing recommendations store
     (no schema/version change). Tracks are referenced by stable
     neuralTrackId keys, never by playlist index or runtime id. Likes are
     behavior events so Resonance Boost learns them; the liked set is
     derived latest-wins from those events (unlike persists with signal 0). */
  const USER_PLAYLISTS_RECORD_ID="userPlaylists";
  let userPlaylistsCache=null,userPlaylistsLoaded=false;
  let likedKeys=new Set(),likedKeysLoaded=false,latestLikeEvents=new Map();
  let libraryCollectionMode="all";
  let collectionScopeActive=false;
  function playlistTrackKey(track){try{return neuralTrackId(track);}catch(error){return track?.id||null;}}
  function trackLikeKeys(track){
    if(!track||typeof track!=="object")return [];
    const keys=new Set();
    const addKey=k=>{if(k!==null&&k!==undefined&&k!=="")keys.add(k);};
    try{addKey(playlistTrackKey(track));}catch(e){}
    addKey(track.spectrumId);
    addKey(track.audioEssenceKey);
    addKey(track.contentKey);
    addKey(track.identityLinks?.spectrumId);
    if(Array.isArray(track.legacyContentKeys)){
      track.legacyContentKeys.forEach(addKey);
    }
    return Array.from(keys);
  }
  function latestLikeEventForTrack(track){
    if(!track)return null;
    const keys=trackLikeKeys(track);
    let latest=null;
    for(let i=0;i<keys.length;i++){
      const event=latestLikeEvents.get(keys[i]);
      if(event){
        const eventTime=Number(event.timestamp)||0;
        const latestTime=Number(latest?.timestamp)||0;
        if(!latest||eventTime>latestTime){
          latest=event;
        }
      }
    }
    return latest;
  }
  async function loadUserPlaylists(){
    try{
      const record=await GPDatabase.getRecommendations(USER_PLAYLISTS_RECORD_ID);
      const lists=Array.isArray(record?.lists)?record.lists.filter(item=>item&&typeof item.id==="string"&&Array.isArray(item.trackKeys)):[];
      userPlaylistsCache={version:1,lists:lists.map(item=>({id:item.id,name:String(item.name||tr("未命名歌单","Untitled Playlist")).slice(0,30),createdAt:Number(item.createdAt)||Date.now(),updatedAt:Number(item.updatedAt)||Date.now(),trackKeys:item.trackKeys.filter(key=>key!==null&&key!==undefined)}))};
    }catch(error){userPlaylistsCache={version:1,lists:[]};}
    userPlaylistsLoaded=true;return userPlaylistsCache;
  }
  async function saveUserPlaylists(){
    if(!userPlaylistsCache)return false;
    try{await GPDatabase.saveRecommendations({id:USER_PLAYLISTS_RECORD_ID,version:1,updatedAt:Date.now(),lists:userPlaylistsCache.lists});return true;}
    catch(error){console.warn("User playlists persistence failed",error);return false;}
  }
  function userPlaylists(){return userPlaylistsCache?.lists||[];}
  function findUserPlaylist(id){return userPlaylists().find(item=>item.id===id)||null;}
  function activePlaylistId(){return libraryCollectionMode.startsWith("pl:")?libraryCollectionMode.slice(3):null;}
  function activePlaylist(){const id=activePlaylistId();return id?findUserPlaylist(id):null;}
  async function loadUserPlaylistsIfNeeded(){if(!userPlaylistsLoaded)await loadUserPlaylists();return userPlaylistsCache;}
  async function createUserPlaylist(name){
    const clean=String(name||"").trim().slice(0,30);
    if(!clean){showToast(tr("请输入歌单名称","Enter a playlist name"));return null;}
    await loadUserPlaylistsIfNeeded();
    const list={id:`pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,name:clean,createdAt:Date.now(),updatedAt:Date.now(),trackKeys:[]};
    userPlaylistsCache.lists.push(list);
    if(await saveUserPlaylists()){showToast(tr(`已创建歌单「${clean}」`,`Created playlist “${clean}”`));setLibraryCollectionMode(`pl:${list.id}`);return list;}
    userPlaylistsCache.lists.pop();showToast(tr("歌单保存失败","Playlist save failed"));return null;
  }
  async function renameUserPlaylist(id,name){
    const list=findUserPlaylist(id),clean=String(name||"").trim().slice(0,30);
    if(!list||!clean)return false;
    list.name=clean;list.updatedAt=Date.now();
    if(await saveUserPlaylists()){syncPlaylistUI();return true;}
    return false;
  }
  async function deleteUserPlaylist(id){
    const list=findUserPlaylist(id);if(!list)return false;
    userPlaylistsCache.lists=userPlaylistsCache.lists.filter(item=>item.id!==id);
    if(await saveUserPlaylists()){
      showToast(tr(`已删除歌单「${list.name}」`,`Deleted playlist “${list.name}”`));
      if(activePlaylistId()===id)setLibraryCollectionMode("all");else syncPlaylistUI();
      return true;
    }
    await loadUserPlaylists();syncPlaylistUI();return false;
  }
  async function addTrackToPlaylist(id,idx){
    const list=findUserPlaylist(id),track=playlist[idx];if(!list||!track)return false;
    const key=playlistTrackKey(track);if(key===null||key===undefined)return false;
    const keys=new Set(trackLikeKeys(track));
    if(list.trackKeys.some(item=>keys.has(item))){showToast(tr(`「${track.title}」已在歌单「${list.name}」中`,`“${track.title}” is already in “${list.name}”`));return false;}
    list.trackKeys.push(key);list.updatedAt=Date.now();
    if(await saveUserPlaylists()){showToast(tr(`已将「${track.title}」加入「${list.name}」`,`Added “${track.title}” to “${list.name}”`));syncPlaylistUI(true);return true;}
    list.trackKeys=list.trackKeys.filter(item=>item!==key);return false;
  }
  async function removeTrackFromPlaylist(id,idx){
    const list=findUserPlaylist(id),track=playlist[idx];if(!list||!track)return false;
    const keys=new Set(trackLikeKeys(track));
    const before=list.trackKeys.length;
    list.trackKeys=list.trackKeys.filter(item=>!keys.has(item));
    if(list.trackKeys.length===before)return false;
    list.updatedAt=Date.now();
    if(await saveUserPlaylists()){render(searchInputSafe());return true;}
    await loadUserPlaylists();render(searchInputSafe());return false;
  }
  function collectionTrackIndices(){
    if(libraryCollectionMode==="liked")return playlist.map((track,idx)=>idx).filter(idx=>isLikedTrack(playlist[idx]));
    const list=activePlaylist();
    if(list){
      const position=new Map();list.trackKeys.forEach((key,order)=>{if(!position.has(key))position.set(key,order);});
      function trackPlaylistOrder(track){
        const direct=position.get(playlistTrackKey(track));
        if(direct!==undefined)return direct;
        const aliases=trackLikeKeys(track);
        for(let i=0;i<aliases.length;i++){
          const pos=position.get(aliases[i]);
          if(pos!==undefined)return pos;
        }
        return undefined;
      }
      return playlist.map((track,idx)=>[trackPlaylistOrder(track),idx]).filter(([order])=>order!==undefined).sort((a,b)=>a[0]-b[0]).map(([,idx])=>idx);
    }
    return playlist.map((_,idx)=>idx);
  }
  function collectionTrackIndicesForMode(mode){
    const keep=libraryCollectionMode;libraryCollectionMode=mode;
    const out=collectionTrackIndices();libraryCollectionMode=keep;return out;
  }
  function syncCollectionScope(){
    // Collection-scoped sequential playback reuses the existing overrideQueue
    // consumer chain (next/previous/ended/crossfade). It has no other producer.
    if(libraryCollectionMode==="all"){if(collectionScopeActive){overrideQueue=null;collectionScopeActive=false;}return;}
    overrideQueue=collectionTrackIndices();collectionScopeActive=true;
  }
  function isLikedTrack(track){
    if(!track)return false;
    try{
      const ev=latestLikeEventForTrack(track);
      if(ev)return ev.context?.liked!==false;
      const keys=trackLikeKeys(track);
      return keys.some(k=>likedKeys.has(k));
    }catch(error){
      return false;
    }
  }
  function syncLikeButtons(){
    document.querySelectorAll("#trackList .track-like, #recommendList .track-like").forEach(button=>{
      const track=playlist[+button.dataset.idx];if(!track)return;
      const liked=isLikedTrack(track);
      button.classList.toggle("active",liked);button.setAttribute("aria-pressed",String(liked));
      const label=liked?tr("取消喜欢","Unlike"):tr("喜欢","Like");button.title=label;button.setAttribute("aria-label",label);
    });
  }
  async function refreshLikedKeys(){
    try{
      const events=await GPDatabase.getBehaviorEvents()||[],latest=new Map();
      events.forEach(event=>{
        if(event?.type!=="like")return;
        const key=event.spectrumId!==null&&event.spectrumId!==undefined?event.spectrumId:event.features?.spectrumId;
        if(key===null||key===undefined||key==="")return;
        const existing=latest.get(key);
        const eventTime=Number(event.timestamp)||0;
        const existingTime=Number(existing?.timestamp)||0;
        if(!existing||eventTime>=existingTime){
          latest.set(key,event);
        }
      });
      latestLikeEvents=latest;
      likedKeys=new Set([...latest.entries()].filter(([,event])=>event?.context?.liked!==false).map(([key])=>key));
      if(Array.isArray(playlist)){
        playlist.forEach(track=>{
          if(isLikedTrack(track)){
            const canonical=playlistTrackKey(track);
            if(canonical!==null&&canonical!==undefined)likedKeys.add(canonical);
          }else{
            trackLikeKeys(track).forEach(k=>likedKeys.delete(k));
          }
        });
      }
    }catch(error){
      latestLikeEvents=new Map();
      likedKeys=new Set();
    }
    likedKeysLoaded=true;syncLikeButtons();
    if(libraryCollectionMode==="liked")render(searchInputSafe());
  }
  async function toggleLike(idx,options={}){
    const track=playlist[idx];if(!track)return;
    const key=playlistTrackKey(track);if(key===null||key===undefined)return;
    const currentlyLiked=isLikedTrack(track);
    const liked=!currentlyLiked;
    const event=await recordBehaviorEvent("like",track,{liked,source:options.source||"library"});
    const timestamp=Number(event?.timestamp)||Date.now();
    const eventObj=event||{type:"like",spectrumId:key,timestamp,context:{liked,source:options.source||"library"}};
    latestLikeEvents.set(key,eventObj);
    if(liked){
      likedKeys.add(key);
    }else{
      trackLikeKeys(track).forEach(k=>likedKeys.delete(k));
    }
    syncLikeButtons();
    if(libraryCollectionMode==="liked")render(searchInputSafe());else syncPlaylistUI(true);
    showToast(liked?tr(`已喜欢「${track.title}」`,`Liked “${track.title}”`):tr(`已取消喜欢「${track.title}」`,`Unliked “${track.title}”`));
  }
  function collectionDisplayName(){
    if(libraryCollectionMode==="liked")return tr("我喜欢","Liked");
    const list=activePlaylist();if(list)return list.name;
    return tr("全部歌曲","All Songs");
  }
  function playCollectionNow(){
    const members=collectionTrackIndices();
    if(!members.length){showToast(tr("这个歌单还没有可播放的歌曲","No playable songs in this collection"));return;}
    const firstId=playlist[members[0]]?.id,firstQueuePos=playQueue.indexOf(firstId);
    if(firstId!==null&&firstId!==undefined&&firstQueuePos!==-1)playQueue.splice(firstQueuePos,1);
    members.slice(1).forEach(idx=>{const id=playlist[idx]?.id;if(id!==null&&id!==undefined&&!playQueue.includes(id))playQueue.push(id);});
    manualQueueActive=true;beginQueuedPlayback();pendingSelectionSource="playlist";
    loadTrack(members[0],true);renderMiniQueue();
    showToast(tr(`正在播放${collectionDisplayName()}（${members.length} 首）`,`Playing ${collectionDisplayName()} (${members.length} songs)`));
  }
  function setLibraryCollectionMode(mode){
    libraryCollectionMode=mode==="liked"||mode.startsWith("pl:")?mode:"all";
    syncCollectionScope();syncPlaylistUI();
  }
  function syncPlaylistUI(skipRender=false){
    const label=$("#playlistBtnText"),pop=$("#playlistPop"),bar=$("#collectionBar");
    if(label)label.textContent=`${tr("歌单","Playlists")}：${collectionDisplayName()}`;
    if(pop){
      const rows=[{mode:"all",name:tr("全部歌曲","All Songs"),count:playlist.length},{mode:"liked",name:`♥ ${tr("我喜欢","Liked")}`,count:collectionTrackIndicesForMode("liked").length}].concat(userPlaylists().map(list=>({mode:`pl:${list.id}`,name:list.name,count:collectionTrackIndicesForMode(`pl:${list.id}`).length,id:list.id})));
      pop.querySelectorAll("[data-collection]").forEach(node=>node.remove());
      const anchor=pop.querySelector(".playlist-pop-divider");
      rows.forEach(row=>{
        const item=document.createElement("div");item.className="playlist-pop-row";item.dataset.collection=row.mode;
        const pick=document.createElement("button");pick.type="button";pick.className="ripple-target";pick.dataset.collection=row.mode;
        const name=document.createElement("span");name.textContent=row.name;
        const count=document.createElement("em");count.textContent=row.count;
        pick.append(name,count);pick.classList.toggle("active",libraryCollectionMode===row.mode);
        item.appendChild(pick);
        if(row.id){
          const del=document.createElement("button");del.type="button";del.className="playlist-pop-del ripple-target";del.dataset.deletePlaylist=row.id;
          del.title=tr("删除歌单","Delete playlist");del.setAttribute("aria-label",tr("删除歌单","Delete playlist"));del.textContent="×";
          item.appendChild(del);
        }
        if(anchor)anchor.before(item);else pop.appendChild(item);
      });
      const input=$("#playlistNameInput"),confirm=$("#playlistConfirmBtn"),active=activePlaylist();
      if(input&&document.activeElement!==input)input.value=active?active.name:"";
      if(confirm)confirm.textContent=active?tr("重命名","Rename"):tr("新建歌单","New Playlist");
    }
    if(bar){
      const active=libraryCollectionMode!=="all";
      bar.classList.toggle("show",active);
      if(active){
        const members=collectionTrackIndices();
        bar.querySelector(".collection-name").textContent=collectionDisplayName();
        bar.querySelector(".collection-count").textContent=tr(`${members.length} 首`,`${members.length} songs`);
      }
    }
    if(!skipRender)render(searchInputSafe());
  }
  $("#playlistBtn").addEventListener("click",event=>{event.stopPropagation();syncPlaylistUI(true);const pop=$("#playlistPop"),show=!pop.classList.contains("show");setMotionPopover(pop,show);if(show)requestAnimationFrame(()=>{try{$("#playlistNameInput")?.focus({preventScroll:true});}catch(error){}});});
  $("#playlistPop").addEventListener("click",async event=>{
    const del=event.target.closest("[data-delete-playlist]");
    if(del){event.stopPropagation();await deleteUserPlaylist(del.dataset.deletePlaylist);return;}
    if(event.target.closest("#playlistCreateRow"))return;
    const row=event.target.closest("[data-collection]");
    if(!row||!row.dataset.collection)return;
    event.stopPropagation();setLibraryCollectionMode(row.dataset.collection);setMotionPopover($("#playlistPop"),false);
  });
  $("#playlistConfirmBtn").addEventListener("click",async event=>{
    event.stopPropagation();
    const input=$("#playlistNameInput"),active=activePlaylist();
    if(active)await renameUserPlaylist(active.id,input.value);
    else await createUserPlaylist(input.value);
  });
  $("#playlistNameInput").addEventListener("keydown",event=>{
    if(event.key==="Enter"){event.preventDefault();$("#playlistConfirmBtn").click();}
    event.stopPropagation();
  });
  $("#collectionPlayBtn").addEventListener("click",event=>{event.stopPropagation();playCollectionNow();});
  document.addEventListener("click",event=>{if(!event.target.closest("#playlistWrap"))setMotionPopover($("#playlistPop"),false);});
  let pendingRowPlaylistIdx=-1;
  function openRowPlaylistPop(idx,anchor){
    pendingRowPlaylistIdx=idx;
    const pop=$("#rowPlaylistPop");if(!pop)return;
    pop.querySelectorAll("[data-row-playlist]").forEach(node=>node.remove());
    const lists=userPlaylists();
    if(!lists.length)pop.querySelector(".row-playlist-empty").style.display="block";
    else{
      pop.querySelector(".row-playlist-empty").style.display="none";
      lists.forEach(list=>{
        const button=document.createElement("button");button.type="button";button.className="ripple-target";button.dataset.rowPlaylist=list.id;
        const name=document.createElement("span");name.textContent=list.name;
        const count=document.createElement("em");count.textContent=collectionTrackIndicesForMode(`pl:${list.id}`).length;
        button.append(name,count);pop.appendChild(button);
      });
    }
    if(pop.parentElement!==document.body)document.body.appendChild(pop);
    pop.style.position="fixed";pop.style.zIndex="320";
    const rect=anchor.getBoundingClientRect(),width=200;
    pop.style.width=`${width}px`;
    pop.style.left=`${Math.max(10,Math.min(window.innerWidth-width-10,rect.right-width))}px`;
    const below=rect.bottom+8,popHeight=Math.min(320,48+lists.length*44);
    pop.style.top=`${Math.max(10,(below+popHeight>window.innerHeight-10)?rect.top-popHeight-8:below)}px`;
    setMotionPopover(pop,true);
  }
  $("#rowPlaylistPop").addEventListener("click",async event=>{
    if(event.target.closest("#rowPlaylistNew")){event.stopPropagation();setMotionPopover($("#rowPlaylistPop"),false);syncPlaylistUI(true);setMotionPopover($("#playlistPop"),true);return;}
    const button=event.target.closest("[data-row-playlist]");
    if(!button)return;event.stopPropagation();
    setMotionPopover($("#rowPlaylistPop"),false);
    if(pendingRowPlaylistIdx>=0)await addTrackToPlaylist(button.dataset.rowPlaylist,pendingRowPlaylistIdx);
    pendingRowPlaylistIdx=-1;
  });
  document.addEventListener("click",event=>{if(!event.target.closest("#rowPlaylistPop")&&!event.target.closest(".playlist-add"))setMotionPopover($("#rowPlaylistPop"),false);});
  loadUserPlaylists().then(()=>syncPlaylistUI(true));
  refreshLikedKeys();
  function normalizeSearchText(value){
    return String(value||"").normalize("NFKD").replace(/\p{M}+/gu,"").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu,"");
  }
  const SEARCH_PINYIN_BOUNDARIES=[['阿','a'],['芭','b'],['擦','c'],['搭','d'],['蛾','e'],['发','f'],['噶','g'],['哈','h'],['击','j'],['喀','k'],['垃','l'],['妈','m'],['拿','n'],['哦','o'],['啪','p'],['期','q'],['然','r'],['撒','s'],['塌','t'],['挖','w'],['昔','x'],['压','y'],['匝','z']];
  const SEARCH_SOUND_GROUPS=["的地得","在再载","已以蚁","他她它","你拟","爱碍艾","生声升","夜页叶","光广","海还","心新欣","想响享","情晴","明名鸣","里理礼","只纸指","时十石","歌哥鸽","周洲舟","陈晨尘","张章彰","方芳","林临琳","王旺","红宏虹","雨语宇","梦孟","静境镜","蓝兰岚","杰洁捷","飞菲非","伟纬玮","东冬","阳杨洋","美每","乐月悦","亮谅","安岸","城成诚"];
  const SEARCH_PINYIN_PHRASES=new Map([["邓紫棋","dengziqi"],["陈奕迅","chenyixun"],["周杰伦","zhoujielun"],["方大同","fangdatong"],["薛之谦","xuezhiqian"],["毛不易","maobuyi"],["五月天","wuyuetian"],["李荣浩","lironghao"],["孙燕姿","sunyanzi"],["张国荣","zhangguorong"],["王力宏","wanglihong"],["林俊杰","linjunjie"],["许嵩","xusong"],["张学友","zhangxueyou"],["刘德华","liudehua"],["梁静茹","liangjingru"],["张惠妹","zhanghuimei"],["田馥甄","tianfuzhen"],["蔡依林","caiyilin"],["陶喆","taozhe"],["任然","renran"],["丁当","dingdang"],["朴树","pushu"],["汪峰","wangfeng"]]);
  /* Compact offline music-search lexicon. It intentionally covers common
     artist/title vocabulary instead of shipping a large transliteration
     dependency; unknown Han characters still fall back to pinyin initials. */
  const SEARCH_PINYIN_CHAR_MAP=new Map(Object.entries({
    爱:"ai",安:"an",暗:"an",岸:"an",把:"ba",白:"bai",半:"ban",北:"bei",被:"bei",别:"bie",不:"bu",猜:"cai",曾:"ceng",长:"chang",唱:"chang",城:"cheng",成:"cheng",陈:"chen",晨:"chen",春:"chun",从:"cong",错:"cuo",大:"da",当:"dang",到:"dao",的:"de",等:"deng",地:"di",第:"di",点:"dian",冬:"dong",东:"dong",懂:"dong",都:"dou",对:"dui",多:"duo",方:"fang",飞:"fei",风:"feng",该:"gai",告:"gao",歌:"ge",给:"gei",孤:"gu",故:"gu",国:"guo",过:"guo",还:"hai",海:"hai",好:"hao",黑:"hei",红:"hong",后:"hou",花:"hua",坏:"huai",欢:"huan",回:"hui",会:"hui",火:"huo",几:"ji",记:"ji",见:"jian",江:"jiang",将:"jiang",叫:"jiao",街:"jie",今:"jin",尽:"jin",静:"jing",睛:"jing",就:"jiu",久:"jiu",开:"kai",看:"kan",空:"kong",哭:"ku",阔:"kuo",来:"lai",蓝:"lan",老:"lao",泪:"lei",冷:"leng",离:"li",里:"li",力:"li",恋:"lian",亮:"liang",林:"lin",流:"liu",留:"liu",路:"lu",落:"luo",没:"mei",美:"mei",梦:"meng",明:"ming",名:"ming",难:"nan",年:"nian",你:"ni",暖:"nuan",女:"nv",泡:"pao",朋:"peng",平:"ping",起:"qi",千:"qian",前:"qian",蔷:"qiang",情:"qing",晴:"qing",秋:"qiu",去:"qu",然:"ran",人:"ren",日:"ri",如:"ru",三:"san",山:"shan",伤:"shang",上:"shang",少:"shao",谁:"shei",深:"shen",生:"sheng",声:"sheng",时:"shi",十:"shi",世:"shi",是:"shi",手:"shou",水:"shui",说:"shuo",思:"si",四:"si",送:"song",岁:"sui",他:"ta",她:"ta",太:"tai",听:"ting",天:"tian",同:"tong",痛:"tong",头:"tou",透:"tou",外:"wai",晚:"wan",忘:"wang",往:"wang",为:"wei",微:"wei",薇:"wei",未:"wei",问:"wen",我:"wo",无:"wu",舞:"wu",雾:"wu",西:"xi",夏:"xia",下:"xia",想:"xiang",像:"xiang",笑:"xiao",心:"xin",新:"xin",星:"xing",醒:"xing",雪:"xue",眼:"yan",阳:"yang",夜:"ye",一:"yi",已:"yi",音:"yin",影:"ying",永:"yong",有:"you",又:"you",友:"you",雨:"yu",月:"yue",再:"zai",在:"zai",怎:"zen",张:"zhang",真:"zhen",只:"zhi",中:"zhong",终:"zhong",重:"zhong",周:"zhou",紫:"zi",走:"zou",最:"zui",昨:"zuo",作:"zuo",玫:"mei",瑰:"gui",光:"guang",沫:"mo",杰:"jie",伦:"lun",奕:"yi",迅:"xun",荣:"rong",浩:"hao",燕:"yan",姿:"zi",俊:"jun",学:"xue",德:"de",静:"jing",茹:"ru",惠:"hui",妹:"mei",馥:"fu",甄:"zhen",依:"yi",谦:"qian",易:"yi"
  }));
  const SEARCH_SOUND_FOLD=new Map();SEARCH_SOUND_GROUPS.forEach(group=>[...group].forEach(char=>SEARCH_SOUND_FOLD.set(char,group[0])));
  function soundFold(value){return [...String(value||"")].map(char=>SEARCH_SOUND_FOLD.get(char)||char).join("");}
  function pinyinInitial(char){
    if(!/[\u3400-\u9fff]/u.test(char))return char;
    let initial="";for(const [boundary,value] of SEARCH_PINYIN_BOUNDARIES){if(char.localeCompare(boundary,"zh-CN-u-co-pinyin")>=0)initial=value;else break;}return initial;
  }
  function pinyinInitials(value){return normalizeSearchText([...String(value||"")].map(pinyinInitial).join(""));}
  function pinyinApproximation(value){
    const raw=String(value||"");
    const phraseForms=[...SEARCH_PINYIN_PHRASES].filter(([phrase])=>raw.includes(phrase)).map(([,pinyin])=>pinyin);
    const characterForm=normalizeSearchText([...raw].map(char=>SEARCH_PINYIN_CHAR_MAP.get(char)||pinyinInitial(char)).join(""));
    return [...new Set([characterForm,...phraseForms].filter(Boolean))];
  }
  function fuzzySubsequence(candidate,query){
    let qi=0,last=-1,gaps=0;
    for(let i=0;i<candidate.length&&qi<query.length;i++){
      if(candidate[i]===query[qi]){if(last>=0)gaps+=i-last-1;last=i;qi++;}
    }
    return qi===query.length&&gaps<=Math.max(2,Math.ceil(query.length*.65));
  }
  function boundedSearchDistance(candidate,query,limit){
    if(Math.abs(candidate.length-query.length)>limit)return limit+1;
    let previous=Array.from({length:query.length+1},(_,index)=>index);
    for(let i=1;i<=candidate.length;i++){
      const current=[i];let rowMin=i;
      for(let j=1;j<=query.length;j++){const value=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(candidate[i-1]===query[j-1]?0:1));current[j]=value;rowMin=Math.min(rowMin,value);}
      if(rowMin>limit)return limit+1;previous=current;
    }
    return previous[query.length];
  }
  function trackSearchFields(track){
    return [track?.title,track?.artist,track?.album,track?.genre,track?.inferredGenre,track?.genreSecondary,track?.name,track?.file?.name,...(track?.identityLinks?.artistAliases||[]),...(track?.identityLinks?.titleAliases||[])].filter(Boolean);
  }
  const trackSearchDocumentCache=new WeakMap();
  function trackSearchDocument(track){
    const fields=trackSearchFields(track),signature=fields.join("\u0001");let cached=trackSearchDocumentCache.get(track);
    if(cached?.signature===signature)return cached.documents;
    const documents=fields.map(raw=>({field:normalizeSearchText(raw),sound:normalizeSearchText(soundFold(raw)),initials:pinyinInitials(raw),pinyin:pinyinApproximation(raw)}));
    trackSearchDocumentCache.set(track,{signature,documents});return documents;
  }
  function fuzzySearchScore(track,queryText){
    const query=normalizeSearchText(queryText);if(!query)return {exact:true,score:1};
    const querySound=normalizeSearchText(soundFold(queryText));let best=0,exact=false;
    for(const {field,sound,initials,pinyin:fullPinyin} of trackSearchDocument(track)){
      if(field.includes(query)||sound.includes(querySound)){exact=true;best=Math.max(best,1);continue;}
      if(initials&&initials.includes(query)){best=Math.max(best,.92);continue;}
      if(fullPinyin.some(pinyin=>pinyin.includes(query))){best=Math.max(best,.94);continue;}
      if(query.length>=2&&fuzzySubsequence(field,query))best=Math.max(best,.82-Math.max(0,field.length-query.length)*.012);
      const limit=query.length>=8?3:query.length>=4?2:1,distance=Math.min(boundedSearchDistance(field,query,limit),boundedSearchDistance(sound,querySound,limit),...fullPinyin.map(value=>boundedSearchDistance(value,query,limit)));
      if(distance<=limit)best=Math.max(best,.78-distance*.13);
    }
    return {exact,score:best};
  }
  function rankedLibrarySearch(indices,queryText){
    const query=String(queryText||"").trim();if(!query)return {indices,similar:false};
    const scored=indices.map(index=>({index,...fuzzySearchScore(playlist[index],query)}));
    const exact=scored.filter(item=>item.exact);if(exact.length)return {indices:exact.map(item=>item.index),similar:false};
    const similar=scored.filter(item=>item.score>=.5).sort((a,b)=>b.score-a.score).slice(0,24);
    return {indices:similar.map(item=>item.index),similar:similar.length>0,empty:similar.length===0};
  }
  function updateSearchFeedback(similar,query,empty=false){const feedback=$("#searchFeedback");if(!feedback)return;feedback.textContent=query?(similar?tr("未找到完全匹配，以下为粗略匹配","No exact match. Approximate matches are shown below."):empty?tr("未找到匹配结果","No matching results"):""):"";feedback.classList.toggle("show",Boolean(feedback.textContent));feedback.classList.toggle("empty",Boolean(empty));}
  const listActionHoverTimers=new WeakMap(),listActionMotionTimers=new WeakMap();
  function runListActionMotion(button){
    if(!button)return;clearTimeout(listActionMotionTimers.get(button));
    restartCssMotion(button,"list-motion-run");
    listActionMotionTimers.set(button,setTimeout(()=>button.classList.remove("list-motion-run"),680));
  }
  document.addEventListener("pointerover",event=>{
    const button=event.target.closest?.(".track-action,.queue-drag-handle");if(!button||button.contains(event.relatedTarget))return;
    clearTimeout(listActionHoverTimers.get(button));listActionHoverTimers.set(button,setTimeout(()=>runListActionMotion(button),300));
  });
  document.addEventListener("pointerout",event=>{
    const button=event.target.closest?.(".track-action,.queue-drag-handle");if(!button||button.contains(event.relatedTarget))return;
    clearTimeout(listActionHoverTimers.get(button));
  });
  document.addEventListener("click",event=>{const button=event.target.closest?.(".track-action,.queue-drag-handle");if(button)runListActionMotion(button);},true);
  function syncLibraryEmptyState(emptyState,visibleCount,hasSearch){
    const show=!hasSearch&&visibleCount===0;
    emptyState.style.display=show?"block":"none";
    if(!show)return;
    const text=playlist.length===0
      ? tr("还没有音乐<br>点击上方按钮导入，或直接把歌曲/文件夹拖进窗口<br>封面会自动从 MP3/FLAC/M4A 中识别","Your library is empty.<br>Import music from Library or drop files or folders here.<br>Artwork is read from MP3, FLAC, or M4A files.")
      : libraryCollectionMode==="liked"
        ? tr("还没有喜欢的歌曲","No liked songs yet")
        : tr("这个歌单还没有歌曲","This playlist is empty");
    const message=emptyState.querySelector("p");if(message)message.innerHTML=text;
  }
  function render(filterText){
    libraryRenderCommits++;
    GP.performance.libraryRenderCommits=libraryRenderCommits;
    const q = (filterText||"").trim();
    const listEl = $("#trackList"), emptyState = $("#emptyState"), panel=$(".library-panel");
    panel?.classList.toggle("library-grid",libraryGridView);
    listEl.querySelectorAll(".track-item").forEach(n => n.remove());
    const visibleIndices=collectionTrackIndices();
    syncLibraryEmptyState(emptyState,visibleIndices.length,q.length>0);
    if(librarySortMode==="artist")visibleIndices.sort((a,b)=>playlist[a].artist.localeCompare(playlist[b].artist,"zh-CN",{sensitivity:"base"})||playlist[a].title.localeCompare(playlist[b].title,"zh-CN"));
    if(librarySortMode==="title")visibleIndices.sort((a,b)=>playlist[a].title.localeCompare(playlist[b].title,"zh-CN",{sensitivity:"base"})||playlist[a].artist.localeCompare(playlist[b].artist,"zh-CN"));
    const playCounts=typeof getLibraryPlayCounts==="function"?getLibraryPlayCounts():new Map();
    const result=rankedLibrarySearch(visibleIndices,q),rows=result.indices.map((idx,rank)=>trackRowHTML(playlist[idx],idx,{rank:rank+1,playCount:playCounts.get(playlist[idx].id)||0,playlistRemove:activePlaylistId()!==null}));
    updateSearchFeedback(result.similar,q,result.empty);
    if(rows.length)listEl.insertAdjacentHTML("beforeend",rows.join(""));
    wireRows(listEl);
    syncPlaylistUI(true);
    renderMiniQueue();
  }
  async function renderLibraryIncrementally(filterText,chunkSize=12){
    libraryRenderCommits++;GP.performance.libraryRenderCommits=libraryRenderCommits;
    const q=(filterText||"").trim(),listEl=$("#trackList"),emptyState=$("#emptyState"),panel=$(".library-panel");
    panel?.classList.toggle("library-grid",libraryGridView);
    listEl.querySelectorAll(".track-item").forEach(node=>node.remove());
    const visibleIndices=collectionTrackIndices();
    syncLibraryEmptyState(emptyState,visibleIndices.length,q.length>0);
    if(librarySortMode==="artist")visibleIndices.sort((a,b)=>playlist[a].artist.localeCompare(playlist[b].artist,"zh-CN",{sensitivity:"base"})||playlist[a].title.localeCompare(playlist[b].title,"zh-CN"));
    if(librarySortMode==="title")visibleIndices.sort((a,b)=>playlist[a].title.localeCompare(playlist[b].title,"zh-CN",{sensitivity:"base"})||playlist[a].artist.localeCompare(playlist[b].artist,"zh-CN"));
    const playCounts=typeof getLibraryPlayCounts==="function"?getLibraryPlayCounts():new Map();
    const result=rankedLibrarySearch(visibleIndices,q),filtered=result.indices;updateSearchFeedback(result.similar,q,result.empty);
    for(let offset=0;offset<filtered.length;offset+=chunkSize){
      const rows=filtered.slice(offset,offset+chunkSize).map((idx,rank)=>trackRowHTML(playlist[idx],idx,{rank:offset+rank+1,playCount:playCounts.get(playlist[idx].id)||0,playlistRemove:activePlaylistId()!==null}));
      if(rows.length)listEl.insertAdjacentHTML("beforeend",rows.join(""));
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    wireRows(listEl);
    syncPlaylistUI(true);
  }
  let lastPlaybackIndicatorIndex=-1;
  function syncCurrentTrackPlaybackIndicator(){
    const touched=new Set([lastPlaybackIndicatorIndex,currentIndex]);
    touched.forEach(idx=>{
      if(idx<0)return;
      document.querySelectorAll(`#trackList .track-item[data-idx="${idx}"],#miniQueueList .track-item[data-idx="${idx}"]`).forEach(row=>{
        row.classList.toggle("playing",idx===currentIndex);
      });
    });
    lastPlaybackIndicatorIndex=currentIndex;
  }
  const SORT_LABELS={original:["排序：原始顺序","Sort: Original"],artist:["排序：歌手 A–Z","Sort: Artist A–Z"],title:["排序：歌名 A–Z","Sort: Title A–Z"]};
  function syncSortUI(){ const labels=SORT_LABELS[librarySortMode]||SORT_LABELS.original;$("#sortBtnText").textContent=tr(labels[0],labels[1]); $$("#sortPop button").forEach(button=>button.classList.toggle("active",button.dataset.sort===librarySortMode)); }
  $("#sortBtn").addEventListener("click",e=>{e.stopPropagation();setMotionPopover($("#sortPop"),!$("#sortPop").classList.contains("show"));});
  $("#sortPop").addEventListener("click",e=>{const button=e.target.closest("button");if(!button)return;librarySortMode=button.dataset.sort;syncSortUI();render(searchInputSafe());setMotionPopover($("#sortPop"),false);});
  $("#libraryViewBtn").addEventListener("click",e=>{e.stopPropagation();libraryGridView=!libraryGridView;$("#libraryViewBtn").setAttribute("aria-pressed",String(libraryGridView));$(".library-panel")?.classList.toggle("library-grid",libraryGridView);render(searchInputSafe());});
  document.addEventListener("click",e=>{if(!e.target.closest("#sortWrap"))setMotionPopover($("#sortPop"),false);});
  let miniQueueDefaultSignature="",miniQueuePlayingIndex=-1,queuePositionPending=false,queuePositionRequestToken=0,queueAlignOnNextPlayback=false,queueMotionTarget=null,queueMotionTimer=0;
  function animateQueuePosition(body,targetTop,instantPosition){
    const maximum=Math.max(0,body.scrollHeight-body.clientHeight),target=Math.max(0,Math.min(maximum,targetTop)),distance=target-body.scrollTop;
    if(instantPosition||Math.abs(distance)<1){clearTimeout(queueMotionTimer);queueMotionTimer=0;queueMotionTarget=null;body.scrollTop=target;}
    else{
      /* Pause and Play can request the same alignment while one native smooth
         scroll is still running. Reissuing it makes Edge cancel and restore
         the previous user-scroll anchor, so one target owns the full motion. */
      if(queueMotionTimer&&queueMotionTarget!==null&&Math.abs(queueMotionTarget-target)<1)return;
      clearTimeout(queueMotionTimer);queueMotionTarget=target;
      body.scrollTo({top:target,behavior:"smooth"});
      queueMotionTimer=setTimeout(()=>{queueMotionTimer=0;queueMotionTarget=null;},900);
    }
    scheduleScrollEdgeUpdate(body);
  }
  function queueListTop(body,list){
    const bodyRect=body.getBoundingClientRect(),listRect=list.getBoundingClientRect();
    const scaleY=body.offsetHeight>0?bodyRect.height/body.offsetHeight:1;
    return body.scrollTop+(listRect.top-bodyRect.top)/Math.max(.01,scaleY);
  }
  function positionCurrentQueueRow(instantPosition=false,attempt=0,requestToken=0){
    if(currentIndex<0)return;
    if(attempt===0)requestToken=++queuePositionRequestToken;
    requestAnimationFrame(()=>{
      if(requestToken!==queuePositionRequestToken)return;
      const body=$("#queueBody"),list=$("#miniQueueList"),row=list?.querySelector(`.queue-default-item[data-idx="${currentIndex}"]`);
      if(!body)return;
      if(!row){queuePositionPending=true;if(attempt<40)setTimeout(()=>positionCurrentQueueRow(instantPosition,attempt+1,requestToken),50);return;}
      if(body.style.display==="none"||body.offsetParent===null){queuePositionPending=true;return;}
      const bodyRect=body.getBoundingClientRect(),rowRect=row.getBoundingClientRect(),scaleY=body.offsetHeight>0?bodyRect.height/body.offsetHeight:1;
      const rowHeight=Math.max(1,rowRect.height/Math.max(.01,scaleY)),rowTop=body.scrollTop+(rowRect.top-bodyRect.top)/Math.max(.01,scaleY),targetTop=Math.max(0,rowTop-rowHeight);
      animateQueuePosition(body,targetTop,instantPosition);
      queuePositionPending=false;queueAlignOnNextPlayback=false;
    });
  }
  function renderMiniQueue(options={}){
    if(typeof syncTraditionalPiP==="function")queueMicrotask(syncTraditionalPiP);
    const instantPosition=options.instantPosition===true;
    const el = $("#miniQueueList");
    for(let i=playQueue.length-1;i>=0;i--){
      if(playlist.findIndex(track => track.id === playQueue[i]) === -1) playQueue.splice(i,1);
    }
    if(manualQueueActive&&playQueue.length===0)manualQueueActive=false;
    const summaryTitle=$(".queue-summary strong");
    if(!manualQueueActive){
      summaryTitle.textContent=tr("歌单顺序","Library Order");
      $("#queueCount").textContent=tr(`${playlist.length} 首歌`,`${playlist.length} songs`);
      $("#clearQueueBtn").style.display="none";
      const signature=`${uiLanguage}:${playlist.length}:${hashString(playlist.map(track=>`${track.id}|${track.title}|${track.artist}|${track.duration||0}`).join("\u0001"))}`;
      const existingRows=el.querySelectorAll(".queue-default-item");
      if(miniQueueDefaultSignature===signature&&existingRows.length===playlist.length){
        if(miniQueuePlayingIndex!==currentIndex){
          el.querySelector(`.queue-default-item[data-idx="${miniQueuePlayingIndex}"]`)?.classList.remove("playing");
          el.querySelector(`.queue-default-item[data-idx="${currentIndex}"]`)?.classList.add("playing");
          miniQueuePlayingIndex=currentIndex;
        }
        positionCurrentQueueRow(instantPosition);return;
      }
      el.innerHTML="";miniQueueDefaultSignature=signature;miniQueuePlayingIndex=currentIndex;
      if(playlist.length===0){el.innerHTML=`<div class="empty-state" style="padding:24px 10px;"><p>${tr("歌单是空的，先去「歌单」页导入音乐吧","Your library is empty. Import music from Library.")}</p></div>`;return;}
      const defaultRows=[];
      for(let idx=0;idx<playlist.length;idx++){
        const t=playlist[idx];
        const thumb=t.thumbUrl||t.coverUrl;
        const cover=thumb?`<img src="${thumb}" class="track-thumb" loading="lazy" decoding="async">`:`<div class="track-thumb"><svg class="single-alpha-icon rounded-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="18" r="3"/><path d="M9 17V5l12-2v12"/><circle cx="18" cy="16" r="3"/></svg></div>`;
        defaultRows.push(`<div class="track-item queue-default-item ripple-target${idx===currentIndex?' playing':''}" data-idx="${idx}">${cover}<div class="track-info"><div class="t-title">${escapeHtml(t.title)}</div><div class="t-artist">${escapeHtml(t.artist)}</div></div><div class="track-dur">${t.duration?fmtTime(t.duration):"--:--"}</div></div>`);
      }
      if(el.dataset.defaultQueueWired!=="1"){el.dataset.defaultQueueWired="1";el.addEventListener("click",event=>{const item=event.target.closest(".queue-default-item");if(item&&el.contains(item))playAt(+item.dataset.idx);});}
      if(options.incremental===true){
        const expectedSignature=signature;
        return (async()=>{
          for(let offset=0;offset<defaultRows.length;offset+=16){
            if(miniQueueDefaultSignature!==expectedSignature)return;
            el.insertAdjacentHTML("beforeend",defaultRows.slice(offset,offset+16).join(""));
            await new Promise(resolve=>requestAnimationFrame(resolve));
          }
          positionCurrentQueueRow(instantPosition);
        })();
      }
      el.insertAdjacentHTML("beforeend",defaultRows.join(""));
      positionCurrentQueueRow(instantPosition);return;
    }
    miniQueueDefaultSignature="";miniQueuePlayingIndex=-1;el.innerHTML="";
    summaryTitle.textContent=tr("手动播放列表","Manual Queue");
    $("#queueCount").textContent=tr(`${playQueue.length} 首等待`,`${playQueue.length} queued`);
    $("#clearQueueBtn").style.display="block";$("#clearQueueBtn").disabled=false;
    const queueCanReorder=playMode!=="shuffle";el.classList.toggle("queue-shuffle-mode",!queueCanReorder);
    playQueue.forEach((trackId, queuePos) => {
      const idx = playlist.findIndex(track => track.id === trackId);
      if(idx === -1) return;
      const t = playlist[idx];
      const thumb=t.thumbUrl||t.coverUrl;
      const cover = thumb ? `<img src="${thumb}" class="track-thumb" loading="lazy" decoding="async">` :
        `<div class="track-thumb"><svg class="single-alpha-icon rounded-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="18" r="3"/><path d="M9 17V5l12-2v12"/><circle cx="18" cy="16" r="3"/></svg></div>`;
      el.insertAdjacentHTML("beforeend", `
        <div class="track-item queue-item${queueCanReorder?"":" queue-shuffle-item"}" data-qpos="${queuePos}" data-track-id="${trackId}" data-idx="${idx}">
          ${cover}
          <div class="track-info"><div class="t-title">${escapeHtml(t.title)}</div><div class="t-artist">${escapeHtml(t.artist)}</div></div>
          <div class="track-dur">${t.duration ? fmtTime(t.duration) : "--:--"}</div>
          <button class="track-action track-remove queue-remove ripple-target" data-qpos="${queuePos}" title="从播放队列移除" aria-label="从播放队列移除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
          <button class="queue-drag-handle" data-qpos="${queuePos}" title="拖拽排序" aria-label="拖拽排序" ${queueCanReorder?"":'disabled aria-hidden="true"'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path class="drag-line drag-line-top" d="M5 8h14"/><path class="drag-line drag-line-middle" d="M5 12h14"/><path class="drag-line drag-line-bottom" d="M5 16h14"/></svg></button>
        </div>`);
    });
    el.querySelectorAll(".queue-item").forEach(item => {
      item.addEventListener("click", e => { if(queueSuppressClick || e.target.closest("button")) return; playQueuedAt(+item.dataset.qpos); });
    });
    el.querySelectorAll(".queue-remove").forEach(btn => {
      btn.addEventListener("click", e => { e.stopPropagation(); removeQueuedAt(+btn.dataset.qpos); });
    });
    el.querySelectorAll(".queue-drag-handle").forEach(handle => {
      handle.addEventListener("pointerdown",e=>{
        if(playMode==="shuffle")return;
        if(e.pointerType==="mouse"&&e.button!==0)return;
        e.preventDefault();e.stopPropagation();queueDragFrom=+handle.dataset.qpos;
        const rows=$$("#miniQueueList .queue-item");
        const sourceRect=rows[queueDragFrom]?.getBoundingClientRect(),bodyRect=$("#queueBody").getBoundingClientRect();
        queueDragState={
          pointerId:e.pointerId,from:queueDragFrom,startX:e.clientX,startY:e.clientY,lastY:e.clientY,
          active:false,insertionPos:queueDragFrom,
          rowCenters:rows.map(row=>{const rect=row.getBoundingClientRect();return rect.top+rect.height/2;}),
          rowHeight:rows[queueDragFrom]?.offsetHeight||52,sourceTop:sourceRect?.top||e.clientY,sourceHeight:sourceRect?.height||52,
          boundaryTop:rows[0]?.getBoundingClientRect().top||bodyRect.top,boundaryBottom:bodyRect.bottom
        };
        if(handle.setPointerCapture)handle.setPointerCapture(e.pointerId);
      });
    });
  }

  function clearQueueShiftVisuals(){
    $$("#miniQueueList .queue-item").forEach(row => row.classList.remove("queue-shift-up","queue-shift-down","dragging","drag-before","drag-after"));
    $("#miniQueueList").style.removeProperty("--queue-shift-distance");
  }
  function clearQueueDragVisuals(state){
    clearQueueShiftVisuals();
    $("#miniQueueList").classList.remove("queue-dragging");
    $$("#miniQueueList .queue-item").forEach(row=>{row.classList.remove("queue-lifted","queue-drag-source");row.style.removeProperty("--queue-drag-y");});
    if(state&&state.ghost){state.ghost.remove();state.ghost=null;}
  }
  function calculateQueueInsertion(state,clientY){
    const firstAfter=state.rowCenters.findIndex(center=>clientY<center);
    return firstAfter===-1?state.rowCenters.length:firstAfter;
  }
  function clampQueueDragClientY(state,clientY){
    const minimum=state.startY+state.boundaryTop-state.sourceTop,maximum=state.startY+state.boundaryBottom-state.sourceHeight-state.sourceTop;
    return Math.max(minimum,Math.min(Math.max(minimum,maximum),clientY));
  }
  function paintQueueDrag(){
    queueDragFrame=0;
    const state = queueDragState;
    if(!state||!state.active)return;
    const list = $("#miniQueueList");
    list.classList.add("queue-dragging");
    const source = list.querySelector(`.queue-item[data-qpos="${state.from}"]`);
    const boundedY=clampQueueDragClientY(state,state.lastY);state.insertionPos=calculateQueueInsertion(state,boundedY);
    clearQueueShiftVisuals();
    if(source&&!state.ghost){
      const rect=source.getBoundingClientRect();
      const ghost=source.cloneNode(true);
      ghost.removeAttribute("data-qpos");ghost.classList.remove("queue-lifted","queue-drag-source","queue-shift-up","queue-shift-down");ghost.classList.add("queue-drag-ghost");
      ghost.querySelectorAll("button").forEach(button=>button.setAttribute("tabindex","-1"));
      const shellScale=Math.max(.1,parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale"))||1);
      const ghostWidth=rect.width/shellScale,ghostHeight=rect.height/shellScale;
      Object.assign(ghost.style,{left:`${rect.left-(ghostWidth-rect.width)/2}px`,top:`${rect.top-(ghostHeight-rect.height)/2}px`,width:`${ghostWidth}px`,height:`${ghostHeight}px`});
      document.body.appendChild(ghost);state.ghost=ghost;state.ghostBaseScale=shellScale;
    }
    if(source){source.classList.add("queue-drag-source");list.style.setProperty("--queue-shift-distance",`${state.rowHeight}px`);}
    if(state.ghost)state.ghost.style.transform=`translate3d(0,${boundedY-state.startY}px,0) scale(${(state.ghostBaseScale||1)*1.035})`;
    const insertion=state.insertionPos;
    $$("#miniQueueList .queue-item").forEach(row=>{const pos=+row.dataset.qpos;if(state.from<insertion&&pos>state.from&&pos<insertion)row.classList.add("queue-shift-up");if(state.from>insertion&&pos>=insertion&&pos<state.from)row.classList.add("queue-shift-down");});
  }
  document.addEventListener("pointermove", e => {
    const state = queueDragState;
    if(!state || state.pointerId !== e.pointerId) return;
    if(!state.active && Math.hypot(e.clientX-state.startX,e.clientY-state.startY) < 6) return;
    state.active = true;state.lastY=e.clientY;
    if(!queueDragFrame)queueDragFrame=requestAnimationFrame(paintQueueDrag);
    e.preventDefault();
  }, {passive:false});
  document.addEventListener("pointerup", e => {
    const state = queueDragState;
    if(!state || state.pointerId !== e.pointerId) return;
    if(queueDragFrame){cancelAnimationFrame(queueDragFrame);queueDragFrame=0;}
    queueDragState = null; queueDragFrom = null;
    if(!state.active){clearQueueDragVisuals(state);return;}
    e.preventDefault();
    queueSuppressClick = true;
    const ghostRect=state.ghost?.getBoundingClientRect()||null;
    moveQueuedTrack(state.from,calculateQueueInsertion(state,clampQueueDragClientY(state,e.clientY)),ghostRect);
    clearQueueDragVisuals(state);
    setTimeout(() => { queueSuppressClick = false; },0);
  });
  document.addEventListener("pointercancel", e => {
    if(!queueDragState || queueDragState.pointerId !== e.pointerId) return;
    if(queueDragFrame){cancelAnimationFrame(queueDragFrame);queueDragFrame=0;}
    const state=queueDragState;queueDragState = null; queueDragFrom = null; clearQueueDragVisuals(state);
  });

  function enqueueTrack(idx, placement){
    const track = playlist[idx];
    if(!track) return;
    const identity=neuralTrackId(track);
    const existingPos=playQueue.findIndex(trackId=>{
      const queued=playlist.find(item=>item.id===trackId);
      return queued&&(queued.id===track.id||neuralTrackId(queued)===identity);
    });
    if(existingPos!==-1){
      clearLibraryActionResidue();
      showToast(tr(`「${track.title}」已经在播放队列中`,`“${track.title}” is already in the queue`));
      return;
    }
    manualQueueActive=true;
    if(placement === "next") playQueue.unshift(track.id);
    else playQueue.push(track.id);
    recordBehaviorEvent("queue_add",track,{placement:placement||"end",movedExisting:false});
    renderMiniQueue();
    clearLibraryActionResidue();
    showToast(placement==="next"?tr(`已将「${track.title}」设为下一首`,`“${track.title}” will play next`):tr(`已将「${track.title}」加入播放列表`,`Added “${track.title}” to the queue`));
  }
  function clearLibraryActionResidue(){
    const library=$("#trackList");if(!library)return;
    library.querySelectorAll(".gp-press-held,.gp-press-release,.glow-pulse,.list-motion-run").forEach(element=>element.classList.remove("gp-press-held","gp-press-release","glow-pulse","list-motion-run"));
    if(library.contains(document.activeElement))document.activeElement.blur();
  }
  function releaseQueuePlaybackContext(){
    playingQueuedTrack=false;queueResumeIndex=null;
    if(pendingSelectionSource==="queue")pendingSelectionSource="sequential";
  }
  function removeQueuedAt(queuePos){
    if(queuePos < 0 || queuePos >= playQueue.length) return;
    const trackId=playQueue[queuePos],track=playlist.find(item=>item.id===trackId);
    playQueue.splice(queuePos,1);
    if(playQueue.length===0){manualQueueActive=false;releaseQueuePlaybackContext();}
    renderMiniQueue();
    showToast(track?tr(`已从播放队列移除「${track.title}」`,`Removed “${track.title}” from the queue`):tr("已从播放队列移除歌曲","Song removed from the queue"));
  }
  function clearPlayQueue(){
    const removedCount=playQueue.length;
    playQueue.length = 0;
    manualQueueActive=false;
    releaseQueuePlaybackContext();
    transitionQueueContent(()=>renderMiniQueue({instantPosition:true}));
    if(removedCount)showToast(tr(`已清空播放队列（${removedCount} 首）`,`Queue cleared (${removedCount} songs)`));
  }
  function moveQueuedTrack(from, insertionPos, ghostRect=null){
    if(from < 0 || from >= playQueue.length) return;
    const trackId = playQueue.splice(from,1)[0];
    if(from < insertionPos) insertionPos--;
    insertionPos = Math.max(0, Math.min(playQueue.length, insertionPos));
    playQueue.splice(insertionPos,0,trackId);
    renderMiniQueue();
    const dropped=$("#miniQueueList").querySelector(`.queue-item[data-qpos="${insertionPos}"]`);
    if(dropped&&ghostRect){
      const target=dropped.getBoundingClientRect(),dx=ghostRect.left-target.left,dy=ghostRect.top-target.top;
      dropped.animate([{transform:`translate3d(${dx}px,${dy}px,0) scale(1.035)`},{transform:"translate3d(0,0,0) scale(1)"}],{duration:240,easing:"cubic-bezier(.2,.82,.2,1)"});
    }
  }
  function takeNextQueuedIndex(){
    if(!manualQueueActive)return null;
    while(playQueue.length){
      const queuePos=playMode==="shuffle"?Math.floor(Math.random()*playQueue.length):0;
      const trackId = playQueue.splice(queuePos,1)[0];
      const idx = playlist.findIndex(track => track.id === trackId);
      if(idx !== -1){if(playQueue.length===0)manualQueueActive=false;renderMiniQueue();return idx;}
    }
    manualQueueActive=false;
    renderMiniQueue();
    return null;
  }
  function beginQueuedPlayback(){
    if(!playingQueuedTrack&&queueResumeIndex===null)queueResumeIndex=currentIndex;
    playingQueuedTrack=true;
  }
  function resumeAfterQueue(){
    if(!playingQueuedTrack)return false;
    const finalQueuedIndex=currentIndex;
    playingQueuedTrack=false;queueResumeIndex=null;
    if(finalQueuedIndex<0||finalQueuedIndex>=playlist.length)return false;
    showToast(tr("手动播放队列已播放完毕，继续播放歌曲库","Manual Queue finished. Continuing with the Library."));
    if(playMode==="repeatOne"){pendingSelectionSource="sequential";loadTrack(finalQueuedIndex,true);return true;}
    if(playMode==="shuffle"){pendingSelectionSource="shuffle";loadTrack(nextShuffleIndex(finalQueuedIndex),true);return true;}
    pendingSelectionSource="sequential";
    loadTrack((finalQueuedIndex+1)%playlist.length,true);return true;
  }
  function playQueuedAt(queuePos){
    if(queuePos < 0 || queuePos >= playQueue.length) return;
    const trackId = playQueue.splice(queuePos,1)[0];
    const idx = playlist.findIndex(track => track.id === trackId);
    if(playQueue.length===0)manualQueueActive=false;renderMiniQueue();
    if(idx !== -1){beginQueuedPlayback();playAt(idx,"queue");}
  }
  $("#clearQueueBtn").addEventListener("click", clearPlayQueue);

  function removeTrack(idx){
    const removedTrack = playlist[idx];
    if(!removedTrack) return;
    flushHistory();
    if(idx === currentIndex){
      playbackIntentToken++;pendingPlayToken=0;wantsPlayback=false;decks.forEach(deck=>deck.pause());audio.src="";isPlaying=false;currentIndex=-1;
      $("#discRotor").classList.remove("spinning","paused");resetDiscRotationTimeline();$("#diskReader").classList.remove("engaged");
      setNowPlayingTitle(tr("未选择歌曲","No Song Selected")); $("#nowArtist").textContent = tr("拖入或导入音乐开始播放","Drop or import music to begin");
      syncNowFormatTag(null);
      seekProgress = 0; drawWaveform();
      updatePlayIcon(); updateArtDisplay(); updateAmbient();
    } else if(idx < currentIndex){ currentIndex--; }
    if(overrideQueue){ overrideQueue = overrideQueue.filter(i => i !== idx).map(i => i > idx ? i-1 : i); if(!overrideQueue.length) overrideQueue = null; }
    for(let i=playQueue.length-1;i>=0;i--){ if(playQueue[i] === removedTrack.id) playQueue.splice(i,1); }
    if(playQueue.length===0){manualQueueActive=false;releaseQueuePlaybackContext();}
    const removedKey=playlistTrackKey(removedTrack);
    if(userPlaylistsCache&&removedKey!==null&&removedKey!==undefined){
      let touched=false;
      userPlaylistsCache.lists.forEach(list=>{const before=list.trackKeys.length;list.trackKeys=list.trackKeys.filter(key=>key!==removedKey);if(list.trackKeys.length!==before){touched=true;list.updatedAt=Date.now();}});
      if(touched){saveUserPlaylists();if(libraryCollectionMode!=="all")render(searchInputSafe());}
    }
    reservedSongIdentities.delete(songIdentity(removedTrack.artist,removedTrack.title));
    if(removedTrack.contentKey)reservedAudioFingerprints.delete(removedTrack.contentKey);
    if(removedTrack.coverUrl) URL.revokeObjectURL(removedTrack.coverUrl);
    if(removedTrack.thumbUrl) URL.revokeObjectURL(removedTrack.thumbUrl);
    URL.revokeObjectURL(removedTrack.url);
    playlist.splice(idx,1);
    invalidateHistoryTrackIndex();
    render(searchInputSafe());
    showToast(tr(`已从歌单移除「${removedTrack.title}」`,`Removed “${removedTrack.title}” from the library`));
  }

  /* ================= adding tracks (with embedded cover + genre) ================= */
  function normalizeSongIdentityPart(value){
    return String(value||"").normalize("NFKC").trim().toLocaleLowerCase().replace(/[‐‑‒–—]/g,"-").replace(/\s+/g," ").replace(/\s*(?:\(\d+\)|\[\d+\]|副本|copy)\s*$/i,"");
  }
  function songIdentity(artist,title){
    return `${normalizeSongIdentityPart(artist)}::${normalizeSongIdentityPart(title)}`;
  }
  function scheduleCooperativeYield(resolve){
    const schedulerYield=globalThis.scheduler?.yield;
    if(typeof schedulerYield==="function"){Promise.resolve(schedulerYield.call(globalThis.scheduler)).then(resolve,()=>setTimeout(resolve,0));return;}
    if(typeof setTimeout==="function"){setTimeout(resolve,0);return;}
    if(!document.hidden&&typeof requestAnimationFrame==="function"){requestAnimationFrame(resolve);return;}
    resolve();
  }
  async function yieldToInputPriority(){
    await new Promise(resolve=>scheduleCooperativeYield(resolve));
    if(navigator.scheduling?.isInputPending?.()){
      if(globalThis.scheduler?.yield)await globalThis.scheduler.yield();
      else await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  const bytesToHex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
  const bytesToAscii=bytes=>String.fromCharCode(...bytes);
  async function sha256Hex(value){
    const bytes=value instanceof Uint8Array?value:new TextEncoder().encode(String(value));
    return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)));
  }
  const FILE_PROBE_CHUNK_BYTES=256*1024;
  const fileProbeChunkCache=new WeakMap();
  function getFileProbeCache(file){
    let cache=fileProbeChunkCache.get(file);
    if(!cache){cache={prefix:null,prefixPromise:null,prefixLength:0,chunks:new Map()};fileProbeChunkCache.set(file,cache);}
    return cache;
  }
  async function readFilePrefix(file,length){
    const safeLength=Math.max(0,Math.min(file.size,Math.floor(length)||0)),cache=getFileProbeCache(file);
    if(cache.prefix&&cache.prefix.length>=safeLength)return cache.prefix.slice(0,safeLength);
    if(cache.prefixPromise&&cache.prefixLength>=safeLength)return (await cache.prefixPromise).slice(0,safeLength);
    const promise=file.slice(0,safeLength).arrayBuffer().then(buffer=>new Uint8Array(buffer));
    cache.prefixPromise=promise;cache.prefixLength=safeLength;
    const bytes=await promise;
    if(cache.prefixPromise===promise){cache.prefix=bytes;cache.prefixPromise=null;cache.prefixLength=bytes.length;}
    return bytes.slice(0,safeLength);
  }
  async function readFileBytes(file,start,length){
    const safeStart=Math.max(0,Math.min(file.size,Math.floor(start)||0));
    const safeEnd=Math.max(safeStart,Math.min(file.size,safeStart+Math.max(0,Math.floor(length)||0)));
    if(safeStart===0)return readFilePrefix(file,safeEnd);
    const chunkStart=Math.floor(safeStart/FILE_PROBE_CHUNK_BYTES)*FILE_PROBE_CHUNK_BYTES;
    const chunkEnd=Math.min(file.size,chunkStart+FILE_PROBE_CHUNK_BYTES);
    if(safeEnd<=chunkEnd){
      const cache=getFileProbeCache(file);let chunkPromise=cache.chunks.get(chunkStart);
      if(!chunkPromise){chunkPromise=file.slice(chunkStart,chunkEnd).arrayBuffer().then(buffer=>new Uint8Array(buffer));cache.chunks.set(chunkStart,chunkPromise);}
      const chunk=await chunkPromise;return chunk.slice(safeStart-chunkStart,safeEnd-chunkStart);
    }
    return new Uint8Array(await file.slice(safeStart,safeEnd).arrayBuffer());
  }
  async function readFileBuffer(file,start,length){
    return (await readFileBytes(file,start,length)).slice().buffer;
  }
  function uint32be(bytes,offset=0){return ((bytes[offset]||0)*0x1000000)+((bytes[offset+1]||0)<<16)+((bytes[offset+2]||0)<<8)+(bytes[offset+3]||0);}
  function uint32le(bytes,offset=0){return ((bytes[offset]||0)|((bytes[offset+1]||0)<<8)|((bytes[offset+2]||0)<<16)|((bytes[offset+3]||0)<<24))>>>0;}
  async function detectFlacPayload(file){
    const signature=await readFileBytes(file,0,4);if(bytesToAscii(signature)!=="fLaC")return null;
    let offset=4,flacPcmMd5=null;
    for(let block=0;block<128&&offset+4<=file.size;block++){
      const header=await readFileBytes(file,offset,4);if(header.length<4)break;
      const isLast=Boolean(header[0]&0x80),type=header[0]&0x7f,size=(header[1]<<16)|(header[2]<<8)|header[3];
      if(type===0&&size>=34){const streamInfo=await readFileBytes(file,offset+4,34);if(streamInfo.length===34){const md5=streamInfo.slice(18,34);if(md5.some(Boolean))flacPcmMd5=bytesToHex(md5);}}
      offset+=4+size;if(isLast)return {start:offset,end:file.size,format:"flac",flacPcmMd5,reliable:true};
    }
    return null;
  }
  async function detectMp3Payload(file){
    let start=0,end=file.size;
    const header=await readFileBytes(file,0,10);
    if(header.length===10&&bytesToAscii(header.slice(0,3))==="ID3"){
      const tagSize=((header[6]&0x7f)<<21)|((header[7]&0x7f)<<14)|((header[8]&0x7f)<<7)|(header[9]&0x7f);
      start=Math.min(end,10+tagSize+((header[5]&0x10)?10:0));
    }
    const id3v1=await readFileBytes(file,Math.max(start,end-128),128);
    if(id3v1.length===128&&bytesToAscii(id3v1.slice(0,3))==="TAG")end-=128;
    const apeFooter=await readFileBytes(file,Math.max(start,end-32),32);
    if(apeFooter.length===32&&bytesToAscii(apeFooter.slice(0,8))==="APETAGEX"){
      const apeSize=uint32le(apeFooter,12);if(apeSize>0&&apeSize<=end-start)end-=apeSize;
    }
    return {start,end:Math.max(start,end),format:"mp3",flacPcmMd5:null,reliable:true};
  }
  async function detectWavPayload(file){
    const header=await readFileBytes(file,0,12);if(header.length<12||bytesToAscii(header.slice(0,4))!=="RIFF"||bytesToAscii(header.slice(8,12))!=="WAVE")return null;
    let offset=12;
    for(let chunk=0;chunk<4096&&offset+8<=file.size;chunk++){
      const chunkHeader=await readFileBytes(file,offset,8);const id=bytesToAscii(chunkHeader.slice(0,4)),size=uint32le(chunkHeader,4);
      if(id==="data")return {start:offset+8,end:Math.min(file.size,offset+8+size),format:"wav",flacPcmMd5:null,reliable:true};
      offset+=8+size+(size&1);
    }
    return null;
  }
  async function detectMp4Payload(file){
    let offset=0;
    for(let atom=0;atom<4096&&offset+8<=file.size;atom++){
      const header=await readFileBytes(file,offset,16);if(header.length<8)break;
      let size=uint32be(header,0),headerSize=8;const type=bytesToAscii(header.slice(4,8));
      if(size===1&&header.length>=16){const view=new DataView(header.buffer,header.byteOffset,header.byteLength);const large=view.getBigUint64(8);size=Number(large>BigInt(Number.MAX_SAFE_INTEGER)?BigInt(file.size-offset):large);headerSize=16;}
      else if(size===0)size=file.size-offset;
      if(size<headerSize)break;
      if(type==="mdat")return {start:offset+headerSize,end:Math.min(file.size,offset+size),format:"mp4",flacPcmMd5:null,reliable:true};
      offset+=size;
    }
    return null;
  }
  async function detectOggPayload(file){
    let offset=0,headersSeen=0;
    for(let page=0;page<512&&offset+27<=file.size;page++){
      const fixed=await readFileBytes(file,offset,27);if(bytesToAscii(fixed.slice(0,4))!=="OggS")break;
      const segments=fixed[26],laces=await readFileBytes(file,offset+27,segments);let payloadSize=0;laces.forEach(value=>payloadSize+=value);
      const payloadStart=offset+27+segments,pageEnd=payloadStart+payloadSize;
      const probe=await readFileBytes(file,payloadStart,Math.min(payloadSize,64));const marker=bytesToAscii(probe);
      if(marker.includes("vorbis")||marker.startsWith("OpusHead")||marker.startsWith("OpusTags"))headersSeen++;
      else if(headersSeen>=2)return {start:offset,end:file.size,format:"ogg",flacPcmMd5:null,reliable:true};
      offset=pageEnd;
    }
    return null;
  }
  async function detectWmaPayload(file){
    const limit=Math.min(file.size,4*1024*1024),bytes=await readFileBytes(file,0,limit);
    const guid=[0x36,0x26,0xb2,0x75,0x8e,0x66,0xcf,0x11,0xa6,0xd9,0x00,0xaa,0x00,0x62,0xce,0x6c];
    outer:for(let i=0;i<=bytes.length-guid.length;i++){
      if(i>0&&(i&0x3ffff)===0)await yieldToInputPriority();
      for(let j=0;j<guid.length;j++)if(bytes[i+j]!==guid[j])continue outer;
      return {start:i+50,end:file.size,format:"wma",flacPcmMd5:null,reliable:true};
    }
    return null;
  }
  async function detectAudioPayload(file){
    const name=String(file.name||"").toLowerCase();let bounds=null;
    if(name.endsWith(".flac"))bounds=await detectFlacPayload(file);
    else if(name.endsWith(".mp3"))bounds=await detectMp3Payload(file);
    else if(/\.(m4a|mp4)$/i.test(name))bounds=await detectMp4Payload(file);
    else if(/\.wav$/i.test(name))bounds=await detectWavPayload(file);
    else if(/\.(ogg|opus)$/i.test(name))bounds=await detectOggPayload(file);
    else if(/\.wma$/i.test(name))bounds=await detectWmaPayload(file);
    return bounds||{start:0,end:file.size,format:audioFormatFromName(name).toLowerCase()||"audio",flacPcmMd5:null,reliable:false};
  }
  async function recognizeAudioEssence(file){
    const bounds=await detectAudioPayload(file),sampleSize=Math.min(65536,Math.max(1,bounds.end-bounds.start));
    const payloadLength=Math.max(0,bounds.end-bounds.start),maxStart=Math.max(bounds.start,bounds.end-sampleSize);
    const starts=[bounds.start,Math.max(bounds.start,Math.min(maxStart,Math.floor(bounds.start+(payloadLength-sampleSize)/2))),maxStart];
    const samples=await Promise.all(starts.map(start=>readFileBytes(file,start,sampleSize)));
    const [anchorHead,anchorMiddle,anchorTail]=await Promise.all(samples.map(sha256Hex));
    const technicalSignature=`${bounds.format}:${payloadLength}`;
    const combined=await sha256Hex(`${technicalSignature}:${bounds.flacPcmMd5||"-"}:${anchorHead}:${anchorMiddle}:${anchorTail}`),spectrumId=`gpsid:v1:${combined}`;
    return {schemaVersion:GP_RECOGNITION_SCHEMA_VERSION,spectrumId,audioEssenceKey:spectrumId,anchorHead,anchorMiddle,anchorTail,
      flacPcmMd5:bounds.flacPcmMd5||null,technicalSignature,payloadLength,payloadStart:bounds.start,payloadEnd:bounds.end,
      format:bounds.format,reliable:bounds.reliable,matchPolicy:"exact-or-flac-md5-or-middle-plus-one",matchedBy:null,identityConfidence:bounds.reliable?"verified-new":"unreliable"};
  }
  GP.core.recognition=Object.freeze({schemaVersion:GP_RECOGNITION_SCHEMA_VERSION,recognizeAudioEssence,detectAudioPayload});
  function fileCacheIdentity(file){
    return `${file.size}:${file.lastModified||0}:${file.type||""}:${file.webkitRelativePath||file.name}`;
  }
  async function resolveTrackCacheByRecognition(recognition){
    if(!recognition?.spectrumId&&!recognition?.audioEssenceKey)return null;
    const spectrumId=recognition.spectrumId||recognition.audioEssenceKey;
    let record=await GPDatabase.getTrackCache(spectrumId).catch(()=>null);
    if(!record)record=await GPDatabase.getTrackCacheBySpectrumId(spectrumId).catch(()=>null);
    if(!record)record=await GPDatabase.getTrackCacheByEssenceKey(recognition.audioEssenceKey).catch(()=>null);
    if(record)return {record,matchedBy:"spectrumId:exact",identityConfidence:"verified"};
    if(recognition.flacPcmMd5){
      record=await GPDatabase.getTrackCacheByRecognitionIndex("flacPcmMd5",recognition.flacPcmMd5).catch(()=>null);
      if(record)return {record,matchedBy:"flacPcmMd5",identityConfidence:"verified"};
    }
    const matches=await Promise.all([
      GPDatabase.getTrackCacheByRecognitionIndex("anchorHead",recognition.anchorHead).catch(()=>null),
      GPDatabase.getTrackCacheByRecognitionIndex("anchorMiddle",recognition.anchorMiddle).catch(()=>null),
      GPDatabase.getTrackCacheByRecognitionIndex("anchorTail",recognition.anchorTail).catch(()=>null)
    ]);
    const candidates=Array.from(new Map(matches.filter(Boolean).map(candidate=>[candidate.spectrumId||candidate.audioEssenceKey||candidate.contentKey,candidate])).values());
    for(const candidate of candidates){
      const saved=candidate.recognition||{},sameStructure=saved.technicalSignature===recognition.technicalSignature&&Number(saved.payloadLength)===Number(recognition.payloadLength);
      const middle=saved.anchorMiddle===recognition.anchorMiddle,head=saved.anchorHead===recognition.anchorHead,tail=saved.anchorTail===recognition.anchorTail;
      if(sameStructure&&middle&&(head||tail))return {record:candidate,matchedBy:`anchors:middle+${head?"head":"tail"}`,identityConfidence:"conservative-recovery"};
    }
    return null;
  }
  async function migrateLegacyRecognitionCache(legacyRecord,recognition,stats){
    if(!legacyRecord||!recognition?.audioEssenceKey)return legacyRecord;
    const oldKey=legacyRecord.contentKey,newKey=recognition.spectrumId||recognition.audioEssenceKey;
    const legacyKeys=Array.from(new Set([...(legacyRecord.legacyContentKeys||[]),oldKey].filter(key=>key&&key!==newKey)));
    const migrated=Object.assign({},legacyRecord,{contentKey:newKey,spectrumId:newKey,audioEssenceKey:newKey,recognition:Object.assign({},recognition,{matchedBy:"legacy-fileIdentity",identityConfidence:"migration-verified"}),
      legacyContentKeys:legacyKeys,cacheSchemaVersion:GP_TRACK_CACHE_SCHEMA_VERSION,recognitionMigratedAt:Date.now(),updatedAt:Date.now()});
    await GPDatabase.saveTrackCache(migrated);
    if(oldKey&&oldKey!==newKey){
      const oldFeatures=await GPDatabase.getTrackFeatures(oldKey).catch(()=>null);
      if(oldFeatures){await GPDatabase.saveTrackFeatures(Object.assign({},oldFeatures,{contentKey:newKey,spectrumId:newKey,audioEssenceKey:newKey,recognitionSchemaVersion:GP_RECOGNITION_SCHEMA_VERSION,migratedFromContentKey:oldKey}));}
    }
    if(stats)stats.identityMigrations=(stats.identityMigrations||0)+1;
    return migrated;
  }
  async function stampRecognitionCache(record,recognition,matchedBy){
    if(!record||!recognition)return record;
    const key=recognition.spectrumId||recognition.audioEssenceKey,legacyKeys=Array.from(new Set([...(record.legacyContentKeys||[]),record.contentKey].filter(value=>value&&value!==key)));
    const stamped=Object.assign({},record,{contentKey:key,spectrumId:key,audioEssenceKey:key,recognition:Object.assign({},recognition,{matchedBy:matchedBy||recognition.matchedBy||"spectrumId",identityConfidence:recognition.identityConfidence||record.recognition?.identityConfidence||null}),
      legacyContentKeys:legacyKeys,cacheSchemaVersion:GP_TRACK_CACHE_SCHEMA_VERSION,updatedAt:Date.now()});
    await GPDatabase.saveTrackCache(stamped);
    if(record.contentKey&&record.contentKey!==key){
      const oldFeatures=await GPDatabase.getTrackFeatures(record.contentKey).catch(()=>null);
      if(oldFeatures)await GPDatabase.saveTrackFeatures(Object.assign({},oldFeatures,{contentKey:key,spectrumId:key,audioEssenceKey:key,recognitionSchemaVersion:GP_RECOGNITION_SCHEMA_VERSION,migratedFromContentKey:record.contentKey}));
    }
    return stamped;
  }
  function recognitionCacheIsCurrent(record,recognition){
    const saved=record?.recognition;if(!saved||!recognition)return false;
    return (record.spectrumId||record.audioEssenceKey||record.contentKey)===(recognition.spectrumId||recognition.audioEssenceKey)
      &&saved.anchorHead===recognition.anchorHead&&saved.anchorMiddle===recognition.anchorMiddle&&saved.anchorTail===recognition.anchorTail
      &&saved.flacPcmMd5===recognition.flacPcmMd5&&saved.technicalSignature===recognition.technicalSignature
      &&Number(saved.payloadLength)===Number(recognition.payloadLength);
  }
  async function mapWithConcurrency(items,limit,worker){
    const results=new Array(items.length);let cursor=0;
    const runners=Array.from({length:Math.min(Math.max(1,limit),items.length)},async()=>{
      while(true){
        const index=cursor++;if(index>=items.length)return;
        results[index]=await worker(items[index],index);
        // 7.3.2: yield only when input is actually pending; unconditional
        // per-item yields added hundreds of idle waits on large imports.
        if(navigator.scheduling?.isInputPending?.())await yieldToInputPriority();
        else if(index%16===15)await yieldToInputPriority();
      }
    });
    await Promise.all(runners);return results;
  }
  function probeTrackDuration(url){
    return new Promise(resolve=>{
      const probe=new Audio();let settled=false;
      const finish=value=>{
        if(settled)return;settled=true;clearTimeout(timer);
        const duration=Number.isFinite(value)?value:0;
        probe.pause();probe.removeAttribute("src");probe.load();resolve(duration);
      };
      const timer=setTimeout(()=>finish(0),10000);
      probe.preload="metadata";
      probe.addEventListener("loadedmetadata",()=>finish(probe.duration),{once:true});
      probe.addEventListener("error",()=>finish(0),{once:true});
      probe.src=url;
    });
  }
  async function coverURLToBlob(url){
    if(!url)return null;
    try{return await (await fetch(url)).blob();}
    catch(error){return null;}
    finally{URL.revokeObjectURL(url);}
  }
  async function createCoverThumbnailBlob(sourceBlob,size=192){
    if(!sourceBlob)return null;
    try{
      const bitmap=await createImageBitmap(sourceBlob);
      const side=Math.min(bitmap.width,bitmap.height);
      const sx=Math.floor((bitmap.width-side)/2),sy=Math.floor((bitmap.height-side)/2);
      const canvas=document.createElement("canvas");canvas.width=size;canvas.height=size;
      const context=canvas.getContext("2d",{alpha:false});
      context.drawImage(bitmap,sx,sy,side,side,0,0,size,size);bitmap.close?.();
      return await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",.86));
    }catch(error){return null;}
  }
  function preloadArtworkUrl(url){
    if(!url)return Promise.resolve();
    return new Promise(resolve=>{
      const image=new Image(),done=()=>resolve();
      image.onload=done;image.onerror=done;image.src=url;
      if(image.decode)image.decode().then(done).catch(()=>{});
    });
  }
  async function preloadTrackArtwork(track){
    const urls=Array.from(new Set([track?.coverUrl,track?.thumbUrl].filter(Boolean)));
    await Promise.all(urls.map(preloadArtworkUrl));
  }
  function audioFormatFromName(name){return String(name||"").split(".").pop()?.toUpperCase()||"";}
  function estimateTrackBitrate(fileSize,duration){return Number(fileSize)>0&&Number(duration)>0?Math.round(Number(fileSize)*8/1000/Number(duration)):null;}
  function applyPersistentTrackSnapshot(track,record){
    if(!track||!record)return track;
    const technical=record.technical||{},analysis=record.analysis||{};
    track.audioEssenceKey=record.audioEssenceKey||track.audioEssenceKey||track.contentKey;
    track.spectrumId=record.spectrumId||track.spectrumId||track.audioEssenceKey||track.contentKey;
    track.recognition=record.recognition||track.recognition||null;
    track.identityLinks=record.identityLinks||track.identityLinks||{spectrumId:track.spectrumId,canonicalArtistId:null,artistAliases:[],titleAliases:[],genreIds:[]};
    track.metadataVersions=record.metadataVersions||track.metadataVersions||null;
    track.legacyContentKeys=Array.isArray(record.legacyContentKeys)?record.legacyContentKeys.slice():[];
    track.format=technical.format||audioFormatFromName(track.name);
    track.fileSize=Number.isFinite(technical.fileSize)?technical.fileSize:(track.file?.size||0);
    track.mimeType=technical.mimeType||track.file?.type||"";
    track.fileLastModified=Number.isFinite(technical.lastModified)?technical.lastModified:(track.file?.lastModified||0);
    track.relativePath=technical.relativePath||track.file?.webkitRelativePath||"";
    track.bitrateKbps=Number.isFinite(technical.bitrateKbps)?technical.bitrateKbps:estimateTrackBitrate(track.fileSize,track.duration);
    track.sampleRate=Number.isFinite(technical.sampleRate)?technical.sampleRate:track.sampleRate;
    track.channels=Number.isFinite(technical.channels)?technical.channels:track.channels;
    if(analysis&&Object.keys(analysis).length)applySpectrumRecordToTrack(track,analysis);
    return track;
  }
  function createPersistentTrackSnapshot(track,existing){
    const previous=existing||{},file=track.file||{},duration=Number(track.duration)||0;
    const sampleRate=Number.isFinite(track.sampleRate)?track.sampleRate:null;
    const channels=Number.isFinite(track.channels)?track.channels:null;
    const energy=Number.isFinite(track.energy)?track.energy:null;
    const energyDb=Number.isFinite(track.energyDb)?track.energyDb:null;
    const bpm=Number.isFinite(track.bpm)?track.bpm:null;
    const bpmConfidence=Number.isFinite(track.bpmConfidence)?track.bpmConfidence:null;
    return Object.assign({},previous,{
      contentKey:track.contentKey,cacheSchemaVersion:GP_TRACK_CACHE_SCHEMA_VERSION,
      spectrumId:track.spectrumId||track.audioEssenceKey||track.contentKey,audioEssenceKey:track.audioEssenceKey||track.spectrumId||track.contentKey,
      recognition:track.recognition||previous.recognition||null,
      identityLinks:Object.assign({spectrumId:track.spectrumId||track.audioEssenceKey||track.contentKey,canonicalArtistId:null,artistAliases:[],titleAliases:[],genreIds:[]},previous.identityLinks||{},track.identityLinks||{},
        {artistAliases:Array.from(new Set([...(previous.identityLinks?.artistAliases||[]),...(track.identityLinks?.artistAliases||[]),track.artist].filter(Boolean))),
         titleAliases:Array.from(new Set([...(previous.identityLinks?.titleAliases||[]),...(track.identityLinks?.titleAliases||[]),track.title].filter(Boolean))),
         genreIds:Array.from(new Set([...(previous.identityLinks?.genreIds||[]),...(track.identityLinks?.genreIds||[]),track.genre].filter(Boolean)))}),
      legacyContentKeys:Array.from(new Set([...(previous.legacyContentKeys||[]),...(track.legacyContentKeys||[])].filter(Boolean))),
      fileName:track.name||file.name||previous.fileName||"",fileSize:Number(file.size)||previous.fileSize||0,
      fileLastModified:Number(file.lastModified)||previous.fileLastModified||0,fileType:file.type||previous.fileType||"",
      relativePath:file.webkitRelativePath||previous.relativePath||"",fileIdentity:fileCacheIdentity(file),
      metadata:{name:track.name||file.name||"",title:track.title||"",artist:track.artist||"",album:track.album||null,date:track.date||null,duration,genre:track.genre||null,genreSource:track.genreSource||null},
      technical:{
        format:audioFormatFromName(track.name||file.name),fileSize:Number(file.size)||0,mimeType:file.type||"",
        lastModified:Number(file.lastModified)||0,relativePath:file.webkitRelativePath||"",duration,
        bitrateKbps:estimateTrackBitrate(file.size,duration),sampleRate,channels
      },
      analysis:{energy,energyDb,loudnessDb:Number.isFinite(track.loudnessDb)?track.loudnessDb:null,
        normalizationGainDb:Number.isFinite(track.normalizationGainDb)?track.normalizationGainDb:(Number.isFinite(track.loudnessDb)?Math.max(-7,Math.min(7,-18-track.loudnessDb)):null),normalizationVersion:1,bpm,bpmConfidence,sampleRate,channels,
        peaks:Array.isArray(track.peaks)?track.peaks.slice(0,160):null,mfcc:track.mfcc||null,mfccSummary:track.mfccSummary||null,mood:track.mood||null,
        inferredGenre:track.inferredGenre||null,genreSecondary:track.genreSecondary||null,genreScores:Array.isArray(track.genreScores)?track.genreScores.slice(0,3):null,
        genreConfidence:Number.isFinite(track.genreConfidence)?track.genreConfidence:null,genreSource:track.genreSource||null,
        spectrumVersion:track.spectrumVersion||null,spectrumStatus:track.spectrumStatus||null},
      informationComplete:track.spectrumStatus==="complete"&&track.spectrumVersion===GP_SPECTRUM_ALGORITHM_VERSION&&sampleRate!==null&&channels!==null,
      cachedAt:previous.cachedAt||Date.now(),updatedAt:Date.now()
    });
  }
  async function persistCompleteTrackSnapshot(track){
    if(!track?.contentKey)return;
    const existing=await GPDatabase.getTrackCache(track.contentKey).catch(()=>null);
    await GPDatabase.saveTrackCache(createPersistentTrackSnapshot(track,existing));
  }
  function applySpectrumRecordToTrack(track,record){
    if(!track||!record)return track;
    track.energy=Number.isFinite(record.energy)?record.energy:null;
    track.energyDb=Number.isFinite(record.energyDb)?record.energyDb:null;
    track.loudnessDb=Number.isFinite(record.loudnessDb)?record.loudnessDb:track.energyDb;
    track.normalizationGainDb=Number.isFinite(record.normalizationGainDb)?record.normalizationGainDb:(Number.isFinite(track.loudnessDb)?Math.max(-7,Math.min(7,-18-track.loudnessDb)):null);
    track.bpm=Number.isFinite(record.bpm)?record.bpm:null;
    track.bpmConfidence=Number.isFinite(record.bpmConfidence)?record.bpmConfidence:null;
    track.sampleRate=Number.isFinite(record.sampleRate)?record.sampleRate:track.sampleRate;
    track.channels=Number.isFinite(record.channels)?record.channels:track.channels;
    track.spectrumStatus=record.spectrumStatus||null;
    track.spectrumVersion=record.spectrumVersion||null;
    track.mfcc=record.mfcc&&Array.isArray(record.mfcc.mean)?record.mfcc:null;
    track.mfccSummary=record.mfccSummary||null;
    track.mood=record.mood||null;
    track.inferredGenre=record.inferredGenre||null;
    track.genreSecondary=record.genreSecondary||null;
    track.genreScores=Array.isArray(record.genreScores)?record.genreScores:null;
    track.genreConfidence=Number.isFinite(record.genreConfidence)?record.genreConfidence:null;
    if((!track.genre||track.genreSource==="spectrum-inference")&&record.inferredGenre){track.genre=record.inferredGenre;track.genreSource="spectrum-inference";}
    if(Array.isArray(record.peaks))track.peaks=record.peaks;
    return track;
  }
  async function restoreSpectrumRecord(track,stats,cacheRecord=null){
    try{
      if(cacheRecord)applyPersistentTrackSnapshot(track,cacheRecord);
      if(track.spectrumStatus==="complete"&&track.spectrumVersion===GP_SPECTRUM_ALGORITHM_VERSION&&Number.isFinite(track.sampleRate)&&Number.isFinite(track.channels)){
        if(stats)stats.featureCacheHits++;GP.performance.spectrum.cacheHits++;return track;
      }
      const record=await GPAnalyzer.readCached(track.contentKey);
      if(record){
        applySpectrumRecordToTrack(track,record);
        await persistCompleteTrackSnapshot(track);
        if(stats)stats.featureCacheHits++;
        GP.performance.spectrum.cacheHits++;
      }else{track.spectrumStatus=null;track.spectrumVersion=null;}
    }catch(error){if(stats)stats.storageErrors++;}
    return track;
  }
  const GP_BACKGROUND_IDLE_WINDOW=10000;
  let gpLastUserInteractionAt=performance.now();
  ["pointerdown","pointermove","keydown","wheel","touchstart"].forEach(type=>document.addEventListener(type,()=>{gpLastUserInteractionAt=performance.now();},{passive:true,capture:true}));
  function runAfterInteractionIdle(task,delay=1200,quietWindow=GP_BACKGROUND_IDLE_WINDOW){
    const check=()=>{
      const remaining=quietWindow-(performance.now()-gpLastUserInteractionAt);
      if(remaining>0){setTimeout(check,Math.min(600,Math.max(80,remaining)));return;}
      const run=()=>{if(performance.now()-gpLastUserInteractionAt<quietWindow){check();return;}task();};
      if("requestIdleCallback" in window)window.requestIdleCallback(run,{timeout:4000});else setTimeout(run,32);
    };
    setTimeout(check,delay);
  }
  const yieldSpectrumTask=()=>new Promise(resolve=>{
    const yieldWhenPlaybackAllows=()=>{
      if(importRunning){yieldToInputPriority().then(resolve);return;}
      if(isPlaying||wantsPlayback){setTimeout(yieldWhenPlaybackAllows,700);return;}
      if(performance.now()-gpLastUserInteractionAt<GP_BACKGROUND_IDLE_WINDOW){setTimeout(yieldWhenPlaybackAllows,400);return;}
      if("requestIdleCallback" in window)window.requestIdleCallback(()=>resolve(),{timeout:120});
      else setTimeout(resolve,0);
    };
    yieldWhenPlaybackAllows();
  });
  let spectrumAnalysisQueue=Promise.resolve(),spectrumResumeAfter=0;
  const spectrumQueuedKeys=new Set();
  async function buildSpectrumEnvelope(audioBuffer){
    const envelopeRate=100,sampleRate=audioBuffer.sampleRate,channels=audioBuffer.numberOfChannels;
    const startSeconds=audioBuffer.duration>210?15:0;
    const analysisSeconds=Math.max(0,Math.min(180,audioBuffer.duration-startSeconds));
    const startFrame=Math.floor(startSeconds*sampleRate),endFrame=Math.min(audioBuffer.length,Math.floor((startSeconds+analysisSeconds)*sampleRate));
    const blockFrames=Math.max(1,Math.round(sampleRate/envelopeRate));
    const blockCount=Math.max(0,Math.floor((endFrame-startFrame)/blockFrames));
    const envelope=new Float32Array(blockCount),channelData=Array.from({length:channels},(_,index)=>audioBuffer.getChannelData(index));
    let envelopeSquareSum=0;
    for(let block=0;block<blockCount;block++){
      const from=startFrame+block*blockFrames,to=Math.min(endFrame,from+blockFrames);
      const stride=Math.max(1,Math.floor((to-from)/32));let squareSum=0,count=0;
      for(let frame=from;frame<to;frame+=stride){
        for(let channel=0;channel<channels;channel++){const value=channelData[channel][frame]||0;squareSum+=value*value;count++;}
      }
      const rms=Math.sqrt(squareSum/Math.max(1,count));envelope[block]=rms;envelopeSquareSum+=rms*rms;
      if(block>0&&block%500===0)await yieldSpectrumTask();
    }
    const overallRms=Math.sqrt(envelopeSquareSum/Math.max(1,blockCount));
    const energyDb=20*Math.log10(Math.max(overallRms,1e-7));
    const energy=Math.round(Math.max(0,Math.min(100,(energyDb+42)/34*100)));
    const peaks=Array.from({length:160},(_,index)=>{
      const from=Math.floor(index*envelope.length/160),to=Math.max(from+1,Math.floor((index+1)*envelope.length/160));let peak=0;
      for(let i=from;i<to&&i<envelope.length;i++)if(envelope[i]>peak)peak=envelope[i];
      return peak;
    });
    return {envelope,envelopeRate,energy,energyDb,peaks};
  }
  async function detectBpmFromEnvelope(envelope,envelopeRate=100){
    if(!envelope||envelope.length<envelopeRate*8)return {bpm:null,confidence:0};
    const flux=new Float32Array(envelope.length-1);let fluxMean=0;
    for(let i=1;i<envelope.length;i++){const value=Math.max(0,envelope[i]-envelope[i-1]);flux[i-1]=value;fluxMean+=value;}
    fluxMean/=Math.max(1,flux.length);
    const onset=new Float32Array(flux.length);let onsetMean=0,onsetPower=0;
    for(let i=0;i<flux.length;i++){const value=Math.max(0,flux[i]-fluxMean*.85);onset[i]=value;onsetMean+=value;}
    onsetMean/=Math.max(1,onset.length);
    for(let i=0;i<onset.length;i++){onset[i]-=onsetMean;onsetPower+=onset[i]*onset[i];}
    if(onsetPower<1e-8)return {bpm:null,confidence:0};
    const correlationCache=new Map();
    const correlation=lag=>{
      lag=Math.max(1,Math.round(lag));if(correlationCache.has(lag))return correlationCache.get(lag);
      let sum=0,left=0,right=0;
      for(let i=lag;i<onset.length;i++){const a=onset[i],b=onset[i-lag];sum+=a*b;left+=a*a;right+=b*b;}
      const value=sum/Math.sqrt(Math.max(1e-12,left*right));correlationCache.set(lag,value);return value;
    };
    let bestBpm=null,bestScore=-Infinity,runnerUp=-Infinity;
    for(let bpm=60;bpm<=200;bpm++){
      const lag=envelopeRate*60/bpm;
      const score=(correlation(lag)+.34*correlation(lag*2)+.12*correlation(lag/2))*(1-Math.min(.1,Math.abs(bpm-120)*.00065));
      if(score>bestScore){runnerUp=bestScore;bestScore=score;bestBpm=bpm;}else if(score>runnerUp&&Math.abs(bpm-bestBpm)>3)runnerUp=score;
      if(bpm%16===0)await yieldSpectrumTask();
    }
    if(!Number.isFinite(bestScore)||bestScore<.035)return {bpm:null,confidence:0};
    if(bestBpm<=100){
      const baseCorrelation=correlation(envelopeRate*60/bestBpm);
      let correctedBpm=bestBpm;
      for(const factor of [2,3]){
        const candidate=bestBpm*factor;
        if(candidate>200)continue;
        const candidateCorrelation=correlation(envelopeRate*60/candidate);
        const harmonicFloor=factor===3?.55:.9;
        if(candidateCorrelation>=Math.max(.08,baseCorrelation*harmonicFloor))correctedBpm=candidate;
      }
      bestBpm=correctedBpm;
    }
    const separation=Math.max(0,bestScore-Math.max(0,runnerUp));
    const confidence=Math.round(Math.max(1,Math.min(100,(bestScore*.72+separation*.9)*100)));
    return {bpm:bestBpm,confidence};
  }
  function fftPowerSpectrum(frame){
    const size=frame.length,real=new Float64Array(size),imag=new Float64Array(size);
    for(let i=0;i<size;i++)real[i]=frame[i];
    for(let i=1,j=0;i<size;i++){
      let bit=size>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
      if(i<j){const swap=real[i];real[i]=real[j];real[j]=swap;}
    }
    for(let length=2;length<=size;length<<=1){
      const angle=-2*Math.PI/length,wrStep=Math.cos(angle),wiStep=Math.sin(angle);
      for(let start=0;start<size;start+=length){
        let wr=1,wi=0;const half=length>>1;
        for(let offset=0;offset<half;offset++){
          const even=start+offset,odd=even+half;
          const oddReal=real[odd]*wr-imag[odd]*wi,oddImag=real[odd]*wi+imag[odd]*wr;
          real[odd]=real[even]-oddReal;imag[odd]=imag[even]-oddImag;real[even]+=oddReal;imag[even]+=oddImag;
          const nextWr=wr*wrStep-wi*wiStep;wi=wr*wiStep+wi*wrStep;wr=nextWr;
        }
      }
    }
    const power=new Float64Array(size/2+1),normalizer=1/(size*size);
    for(let i=0;i<power.length;i++)power[i]=(real[i]*real[i]+imag[i]*imag[i])*normalizer;
    return power;
  }
  function hzToMel(hz){return 2595*Math.log10(1+hz/700);}
  function melToHz(mel){return 700*(Math.pow(10,mel/2595)-1);}
  function createMelFilterBins(sampleRate,fftSize,nMels){
    const minMel=hzToMel(20),maxMel=hzToMel(Math.min(8000,sampleRate*.49)),maxBin=fftSize>>1,bins=[];
    for(let i=0;i<nMels+2;i++){
      const hz=melToHz(minMel+(maxMel-minMel)*i/(nMels+1));
      bins.push(Math.max(0,Math.min(maxBin,Math.floor((fftSize+1)*hz/sampleRate))));
    }
    return bins;
  }
  function mfccFromPower(power,melBins,nMfcc){
    const nMels=melBins.length-2,logMel=new Float64Array(nMels);
    for(let band=0;band<nMels;band++){
      const left=melBins[band],center=Math.max(left+1,melBins[band+1]),right=Math.max(center+1,melBins[band+2]);let energy=0;
      for(let bin=left;bin<center&&bin<power.length;bin++)energy+=power[bin]*(bin-left)/(center-left);
      for(let bin=center;bin<right&&bin<power.length;bin++)energy+=power[bin]*(right-bin)/(right-center);
      logMel[band]=Math.log(Math.max(1e-12,energy));
    }
    const coefficients=new Float64Array(nMfcc);
    for(let coefficient=0;coefficient<nMfcc;coefficient++){
      let sum=0;for(let band=0;band<nMels;band++)sum+=logMel[band]*Math.cos(Math.PI*coefficient*(band+.5)/nMels);
      coefficients[coefficient]=sum*Math.sqrt((coefficient===0?1:2)/nMels);
    }
    return coefficients;
  }
  async function extractMfccFeatures(audioBuffer){
    const targetRate=Math.min(22050,audioBuffer.sampleRate),frameSize=1024,nMels=40,nMfcc=13,maxFrames=120;
    const ratio=audioBuffer.sampleRate/targetRate,sourceFrameLength=Math.max(frameSize,Math.ceil(frameSize*ratio));
    const available=Math.max(0,audioBuffer.length-sourceFrameLength-2),frameCount=Math.max(1,Math.min(maxFrames,Math.floor(audioBuffer.duration*2)||1));
    const channels=Array.from({length:audioBuffer.numberOfChannels},(_,index)=>audioBuffer.getChannelData(index));
    const melBins=createMelFilterBins(targetRate,frameSize,nMels),vectors=[],frameRms=[];
    let centroidTotal=0,flatnessTotal=0,rolloffTotal=0,bandwidthTotal=0,zcrTotal=0,bassTotal=0,midTotal=0,highTotal=0,fluxTotal=0,crestTotal=0,mfccDeltaTotal=0;
    let previousNormalizedPower=null,previousVector=null;
    for(let frameIndex=0;frameIndex<frameCount;frameIndex++){
      const start=Math.floor(available*(frameIndex+.5)/frameCount),frame=new Float64Array(frameSize);let rmsSquare=0,peak=0,zcr=0,previousRaw=0;
      for(let sample=0;sample<frameSize;sample++){
        const sourcePosition=start+sample*ratio,left=Math.floor(sourcePosition),mix=sourcePosition-left;let raw=0;
        for(const channel of channels)raw+=(channel[left]||0)*(1-mix)+(channel[left+1]||0)*mix;
        raw/=Math.max(1,channels.length);if(sample&&((raw>=0)!==(previousRaw>=0)))zcr++;previousRaw=raw;peak=Math.max(peak,Math.abs(raw));rmsSquare+=raw*raw;
        frame[sample]=raw*(.5-.5*Math.cos(2*Math.PI*sample/(frameSize-1)));
      }
      const rms=Math.sqrt(rmsSquare/frameSize);if(rms<1e-5)continue;frameRms.push(rms);zcrTotal+=zcr/(frameSize-1);crestTotal+=peak/Math.max(1e-8,rms);
      const power=fftPowerSpectrum(frame),vector=mfccFromPower(power,melBins,nMfcc);vectors.push(vector);
      let weighted=0,total=0,logTotal=0,positive=0,bass=0,mid=0,high=0;
      for(let bin=1;bin<power.length;bin++){
        const value=Math.max(1e-16,power[bin]),hz=bin*targetRate/frameSize;weighted+=bin*value;total+=value;logTotal+=Math.log(value);positive++;
        if(hz<250)bass+=value;else if(hz<4000)mid+=value;else high+=value;
      }
      const centroidBin=total>0?weighted/total:0;let spread=0,cumulative=0,rolloffBin=0;
      for(let bin=1;bin<power.length;bin++){spread+=(bin-centroidBin)*(bin-centroidBin)*power[bin];cumulative+=power[bin];if(!rolloffBin&&cumulative>=total*.85)rolloffBin=bin;}
      centroidTotal+=centroidBin/(power.length-1);bandwidthTotal+=Math.sqrt(spread/Math.max(1e-16,total))/(power.length-1);rolloffTotal+=rolloffBin/(power.length-1);
      flatnessTotal+=total>0?Math.exp(logTotal/Math.max(1,positive))/(total/Math.max(1,positive)):0;
      bassTotal+=bass/Math.max(1e-16,total);midTotal+=mid/Math.max(1e-16,total);highTotal+=high/Math.max(1e-16,total);
      const normalizedPower=Float64Array.from(power,value=>value/Math.max(1e-16,total));
      if(previousNormalizedPower){let flux=0;for(let bin=1;bin<normalizedPower.length;bin++)flux+=Math.max(0,normalizedPower[bin]-previousNormalizedPower[bin]);fluxTotal+=flux;}
      if(previousVector){let delta=0;for(let i=1;i<vector.length;i++)delta+=Math.abs(vector[i]-previousVector[i]);mfccDeltaTotal+=delta/(vector.length-1);}
      previousNormalizedPower=normalizedPower;previousVector=vector;
      if(frameIndex%5===4)await yieldSpectrumTask();
    }
    if(!vectors.length)return null;
    const mean=new Array(nMfcc).fill(0),stdev=new Array(nMfcc).fill(0),count=vectors.length;
    vectors.forEach(vector=>vector.forEach((value,index)=>mean[index]+=value/count));
    vectors.forEach(vector=>vector.forEach((value,index)=>stdev[index]+=(value-mean[index])*(value-mean[index])/count));
    for(let i=0;i<nMfcc;i++){mean[i]=Math.round(mean[i]*10000)/10000;stdev[i]=Math.round(Math.sqrt(stdev[i])*10000)/10000;}
    const rmsMean=frameRms.reduce((sum,value)=>sum+value,0)/frameRms.length;
    const rmsVariance=frameRms.reduce((sum,value)=>sum+(value-rmsMean)*(value-rmsMean),0)/frameRms.length;
    const round=value=>Math.round(value*10000)/10000,transitions=Math.max(1,count-1);
    return {mean,stdev,frames:count,sampleRate:targetRate,frameSize,nMels,nMfcc,
      spectralCentroid:round(centroidTotal/count),spectralFlatness:round(flatnessTotal/count),spectralRolloff:round(rolloffTotal/count),
      spectralBandwidth:round(bandwidthTotal/count),zeroCrossingRate:round(zcrTotal/count),bassRatio:round(bassTotal/count),midRatio:round(midTotal/count),
      highRatio:round(highTotal/count),spectralFlux:round(fluxTotal/transitions),crestFactor:round(crestTotal/count),
      dynamicRangeDb:round(20*Math.log10(1+Math.sqrt(rmsVariance)/Math.max(1e-8,rmsMean))),mfccDelta:round(mfccDeltaTotal/transitions)};
  }
  const SPECTRUM_TEXT_GENRES=[
    {genre:"Rock",keywords:["beyond","光辉岁月","海阔天空","真的爱你","黄家驹","五月天","崔健","汪峰","黑豹乐队","郑钧","伍佰","queen","the beatles","rolling stones","guns n roses","oasis","coldplay","radiohead","bon jovi","pink floyd","led zeppelin","ac/dc","foo fighters","nirvana","linkin park","摇滚"]},
    {genre:"Metal",keywords:["metallica","iron maiden","black sabbath","slipknot","megadeth","metal","金属"]},
    {genre:"Classical",keywords:["mozart","bach","beethoven","chopin","vivaldi","tchaikovsky","symphony","concerto","sonata","交响","协奏曲","古典"]},
    {genre:"Jazz",keywords:["jazz","miles davis","john coltrane","ella fitzgerald","louis armstrong","爵士"]},
    {genre:"Electronic",keywords:["edm","techno","house","trance","dubstep","avicii","skrillex","alan walker","daft punk","电子","电音"]},
    {genre:"Hip-Hop",keywords:["hip hop","hip-hop","rap","eminem","kendrick lamar","drake","jay-z","说唱","嘻哈"]},
    {genre:"R&B/Soul",keywords:["r&b","rnb","soul","the weeknd","beyonce","alicia keys","灵魂乐"]},
    {genre:"Folk/Country",keywords:["folk","country","bluegrass","johnny cash","民谣","乡村"]},
    {genre:"Ambient",keywords:["ambient","chillout","lofi","lo-fi","brian eno","氛围","白噪音"]},
    {genre:"Soundtrack",keywords:["soundtrack","ost","film score","hans zimmer","久石让","原声","配乐"]},
    {genre:"Reggae",keywords:["reggae","bob marley","雷鬼"]},
    {genre:"Blues",keywords:["blues","b.b. king","muddy waters","蓝调"]},
    {genre:"Pop",keywords:["taylor swift","ariana grande","adele","bruno mars","ed sheeran","harry styles","陈奕迅","邓紫棋","周杰伦","林俊杰","张学友","王菲","流行"]}
  ];
  function triangular(value,center,width){return Math.max(0,1-Math.abs(value-center)/width);}
  function inferSpectrumProfile(track,features){
    const searchable=`${track.artist||""} ${track.title||""} ${track.name||""}`.normalize("NFKC").toLocaleLowerCase();
    const textMatch=SPECTRUM_TEXT_GENRES.find(rule=>rule.keywords.some(keyword=>searchable.includes(keyword)));
    const mfcc=features.mfcc||{},clamp=value=>Math.max(0,Math.min(1,value));
    const hasAcousticEvidence=Array.isArray(mfcc.mean)&&mfcc.mean.length>=13&&Number(mfcc.frames)>0&&Number.isFinite(Number(features.energy))&&Number.isFinite(Number(features.bpm));
    const centroid=Number(mfcc.spectralCentroid)||0,flatness=clamp((Number(mfcc.spectralFlatness)||0)/.22),rolloff=Number(mfcc.spectralRolloff)||0;
    const bandwidth=Number(mfcc.spectralBandwidth)||0,zcr=clamp((Number(mfcc.zeroCrossingRate)||0)/.22),bass=Number(mfcc.bassRatio)||0,mid=Number(mfcc.midRatio)||0,high=Number(mfcc.highRatio)||0;
    const flux=clamp((Number(mfcc.spectralFlux)||0)/.75),dynamic=clamp((Number(mfcc.dynamicRangeDb)||0)/8),mfccDelta=clamp((Number(mfcc.mfccDelta)||0)/10);
    const energy=clamp((Number(features.energy)||0)/100),bpm=Number(features.bpm)||0,rhythm=clamp((Number(features.bpmConfidence)||0)/100),loudness=clamp(((Number(features.loudnessDb??features.energyDb)||-42)+42)/34);
    const scores={Pop:0,Rock:0,Metal:0,Electronic:0,"Hip-Hop":0,"R&B/Soul":0,Jazz:0,Classical:0,Ambient:0,"Folk/Country":0,Soundtrack:0,Reggae:0,Blues:0,Mixed:.35};
    const add=(genre,value)=>{scores[genre]=(scores[genre]||0)+Math.max(0,value);};
    add("Rock",1.3*energy+.8*loudness+.75*mid+.65*flux+.45*zcr+.55*triangular(bpm,125,65));
    add("Metal",1.0*energy+.65*loudness+1.35*high+1.15*zcr+1.0*flatness+.45*triangular(bpm,145,70));
    add("Electronic",1.25*energy+1.05*rhythm+.85*triangular(bpm,128,32)+.55*bass+.5*high+.45*(1-dynamic));
    add("Hip-Hop",.9*energy+1.15*bass+.9*triangular(bpm,90,30)+.7*flux+.35*(1-centroid));
    add("R&B/Soul",.75*energy+1.0*bass+.9*triangular(bpm,92,28)+.6*(1-flatness)+.45*(1-high));
    add("Jazz",.65*(1-Math.abs(energy-.48))+.9*dynamic+.75*(1-flatness)+.6*mfccDelta+.45*triangular(bpm,112,55));
    add("Classical",1.5*dynamic+1.1*(1-flatness)+.8*(1-rhythm)+.7*bandwidth+.55*(1-loudness));
    add("Ambient",1.4*(1-energy)+1.05*(1-rhythm)+.9*(1-flux)+.7*(1-zcr)+.5*(1-rolloff)+.8*(1-dynamic));
    add("Folk/Country",.8*triangular(bpm,105,45)+.75*(1-flatness)+.65*mid+.45*dynamic+.35*(1-high));
    add("Soundtrack",.95*dynamic+.8*(1-rhythm)+.65*bandwidth+.5*(1-flatness)+.4*(1-Math.abs(energy-.5)));
    add("Reggae",1.05*bass+1.0*triangular(bpm,88,24)+.6*rhythm+.45*(1-high));
    add("Blues",.85*mid+.75*triangular(bpm,100,45)+.7*dynamic+.55*(1-flatness));
    add("Pop",.75*triangular(bpm,116,38)+.65*(1-Math.abs(energy-.62))+.55*rhythm+.5*(1-Math.abs(centroid-.24)/.24)+.35*(1-flatness));
    if(textMatch)add(textMatch.genre,5.5);
    const ranked=Object.entries(scores).sort((a,b)=>b[1]-a[1]),top=ranked[0],second=ranked[1],margin=top[1]-second[1];
    const genre=!hasAcousticEvidence||top[1]<1.15?"Mixed":top[0],secondary=genre!=="Mixed"&&margin<.42&&second[0]!=="Mixed"?second[0]:null;
    const confidence=Math.round(Math.min(.96,.38+margin/Math.max(1,top[1])*.36+(textMatch?.genre===genre?.25:0))*100)/100;
    const tone=centroid>=.31?"bright":centroid<=.14?"deep":"warm";
    let motion="balanced";
    if(genre==="Rock"||genre==="Metal"||(genre==="Electronic"&&energy>.55))motion=energy>.38?"driving":"dynamic";
    else if(energy>.74&&flux>.35)motion="intense";
    else if(bass>.42&&flux>.25)motion="punchy";
    else if(dynamic>.48||mfccDelta>.45)motion="dynamic";
    else if(energy<.28&&flux<.25)motion="calm";
    else if(flatness<.2&&high<.16)motion="smooth";
    return {mfccSummary:{tone,motion},mood:motion,inferredGenre:genre,genreSecondary:secondary,
      genreScores:ranked.slice(0,3).map(([name,score])=>({name,score:Math.round(score*100)/100})),genreConfidence:confidence,genreSource:"spectrum-inference"};
  }
  async function analyzeTrackSpectrum(track){
    if(!track?.file)throw new Error("Local audio file is required");
    const arrayBuffer=await track.file.arrayBuffer();
    const audioBuffer=await decodeAudioBuffer(arrayBuffer);
    const analysis=await buildSpectrumEnvelope(audioBuffer);
    const tempo=await detectBpmFromEnvelope(analysis.envelope,analysis.envelopeRate);
    const mfcc=await extractMfccFeatures(audioBuffer);
    const base={energy:analysis.energy,energyDb:analysis.energyDb,loudnessDb:analysis.energyDb,normalizationGainDb:Math.max(-7,Math.min(7,-18-analysis.energyDb)),normalizationVersion:1,bpm:tempo.bpm,bpmConfidence:tempo.confidence,mfcc,
      sampleRate:audioBuffer.sampleRate,channels:audioBuffer.numberOfChannels,peaks:analysis.peaks,spectrumVersion:GP_SPECTRUM_ALGORITHM_VERSION,spectrumStatus:"complete"};
    return Object.assign(base,inferSpectrumProfile(track,base));
  }
  function waitForSpectrumWorkSlot(){
    return new Promise(resolve=>{
      const waitUntilPlaybackIsIdle=()=>{
        if(importRunning){yieldToInputPriority().then(resolve);return;}
        if(isPlaying||wantsPlayback){setTimeout(waitUntilPlaybackIsIdle,700);return;}
        if(performance.now()-gpLastUserInteractionAt<GP_BACKGROUND_IDLE_WINDOW){setTimeout(waitUntilPlaybackIsIdle,500);return;}
        if(performance.now()<spectrumResumeAfter){setTimeout(waitUntilPlaybackIsIdle,Math.min(700,Math.max(80,spectrumResumeAfter-performance.now())));return;}
        const ready=()=>yieldToInputPriority().then(resolve);
        if("requestIdleCallback" in window)window.requestIdleCallback(ready,{timeout:400});
        else setTimeout(ready,32);
      };
      waitUntilPlaybackIsIdle();
    });
  }
  function queueSpectrumAnalysis(tracks,options={}){
    const foreground=options.foreground===true,onProgress=typeof options.onProgress==="function"?options.onProgress:null;
    const eligible=tracks.filter(track=>track?.contentKey&&track.spectrumStatus!=="complete"&&!spectrumQueuedKeys.has(track.contentKey));
    let completed=0;
    eligible.forEach(track=>{
      spectrumQueuedKeys.add(track.contentKey);track.spectrumStatus="queued";GP.performance.spectrum.queued++;
      spectrumAnalysisQueue=spectrumAnalysisQueue.then(async()=>{
        if(!foreground)await waitForSpectrumWorkSlot();else await yieldImportFrame();
        track.spectrumStatus="analyzing";if(playlist[currentIndex]===track)updateTrackInfoCard(track);
        try{
          const result=await GPAnalyzer.analyze(track);
          applySpectrumRecordToTrack(track,result);
          if(playlist[currentIndex]===track&&audioCtx)applyCurrentTrackNormalization();
          await GPAnalyzer.saveSpectrum(track,result);
          await persistCompleteTrackSnapshot(track);
          GP.performance.spectrum.completed++;
        }catch(error){track.spectrumStatus="failed";GP.performance.spectrum.failed++;}
        finally{
          spectrumQueuedKeys.delete(track.contentKey);completed++;if(onProgress)onProgress(completed,eligible.length,track);
          if(playlist[currentIndex]===track)updateTrackInfoCard(track);
        }
      });
    });
    const completedBatch=spectrumAnalysisQueue;
    if(!foreground)completedBatch.then(()=>{if(completedBatch===spectrumAnalysisQueue)scheduleDailyMixRefresh(40);});
    return completedBatch;
  }
  function trackFromCache(file,contentKey,url,record,recognition=null){
    const parsed=parseName(file.name),metadata=record?.metadata||{};
    const cachedArtist=cleanMetadataText(metadata.artist),cachedTitle=cleanMetadataText(metadata.title);
    const cachedAlbum=cleanMetadataText(metadata.album),cachedDate=cleanMetadataText(metadata.date),cachedGenre=cleanMetadataText(metadata.genre);
    const coverBlob=record?.coverBlob instanceof Blob?record.coverBlob:null;
    const thumbBlob=record?.thumbBlob instanceof Blob?record.thumbBlob:null;
    return {
      id:idCounter++,name:file.name,artist:cachedArtist||parsed.artist,title:cachedTitle||parsed.title,album:cachedAlbum||null,date:cachedDate||null,url,
      duration:Number(metadata.duration)||0,file,sourceKey:songIdentity(cachedArtist||parsed.artist,cachedTitle||parsed.title),contentKey,
      spectrumId:recognition?.spectrumId||record?.spectrumId||recognition?.audioEssenceKey||record?.audioEssenceKey||contentKey,
      audioEssenceKey:recognition?.audioEssenceKey||record?.audioEssenceKey||contentKey,recognition:recognition||record?.recognition||null,
      identityLinks:record?.identityLinks||null,
      legacyContentKeys:Array.isArray(record?.legacyContentKeys)?record.legacyContentKeys.slice():[],
      coverUrl:coverBlob?URL.createObjectURL(coverBlob):null,thumbUrl:(thumbBlob||coverBlob)?URL.createObjectURL(thumbBlob||coverBlob):null,
      genre:cachedGenre||null,genreSource:metadata.genreSource||(cachedGenre?"metadata":null),format:audioFormatFromName(file.name),fileSize:file.size,mimeType:file.type||"",fileLastModified:file.lastModified||0,
      relativePath:file.webkitRelativePath||"",bitrateKbps:estimateTrackBitrate(file.size,metadata.duration),sampleRate:null,channels:null,
      peaks:null,energy:null,energyDb:null,loudnessDb:null,bpm:null,bpmConfidence:null,mfcc:null,mfccSummary:null,mood:null,inferredGenre:null,genreSecondary:null,genreScores:null,genreConfidence:null,spectrumStatus:null,spectrumVersion:null,cacheHit:true
    };
  }
  async function buildAndCacheTrack(file,contentKey,stats,knownCache,recognition){
    const url=URL.createObjectURL(file);
    try{
      let cached=knownCache||null;
      if(!cached){try{cached=await GPDatabase.getTrackCache(contentKey);}catch(error){stats.storageErrors++;}}
      if(cached?.metadata){
        stats.cacheHits++;
        const track=await restoreSpectrumRecord(trackFromCache(file,contentKey,url,cached,recognition),stats,cached);
        const surfaceChanged=cached.fileName!==file.name||Number(cached.fileSize)!==Number(file.size)||Number(cached.fileLastModified)!==Number(file.lastModified||0)||String(cached.relativePath||"")!==String(file.webkitRelativePath||"");
        if(surfaceChanged)await rescanTrackMetadata(track);
        return track;
      }
      stats.cacheMisses++;
      const parsed=parseName(file.name);
      // 7.3.2: duration probe, cover read and metadata parse are independent —
      // run them concurrently instead of serially (rescan already does this).
      const [duration,coverTempUrl,embeddedMetadata]=await Promise.all([
        probeTrackDuration(url),extractEmbeddedCover(file),extractFileMetadata(file)
      ]);
      const coverBlob=await coverURLToBlob(coverTempUrl);
      const title=embeddedMetadata.title||parsed.title,artist=embeddedMetadata.artist||parsed.artist,genre=embeddedMetadata.genre||null;
      const thumbBlob=await createCoverThumbnailBlob(coverBlob);
      const record={
        contentKey,spectrumId:recognition?.spectrumId||contentKey,audioEssenceKey:recognition?.audioEssenceKey||contentKey,recognition:recognition||null,
        identityLinks:{spectrumId:recognition?.spectrumId||contentKey,canonicalArtistId:null,artistAliases:[artist].filter(Boolean),titleAliases:[title].filter(Boolean),genreIds:[genre].filter(Boolean)},legacyContentKeys:[],
        cacheSchemaVersion:GP_TRACK_CACHE_SCHEMA_VERSION,fileName:file.name,fileSize:file.size,
        fileLastModified:file.lastModified||0,fileType:file.type||"",relativePath:file.webkitRelativePath||"",fileIdentity:fileCacheIdentity(file),
        metadata:{name:file.name,title,artist,album:embeddedMetadata.album||null,date:embeddedMetadata.date||null,duration,genre,genreSource:genre?"metadata":null},
        technical:{format:audioFormatFromName(file.name),fileSize:file.size,mimeType:file.type||"",lastModified:file.lastModified||0,
          relativePath:file.webkitRelativePath||"",duration,bitrateKbps:estimateTrackBitrate(file.size,duration),sampleRate:null,channels:null},
        analysis:{energy:null,energyDb:null,loudnessDb:null,bpm:null,bpmConfidence:null,sampleRate:null,channels:null,peaks:null,mfcc:null,mfccSummary:null,mood:null,inferredGenre:null,genreSecondary:null,genreScores:null,genreConfidence:null,genreSource:null,spectrumVersion:null,spectrumStatus:null},
        informationComplete:false,coverBlob:coverBlob||null,thumbBlob:thumbBlob||null,cachedAt:Date.now(),updatedAt:Date.now()
      };
      try{await GPDatabase.addTrackCache(record);stats.cacheWrites++;}
      catch(error){
        if(error?.name!=="ConstraintError")stats.storageErrors++;
      }
      return restoreSpectrumRecord(trackFromCache(file,contentKey,url,record,recognition),stats,record);
    }catch(error){
      stats.parseErrors++;
      const parsed=parseName(file.name);
      return restoreSpectrumRecord({id:idCounter++,name:file.name,artist:parsed.artist,title:parsed.title,url,duration:0,file,sourceKey:songIdentity(parsed.artist,parsed.title),contentKey,
        spectrumId:recognition?.spectrumId||contentKey,audioEssenceKey:recognition?.audioEssenceKey||contentKey,recognition:recognition||null,
        identityLinks:{spectrumId:recognition?.spectrumId||contentKey,canonicalArtistId:null,artistAliases:[parsed.artist].filter(Boolean),titleAliases:[parsed.title].filter(Boolean),genreIds:[]},legacyContentKeys:[],coverUrl:null,thumbUrl:null,genre:null,genreSource:null,
        format:audioFormatFromName(file.name),fileSize:file.size,mimeType:file.type||"",fileLastModified:file.lastModified||0,relativePath:file.webkitRelativePath||"",bitrateKbps:null,
        sampleRate:null,channels:null,peaks:null,energy:null,energyDb:null,loudnessDb:null,bpm:null,bpmConfidence:null,mfcc:null,mfccSummary:null,mood:null,inferredGenre:null,
        genreSecondary:null,genreScores:null,genreConfidence:null,spectrumStatus:null,spectrumVersion:null,cacheHit:false},stats);
    }
  }
  let importRunning=false,importCompletionTimer=0,pendingPostImportTracks=[],pendingImportHistorySync=false,importSpinnerAnimation=null;
  function startImportSpinner(){
    const icon=$("#rescanModal .scan-cycle-icon");if(!icon)return;
    importSpinnerAnimation?.cancel();icon.style.willChange="transform";
    importSpinnerAnimation=icon.animate([
      {transform:"translate3d(0,0,0) rotate(0deg)"},
      {transform:"translate3d(0,0,0) rotate(360deg)"}
    ],{duration:1350,iterations:Infinity,easing:"linear"});
  }
  function stopImportSpinner(){
    importSpinnerAnimation?.cancel();importSpinnerAnimation=null;
    const icon=$("#rescanModal .scan-cycle-icon");if(icon){icon.style.removeProperty("will-change");icon.style.removeProperty("transform");}
  }
  function releaseImportBackgroundWork(){
    pendingPostImportTracks.length=0;pendingImportHistorySync=false;
  }
  function openImportProgress(total){
    clearTimeout(importCompletionTimer);
    closeAllMotionPopovers();
    importRunning=true;rescanModalMode="importRunning";
    $("#rescanModal").classList.add("is-scanning");
    $("#rescanModalTitle").textContent=tr("正在导入音乐","Importing Music");
    $("#rescanModalMessage").textContent=tr(`正在准备识别 ${total} 首歌曲…`,`Preparing to identify ${total} songs…`);
    $("#rescanProgress").classList.add("show");$("#rescanProgressFill").style.width="0%";
    $("#rescanCancelBtn").style.display="none";
    $("#rescanConfirmBtn").disabled=true;$("#rescanConfirmBtn").textContent=tr("导入中…","Importing…");
    $("#rescanModal").classList.add("show");
    startImportSpinner();
  }
  let importProgressFrame=0,importProgressState=null;
  function paintImportProgress(){
    importProgressFrame=0;const state=importProgressState;if(!state)return;
    $("#rescanProgressFill").style.width=`${state.safe}%`;
    $("#rescanModalMessage").textContent=state.phase==="identity"
      ?tr(`正在识别歌曲身份 ${state.completed} / ${state.total}…`,`Identifying songs ${state.completed} / ${state.total}…`)
      :tr(`正在恢复或读取歌曲信息 ${state.completed} / ${state.total}…`,`Restoring or reading song data ${state.completed} / ${state.total}…`);
  }
  function updateImportProgress(percent,completed,total,phase){
    importProgressState={safe:Math.max(0,Math.min(100,percent)),completed,total,phase};
    if(!importProgressFrame)importProgressFrame=requestAnimationFrame(paintImportProgress);
  }
  const yieldImportFrame=()=>yieldToInputPriority();
  function updateImportCommitProgress(percent,phase){
    $("#rescanProgressFill").style.width=`${percent}%`;
    $("#rescanModalMessage").textContent=phase==="render"
      ?tr("正在更新歌单与界面…","Updating library and interface…")
      :phase==="analysis"
        ?tr("正在完成音频特征分析…","Completing audio feature analysis…")
        :phase==="neural"
          ?tr("正在更新 Resonance Boost 用户模型…","Updating the Resonance Boost user model…")
          :phase==="recommendation"
            ?tr("正在生成并保存每日推荐…","Generating and saving Daily Mix…")
        :phase==="organize"
          ?tr("正在整理历史、推荐与背景…","Finalizing history, recommendations and background…")
          :tr("正在安全保存导入结果…","Saving imported songs…");
  }
  function finishImportProgress(stats,error=null){
    if(importProgressFrame)cancelAnimationFrame(importProgressFrame);importProgressFrame=0;importProgressState=null;
    importRunning=false;rescanModalMode=error?"importError":"importDone";
    stopImportSpinner();
    $("#rescanModal").classList.remove("is-scanning");
    $("#rescanProgressFill").style.width="100%";
    $("#rescanModalTitle").textContent=error?tr("导入未完成","Import Incomplete"):tr("导入完成","Import Complete");
    $("#rescanModalMessage").textContent=error
      ?tr("导入过程中出现错误；已经成功加入的歌曲会保留。","An error interrupted the import. Songs already added remain available.")
      :tr(`已处理 ${stats?.files||0} 首歌曲，缓存命中 ${stats?.cacheHits||0} 首，新增 ${stats?.cacheMisses||0} 首${stats?.duplicates?`，跳过重复 ${stats.duplicates} 首`:""}。`,`Processed ${stats?.files||0} songs, restored ${stats?.cacheHits||0} from cache, added ${stats?.cacheMisses||0}${stats?.duplicates?`, and skipped ${stats.duplicates} duplicates`:""}.`);
    $("#rescanConfirmBtn").disabled=false;$("#rescanConfirmBtn").textContent=tr("完成","Done");
  }
  async function settleImportProgress(stats,error=null){
    $("#rescanProgressFill").style.width="100%";
    $("#rescanModalMessage").textContent=error
      ?tr("正在保留已完成的导入结果…","Preserving completed import results…")
      :tr("所有初始化已经完成…","All initialization is complete…");
    await yieldToInputPriority();await new Promise(resolve=>{
      // 7.3.2: close on paint commit instead of a fixed 240 ms wait.
      if(!document.hidden&&typeof requestAnimationFrame==="function")requestAnimationFrame(()=>requestAnimationFrame(resolve));
      else resolve();
    });
    finishImportProgress(stats,error);
  }
  const libraryOrderCollator=new Intl.Collator(["zh-CN","en"],{numeric:true,sensitivity:"base"});
  function libraryOrderKey(track){return String(track?.file?.webkitRelativePath||track?.file?.name||track?.name||`${track?.artist||""} - ${track?.title||""}`);}
  function insertImportedTracksInLibrary(tracks){
    const currentId=playlist[currentIndex]?.id||null;
    const overrideIds=overrideQueue?.map(index=>playlist[index]?.id).filter(Boolean)||null;
    playlist.push(...tracks);
    playlist.sort((a,b)=>libraryOrderCollator.compare(libraryOrderKey(a),libraryOrderKey(b))||String(a.id).localeCompare(String(b.id)));
    if(currentId)currentIndex=playlist.findIndex(track=>track.id===currentId);
    if(overrideIds)overrideQueue=overrideIds.map(id=>playlist.findIndex(track=>track.id===id)).filter(index=>index>=0);
    if(overrideQueue&&!overrideQueue.length)overrideQueue=null;
    if(playMode==="shuffle"&&currentIndex>=0){shuffleTimeline=[currentIndex];shuffleTimelineCursor=0;}
  }
  async function addFiles(fileList){
    const all = Array.from(fileList);
    const audioFiles = all.filter(f => f.type.startsWith("audio/") || /\.(mp3|wav|m4a|flac|ogg|aac|wma)$/i.test(f.name));
    if(audioFiles.length === 0) return;
    if(importRunning||metadataRescanRunning)return;
    openImportProgress(audioFiles.length);

    const renderStart=libraryRenderCommits;
    const startedAt=performance.now();
    const stats={files:audioFiles.length,cacheHits:0,cacheMisses:0,cacheWrites:0,featureCacheHits:0,duplicates:0,storageErrors:0,parseErrors:0,
      identityMigrations:0,essenceMatches:0,flacMd5Matches:0,anchorFallbackMatches:0,unreliableIdentities:0,renderCommits:0,durationMs:0};
    playlist.forEach(track=>{reservedSongIdentities.add(songIdentity(track.artist,track.title));if(track.contentKey)reservedAudioFingerprints.add(track.contentKey);});
    const uniqueFiles=[];
    const duplicates=[];
    let identityCompleted=0;
    const candidates=await mapWithConcurrency(audioFiles,5,async file=>{
      const recognition=await recognizeAudioEssence(file);if(!recognition.reliable)stats.unreliableIdentities++;
      let cachedRecord=null,match=null;
      try{match=await resolveTrackCacheByRecognition(recognition);}catch(error){stats.storageErrors++;}
      if(match){
        recognition.identityConfidence=match.identityConfidence||recognition.identityConfidence;
        cachedRecord=recognitionCacheIsCurrent(match.record,recognition)?match.record:await stampRecognitionCache(match.record,recognition,match.matchedBy).catch(()=>match.record);
        if(match.matchedBy==="flacPcmMd5")stats.flacMd5Matches++;
        else if(match.matchedBy.startsWith("anchors:"))stats.anchorFallbackMatches++;
        else stats.essenceMatches++;
      }else{
        let legacyRecord=null;
        try{legacyRecord=await GPDatabase.getTrackCacheByFileIdentity(fileCacheIdentity(file));}catch(error){stats.storageErrors++;}
        if(legacyRecord)cachedRecord=await migrateLegacyRecognitionCache(legacyRecord,recognition,stats).catch(()=>legacyRecord);
      }
      const candidate={file,contentKey:recognition.audioEssenceKey,cachedRecord,recognition};
      identityCompleted++;updateImportProgress(identityCompleted/audioFiles.length*35,identityCompleted,audioFiles.length,"identity");
      return candidate;
    });
    candidates.forEach(({file,contentKey,cachedRecord,recognition})=>{
      const parsed=parseName(file.name);
      const key=songIdentity(parsed.artist,parsed.title);
      if(reservedSongIdentities.has(key)||reservedAudioFingerprints.has(contentKey)){duplicates.push(file);return;}
      reservedSongIdentities.add(key);reservedAudioFingerprints.add(contentKey);uniqueFiles.push({file,contentKey,cachedRecord,recognition});
    });
    if(duplicates.length){
      stats.duplicates=duplicates.length;
      const firstTitle=parseName(duplicates[0].name).title;
      showToast(duplicates.length===1?tr(`「${firstTitle}」已经在歌单中`,`“${firstTitle}” is already in the library`):tr(`${duplicates.length} 首歌曲已经在歌单中，未重复添加`,`${duplicates.length} songs were already in the library and were skipped`));
    }
    if(uniqueFiles.length===0){updateImportCommitProgress(99,"organize");await yieldImportFrame();await settleImportProgress(stats);return;}

    let dataCompleted=0;
    const tracks=await mapWithConcurrency(uniqueFiles,6,async ({file,contentKey,cachedRecord,recognition})=>{
      const track=await buildAndCacheTrack(file,contentKey,stats,cachedRecord,recognition);
      dataCompleted++;updateImportProgress(35+dataCompleted/uniqueFiles.length*55,dataCompleted,uniqueFiles.length,"data");
      return track;
    });
    updateImportCommitProgress(92,"render");await yieldImportFrame();
    await mapWithConcurrency(tracks,4,preloadTrackArtwork);
    updateImportCommitProgress(93,"commit");await yieldImportFrame();
    insertImportedTracksInLibrary(tracks);
    tracks.forEach(track=>{reservedSongIdentities.add(songIdentity(track.artist,track.title));reservedAudioFingerprints.add(track.contentKey);});
    invalidateHistoryTrackIndex();pendingImportHistorySync=true;
    updateImportCommitProgress(97,"render");await yieldImportFrame();
    await renderLibraryIncrementally(searchInputSafe());
    if(currentIndex===-1&&playlist.length>0){
      const startIndex=playMode==="shuffle"?Math.floor(Math.random()*playlist.length):0;
      loadTrack(startIndex,false);
    }
    await renderMiniQueue({instantPosition:true,incremental:true});
    updateImportCommitProgress(98,"organize");await yieldImportFrame();
    syncHistoryMetadataForPlaylist();persistHistoryStoreNow();
    updateImportCommitProgress(99,"neural");await yieldImportFrame();
    await refreshUserModel();
    updateImportCommitProgress(99.5,"recommendation");await yieldImportFrame();
    await finalizeDailyMixForImport();
    await Promise.all([updateAmbient(),applyAdaptiveAccent()]);
    if(playlist[currentIndex])updateTrackInfoCard(playlist[currentIndex]);
    stats.renderCommits=libraryRenderCommits-renderStart;
    stats.durationMs=Math.round(performance.now()-startedAt);
    GP.performance.lastImport=Object.freeze({...stats});
    pendingPostImportTracks.length=0;pendingImportHistorySync=false;
    await settleImportProgress(stats);
    sweepRetiredArtworkUrls();
    // 7.3.2 aggressive: the dialog is already closed here; heavy spectrum
    // decoding continues in the background slot and refreshes Daily Mix when
    // done, so large imports no longer block the modal.
    queueSpectrumAnalysis(tracks,{foreground:false});
  }

  let metadataRescanRunning=false;
  const retiredArtworkUrls=new Set();
  const MAX_RETIRED_ARTWORK_URLS=256;
  const MAX_ARTWORK_SWEEP_RETRIES=12;
  let artworkSweepTimer=0,artworkSweepRetries=0;

  function clearArtworkSweepTimer(){
    if(artworkSweepTimer){clearTimeout(artworkSweepTimer);artworkSweepTimer=0;}
  }

  function isArtworkUrlReferenced(url){
    if(!url||typeof url!=="string")return false;
    if(Array.isArray(playlist)){
      for(let i=0;i<playlist.length;i++){
        const t=playlist[i];
        if(t&&(t.coverUrl===url||t.thumbUrl===url))return true;
      }
    }
    try{
      if(typeof artTransitionCopies!=="undefined"&&Array.isArray(artTransitionCopies)){
        for(let i=0;i<artTransitionCopies.length;i++){
          const node=artTransitionCopies[i];
          if(node&&(node.src===url||node.getAttribute?.("src")===url||node.currentSrc===url))return true;
        }
      }
    }catch(error){}
    if(typeof document!=="undefined"&&document.querySelectorAll){
      try{
        const nodes=document.querySelectorAll("img, image, video");
        for(let i=0;i<nodes.length;i++){
          const node=nodes[i];
          if(node&&(node.src===url||node.getAttribute?.("src")===url||node.currentSrc===url))return true;
        }
      }catch(error){}
    }
    try{
      if(typeof gpVideoPipCoverSource!=="undefined"&&gpVideoPipCoverSource===url)return true;
    }catch(error){}
    return false;
  }

  function enforceRetiredArtworkBounds(forceOldest=false){
    if(!retiredArtworkUrls.size)return;
    for(const url of Array.from(retiredArtworkUrls)){
      if(!isArtworkUrlReferenced(url)){
        retiredArtworkUrls.delete(url);
        try{URL.revokeObjectURL(url);}catch(error){}
      }
    }
    while(retiredArtworkUrls.size>(forceOldest?0:MAX_RETIRED_ARTWORK_URLS)){
      let oldest=null;
      for(const url of retiredArtworkUrls){
        if(!isArtworkUrlReferenced(url)){oldest=url;break;}
      }
      if(!oldest)break;
      retiredArtworkUrls.delete(oldest);
      try{URL.revokeObjectURL(oldest);}catch(error){}
    }
  }

  function sweepRetiredArtworkUrls(){
    clearArtworkSweepTimer();
    if(!retiredArtworkUrls.size){artworkSweepRetries=0;return;}
    for(const url of Array.from(retiredArtworkUrls)){
      if(!isArtworkUrlReferenced(url)){
        retiredArtworkUrls.delete(url);
        try{URL.revokeObjectURL(url);}catch(error){}
      }
    }
    if(retiredArtworkUrls.size>0){
      scheduleArtworkSweep();
    }else{
      artworkSweepRetries=0;
    }
  }

  function scheduleArtworkSweep(){
    if(artworkSweepTimer)return;
    if(!retiredArtworkUrls.size){artworkSweepRetries=0;return;}
    if(artworkSweepRetries>=MAX_ARTWORK_SWEEP_RETRIES){
      artworkSweepRetries=0;
      enforceRetiredArtworkBounds(true);
      return;
    }
    artworkSweepRetries++;
    artworkSweepTimer=setTimeout(()=>{
      artworkSweepTimer=0;
      sweepRetiredArtworkUrls();
    },240);
  }

  function retireArtworkUrl(url){
    if(typeof url!=="string"||!url.startsWith("blob:"))return;
    if(!isArtworkUrlReferenced(url)){
      try{URL.revokeObjectURL(url);}catch(error){}
      return;
    }
    retiredArtworkUrls.add(url);
    enforceRetiredArtworkBounds();
    scheduleArtworkSweep();
  }

  function replaceTrackArtwork(track,coverBlob,thumbBlob){
    if(!track)return;
    const oldUrls=new Set([track.coverUrl,track.thumbUrl].filter(url=>typeof url==="string"&&url.startsWith("blob:")));
    const nextCoverUrl=coverBlob?URL.createObjectURL(coverBlob):null;
    const nextThumbUrl=(thumbBlob||coverBlob)?URL.createObjectURL(thumbBlob||coverBlob):null;
    track.coverUrl=nextCoverUrl;
    track.thumbUrl=nextThumbUrl;
    oldUrls.forEach(url=>{
      if(url!==nextCoverUrl&&url!==nextThumbUrl){
        retireArtworkUrl(url);
      }
    });
  }
  function metadataVersionSnapshot(metadata,fileInfo={},capturedAt=Date.now()){
    const value=metadata||{};
    return {capturedAt,fileName:fileInfo.fileName||value.name||"",fileIdentity:fileInfo.fileIdentity||null,
      metadata:{name:value.name||"",title:value.title||"",artist:value.artist||"",album:value.album||null,date:value.date||null,genre:value.genre||null,genreSource:value.genreSource||null,duration:Number(value.duration)||0}};
  }
  async function rescanTrackMetadata(track){
    if(!track?.file||!track.contentKey)throw new Error("Local file is unavailable");
    if(typeof bindHistoryIdentityBeforeMetadataChange==="function")bindHistoryIdentityBeforeMetadataChange(track);
    const file=track.file,parsed=parseName(file.name),previous=await GPDatabase.getTrackCache(track.contentKey).catch(()=>null);
    const [embeddedMetadata,duration,coverTempUrl]=await Promise.all([
      extractFileMetadata(file),probeTrackDuration(track.url),extractEmbeddedCover(file)
    ]);
    const rescannedCoverBlob=await coverURLToBlob(coverTempUrl),coverBlob=rescannedCoverBlob||previous?.coverBlob||null;
    const thumbBlob=rescannedCoverBlob?(await createCoverThumbnailBlob(rescannedCoverBlob)):previous?.thumbBlob||coverBlob;
    const title=embeddedMetadata.title||parsed.title,artist=embeddedMetadata.artist||parsed.artist,genre=embeddedMetadata.genre||null;
    const beforeVersion=metadataVersionSnapshot(previous?.metadata||{name:track.name,title:track.title,artist:track.artist,album:track.album,date:track.date,genre:track.genre,duration:track.duration},
      {fileName:previous?.fileName||track.name,fileIdentity:previous?.fileIdentity||fileCacheIdentity(file)});
    const before=JSON.stringify({title:track.title,artist:track.artist,album:track.album||null,date:track.date||null,genre:track.genreSource==="metadata"?track.genre:null,duration:Math.round((track.duration||0)*1000)});
    track.name=file.name;track.title=title;track.artist=artist;track.album=embeddedMetadata.album||null;track.date=embeddedMetadata.date||null;
    track.duration=Number(duration)||Number(previous?.metadata?.duration)||track.duration||0;
    track.genre=genre;track.genreSource=genre?"metadata":null;
    if(!genre&&track.inferredGenre){track.genre=track.inferredGenre;track.genreSource="spectrum-inference";}
    track.sourceKey=songIdentity(artist,title);track.fileSize=file.size;track.fileLastModified=file.lastModified||0;track.mimeType=file.type||"";
    track.relativePath=file.webkitRelativePath||track.relativePath||"";track.format=audioFormatFromName(file.name);track.bitrateKbps=estimateTrackBitrate(file.size,track.duration);
    replaceTrackArtwork(track,coverBlob,thumbBlob);
    const base=previous||createPersistentTrackSnapshot(track,null),spectrumId=track.spectrumId||track.audioEssenceKey||track.contentKey;
    const aliases=Array.from(new Set([...(base.identityLinks?.artistAliases||[]),beforeVersion.metadata.artist,artist].filter(Boolean)));
    const titleAliases=Array.from(new Set([...(base.identityLinks?.titleAliases||[]),beforeVersion.metadata.title,title].filter(Boolean)));
    const afterMetadata={name:file.name,title,artist,album:embeddedMetadata.album||null,date:embeddedMetadata.date||null,duration:track.duration,genre,genreSource:genre?"metadata":null};
    const metadataVersions={before:beforeVersion,after:metadataVersionSnapshot(afterMetadata,{fileName:file.name,fileIdentity:fileCacheIdentity(file)})};
    const record=Object.assign({},base,{
      contentKey:track.contentKey,spectrumId,audioEssenceKey:track.audioEssenceKey||spectrumId,
      fileName:file.name,fileSize:file.size,fileLastModified:file.lastModified||0,fileType:file.type||"",relativePath:file.webkitRelativePath||"",fileIdentity:fileCacheIdentity(file),
      identityLinks:Object.assign({spectrumId,canonicalArtistId:null,artistAliases:[],titleAliases:[],genreIds:[]},base.identityLinks||{},{spectrumId,artistAliases:aliases,titleAliases,genreIds:genre?[genre]:[]}),
      metadata:afterMetadata,metadataVersions,
      technical:Object.assign({},base.technical||{},{format:audioFormatFromName(file.name),fileSize:file.size,mimeType:file.type||"",lastModified:file.lastModified||0,relativePath:file.webkitRelativePath||"",duration:track.duration,bitrateKbps:estimateTrackBitrate(file.size,track.duration)}),
      coverBlob:coverBlob||null,thumbBlob:thumbBlob||null,metadataRescannedAt:Date.now(),updatedAt:Date.now()
    });
    await GPDatabase.saveTrackCache(record);
    track.identityLinks=record.identityLinks;track.metadataVersions=metadataVersions;
    const after=JSON.stringify({title,artist,album:embeddedMetadata.album||null,date:embeddedMetadata.date||null,genre,duration:Math.round(track.duration*1000)});
    return {changed:before!==after,genreFound:Boolean(genre)};
  }
  async function rescanImportedLibrary(onProgress){
    if(metadataRescanRunning)throw new Error("Metadata rescan already running");
    metadataRescanRunning=true;const startedAt=performance.now(),stats={total:playlist.length,scanned:0,changed:0,genreFound:0,failed:0,durationMs:0};
    try{
      await mapWithConcurrency(playlist.slice(),2,async track=>{
        try{const result=await rescanTrackMetadata(track);stats.scanned++;if(result.changed)stats.changed++;if(result.genreFound)stats.genreFound++;}
        catch(error){stats.failed++;}
        onProgress?.(stats.scanned+stats.failed,stats.total,stats);await yieldSpectrumTask();
      });
      reservedSongIdentities.clear();reservedAudioFingerprints.clear();
      playlist.forEach(track=>{reservedSongIdentities.add(songIdentity(track.artist,track.title));if(track.contentKey)reservedAudioFingerprints.add(track.contentKey);});
      invalidateHistoryTrackIndex();
      syncHistoryMetadataForPlaylist();
      render(searchInputSafe());renderMiniQueue();
      scheduleDailyMixRefresh(40);
      if(currentIndex>=0&&playlist[currentIndex]){
        const current=playlist[currentIndex];setNowPlayingTitle(current.title);$("#nowArtist").textContent=current.artist;
        updateTrackInfoCard(current);updateArtDisplay();updateAmbient();applyAdaptiveAccent();
      }
      sweepRetiredArtworkUrls();
      stats.durationMs=Math.round(performance.now()-startedAt);GP.performance.lastMetadataRescan=Object.freeze({...stats});return stats;
    }finally{
      metadataRescanRunning=false;
      scheduleArtworkSweep();
    }
  }

  /* ================= playback engine ================= */
  let listeningKey = null;
  let lastTimeMark = 0;
  let pauseCommitTimer=0,pauseEnvelopeToken=0;
  let nativeEndPauseTimer=0,nativeEndPauseToken=0,nativeEndPausePending=false;
  function clearNativeEndPause(){nativeEndPauseToken++;nativeEndPausePending=false;if(nativeEndPauseTimer){clearTimeout(nativeEndPauseTimer);nativeEndPauseTimer=0;}}
  function deferNativeEndPause(deck){
    clearNativeEndPause();nativeEndPausePending=true;const token=nativeEndPauseToken;
    nativeEndPauseTimer=setTimeout(()=>{
      if(token!==nativeEndPauseToken||deck!==audio)return;
      nativeEndPauseTimer=0;nativeEndPausePending=false;emitListeningCheckpoint("pause");
      if(!pendingPlayToken)wantsPlayback=false;setPlaybackVisualState(false);
    },32);
  }
  let trackDetailRevision=0,trackDetailHoldUntil=0;
  let firstPlaybackQueueAlignment=true;
  function ensureTrackMediaURL(track){
    if(track?.file&&(!track.url||!String(track.url).startsWith("blob:")))track.url=URL.createObjectURL(track.file);
    return track?.url||"";
  }
  function reserveTrackDetailWindow(duration=330){trackDetailHoldUntil=Math.max(trackDetailHoldUntil,performance.now()+duration);}

  function updateNowPlayingUI(t){
    transitionNowPlayingMeta(t.title,t.artist);
    syncNowFormatTag(t);
    seekProgress = 0; drawWaveform();
    $("#curTime").textContent = "0:00"; $("#durTime").textContent = t.duration ? fmtTime(t.duration) : "0:00";
    updateArtDisplay();syncCurrentTrackPlaybackIndicator();
    const revision=++trackDetailRevision,trackIndex=currentIndex;
    /* The first two frames belong exclusively to transport, title and artwork
       motion. Queue reconciliation, colour extraction, ambient raster work and
       auxiliary panels begin only after that compositor commit. */
    const commitDetails=()=>{
      if(revision!==trackDetailRevision||currentIndex!==trackIndex)return;
      updateAmbient();if(!importRunning)renderMiniQueue({instantPosition:false});applyAdaptiveAccent();
      updateTrackInfoCard(t);if(soundPanelActive)loadWaveformFor(t);
      if("mediaSession" in navigator&&typeof MediaMetadata!=="undefined"){
        try{navigator.mediaSession.metadata=new MediaMetadata({title:t.title||t.name||"Glass Player",artist:t.artist||"",album:t.album||"",artwork:t.coverUrl?[{src:t.coverUrl}]:[]});}catch(error){}
      }
      if(typeof syncTraditionalPiP==="function")syncTraditionalPiP(true);
    };
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const remaining=trackDetailHoldUntil-performance.now();
      if(remaining>0)setTimeout(commitDetails,remaining);else commitDetails();
    }));
  }

  function loadTrack(idx, autoplay){
    if(!Number.isInteger(idx)||idx<0 || idx>=playlist.length) return;
    clearNativeEndPause();
    const doCrossfade = crossfadeEnabled && currentIndex !== -1 && autoplay !== false && isPlaying;
    if(doCrossfade){ crossfadeTo(idx); return; }
    const doClickSafeSwap=currentIndex!==-1&&autoplay!==false&&isPlaying;
    if(doClickSafeSwap){crossfadeTo(idx,.024);return;}

    flushHistory();
    if(crossfadeSwapTimer){ clearTimeout(crossfadeSwapTimer); crossfadeSwapTimer=null; }
    crossfading = false;
    decks.forEach(d => { if(d !== audio) d.pause(); });
    if(deckGains[activeIdx]){ deckGains[activeIdx].gain.cancelScheduledValues(audioCtx.currentTime); deckGains[activeIdx].gain.value = 1; }

    currentIndex = idx;
    if(autoplay===false)queueAlignOnNextPlayback=true;
    const t = playlist[idx];
    audio.src = ensureTrackMediaURL(t);
    if(audioCtx)applyDeckNormalization(activeIdx,t);
    lastTimeMark = 0;
    listeningKey = spectrumHistoryKey(t);
    beginBehaviorTrack(t,pendingSelectionSource);
    updateNowPlayingUI(t);
    if(autoplay !== false) playAudio(); else pauseAudio();
  }

  function crossfadeTo(idx,durationOverride=null){
    if(!Number.isInteger(idx)||idx<0||idx>=playlist.length)return;
    clearNativeEndPause();
    ensureAudioCtx();
    flushHistory();
    if(crossfadeSwapTimer){ clearTimeout(crossfadeSwapTimer); crossfadeSwapTimer=null; }
    const fromIdx = activeIdx, toIdx = 1-activeIdx;
    const standby = decks[toIdx];
    const t = playlist[idx];
    ensureTrackMediaURL(t);
    const now = audioCtx.currentTime, dur = Number.isFinite(durationOverride)?Math.max(.018,durationOverride):crossfadeSeconds;
    const gFrom = deckGains[fromIdx], gTo = deckGains[toIdx];
    gTo.gain.cancelScheduledValues(now);gTo.gain.setValueAtTime(0,now);
    standby.src = t.url;
    applyDeckNormalization(toIdx,t);
    standby.currentTime = 0;
    const transitionToken=++playbackIntentToken;wantsPlayback=true;pendingPlayToken=transitionToken;
    standby.play().then(()=>{
      if(pendingPlayToken===transitionToken)pendingPlayToken=0;
      if(transitionToken!==playbackIntentToken||!wantsPlayback){standby.pause();return;}
      /* The fade starts only after Edge has actually started the new decoder.
         Starting it at play() request time could finish a 24 ms ramp before
         the first FLAC PCM frame arrived, exposing that frame at full gain. */
      const fadeNow=audioCtx.currentTime;
      gFrom.gain.cancelScheduledValues(fadeNow);gFrom.gain.setValueAtTime(gFrom.gain.value,fadeNow);
      gTo.gain.cancelScheduledValues(fadeNow);gTo.gain.setValueAtTime(0,fadeNow);
      gFrom.gain.linearRampToValueAtTime(0,fadeNow+dur);gTo.gain.linearRampToValueAtTime(1,fadeNow+dur);
      crossfadeSwapTimer=setTimeout(()=>{
        oldDeck.pause();
        const settleNow=audioCtx.currentTime;gFrom.gain.cancelScheduledValues(settleNow);gFrom.gain.setValueAtTime(1,settleNow);
        crossfading=false;crossfadeSwapTimer=null;
      },dur*1000+60);
    }).catch(()=>{if(transitionToken===playbackIntentToken){pendingPlayToken=0;pauseAudio();}});

    crossfading = true;
    const oldDeck = decks[fromIdx];
    activeIdx = toIdx;
    audio = decks[activeIdx];
    currentIndex = idx;
    lastTimeMark = 0;
    listeningKey = spectrumHistoryKey(t);
    beginBehaviorTrack(t,pendingSelectionSource);
    wantsPlayback = true;
    updateNowPlayingUI(t);
    setPlaybackVisualState(true);

  }

  function maybeTriggerAutoCrossfade(){
    if(!wantsPlayback||!isPlaying||!crossfadeEnabled || crossfading || !audio.duration || sleepTimerMode === "end" || playMode === "repeatOne" || (playingQueuedTrack&&playQueue.length===0)) return;
    if(!playlist.length)return;
    const remaining = audio.duration - audio.currentTime;
    if(remaining <= crossfadeSeconds && audio.duration > crossfadeSeconds*1.5){
      let nextIdx = takeNextQueuedIndex();
      if(nextIdx!==null){beginQueuedPlayback();pendingSelectionSource="queue";}
      if(overrideQueue){
        if(nextIdx === null){
          const pos = overrideQueue.indexOf(currentIndex);
          nextIdx = (pos !== -1 && pos+1 < overrideQueue.length) ? overrideQueue[pos+1] : null;
          if(nextIdx!==null)pendingSelectionSource="recommendation";
          if(nextIdx === null) overrideQueue = null;
        }
      }
      if(nextIdx === null){pendingSelectionSource=playMode === "shuffle"?"shuffle":"sequential";nextIdx = playMode === "shuffle" ? nextShuffleIndex() : (currentIndex+1) % playlist.length;}
      recordComplete(playlist[currentIndex]);
      crossfadeTo(nextIdx);
    }
  }

  function playAt(idx,sourceOverride=null){
    const chosen=playlist[idx],query=searchInputSafe().trim(),source=sourceOverride||(query?"search_select":"manual_select");
    const eventType=sourceOverride==="queue"?"manual_select":sourceOverride?null:source;
    if(chosen&&eventType)recordBehaviorEvent(eventType,chosen,{query:query||null,surface:sourceOverride||"library"});
    if(chosen)pendingSelectionSource=source;
    if(currentIndex !== -1 && idx !== currentIndex) judgeAndRecordTransition("manual-selection");
    if(playMode === "shuffle" && idx !== currentIndex){
      if(shuffleTimelineCursor<0&&currentIndex>=0){shuffleTimeline=[currentIndex];shuffleTimelineCursor=0;}
      if(shuffleTimelineCursor<shuffleTimeline.length-1)shuffleTimeline.length=shuffleTimelineCursor+1;
      if(shuffleTimeline[shuffleTimeline.length-1]!==idx)shuffleTimeline.push(idx);
      if(shuffleTimeline.length>21)shuffleTimeline.splice(0,shuffleTimeline.length-21);
      shuffleTimelineCursor=shuffleTimeline.length-1;
    }
    if(overrideQueue && overrideQueue.indexOf(idx) === -1) overrideQueue = null;
    loadTrack(idx, true);
  }
  function setPlaybackVisualState(playing,forceRender=false){
    const next=!!playing,changed=isPlaying!==next;isPlaying=next;
    if("mediaSession" in navigator){try{navigator.mediaSession.playbackState=next?"playing":"paused";}catch(error){}}
    /* A later native pause event must not restart the 720 ms stop timeline.
       The record and reader are armed exactly once on the real state edge. */
    if(changed){syncDiscRotationTimeline(next);$("#diskReader").classList.toggle("engaged",next&&coverDisplayMode==="rotate");}
    syncPlaybackMotion120();
    updatePlayIcon();
    if(changed||forceRender)syncCurrentTrackPlaybackIndicator();
  }
  let playbackMotionFrame=0,playbackMotionLastPaint=0,playbackMotionLastSecond=-1;
  function runPlaybackMotion120(timestamp){
    playbackMotionFrame=0;
    const playerActive=!!$(".view[data-view='player']")?.classList.contains("active");
    if(!isPlaying||audio.paused||audio.ended||document.hidden||!playerActive)return;
    if(timestamp-playbackMotionLastPaint>=GP_MOTION_FRAME_MS-.35){
      playbackMotionLastPaint=timestamp;
      if(audio.duration){
        seekProgress=Math.max(0,Math.min(1,audio.currentTime/audio.duration));
        if($(".view[data-view='player']")?.classList.contains("active")){
          drawWaveform();
          const wholeSecond=Math.floor(audio.currentTime);
          if(wholeSecond!==playbackMotionLastSecond){playbackMotionLastSecond=wholeSecond;$("#curTime").textContent=fmtTime(audio.currentTime);}
        }
      }
    }
    playbackMotionFrame=requestAnimationFrame(runPlaybackMotion120);
  }
  function syncPlaybackMotion120(){
    const playerActive=!!$(".view[data-view='player']")?.classList.contains("active");
    if(isPlaying&&!document.hidden&&playerActive){if(!playbackMotionFrame)playbackMotionFrame=requestAnimationFrame(runPlaybackMotion120);}
    else{if(playbackMotionFrame)cancelAnimationFrame(playbackMotionFrame);playbackMotionFrame=0;playbackMotionLastPaint=0;}
  }
  document.addEventListener("visibilitychange",syncPlaybackMotion120);
  function playAudio(){
    clearNativeEndPause();
    ensureAudioCtx();
    if(playMode!=="repeatOne"&&manualQueueActive&&!playingQueuedTrack&&playQueue.length){
      const queuedIdx=takeNextQueuedIndex();
      if(queuedIdx!==null){beginQueuedPlayback();pendingSelectionSource="queue";loadTrack(queuedIdx,true);return;}
    }
    if(currentIndex === -1){ if(playlist.length) loadTrack(0,true); return; }
    if(pauseCommitTimer){clearTimeout(pauseCommitTimer);pauseCommitTimer=0;}pauseEnvelopeToken++;
    const firstQueueAlignment=firstPlaybackQueueAlignment&&!manualQueueActive;
    if(firstQueueAlignment)positionCurrentQueueRow(false);
    const target=audio,token=++playbackIntentToken;wantsPlayback=true;pendingPlayToken=token;resetBehaviorMediaClock();
    const desiredVolume=parseFloat($("#vol").value)||0.7,now=audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(now);masterGain.gain.setValueAtTime(0,now);
    target.play().then(()=>{
      if(pendingPlayToken===token)pendingPlayToken=0;
      if(token!==playbackIntentToken||!wantsPlayback||target!==audio){target.pause();return;}
      const fadeNow=audioCtx.currentTime;masterGain.gain.cancelScheduledValues(fadeNow);masterGain.gain.setValueAtTime(0,fadeNow);masterGain.gain.linearRampToValueAtTime(desiredVolume,fadeNow+.02);
      setPlaybackVisualState(!target.paused&&!target.ended);
      firstPlaybackQueueAlignment=false;
      queueAlignOnNextPlayback=false;
      if(!manualQueueActive&&!firstQueueAlignment)positionCurrentQueueRow(false);
    }).catch(()=>{
      if(token!==playbackIntentToken)return;
      const failNow=audioCtx.currentTime;masterGain.gain.cancelScheduledValues(failNow);masterGain.gain.setValueAtTime(desiredVolume,failNow);
      pendingPlayToken=0;wantsPlayback=false;setPlaybackVisualState(false);
    });
  }
  function pauseAudio(){
    clearNativeEndPause();
    settleBehaviorProgress();emitListeningCheckpoint("pause");
    flushHistory();
    playbackIntentToken++;pendingPlayToken=0;wantsPlayback=false;
    if(crossfadeSwapTimer){clearTimeout(crossfadeSwapTimer);crossfadeSwapTimer=null;}
    crossfading=false;
    if(audioCtx){
      const token=++pauseEnvelopeToken,now=audioCtx.currentTime,desiredVolume=parseFloat($("#vol").value)||0.7;
      masterGain.gain.cancelScheduledValues(now);masterGain.gain.setValueAtTime(masterGain.gain.value,now);masterGain.gain.linearRampToValueAtTime(0,now+.018);
      if(pauseCommitTimer)clearTimeout(pauseCommitTimer);
      pauseCommitTimer=setTimeout(()=>{
        if(token!==pauseEnvelopeToken||wantsPlayback)return;
        decks.forEach(deck=>deck.pause());
        const settleNow=audioCtx.currentTime;masterGain.gain.cancelScheduledValues(settleNow);masterGain.gain.setValueAtTime(desiredVolume,settleNow);
        deckGains.forEach((gain,index)=>{if(!gain)return;gain.gain.cancelScheduledValues(settleNow);gain.gain.setValueAtTime(index===activeIdx?1:0,settleNow);});
        pauseCommitTimer=0;
      },24);
    }else decks.forEach(deck=>deck.pause());
    setPlaybackVisualState(false);
    if(!manualQueueActive)positionCurrentQueueRow(false);
  }
  function togglePlay(){ if(audio.ended){playAudio();return;} (wantsPlayback||!audio.paused) ? pauseAudio() : playAudio(); }
  function updatePlayIcon(){
    $("#playIcon").innerHTML = isPlaying ? '<rect x="7" y="5" width="4" height="14" rx="1.4"/><rect x="13" y="5" width="4" height="14" rx="1.4"/>' : '<path d="M9.25 5.7C8.5 5.25 8 5.62 8 6.5v11c0 .88.5 1.25 1.25.8l9.1-5.5c.78-.47.78-1.13 0-1.6z"/>';
    $("#miniEq").classList.toggle("playing", isPlaying);
    syncMiniEqMeter();
    if(typeof syncTraditionalPiP==="function")syncTraditionalPiP();
  }
  function ensureShuffleTimeline(baseIndex=currentIndex){
    if(baseIndex<0)return;
    if(shuffleTimelineCursor<0||shuffleTimeline[shuffleTimelineCursor]!==baseIndex){shuffleTimeline=[baseIndex];shuffleTimelineCursor=0;}
  }
  function nextShuffleIndex(baseIndex=currentIndex){
    ensureShuffleTimeline(baseIndex);
    if(shuffleTimelineCursor>=0&&shuffleTimelineCursor<shuffleTimeline.length-1)return shuffleTimeline[++shuffleTimelineCursor];
    const next=weightedPickIndex(baseIndex);
    shuffleTimeline.push(next);shuffleTimelineCursor=shuffleTimeline.length-1;
    if(shuffleTimeline.length>21){const removed=shuffleTimeline.length-21;shuffleTimeline.splice(0,removed);shuffleTimelineCursor-=removed;}
    shuffleHistory=shuffleTimeline.slice(0,shuffleTimelineCursor);
    return next;
  }
  function previousShuffleIndex(){
    ensureShuffleTimeline();
    if(shuffleTimelineCursor>0){shuffleTimelineCursor--;shuffleHistory=shuffleTimeline.slice(0,shuffleTimelineCursor);return shuffleTimeline[shuffleTimelineCursor];}
    return null;
  }
  function nextTrack(){
    if(playlist.length===0) return;
    reserveAmbientTransitionWindow(340);reserveTrackDetailWindow(330);
    judgeAndRecordTransition();
    const queuedIdx = takeNextQueuedIndex();
    if(queuedIdx !== null){ beginQueuedPlayback();pendingSelectionSource="queue";loadTrack(queuedIdx, true); return; }
    if(resumeAfterQueue())return;
    if(overrideQueue){
      const pos = overrideQueue.indexOf(currentIndex);
      if(pos !== -1 && pos+1 < overrideQueue.length){ pendingSelectionSource="recommendation";loadTrack(overrideQueue[pos+1], true); return; }
      overrideQueue = null;
    }
    if(playMode === "shuffle"){pendingSelectionSource="shuffle";loadTrack(nextShuffleIndex(), true); return; }
    let idx = currentIndex+1; if(idx>=playlist.length) idx=0;
    pendingSelectionSource="sequential";
    loadTrack(idx, true);
  }
  function prevTrack(){
    if(playlist.length===0) return;
    reserveAmbientTransitionWindow(340);reserveTrackDetailWindow(330);
    if(audio.currentTime>3){settleBehaviorProgress();recordBehaviorEvent("replay",playlist[currentIndex],{position:audio.currentTime,duration:audio.duration,selectionSource:behaviorRuntime.source});audio.currentTime=0;resetBehaviorMediaClock();return;}
    judgeAndRecordTransition();
    if(overrideQueue){
      const pos = overrideQueue.indexOf(currentIndex);
      if(pos > 0){ loadTrack(overrideQueue[pos-1], true); return; }
    }
    if(playMode==="shuffle"){
      const previous=previousShuffleIndex();
      if(previous!==null){pendingSelectionSource="shuffle-history";loadTrack(previous,true);return;}
    }
    let idx = currentIndex-1; if(idx<0) idx = playlist.length-1;
    loadTrack(idx, true);
  }
  function onEnded(){
    if(!wantsPlayback||!isPlaying){if(!nativeEndPausePending)return;}
    clearNativeEndPause();
    if(crossfading) return; // already advanced proactively
    if(!playlist.length){pauseAudio();return;}
    recordComplete(playlist[currentIndex]);
    if(sleepTimerMode === "end"){ pauseAudio(); clearSleepTimer(); return; }
    if(playMode === "repeatOne"){recordBehaviorEvent("replay",playlist[currentIndex],{automaticLoop:true,duration:audio.duration});audio.currentTime=0;beginBehaviorTrack(playlist[currentIndex],"repeat");resetBehaviorMediaClock();playAudio();return;}
    const queuedIdx = takeNextQueuedIndex();
    if(queuedIdx !== null){ beginQueuedPlayback();pendingSelectionSource="queue";loadTrack(queuedIdx, true); return; }
    if(resumeAfterQueue())return;
    if(overrideQueue){
      const pos = overrideQueue.indexOf(currentIndex);
      if(pos !== -1 && pos+1 < overrideQueue.length){pendingSelectionSource="recommendation";loadTrack(overrideQueue[pos+1], true); return; }
      overrideQueue = null;
    }
    if(playMode === "shuffle"){pendingSelectionSource="shuffle";loadTrack(nextShuffleIndex(), true); return; }
    let idx = currentIndex+1; if(idx>=playlist.length) idx=0;
    pendingSelectionSource="sequential";
    loadTrack(idx, true);
  }

  /* ---- merged play-mode button: sequential -> shuffle -> repeatOne ---- */
  const modeIcons = {
    sequential:'<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
    shuffle:'<path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>',
    repeatOne:'<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>'
  };
  const modeLabels = { sequential:["顺序播放","Sequential"], shuffle:["随机播放","Shuffle"], repeatOne:["单曲循环","Repeat One"] };
  function setMode(mode){
    const previous=playMode;playMode = mode; shuffleHistory = [];
    shuffleTimeline=currentIndex>=0&&mode==="shuffle"?[currentIndex]:[];shuffleTimelineCursor=shuffleTimeline.length-1;
    $("#modeIcon").innerHTML = modeIcons[mode];
    $("#modeLabel").textContent = tr(modeLabels[mode][0],modeLabels[mode][1]);
    $("#modeBtn").classList.toggle("active", mode !== "sequential");
    $("#repeatOneBadge").style.display = mode === "repeatOne" ? "grid" : "none";
    savePrefs();
    if(previous!==mode){
      recordBehaviorEvent("play_mode_change",playlist[currentIndex]||null,{previous,mode});if(previous==="shuffle"||mode==="shuffle")recordBehaviorEvent("shuffle_toggle",playlist[currentIndex]||null,{enabled:mode==="shuffle"});if(previous==="repeatOne"||mode==="repeatOne")recordBehaviorEvent("repeat_toggle",playlist[currentIndex]||null,{enabled:mode==="repeatOne"});
      if(manualQueueActive){
        const list=$("#miniQueueList"),shuffle=mode==="shuffle";
        list.classList.toggle("queue-shuffle-mode",shuffle);
        list.querySelectorAll(".queue-drag-handle").forEach(handle=>{handle.disabled=shuffle;handle.setAttribute("aria-hidden",String(shuffle));});
      }
    }
  }
  let modeSwitchToken=0;
  $("#modeBtn").addEventListener("click", () => {
    const icon=$("#modeIcon"),nextMode=playMode==="sequential" ? "shuffle" : playMode==="shuffle" ? "repeatOne" : "sequential",token=++modeSwitchToken;
    icon.classList.remove("gp-mode-icon-enter");restartCssMotion(icon,"gp-mode-icon-exit");
    setTimeout(()=>{if(token!==modeSwitchToken)return;setMode(nextMode);icon.classList.remove("gp-mode-icon-exit");restartCssMotion(icon,"gp-mode-icon-enter");setTimeout(()=>{if(token===modeSwitchToken)icon.classList.remove("gp-mode-icon-enter");},145);},105);
  });
  $("#playbackSpeedPop").addEventListener("click",event=>{const preset=event.target.closest("[data-rate]");if(!preset)return;event.stopPropagation();applyPlaybackRate(Number(preset.dataset.rate),{syncSlider:true,persist:true});});
  function placePlaybackSpeedPopover(){
    const pop=$("#playbackSpeedPop"),button=$("#playbackSpeedButton");if(!pop||!button)return;
    if(pop.parentElement!==document.body)document.body.appendChild(pop);
    const rect=button.getBoundingClientRect(),half=82,center=Math.max(half+10,Math.min(innerWidth-half-10,rect.left+rect.width/2));
    const height=pop.offsetHeight||33,top=Math.max(10,rect.top-height-6);
    pop.style.left=`${Math.round(center)}px`;pop.style.top=`${Math.round(top)}px`;
  }
  function setPlaybackSpeedPopover(open){
    const pop=$("#playbackSpeedPop"),button=$("#playbackSpeedButton");if(open)placePlaybackSpeedPopover();setMotionPopover(pop,open);
    button.setAttribute("aria-expanded",String(open));pop.setAttribute("aria-hidden",String(!open));
    if(open)requestAnimationFrame(()=>{placePlaybackSpeedPopover();updateGlider($(".playback-speed-presets"),false);});
  }
  $("#playbackSpeedButton").addEventListener("click",event=>{event.stopPropagation();setPlaybackSpeedPopover(!$("#playbackSpeedPop").classList.contains("show"));});
  $("#playbackSpeedPop").addEventListener("click",event=>event.stopPropagation());
  document.addEventListener("click",event=>{if(!event.target.closest(".playback-speed-wrap,#playbackSpeedPop"))setPlaybackSpeedPopover(false);});
  window.addEventListener("resize",()=>{if($("#playbackSpeedPop").classList.contains("show"))placePlaybackSpeedPopover();},{passive:true});
  /* ================= listening history tracking ================= */
  let historyStoreCache=null,historyStoreRevision=0,visibleHistoryRefreshTimer=0,lastVisibleHistoryRefreshAt=0;
  let historyPersistenceTimer=0,historyPersistenceIdle=0,historyStoreDirty=false;
  function loadHistoryStore(){
    if(historyStoreCache)return historyStoreCache;
    try{ historyStoreCache=JSON.parse(GPBrowserStorage.getLocal("glassPlayerHistory")) || {songs:{},daily:{}}; }
    catch(e){ historyStoreCache={songs:{},daily:{}}; }
    return historyStoreCache;
  }
  function persistHistoryStoreNow(store=historyStoreCache){
    clearTimeout(historyPersistenceTimer);historyPersistenceTimer=0;
    if(historyPersistenceIdle&&"cancelIdleCallback" in window)cancelIdleCallback(historyPersistenceIdle);
    historyPersistenceIdle=0;
    if(!store||!historyStoreDirty)return;
    try{GPBrowserStorage.setLocal("glassPlayerHistory",JSON.stringify(store));historyStoreDirty=false;}catch(e){}
  }
  function scheduleHistoryPersistence(){
    if(historyPersistenceTimer||historyPersistenceIdle)return;
    historyPersistenceTimer=setTimeout(()=>{
      historyPersistenceTimer=0;
      if("requestIdleCallback" in window)historyPersistenceIdle=requestIdleCallback(()=>{historyPersistenceIdle=0;persistHistoryStoreNow();},{timeout:5000});
      else persistHistoryStoreNow();
    },24000);
  }
  function saveHistoryStore(store,immediate=false){
    historyStoreCache=store;historyStoreRevision+=1;historyRenderedSignatures.clear();
    historyStoreDirty=true;
    if(immediate)persistHistoryStoreNow(store);else scheduleHistoryPersistence();
    scheduleVisibleHistoryRefresh();
  }

  function spectrumHistoryKey(track){return track?.spectrumId||track?.audioEssenceKey||trackKey(track);}
  function bindHistoryIdentityBeforeMetadataChange(track){
    const store=loadHistoryStore(),stable=spectrumHistoryKey(track),legacy=trackKey(track);if(stable===legacy||!store.songs[legacy])return;
    if(store.songs[stable])mergeHistoryEntries(store.songs[stable],store.songs[legacy]);else store.songs[stable]=store.songs[legacy];delete store.songs[legacy];
    ensureSongEntry(store,stable,track);saveHistoryStore(store);
  }
  function normalizeHistoryToken(value){return String(value||"").normalize("NFKC").toLocaleLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g,"").replace(/[\s\p{P}\p{S}]+/gu,"");}
  function historyIdentityCandidates(track){
    const parsed=parseName(track?.name||track?.file?.name||""),versions=track?.metadataVersions||{};
    const artists=new Set([track?.artist,...(track?.identityLinks?.artistAliases||[]),versions.before?.metadata?.artist,versions.after?.metadata?.artist]);
    const titles=new Set([track?.title,parsed?.title,...(track?.identityLinks?.titleAliases||[]),versions.before?.metadata?.title,versions.after?.metadata?.title]);
    return {artists:new Set([...artists].map(normalizeHistoryToken).filter(Boolean)),titles:new Set([...titles].map(normalizeHistoryToken).filter(Boolean))};
  }
  function findHistoryEntryKey(store,track){
    const stable=spectrumHistoryKey(track),legacy=trackKey(track);if(store.songs[stable])return stable;if(store.songs[legacy])return legacy;
    const legacyIds=new Set([stable,track?.spectrumId,track?.audioEssenceKey,track?.contentKey,...(track?.legacyContentKeys||[])].filter(Boolean));
    for(const [key,entry] of Object.entries(store.songs||{})){
      const identity=entry.identity||{};if([identity.spectrumId,identity.audioEssenceKey,entry.spectrumId,...(identity.legacyContentKeys||[])].some(id=>legacyIds.has(id)))return key;
    }
    const candidates=historyIdentityCandidates(track);
    for(const [key,entry] of Object.entries(store.songs||{})){
      const artistTokens=[entry.artist,...(entry.identity?.artistAliases||[])].map(normalizeHistoryToken).filter(Boolean);
      const titleTokens=[entry.title,...(entry.identity?.titleAliases||[])].map(normalizeHistoryToken).filter(Boolean);
      if(titleTokens.some(title=>candidates.titles.has(title))&&artistTokens.some(artist=>candidates.artists.has(artist)))return key;
    }
    return null;
  }
  function mergeHistoryEntries(target,source){
    if(!source||target===source)return target;
    target.playCount=(target.playCount||0)+(source.playCount||0);target.totalSeconds=(target.totalSeconds||0)+(source.totalSeconds||0);
    target.daily=target.daily||{};Object.entries(source.daily||{}).forEach(([day,seconds])=>target.daily[day]=(target.daily[day]||0)+(Number(seconds)||0));
    target.dailyPlays=target.dailyPlays||{};Object.entries(source.dailyPlays||{}).forEach(([day,count])=>target.dailyPlays[day]=(target.dailyPlays[day]||0)+(Number(count)||0));
    const datedPlays=Object.values(target.dailyPlays).reduce((sum,count)=>sum+(Number(count)||0),0);
    target.legacyUndatedPlayCount=Math.max(0,(Number(target.playCount)||0)-datedPlays);
    target.identity=target.identity||{};const sourceIdentity=source.identity||{};
    target.identity.artistAliases=Array.from(new Set([...(target.identity.artistAliases||[]),...(sourceIdentity.artistAliases||[]),source.artist].filter(Boolean)));
    target.identity.titleAliases=Array.from(new Set([...(target.identity.titleAliases||[]),...(sourceIdentity.titleAliases||[]),source.title].filter(Boolean)));
    target.identity.genreSnapshots=Array.from(new Set([...(target.identity.genreSnapshots||[]),...(sourceIdentity.genreSnapshots||[]),source.genre].filter(Boolean)));
    target.identity.spectrumId=target.identity.spectrumId||sourceIdentity.spectrumId||source.spectrumId||null;
    return target;
  }

  function ensureSongEntry(store, key, t){
    const legacyKey=trackKey(t);
    if(key!==legacyKey&&store.songs[legacyKey]){
      if(store.songs[key])mergeHistoryEntries(store.songs[key],store.songs[legacyKey]);else store.songs[key]=store.songs[legacyKey];
      delete store.songs[legacyKey];
    }
    if(!store.songs[key]) store.songs[key] = {artist:t.artist, title:t.title, playCount:0, totalSeconds:0, daily:{},dailyPlays:{}};
    const entry = store.songs[key];
    if(!entry.daily){
      // Legacy totals have no trustworthy date. Never fabricate activity for today.
      entry.daily = {};
      entry.legacyUndatedSeconds = Number(entry.totalSeconds)||0;
    }
    entry.dailyPlays=entry.dailyPlays||{};
    if(!Number.isFinite(Number(entry.legacyUndatedPlayCount))){
      const datedPlays=Object.values(entry.dailyPlays).reduce((sum,count)=>sum+(Number(count)||0),0);
      entry.legacyUndatedPlayCount=Math.max(0,(Number(entry.playCount)||0)-datedPlays);
    }
    const hasDatedPlays=Object.values(entry.dailyPlays).some(count=>(Number(count)||0)>0);
    if(!hasDatedPlays&&!entry.legacyDailySeconds&&Object.keys(entry.daily).length)entry.legacyDailySeconds={...entry.daily};
    entry.identity=entry.identity||{spectrumId:t.spectrumId||t.audioEssenceKey||null,canonicalArtistId:null,artistAliases:[],titleAliases:[],genreSnapshots:[]};
    entry.identity.spectrumId=t.spectrumId||t.audioEssenceKey||entry.identity.spectrumId||null;
    entry.identity.artistAliases=Array.from(new Set([...(entry.identity.artistAliases||[]),entry.artist,t.artist].filter(Boolean)));
    const versions=t.metadataVersions||{};
    entry.identity.titleAliases=Array.from(new Set([...(entry.identity.titleAliases||[]),entry.title,t.title,...(t.identityLinks?.titleAliases||[]),versions.before?.metadata?.title,versions.after?.metadata?.title].filter(Boolean)));
    entry.identity.genreSnapshots=Array.from(new Set([...(entry.identity.genreSnapshots||[]),t.genre].filter(Boolean)));
    entry.artist=t.artist;entry.title=t.title;entry.album=t.album||entry.album||null;entry.genre=t.genre||entry.genre||null;entry.duration=Number(t.duration)||Number(entry.duration)||0;
    return entry;
  }
  function syncHistoryMetadataForPlaylist(){
    const store=loadHistoryStore();let changed=false;
    playlist.forEach(t=>{
      const key=spectrumHistoryKey(t),sourceKey=findHistoryEntryKey(store,t);if(!sourceKey)return;
      const before=JSON.stringify(store.songs[key]||store.songs[sourceKey]);
      if(sourceKey!==key){if(store.songs[key])mergeHistoryEntries(store.songs[key],store.songs[sourceKey]);else store.songs[key]=store.songs[sourceKey];delete store.songs[sourceKey];changed=true;}
      const entry=ensureSongEntry(store,key,t);
      entry.artist=t.artist;entry.title=t.title;entry.album=t.album||null;entry.genre=t.genre||null;
      if(before!==JSON.stringify(entry))changed=true;
    });
    if(changed)saveHistoryStore(store);
  }
  function flushHistory(forcePersist=false){
    if(!listeningKey) return;
    const delta = Math.max(0, audio.currentTime - lastTimeMark);
    lastTimeMark = audio.currentTime;
    if(delta <= 0 || delta > 5) return; // guard against seeks/jumps
    const store = loadHistoryStore();
    const t = playlist[currentIndex];
    if(!t) return;
    const entry = ensureSongEntry(store, listeningKey, t);
    const day = todayKey();
    entry.daily[day] = (entry.daily[day]||0) + delta;
    entry.totalSeconds = (entry.totalSeconds||0) + delta;
    store.daily[day] = (store.daily[day]||0) + delta;
    store.hourly=store.hourly||{};store.hourly[day]=store.hourly[day]||{};
    const hour=String(new Date().getHours()).padStart(2,"0");
    store.hourly[day][hour]=(store.hourly[day][hour]||0)+delta;
    saveHistoryStore(store,forcePersist);
  }
  function incrementPlayCount(){
    if(!listeningKey) return;
    const store = loadHistoryStore();
    const t = playlist[currentIndex];
    if(!t) return;
    const entry = ensureSongEntry(store, listeningKey, t);
    entry.playCount += 1;
    const day=todayKey();
    entry.dailyPlays[day]=(entry.dailyPlays[day]||0)+1;
    saveHistoryStore(store);
  }
  function sumSongInRange(entry, days, now){
    if(!entry.daily) return days===Infinity?(entry.totalSeconds||0):0;
    if(days === Infinity) return Object.values(entry.daily).reduce((a,b)=>a+b,0)+(Number(entry.legacyUndatedSeconds)||0);
    let sum = 0;
    for(let i=0;i<days;i++){ const d = new Date(now); d.setDate(d.getDate()-i); sum += entry.daily[todayKey(d)] || 0; }
    return sum;
  }
  function sumPlayCountInRange(entry,days,now,duration=0){
    const daily=entry.dailyPlays||{};
    const datedTotal=Object.values(daily).reduce((sum,count)=>sum+(Number(count)||0),0);
    const legacySnapshot=entry.legacyDailySeconds;
    const legacyDaily=legacySnapshot&&Object.keys(legacySnapshot).length?legacySnapshot:(datedTotal?{}:(entry.daily||{}));
    const legacySecondsTotal=Object.values(legacyDaily).reduce((sum,seconds)=>sum+(Number(seconds)||0),0);
    const inferLegacy=seconds=>{
      const listened=Math.max(0,Number(seconds)||0);
      if(!listened)return 0;
      if(duration>0)return Math.max(1,Math.floor(listened/(duration*.75)));
      return 1;
    };
    if(days===Infinity)return Math.max(Number(entry.playCount)||0,datedTotal+inferLegacy(legacySecondsTotal));
    let datedInRange=0;
    for(let i=0;i<days;i++){const d=new Date(now);d.setDate(d.getDate()-i);datedInRange+=Number(daily[todayKey(d)])||0;}
    const legacy=Math.max(0,Number(entry.legacyUndatedPlayCount)||0);
    if(!legacy)return datedInRange+inferLegacy(Array.from({length:days},(_,i)=>{const d=new Date(now);d.setDate(d.getDate()-i);return Number(legacyDaily[todayKey(d)])||0;}).reduce((sum,seconds)=>sum+seconds,0));
    const allLegacySeconds=Object.values(legacyDaily).reduce((sum,seconds)=>sum+(Number(seconds)||0),0);
    if(!allLegacySeconds)return datedInRange;
    let rangeSeconds=0;
    for(let i=0;i<days;i++){const d=new Date(now);d.setDate(d.getDate()-i);rangeSeconds+=Number(legacyDaily[todayKey(d)])||0;}
    return datedInRange+Math.max(0,Math.min(legacy,Math.round(legacy*rangeSeconds/allLegacySeconds)));
  }
  setInterval(flushHistory, 8000);
  window.addEventListener("beforeunload",()=>{emitListeningCheckpoint("unload");flushHistory(true);persistHistoryStoreNow();});
  window.addEventListener("pagehide",()=>{emitListeningCheckpoint("pagehide");flushHistory(true);persistHistoryStoreNow();});
  document.addEventListener("visibilitychange",()=>{if(document.hidden){emitListeningCheckpoint("hidden");flushHistory(true);persistHistoryStoreNow();}else resetBehaviorMediaClock();});

  $("#rangeSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button"); if(!btn) return;
    $$("#rangeSeg button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    requestAnimationFrame(()=>updateGlider($("#rangeSeg"),true));
    scheduleHistoryRender();
  });

  function historyDay(offset=0){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-offset);return d;}
  function sumDailyOffsets(daily,start,count){let total=0;for(let i=start;i<start+count;i++)total+=Number(daily?.[todayKey(historyDay(i))])||0;return total;}
  function calendarHistoryRange(kind,offset=0){
    const now=new Date(),start=new Date(now),end=new Date(now);start.setHours(0,0,0,0);end.setHours(0,0,0,0);
    if(kind==="day"){start.setDate(start.getDate()-offset);end.setTime(start.getTime());end.setDate(end.getDate()+1);}
    else if(kind==="week"){
      const mondayDelta=(start.getDay()+6)%7;start.setDate(start.getDate()-mondayDelta-offset*7);end.setTime(start.getTime());end.setDate(end.getDate()+7);
    }else if(kind==="month"){
      start.setDate(1);start.setMonth(start.getMonth()-offset);end.setTime(start.getTime());end.setMonth(end.getMonth()+1);
    }else if(kind==="year"){
      start.setMonth(0,1);start.setFullYear(start.getFullYear()-offset);end.setTime(start.getTime());end.setFullYear(end.getFullYear()+1);
    }else return null;
    return {start,end};
  }
  function dayKeyInRange(key,range){if(!range)return true;const stamp=new Date(`${key}T12:00:00`).getTime();return stamp>=range.start.getTime()&&stamp<range.end.getTime();}
  function sumDailyRange(daily,range){return Object.entries(daily||{}).reduce((sum,[key,value])=>sum+(dayKeyInRange(key,range)?Number(value)||0:0),0);}
  function sumSongRange(entry,range){return range?sumDailyRange(entry?.daily,range):sumSongInRange(entry,Infinity);}
  function sumPlayCountRange(entry,range,duration=0){
    if(!range)return sumPlayCountInRange(entry,Infinity,new Date(),duration);
    const dated=Object.entries(entry?.dailyPlays||{}).reduce((sum,[key,value])=>sum+(dayKeyInRange(key,range)?Number(value)||0:0),0);
    const legacySeconds=sumDailyRange(entry?.legacyDailySeconds||(!Object.keys(entry?.dailyPlays||{}).length?entry?.daily:{}),range);
    return dated+(legacySeconds>0?(duration>0?Math.max(1,Math.floor(legacySeconds/(duration*.75))):1):0);
  }
  function getLibraryPlayCounts(){
    const store=loadHistoryStore(),counts=new Map();
    playlist.forEach(track=>{
      const key=findHistoryEntryKey(store,track),entry=key?store.songs[key]:null;
      counts.set(track.id,entry?sumPlayCountRange(entry,null,Number(track.duration)||Number(entry.duration)||0):0);
    });
    return counts;
  }
  let historyTrackIndex=null;
  function invalidateHistoryTrackIndex(){historyTrackIndex=null;historyRenderedSignatures.clear();}
  function getHistoryTrackIndex(){
    if(historyTrackIndex)return historyTrackIndex;
    const byKey=new Map(),byAlias=new Map(),coverByKey=new Map();
    playlist.forEach(track=>{
      const stable=spectrumHistoryKey(track),legacy=trackKey(track),cover=track.thumbUrl||track.coverUrl||null,candidates=historyIdentityCandidates(track);
      byKey.set(stable,track);byKey.set(legacy,track);
      if(cover){coverByKey.set(stable,cover);coverByKey.set(legacy,cover);}
      for(const artist of candidates.artists)for(const title of candidates.titles){
        const aliasKey=artist+"||"+title;
        if(!byAlias.has(aliasKey))byAlias.set(aliasKey,track);
        if(cover&&!coverByKey.has(aliasKey))coverByKey.set(aliasKey,cover);
      }
    });
    historyTrackIndex={byKey,byAlias,coverByKey};return historyTrackIndex;
  }
  function currentTrackForHistory(key,entry){
    const index=getHistoryTrackIndex(),direct=index.byKey.get(key);if(direct)return direct;
    const artists=new Set([entry?.artist,...(entry?.identity?.artistAliases||[])].map(normalizeHistoryToken).filter(Boolean));
    const titles=new Set([entry?.title,...(entry?.identity?.titleAliases||[])].map(normalizeHistoryToken).filter(Boolean));
    for(const artist of artists)for(const title of titles){const match=index.byAlias.get(artist+"||"+title);if(match)return match;}
    return null;
  }
  function setBatchedScrollHTML(element,html){
    if(!element)return;element.dataset.gpSseBatch="1";element.innerHTML=html;
    requestAnimationFrame(()=>{delete element.dataset.gpSseBatch;scheduleScrollEdgeUpdate(element);});
  }
  function renderHistoryComparison(store,range,currentRange,current){
    const el=$("#historyCompare");if(!el)return;
    if(!currentRange){el.textContent=tr("持续积累中","Growing with every listen");el.className="history-compare flat";return;}
    const previous=sumDailyRange(store.daily,calendarHistoryRange(range,1)),diff=current-previous;
    if(Math.abs(diff)<1){el.textContent=tr("与上一周期持平","No change from the previous period");el.className="history-compare flat";return;}
    const up=diff>0,period=uiLanguage==="zh"?({day:"昨天",week:"上一周",month:"上一个月",year:"去年"}[range]):({day:"yesterday",week:"the previous week",month:"the previous month",year:"last year"}[range]);
    el.className=`history-compare ${up?"up":"down"}`;
    el.innerHTML=`<span class="compare-arrow">${up?"▲":"▼"}</span>${tr(`相比${period}${up?"增加":"减少"} ${fmtDuration(Math.abs(diff))}`,`${fmtDuration(Math.abs(diff))} ${up?"more":"less"} than ${period}`)}`;
  }
  function renderHistoryRanking(store,range){
    const candidates=Object.entries(store.songs||{}).map(([historyKey,s])=>{const track=currentTrackForHistory(historyKey,s);return {...s,historyKey,track,title:track?.title||s.title,artist:track?.artist||s.artist,rangeSeconds:sumSongRange(s,range)};}).filter(s=>s.rangeSeconds>0).sort((a,b)=>b.rangeSeconds-a.rangeSeconds),ranked=candidates.slice(0,50);
    const topSong=$("#historyStatTopSong");
    if(topSong)topSong.textContent=ranked[0]?.title||"—";
    const topList=$("#topList");if(!ranked.length){setBatchedScrollHTML(topList,`<div class="empty-state"><p>${tr("这个时间段还没有听歌记录","No listening history for this range")}</p></div>`);return;}
    const historyIndex=getHistoryTrackIndex(),fallback=`<svg class="single-alpha-icon rounded-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="18" r="3"/><path d="M9 17V5l12-2v12"/><circle cx="18" cy="16" r="3"/></svg>`;
    const coverFor=s=>{const normalized=normalizeHistoryToken(s.artist)+"||"+normalizeHistoryToken(s.title);return historyIndex.coverByKey.get(s.historyKey)||historyIndex.coverByKey.get(normalized)||s.track?.thumbUrl||s.track?.coverUrl||null;};
    const top3=ranked.slice(0,3),ranks4to10=ranked.slice(3,10),ranks11to50=ranked.slice(10,50),maxSec=ranked[0].rangeSeconds||1,podiumOrder=[top3[1],top3[0],top3[2]];
    const podium=`<div class="podium">${podiumOrder.map(s=>{if(!s)return `<div class="podium-item podium-empty"></div>`;const rank=s===top3[0]?1:s===top3[1]?2:3,cover=coverFor(s);return `<div class="podium-item rank${rank}"><div class="podium-cover-wrap">${cover?`<img src="${cover}" class="podium-cover" loading="lazy" decoding="async">`:`<div class="podium-cover-fallback">${fallback}</div>`}<div class="podium-medal">${rank}</div></div><div class="podium-name">${escapeHtml(s.title)}</div><div class="podium-artist">${escapeHtml(s.artist)}</div><div class="podium-time">${fmtDuration(s.rangeSeconds)}</div></div>`;}).join("")}</div>`;
    const rankRows=(items,startRank)=>items.map((s,i)=>{const cover=coverFor(s);return `<div class="top-row"><div class="top-rank">${startRank+i}</div><div class="top-row-main">${cover?`<img src="${cover}" class="track-thumb" loading="lazy" decoding="async">`:`<div class="track-thumb">${fallback}</div>`}<div class="top-info"><div class="t-title">${escapeHtml(s.title)}</div><div class="t-artist">${escapeHtml(s.artist)}</div></div></div><div class="top-row-metrics"><div class="top-bar-wrap"><div class="top-bar-fill" style="width:${(s.rangeSeconds/maxSec*100).toFixed(0)}%"></div></div><div class="top-meta"><span>${fmtDuration(s.rangeSeconds)}</span></div></div></div>`;}).join("");
    const rankHeading=`<div class="history-ranks-heading"><span>${tr("歌曲","Song")}</span><span>${tr("时长","Duration")}</span></div>`;
    const leftMarkup=`<div class="history-ranking-kicker"><span class="history-kicker-wide">${tr("Top 10","Top 10")}</span><span class="history-kicker-narrow">${tr("Top 50","Top 50")}</span></div>${podium}`;
    const leftRows=rankRows(ranks4to10,4),rightRows=rankRows(ranks11to50,11);
    const leftRanksMarkup=`${rankHeading}<div class="history-rank-rows">${leftRows||`<div class="history-ranking-caption">${tr("暂无更多歌曲","No more songs in this range")}</div>`}</div>`;
    const rightRanksMarkup=`<div class="history-ranking-kicker">${tr("11–50","11–50")}</div>${rankHeading}<div class="history-rank-rows">${rightRows||`<div class="history-ranking-caption">${tr("暂无更多歌曲","No more songs in this range")}</div>`}</div>`;
    setBatchedScrollHTML(topList,`<div class="history-ranking-grid"><div class="history-ranking-left" id="historyRankingLeft" data-gp-sse><section class="history-top10" id="historyTop3">${leftMarkup}</section><section class="history-left-ranks" id="historyRanks4to10">${leftRanksMarkup}</section></div><section class="history-ranks-list" id="historyRanks11to50" data-gp-sse>${rightRanksMarkup}</section></div>`);
  }
  function chooseNeuralWindow(store){
    const candidates=[7,14,21,30,45],thresholds={7:[1200,2],14:[1800,3],21:[2400,4],30:[3000,5],45:[3600,6]};
    let fallback={days:45,total:0,active:0,confident:false};
    for(const days of candidates){
      const total=sumDailyOffsets(store.daily,0,days),active=Array.from({length:days},(_,i)=>Number(store.daily?.[todayKey(historyDay(i))])||0).filter(Boolean).length,[minimumSeconds,minimumDays]=thresholds[days];
      const result={days,total,active,confident:total>=minimumSeconds&&active>=minimumDays};
      fallback=result;if(result.confident)return result;
    }
    return fallback;
  }
  function recentAffinity(entry,days){
    const halfLife=Math.max(3.5,days*.28),daily=entry?.daily||{};let weightedSeconds=0,weightedPlays=0,recentSeconds=0,olderSeconds=0;
    for(let offset=0;offset<days;offset++){
      const key=todayKey(historyDay(offset)),seconds=Number(daily[key])||0,weight=Math.pow(.5,offset/halfLife);
      weightedSeconds+=seconds*weight;weightedPlays+=(Number(entry?.dailyPlays?.[key])||0)*weight;
      if(offset<Math.max(3,Math.ceil(days*.34)))recentSeconds+=seconds;else olderSeconds+=seconds;
    }
    const recentSpan=Math.max(3,Math.ceil(days*.34)),olderSpan=Math.max(1,days-recentSpan);
    const momentum=Math.max(.72,Math.min(1.45,(recentSeconds/recentSpan+30)/(olderSeconds/olderSpan+30)));
    return (weightedSeconds+weightedPlays*75)*momentum;
  }
  function topAggregate(items,keyFn){const totals=new Map();items.forEach(item=>{const key=keyFn(item);if(key)totals.set(key,(totals.get(key)||0)+item.recentScore);});return [...totals.entries()].sort((a,b)=>b[1]-a[1])[0]||null;}
  function renderRecentFavorites(store){
    const win=chooseNeuralWindow(store),items=Object.entries(store.songs||{}).map(([key,s])=>{const track=currentTrackForHistory(key,s),rangeSeconds=sumSongInRange(s,win.days,new Date());return {...s,key,track,rangeSeconds,recentScore:recentAffinity(s,win.days)};}).filter(s=>s.rangeSeconds>0&&s.recentScore>0);
    const song=[...items].sort((a,b)=>b.recentScore-a.recentScore)[0],artist=topAggregate(items,s=>s.track?.artist||s.artist),album=topAggregate(items,s=>s.track?.album||s.album),genre=topAggregate(items,s=>s.track?.genre||s.genre);
    const buckets={morning:0,noon:0,afternoon:0,evening:0,late:0};let hourTotal=0,activeHourDays=0;
    for(let i=0;i<win.days;i++){const hours=store.hourly?.[todayKey(historyDay(i))];if(!hours)continue;activeHourDays++;Object.entries(hours).forEach(([h,sec])=>{const key=listeningPeriodForHour(+h);buckets[key]+=Number(sec)||0;hourTotal+=Number(sec)||0;});}
    const periodRows=Object.entries(buckets).sort((a,b)=>b[1]-a[1]);
    const periodLabels={morning:tr("清晨","Early Morning"),noon:tr("午间","Midday"),afternoon:tr("下午","Afternoon"),evening:tr("晚间","Evening"),late:tr("深夜","Late Night")};
    const periodDescriptors={morning:tr("晨光清醒","Clear Mornings"),noon:tr("午间舒展","Easy Midday"),afternoon:tr("下午专注","Focused Afternoons"),evening:tr("晚间沉浸","Immersive Evenings"),late:tr("深夜独处","Late-night Solitude")};
    const timeGenre=neuralModel?.preference?.timeGenre||{};
    const preferredGenre=slot=>Object.entries(timeGenre[slot]||{}).filter(([,score])=>Number(score)>0).sort((a,b)=>b[1]-a[1])[0]?.[0]||"";
    const qualifiedPeriods=periodRows.filter(([,seconds])=>seconds>=Math.max(600,hourTotal*.12)).slice(0,3);
    const habitReady=Boolean(qualifiedPeriods.length&&hourTotal>=1800&&activeHourDays>=3);
    const habitParts=habitReady?qualifiedPeriods.map(([slot])=>{const genre=preferredGenre(slot);return {period:periodDescriptors[slot]||periodLabels[slot],genre};}):[];
    const confidenceText=habitReady?(win.confident?tr("Resonance Boost 已形成稳定结论","Resonance Boost found a stable pattern"):tr("样本较少，结论会随收听继续调整","Limited evidence — this will refine as you listen")):"";
    const card=(label,value)=>`<article class="favorite-card"><div class="favorite-label">${label}</div><div class="favorite-answer"><strong>${escapeHtml(value||tr("等待更多收听记录","Waiting for more listening"))}</strong></div></article>`;
    const habitMarkup=habitReady?habitParts.map(part=>`<span class="habit-part"><strong>${escapeHtml(part.period)}</strong>${part.genre?`<span>${escapeHtml(part.genre)}</span>`:""}</span>`).join(""):`<span class="habit-learning">${tr("仍在学习你的听歌时段","Still learning your listening rhythm")}</span>`;
    setBatchedScrollHTML($("#favoritesGrid"),`<div class="favorite-matrix">${card(tr("最爱歌曲","Favorite Song"),song?.title)}${card(tr("最爱艺人","Favorite Artist"),artist?.[0])}${card(tr("最爱专辑","Favorite Album"),album?.[0])}${card(tr("最爱风格","Favorite Genre"),genre?.[0])}</div><article class="favorite-habit-panel"><div class="habit-heading"><div class="favorite-label">${tr("听歌习惯","Listening Rhythm")}</div>${confidenceText?`<div class="favorite-confidence">${confidenceText}</div>`:""}</div><div class="favorite-answer habit-parts">${habitMarkup}</div></article>`);
  }
  function artistTopForOffsets(store,start,count){
    const totals=new Map();Object.values(store.songs||{}).forEach(s=>{const sec=sumDailyOffsets(s.daily,start,count);if(sec>0)totals.set(s.artist||tr("未知艺人","Unknown Artist"),(totals.get(s.artist)||0)+sec);});return [...totals.entries()].sort((a,b)=>b[1]-a[1])[0]||[tr("暂无","None"),0];
  }
  function artistTopForMonth(store,date){
    const prefix=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-`,totals=new Map();Object.values(store.songs||{}).forEach(s=>{let sec=0;Object.entries(s.daily||{}).forEach(([day,value])=>{if(day.startsWith(prefix))sec+=Number(value)||0;});if(sec>0)totals.set(s.artist||tr("未知艺人","Unknown Artist"),(totals.get(s.artist)||0)+sec);});return [...totals.entries()].sort((a,b)=>b[1]-a[1])[0]||[tr("暂无","None"),0];
  }
  function artistTopForCalendarRange(store,range){
    const totals=new Map();Object.values(store.songs||{}).forEach(entry=>{const seconds=sumSongRange(entry,range),artist=entry.artist||tr("未知艺人","Unknown Artist");if(seconds>0)totals.set(artist,(totals.get(artist)||0)+seconds);});return [...totals.entries()].sort((a,b)=>b[1]-a[1])[0]||[tr("暂无","None"),0];
  }
  function periodBars(rows){const max=Math.max(1,...rows.map(r=>r.value));return `<div class="period-bars">${rows.map(r=>`<div class="period-row" data-chart-tip="${escapeHtml(`${r.label} · ${r.name} · ${fmtDuration(r.value)}`)}"><span class="period-label">${escapeHtml(r.label)}</span><span class="period-name">${escapeHtml(r.name)}</span><span class="period-track"><span class="period-fill" style="display:block;width:${(r.value/max*100).toFixed(1)}%"></span></span></div>`).join("")}</div>`;}
  function chooseInsightWindow(store){
    const candidates=[4,6,8,12,16];let fallback={weeks:4,activeWeeks:0,activeDays:0,total:0,confident:false};
    for(const weeks of candidates){const total=sumDailyOffsets(store.daily,0,weeks*7),activeDays=Array.from({length:weeks*7},(_,i)=>Number(store.daily?.[todayKey(historyDay(i))])||0).filter(Boolean).length,activeWeeks=Array.from({length:weeks},(_,i)=>sumDailyOffsets(store.daily,i*7,7)).filter(Boolean).length,result={weeks,activeWeeks,activeDays,total,confident:total>=7200&&activeDays>=6&&activeWeeks>=Math.min(3,Math.ceil(weeks*.42))};fallback=result;if(result.confident)return result;}
    return fallback;
  }
  function topHistoryDimension(store,start,count,field){
    const totals=new Map();Object.entries(store.songs||{}).forEach(([key,s])=>{const seconds=sumDailyOffsets(s.daily,start,count),track=currentTrackForHistory(key,s),value=field==="album"?(track?.album||s.album):field==="genre"?(track?.genre||s.genre):field==="song"?(track?.title||s.title):(track?.artist||s.artist);if(seconds>0&&value)totals.set(value,(totals.get(value)||0)+seconds);});
    return [...totals.entries()].sort((a,b)=>b[1]-a[1])[0]||null;
  }
  function buildListeningInsights(store){
    const win=chooseInsightWindow(store),days=win.weeks*7,insights=[],weekly=Array.from({length:win.weeks},(_,i)=>artistTopForOffsets(store,i*7,7)),artistWeeks=new Map();weekly.forEach(([name,value])=>{if(value>0)artistWeeks.set(name,(artistWeeks.get(name)||0)+1);});
    const dominant=[...artistWeeks.entries()].sort((a,b)=>b[1]-a[1])[0],album=topHistoryDimension(store,0,days,"album"),song=topHistoryDimension(store,0,days,"song");
    if(dominant)insights.push(tr(`在可信的 <strong>${win.weeks} 周</strong>观察窗口中，<strong>${escapeHtml(dominant[0])}</strong> 有 <strong>${dominant[1]} 周</strong>成为最爱艺人。`,`Across a reliable <strong>${win.weeks}-week</strong> window, <strong>${escapeHtml(dominant[0])}</strong> was your favorite artist for <strong>${dominant[1]} weeks</strong>.`));
    if(album)insights.push(tr(`这段观察期听得最久的专辑是 <strong>${escapeHtml(album[0])}</strong>，累计 <strong>${fmtDuration(album[1])}</strong>。`,`Your most-listened album in this window was <strong>${escapeHtml(album[0])}</strong> at <strong>${fmtDuration(album[1])}</strong>.`));
    if(song)insights.push(tr(`单曲 <strong>${escapeHtml(song[0])}</strong>获得了最高收听时长：<strong>${fmtDuration(song[1])}</strong>。`,`The song <strong>${escapeHtml(song[0])}</strong> led listening time with <strong>${fmtDuration(song[1])}</strong>.`));
    const previous=sumDailyOffsets(store.daily,days,days);if(win.total>0&&previous>0){const diff=win.total-previous,percent=Math.round(Math.abs(diff)/Math.max(1,previous)*100);insights.push(tr(`总听歌时长较前一个同等窗口<strong>${diff>=0?"增加":"减少"} ${percent}%</strong>，当前为 <strong>${fmtDuration(win.total)}</strong>。`,`Total listening time <strong>${diff>=0?"rose":"fell"} ${percent}%</strong> versus the previous equal window, reaching <strong>${fmtDuration(win.total)}</strong>.`));}
    const weekdays=new Map();for(let i=0;i<days;i++){const d=historyDay(i),seconds=Number(store.daily?.[todayKey(d)])||0;if(seconds){const label=d.toLocaleDateString(uiLanguage==="zh"?"zh-CN":"en-US",{weekday:"long"});weekdays.set(label,(weekdays.get(label)||0)+seconds);}}const topDay=[...weekdays.entries()].sort((a,b)=>b[1]-a[1])[0];if(topDay)insights.push(tr(`<strong>${escapeHtml(topDay[0])}</strong>最容易进入听歌状态，累计 <strong>${fmtDuration(topDay[1])}</strong>。`,`You listened most often on <strong>${escapeHtml(topDay[0])}</strong>, totaling <strong>${fmtDuration(topDay[1])}</strong>.`));
    if(!insights.length)insights.push(tr("数据仍不足以形成可信洞察；Resonance Boost 会继续在本地积累证据。","There is not enough evidence for reliable insights yet; Resonance Boost will keep learning locally."));
    return insights.slice(0,5);
  }
  function renderListeningData(store){
    const recent=Array.from({length:10},(_,i)=>{const offset=9-i,d=historyDay(offset);return {label:d.toLocaleDateString(uiLanguage==="zh"?"zh-CN":"en-US",{month:"numeric",day:"numeric"}),tip:d.toLocaleDateString(uiLanguage==="zh"?"zh-CN":"en-US",{month:"short",day:"numeric",weekday:"short"}),value:Number(store.daily?.[todayKey(d)])||0};}),max=Math.max(1,...recent.map(d=>d.value)),W=720,H=170,padX=30,padTop=20,padBottom=30;
    const points=recent.map((d,i)=>({x:padX+i*(W-padX*2)/9,y:H-padBottom-(d.value/max)*(H-padTop-padBottom),...d}));
    const curvePath=monotoneCurvePath(points,.62);
    const areaPath=`${curvePath} L ${W-padX} ${H-padBottom} L ${padX} ${H-padBottom} Z`;
    const svg=`<svg class="line-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="historyAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>${[0,.5,1].map(n=>`<line class="chart-grid" x1="${padX}" y1="${padTop+n*(H-padTop-padBottom)}" x2="${W-padX}" y2="${padTop+n*(H-padTop-padBottom)}"/>`).join("")}<path class="chart-area" d="${areaPath}"/><path class="chart-line" d="${curvePath}"/>${points.map(p=>`<circle class="chart-dot" cx="${p.x}" cy="${p.y}" r="4.5" data-chart-tip="${escapeHtml(`${p.tip} · ${fmtDuration(p.value)}`)}"/><text class="chart-label" x="${p.x}" y="${H-8}">${escapeHtml(p.label)}</text>`).join("")}</svg>`;
    const weeks=Array.from({length:12},(_,i)=>{const age=11-i,[name,value]=artistTopForCalendarRange(store,calendarHistoryRange("week",age));return {label:age===0?tr("本周","This week"):tr(`${age}周前`,`${age}w ago`),name,value};});
    const months=Array.from({length:12},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-(11-i));const [name,value]=artistTopForMonth(store,d);return {label:d.toLocaleDateString(uiLanguage==="zh"?"zh-CN":"en-US",{month:"short"}),name,value};});
    const insights=buildListeningInsights(store);
    setBatchedScrollHTML($("#dataDashboard"),`<section class="data-card wide"><h3>${tr("过去十天听歌时间","Listening Time · Last Ten Days")}</h3><div class="data-sub">${tr("悬停数据点查看日期与详细时长","Hover a point for the date and listening time")}</div>${svg}</section><section class="data-card"><h3>${tr("过去十二周最爱艺人","Favorite Artists · Twelve Weeks")}</h3><div class="data-sub">${tr("每周以听歌时长计算","Calculated from weekly listening time")}</div>${periodBars(weeks)}</section><section class="data-card"><h3>${tr("过去十二个月最爱艺人","Favorite Artists · Twelve Months")}</h3><div class="data-sub">${tr("悬停条形查看月份、艺人和时长","Hover a bar for month, artist and time")}</div>${periodBars(months)}</section><section class="data-card wide"><div class="neural-insights">${insights.map(text=>`<div class="neural-insight">${text}</div>`).join("")}</div></section>`);
  }
   /* ============ annual report (7.5.0 Replay Atlas) ============
     History Service owns yearly aggregation; History View renders it.
     The report year rolls forward automatically: Dec 31 (year Y) through
     Jan 14 (year Y+1) opens year Y and presents it once per session.
     Completed years stay viewable and downloadable all year. Downloads are
      standalone interactive HTML (inline style, chapters and scroll motion;
      blob: covers are omitted by design). */
  const ANNUAL_WINDOW_END_DAY=14;
  function annualReportWindow(now=new Date()){
    const month=now.getMonth(),date=now.getDate(),year=now.getFullYear();
    if(month===11&&date===31)return {open:true,year};
    if(month===0&&date<=ANNUAL_WINDOW_END_DAY)return {open:true,year:year-1};
    return {open:false,year:year-1};
  }
  function annualAvailableYears(store){
    const years=new Set(),collect=key=>{const year=Number(String(key||"").slice(0,4));if(Number.isInteger(year)&&year>=2000&&year<=9999)years.add(year);};
    Object.keys(store.daily||{}).forEach(collect);
    Object.values(store.songs||{}).forEach(entry=>Object.keys(entry?.daily||{}).forEach(collect));
    return [...years].sort((a,b)=>b-a);
  }
  function buildAnnualReport(store,year){
    const range={start:new Date(year,0,1),end:new Date(year+1,0,1)};
    const total=sumDailyRange(store.daily,range);
    const songs=Object.entries(store.songs||{}).map(([key,entry])=>({key,entry,track:currentTrackForHistory(key,entry),seconds:sumSongRange(entry,range),plays:sumPlayCountRange(entry,range,Number(entry.duration)||0)})).filter(item=>item.seconds>0).sort((a,b)=>b.seconds-a.seconds||b.plays-a.plays);
    const totalPlays=songs.reduce((sum,item)=>sum+item.plays,0);
    const artists=new Map(),albums=new Map(),genres=new Map();
    songs.forEach(item=>{
      const artist=item.track?.artist||item.entry.artist,album=item.track?.album||item.entry.album,genre=item.track?.genre||item.entry.genre;
      if(artist)artists.set(artist,(artists.get(artist)||0)+item.seconds);
      if(album)albums.set(album,(albums.get(album)||0)+item.seconds);
      if(genre)genres.set(genre,(genres.get(genre)||0)+item.seconds);
    });
    const topRows=list=>[...list.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
    const days=Object.entries(store.daily||{}).filter(([key,value])=>String(key).startsWith(`${year}-`)&&(Number(value)||0)>0);
    const weekdayTotals=Array.from({length:7},()=>0),seasonTotals=new Map([["winter",0],["spring",0],["summer",0],["autumn",0]]);
    const seasonForMonth=month=>month<2||month===11?"winter":month<5?"spring":month<8?"summer":"autumn";
    days.forEach(([key,value])=>{const date=new Date(`${key}T12:00:00`),month=date.getMonth();weekdayTotals[date.getDay()]+=Number(value)||0;seasonTotals.set(seasonForMonth(month),(seasonTotals.get(seasonForMonth(month))||0)+(Number(value)||0));});
    const monthly=Array.from({length:12},(_,month)=>{
      const seconds=sumDailyRange(store.daily,{start:new Date(year,month,1),end:new Date(year,month+1,1)});
      const [name]=artistTopForMonth(store,new Date(year,month,1));
      return {label:new Date(year,month,1).toLocaleDateString(uiLanguage==="zh"?"zh-CN":"en-US",{month:"short"}),name:seconds>0?name:tr("—","—"),value:seconds};
    });
    const activeDays=days.length;
    let bestDay=null;
    Object.entries(store.daily||{}).forEach(([key,value])=>{if(String(key).startsWith(`${year}-`)&&(Number(value)||0)>0&&(!bestDay||Number(value)>bestDay.value))bestDay={key,value:Number(value)};});
    const hourTotals=Array.from({length:24},()=>0);
    Object.entries(store.hourly||{}).forEach(([day,hours])=>{if(!String(day).startsWith(`${year}-`))return;Object.entries(hours||{}).forEach(([hour,seconds])=>{const slot=Number(hour);if(slot>=0&&slot<24)hourTotals[slot]+=Number(seconds)||0;});});
    const peakHour=hourTotals.indexOf(Math.max(...hourTotals,0));
    const hourBands=Array.from({length:6},(_,band)=>({label:`${String(band*4).padStart(2,"0")}–${String(band*4+3).padStart(2,"0")}`,value:hourTotals.slice(band*4,band*4+4).reduce((sum,value)=>sum+value,0)}));
    const weekdayNames=Array.from({length:7},(_,day)=>new Date(2024,0,day+7).toLocaleDateString(uiLanguage==="zh"?"zh-CN":"en-US",{weekday:"long"}));
    const weekdays=weekdayNames.map((label,day)=>({label,value:weekdayTotals[day]}));
    const seasons=[...seasonTotals.entries()].map(([key,value])=>({key,label:tr({winter:"冬季",spring:"春季",summer:"夏季",autumn:"秋季"}[key],{winter:"Winter",spring:"Spring",summer:"Summer",autumn:"Autumn"}[key]),value}));
    const formatTotals=new Map(),losslessFormats=new Set(["FLAC","ALAC","WAV","AIFF"]);
    songs.forEach(item=>{const format=String(item.track?.format||item.entry.format||"").toUpperCase();if(format)formatTotals.set(format,(formatTotals.get(format)||0)+item.seconds);});
    const audioProfile={formats:[...formatTotals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5),losslessSeconds:[...formatTotals.entries()].filter(([format])=>losslessFormats.has(format)).reduce((sum,[,value])=>sum+value,0),sampleRateTracks:songs.filter(item=>Number(item.track?.sampleRate||item.entry.sampleRate)>=48000).length};
    const artistEvolution=monthly.map(row=>({label:row.label,name:row.name,value:row.value})).filter(row=>row.value>0&&row.name&&row.name!=="—");
    return {year,total,totalPlays,activeDays,bestDay,songs:songs.slice(0,12),topSong:songs[0]||null,topArtist:topRows(artists)[0]||null,topAlbum:topRows(albums)[0]||null,artists:topRows(artists),albums:topRows(albums),genres:topRows(genres),monthly,weekdays,seasons,hourBands,peakHour:hourTotals[peakHour]>0?peakHour:null,peakWeekday:weekdays.slice().sort((a,b)=>b.value-a.value)[0]||null,peakSeason:seasons.slice().sort((a,b)=>b.value-a.value)[0]||null,artistEvolution,audioProfile,uniqueSongs:songs.length};
  }
  let annualReportYear=null,annualAutoOpenedFor=0;
  function renderAnnualTabs(years,target,win){
    const host=$("#annualYearTabs");if(!host)return;
    host.innerHTML=years.map(year=>`<button type="button" class="${year===target?"active":""}" data-annual-year="${year}">${year}${win.open&&year===win.year?` · ${tr("新","New")}`:""}</button>`).join("");
  }
  function annualBarRows(rows,max=Math.max(1,...rows.map(row=>row.value))){return rows.map(row=>'<div class="annual-bar-row"><span>'+escapeHtml(row.label||row.name||row.key||'—')+'</span><i><b style="width:'+((row.value/max*100).toFixed(1))+'%"></b></i><em>'+fmtDuration(row.value)+'</em></div>').join('');}
  function attachAnnualReportMotion(host){
    host._annualMotionCleanup?.();
    host.classList.remove('is-ready');
    const sections=[...host.querySelectorAll('[data-annual-depth]')];
    const reveal=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting)entry.target.classList.add('is-visible');}),{root:host,threshold:.12});
    sections.forEach(section=>reveal.observe(section));
    let frame=0;
    const sync=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;const box=host.getBoundingClientRect();sections.forEach(section=>{const rect=section.getBoundingClientRect(),center=rect.top+rect.height/2,delta=(box.top+box.height/2-center)/Math.max(1,box.height);section.style.setProperty('--annual-shift',(Math.max(-1,Math.min(1,delta))*Number(section.dataset.annualDepth||0))+'em');});});};
    host.addEventListener('scroll',sync,{passive:true});
    addEventListener('resize',sync,{passive:true});
    host._annualMotionCleanup=()=>{reveal.disconnect();host.removeEventListener('scroll',sync);removeEventListener('resize',sync);if(frame)cancelAnimationFrame(frame);};
    requestAnimationFrame(()=>{host.classList.add('is-ready');sync();});
  }
  function renderAnnualBody(store,year){
    const host=$('#annualReportBody');if(!host)return;
    const report=buildAnnualReport(store,year);
    $('#annualReportTitle').textContent=tr(year+' 年度报告',year+' Annual Report');
    if(report.total<=0){host._annualMotionCleanup?.();host._annualMotionCleanup=null;setBatchedScrollHTML(host,'<div class="empty-state"><p>'+tr(year+' 年还没有听歌记录','No listening history for '+year)+'</p></div>');return;}
    const card=(label,value,detail)=>'<article class="annual-kpi"><span>'+label+'</span><strong>'+value+'</strong>'+(detail?'<small>'+detail+'</small>':'')+'</article>';
    const top=report.topSong,bestDayValue=report.bestDay?escapeHtml(report.bestDay.key)+' · '+fmtDuration(report.bestDay.value):'—';
    const peakValue=report.peakHour===null?tr('—','—'):tr(report.peakHour+':00 最活跃','Most active at '+report.peakHour+':00');
    const rankRows=report.songs.map((item,rank)=>{const cover=item.track?.thumbUrl||item.track?.coverUrl;const thumb=cover?'<img src="'+cover+'" class="track-thumb" loading="lazy" decoding="async">':'<div class="track-thumb"><span>'+escapeHtml((item.track?.title||item.entry.title||'?').trim().slice(0,1))+'</span></div>';return '<div class="top-row"><div class="top-rank">'+(rank+1)+'</div><div class="top-row-main">'+thumb+'<div class="top-info"><div class="t-title">'+escapeHtml(item.track?.title||item.entry.title)+'</div><div class="t-artist">'+escapeHtml(item.track?.artist||item.entry.artist)+'</div></div></div><div class="top-row-metrics"><div class="top-bar-wrap"><div class="top-bar-fill" style="width:'+((item.seconds/Math.max(1,report.songs[0].seconds)*100).toFixed(0))+'%"></div></div><div class="top-meta"><span>'+fmtDuration(item.seconds)+' · '+item.plays+tr('次',' plays')+'</span></div></div></div>';}).join('');
    const topSongTitle=top?escapeHtml(top.track?.title||top.entry.title):'—',topArtist=report.topArtist?escapeHtml(report.topArtist[0]):'—',topAlbum=report.topAlbum?escapeHtml(report.topAlbum[0]):'—';
    const audioLabel=report.audioProfile.losslessSeconds>0?tr('包含无损播放','Includes lossless listening'):tr('未记录无损格式','No lossless format recorded');
    let html='<div class="annual-report-story">';
    html+='<section class="annual-chapter annual-hero-chapter" data-annual-depth=".12"><div class="annual-kicker">GLASS PLAYER · '+tr('年度回顾','YEAR IN SOUND')+'</div><div class="annual-year">'+year+'</div><p>'+tr('这一年，你把时间交给了声音。','A year of your time, translated into sound.')+'</p><div class="annual-kpis">'+card(tr('听歌时间','Listening time'),fmtDuration(report.total),report.activeDays+tr('个活跃日',' active days'))+card(tr('播放次数','Plays'),report.totalPlays,report.uniqueSongs+tr('首独立歌曲',' unique songs'))+card(tr('年度之歌','Song of the year'),topSongTitle,top?fmtDuration(top.seconds):'—')+card(tr('年度艺人','Artist of the year'),topArtist)+card(tr('年度专辑','Album of the year'),topAlbum)+'</div></section>';
    html+='<section class="annual-chapter annual-feature-chapter" data-annual-depth="-.08"><div class="annual-chapter-index">01</div><div><h4>'+tr('年度之歌','THE SONG THAT STAYED')+'</h4><h2>'+topSongTitle+'</h2><p>'+(top?(escapeHtml(top.track?.artist||top.entry.artist||'')+' · '+fmtDuration(top.seconds)+' · '+top.plays+tr('次',' plays')):'—')+'</p></div><div class="annual-feature-number">01</div></section>';
    html+='<section class="annual-chapter" data-annual-depth=".05"><div class="annual-section-heading"><div><span>'+tr('节奏','RHYTHM')+'</span><h3>'+tr('你的听歌节拍','Your listening rhythm')+'</h3></div><p>'+tr('从日期、时段和季节，看见这一年的习惯。','A year of habits, seen through days, hours and seasons.')+'</p></div><div class="annual-rhythm-grid"><div><h5>'+tr('最活跃星期','Most active weekday')+'</h5><strong>'+escapeHtml(report.peakWeekday?.label||'—')+'</strong>'+annualBarRows(report.weekdays)+'</div><div><h5>'+tr('最常出现的时段','Most active hours')+'</h5><strong>'+peakValue+'</strong>'+annualBarRows(report.hourBands)+'</div><div><h5>'+tr('季节偏好','Seasonal listening')+'</h5><strong>'+escapeHtml(report.peakSeason?.label||'—')+'</strong>'+annualBarRows(report.seasons)+'</div></div></section>';
    html+='<section class="annual-chapter" data-annual-depth="-.06"><div class="annual-section-heading"><div><span>'+tr('时间线','TIMELINE')+'</span><h3>'+tr('十二个月的起伏','Twelve months in motion')+'</h3></div></div><div class="annual-month-grid">'+annualBarRows(report.monthly)+'</div><div class="annual-evolution">'+report.artistEvolution.map(row=>'<span>'+escapeHtml(row.label)+'<b>'+escapeHtml(row.name)+'</b></span>').join('')+'</div></section>';
    html+='<section class="annual-chapter annual-ranking-chapter" data-annual-depth=".1"><div class="annual-section-heading"><div><span>'+tr('排行榜','RANKINGS')+'</span><h3>'+tr('重复播放的那些歌','The songs you returned to')+'</h3></div><p>'+tr('按年度听歌时长排序，显示最多 12 首。','Ranked by listening time, up to 12 songs.')+'</p></div><div class="annual-ranking-list">'+rankRows+'</div></section>';
    const dims=[[tr('最爱艺人','Favorite artists'),report.artists],[tr('最爱专辑','Favorite albums'),report.albums],[tr('最爱风格','Favorite genres'),report.genres]];
    html+='<section class="annual-chapter" data-annual-depth="-.05"><div class="annual-section-heading"><div><span>'+tr('偏好版图','YOUR MAP')+'</span><h3>'+tr('艺人、专辑与风格','Artists, albums and genres')+'</h3></div></div><div class="annual-dims">'+dims.map(pair=>'<div class="annual-dim"><h5>'+pair[0]+'</h5>'+annualBarRows(pair[1].map(row=>({name:row[0],value:row[1]})))+'</div>').join('')+'</div></section>';
    html+='<section class="annual-chapter" data-annual-depth=".07"><div class="annual-section-heading"><div><span>'+tr('音质档案','AUDIO PROFILE')+'</span><h3>'+tr('你听到的声音','The sound you chose')+'</h3></div></div><div class="annual-audio-grid"><div><strong>'+audioLabel+'</strong><span>'+fmtDuration(report.audioProfile.losslessSeconds)+' '+tr('无损时长','lossless time')+'</span></div><div><strong>'+tr('高采样率曲目','High sample-rate tracks')+'</strong><span>'+report.audioProfile.sampleRateTracks+'</span></div><div><strong>'+tr('记录到的格式','Formats recorded')+'</strong><span>'+(report.audioProfile.formats.map(row=>escapeHtml(row[0])).join(' · ')||'—')+'</span></div></div></section>';
    html+='<section class="annual-chapter annual-closing-chapter" data-annual-depth="-.1"><div class="annual-closing-number">'+fmtDuration(report.total)+'</div><h3>'+tr('这一年，感谢你一直在听。','Thanks for listening all year.')+'</h3><p>'+tr('单日最高是 '+bestDayValue+'。所有统计均在本地生成。','Your peak day was '+bestDayValue+'. Every statistic was generated locally.')+'</p><small>'+tr('歌曲文件不会离开设备；本报告只读取现有听歌历史。','Audio files never leave this device; this report reads only existing listening history.')+'</small></section></div>';
    host.innerHTML=html;
    attachAnnualReportMotion(host);
  }
  function openAnnualReport(year){
    const store=loadHistoryStore(),win=annualReportWindow();
    const years=annualAvailableYears(store);
    if(win.open&&!years.includes(win.year))years.unshift(win.year);
    const target=years.includes(year)?year:(win.open?win.year:years[0]);
    if(target===undefined){showToast(tr("还没有听歌记录","No listening history yet"));return;}
    annualReportYear=target;
    renderAnnualTabs(years,target,win);
    renderAnnualBody(store,target);
    $("#annualReportModal").classList.add("show");
    setTimeout(()=>{try{scheduleScrollEdgeUpdate($("#annualReportBody"));}catch(error){}},260);
  }
  function closeAnnualReport(){$("#annualReportModal").classList.remove("show");}
  function maybeAutoOpenAnnualReport(){
    const win=annualReportWindow();
    if(!win.open||annualAutoOpenedFor===win.year)return;
    if(!$(".view[data-view=\"history\"]")?.classList.contains("active"))return;
    annualAutoOpenedFor=win.year;openAnnualReport(win.year);
  }
  function syncAnnualButton(){
    const button=$("#annualReportBtn");if(!button)return;
    const win=annualReportWindow();
    button.textContent=tr("年度报告","Annual Report");
    button.classList.toggle("fresh",win.open);
    button.title=win.open?tr(`${win.year} 年度报告已开放，1 月 14 日截止`,`${win.year} report is open until January 14`):tr("查看往年报告","Browse past yearly reports");
  }
  function buildAnnualReportHTML(report){
    const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const fmt=seconds=>{const total=Math.round(seconds||0),hours=Math.floor(total/3600),minutes=Math.floor(total%3600/60);return hours?hours+'h '+minutes+'m':minutes?minutes+' min':total+' sec';};

    // helper for bar charts
    const barRows=rows=>rows.map(row=>`<div class="bar-row"><span>${esc(row.label||row.name||row.key||'-')}</span><i><b style="width:${(row.value/Math.max(1,...rows.map(item=>item.value))*100).toFixed(1)}%"></b></i><em>${fmt(row.value)}</em></div>`).join('');

    const top=report.topSong;
    const topTitle=top?.track?.title||top?.entry.title||'-';
    const topArtist=report.topArtist?.[0]||'-';
    const topAlbum=report.topAlbum?.[0]||'-';

    // Top 12 list
    const top12 = report.songs.slice(0, 12);
    const maxSeconds = Math.max(1, ...top12.map(s => s.seconds));
    const rows=top12.map((item,index)=>{
      const badge = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : String(index+1).padStart(2,'0');
      const pct = (item.seconds / maxSeconds * 100).toFixed(1);
      return `<div class="rank"><div class="badge">${badge}</div><div class="rank-info"><b>${esc(item.track?.title||item.entry.title)}</b><small>${esc(item.track?.artist||item.entry.artist||'')}</small><div class="rank-bar"><div style="width:${pct}%"></div></div></div><div class="rank-stats"><em>${fmt(item.seconds)}</em><span>${item.plays} plays</span></div></div>`;
    }).join('');

    const dims=[['Top Artists',report.artists],['Top Albums',report.albums],['Top Genres',report.genres]].map(pair=>`<div class="dim-panel"><h4>${pair[0]}</h4><div class="bars">${barRows(pair[1].map(row=>({name:row[0],value:row[1]})))}</div></div>`).join('');

    const style = `
      :root {
        --bg-obsidian: #08090d;
        --bg-velvet: #0e1017;
        --accent-cyan: #00f0ff;
        --accent-magenta: #ff0055;
        --accent-amber: #ffb800;
        --accent-indigo: #4d00ff;
        --text-main: #f0f2f5;
        --text-muted: #8b949e;
        --font-base: "Inter", system-ui, -apple-system, sans-serif;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      html { scroll-behavior: smooth; background: var(--bg-obsidian); }
      body {
        font-family: var(--font-base);
        color: var(--text-main);
        background: radial-gradient(circle at 15% 10%, rgba(77, 0, 255, 0.15) 0%, transparent 40%),
                    radial-gradient(circle at 85% 90%, rgba(255, 0, 85, 0.1) 0%, transparent 40%);
        background-attachment: fixed;
        overflow-x: hidden;
      }
      /* Sticky Header */
      header.top-nav {
        position: fixed; top: 0; left: 0; width: 100%; z-index: 1000;
        background: rgba(8, 9, 13, 0.7); backdrop-filter: blur(16px);
        display: flex; flex-direction: column;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      .progress-bar { height: 4px; width: 100%; background: rgba(255,255,255,0.1); }
      .progress-fill { height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent-cyan), var(--accent-magenta)); transform-origin: left; }
      .nav-inner { display: flex; justify-content: space-between; align-items: center; padding: 12px 24px; }
      .nav-pills { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
      .nav-pills::-webkit-scrollbar { display: none; }
      .pill { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; color: var(--text-muted); background: rgba(255,255,255,0.05); cursor: pointer; text-decoration: none; transition: 0.3s; white-space: nowrap; }
      .pill.active, .pill:hover { background: rgba(255,255,255,0.15); color: #fff; box-shadow: 0 0 10px rgba(0, 240, 255, 0.3); }
      .btn-print { background: linear-gradient(135deg, var(--accent-indigo), var(--accent-magenta)); border: none; color: white; padding: 6px 16px; border-radius: 20px; font-weight: bold; cursor: pointer; font-size: 13px; display: flex; align-items: center; gap: 6px; }
      .btn-print:hover { filter: brightness(1.2); }

      main { width: min(1200px, 100%); margin: auto; padding: 80px 4vw 16vh; }

      .chapter {
        min-height: 85vh; display: flex; flex-direction: column; justify-content: center;
        padding: 10vh 0; position: relative;
        opacity: 0; transform: translateY(60px) scale(0.95); filter: blur(8px);
        transition: opacity 1s ease, transform 1s cubic-bezier(0.2, 0.8, 0.2, 1), filter 1s ease;
      }
      .chapter.visible { opacity: 1; transform: translateY(var(--parallax-shift, 0px)) scale(1); filter: blur(0); }

      /* Typography */
      .eyebrow { font-size: 14px; text-transform: uppercase; letter-spacing: 0.2em; color: var(--accent-cyan); font-weight: 800; margin-bottom: 16px; display: inline-block; padding-bottom: 4px; border-bottom: 2px solid var(--accent-cyan); }
      h1 { font-size: clamp(60px, 10vw, 150px); line-height: 0.9; font-weight: 900; letter-spacing: -0.05em; background: linear-gradient(135deg, #fff, var(--text-muted)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 20px; }
      h2 { font-size: clamp(36px, 6vw, 72px); line-height: 1.1; margin-bottom: 16px; font-weight: 800; color: #fff; }
      h3 { font-size: 24px; color: #fff; margin-bottom: 12px; }
      p { font-size: clamp(16px, 2vw, 24px); color: var(--text-muted); max-width: 800px; line-height: 1.6; }

      /* Cover Stats */
      .hero-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 60px; }
      .hero-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 24px; transition: 0.3s; backdrop-filter: blur(10px); }
      .hero-card:hover { transform: translateY(-5px); background: rgba(255,255,255,0.08); border-color: var(--accent-cyan); box-shadow: 0 10px 30px rgba(0,240,255,0.1); }
      .hero-card .lbl { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); font-weight: 700; margin-bottom: 8px; }
      .hero-card .val { font-size: 28px; font-weight: 800; color: #fff; }

      /* Chapter 01 Vinyl */
      .vinyl-container { display: flex; align-items: center; gap: 40px; margin-top: 40px; flex-wrap: wrap; }
      .vinyl-disc { width: 300px; height: 300px; border-radius: 50%; background: repeating-radial-gradient(#111 0%, #000 5%, #111 10%); box-shadow: 0 0 50px rgba(255,0,85,0.3), inset 0 0 20px rgba(255,255,255,0.1); position: relative; animation: spin 10s linear infinite; display: grid; place-items: center; }
      .vinyl-label { width: 100px; height: 100px; border-radius: 50%; background: linear-gradient(135deg, var(--accent-magenta), var(--accent-amber)); border: 4px solid #111; }
      .vinyl-hole { width: 12px; height: 12px; border-radius: 50%; background: var(--bg-obsidian); position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
      @keyframes spin { 100% { transform: rotate(360deg); } }
      .soty-info h3 { font-size: 48px; margin-bottom: 8px; background: linear-gradient(90deg, #fff, var(--accent-cyan)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
      .soty-info p { font-size: 24px; margin-bottom: 16px; color: var(--text-main); }

      /* Grids */
      .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 30px; margin-top: 40px; }
      .dim-panel { background: rgba(255,255,255,0.02); padding: 30px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05); }
      .dim-panel h4 { font-size: 20px; margin-bottom: 24px; color: var(--accent-amber); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 12px; }

      /* Bar Charts */
      .bars { display: flex; flex-direction: column; gap: 12px; }
      .bar-row { display: grid; grid-template-columns: minmax(80px, 1fr) 2fr 70px; align-items: center; gap: 12px; font-size: 14px; }
      .bar-row span { color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .bar-row i { height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; }
      .bar-row b { display: block; height: 100%; background: linear-gradient(90deg, var(--accent-indigo), var(--accent-cyan)); border-radius: 4px; transition: width 1s ease-out; }
      .bar-row em { font-style: normal; text-align: right; color: var(--text-muted); font-variant-numeric: tabular-nums; }

      /* Evolution Timeline */
      .evolution { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
      .ev-badge { background: rgba(255,255,255,0.05); padding: 10px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); display: flex; gap: 12px; align-items: center; transition: 0.3s; }
      .ev-badge:hover { background: rgba(255,255,255,0.1); border-color: var(--accent-amber); transform: translateY(-2px); }
      .ev-badge span { color: var(--text-muted); font-size: 12px; }
      .ev-badge b { color: #fff; font-size: 16px; }

      /* Rankings */
      .rankings { margin-top: 40px; display: flex; flex-direction: column; gap: 12px; }
      .rank { display: grid; grid-template-columns: 50px 1fr auto; align-items: center; gap: 20px; background: rgba(255,255,255,0.02); padding: 16px 24px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05); transition: 0.3s; }
      .rank:hover { background: rgba(255,255,255,0.05); transform: translateX(10px); border-color: rgba(255,255,255,0.2); }
      .badge { font-size: 24px; font-weight: 900; color: var(--text-muted); text-align: center; }
      .rank-info b { display: block; font-size: 18px; color: #fff; margin-bottom: 4px; }
      .rank-info small { color: var(--text-muted); font-size: 14px; }
      .rank-bar { height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; margin-top: 8px; overflow: hidden; width: 60%; }
      .rank-bar div { height: 100%; background: var(--accent-amber); border-radius: 2px; }
      .rank-stats { text-align: right; }
      .rank-stats em { display: block; font-style: normal; font-size: 16px; color: #fff; font-weight: bold; }
      .rank-stats span { font-size: 12px; color: var(--text-muted); }

      /* Footer */
      .closing { text-align: center; align-items: center; }
      .watermark { opacity: 0.3; margin: 40px 0; max-width: 400px; }
      .privacy-seal { display: inline-flex; align-items: center; gap: 8px; background: rgba(0, 255, 128, 0.1); color: #00ff80; padding: 12px 24px; border-radius: 30px; font-size: 14px; font-weight: bold; border: 1px solid rgba(0, 255, 128, 0.3); margin-top: 20px; }

      @media print {
        body { background: #fff; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        header.top-nav { display: none; }
        .chapter { opacity: 1; transform: none; filter: none; min-height: auto; page-break-inside: avoid; padding: 20px 0; }
        h1, h2, h3, h4, .val, .rank-info b { color: #000; -webkit-text-fill-color: #000; }
        .hero-card, .dim-panel, .rank, .ev-badge { background: #f0f0f0; border-color: #ccc; box-shadow: none; }
        .bar-row span, p, .text-muted { color: #333; }
        .bar-row i { background: #ddd; }
        .vinyl-disc { box-shadow: none; border: 1px solid #ccc; animation: none; }
        .privacy-seal { background: #e0ffe0; color: #008000; border-color: #008000; }
      }

      @media (max-width: 768px) {
        .rank { grid-template-columns: 30px 1fr; gap: 12px; }
        .rank-stats { grid-column: 2; text-align: left; display: flex; gap: 12px; align-items: center; }
        .hero-grid { grid-template-columns: 1fr 1fr; }
        .nav-inner { padding: 12px; }
      }
    `;

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Glass Player Replay Atlas ${report.year}</title>
  <style>${style}</style>
</head>
<body>
  <header class="top-nav">
    <div class="progress-bar"><div class="progress-fill" id="scrollProgress"></div></div>
    <div class="nav-inner">
      <div class="nav-pills" id="navPills">
        <a href="#prologue" class="pill active">Prologue</a>
        <a href="#ch01" class="pill">01. Song</a>
        <a href="#ch02" class="pill">02. Rhythm</a>
        <a href="#ch03" class="pill">03. Time</a>
        <a href="#ch04" class="pill">04. Top 12</a>
        <a href="#ch05" class="pill">05. Map</a>
        <a href="#ch06" class="pill">06. Profile</a>
        <a href="#epilogue" class="pill">Epilogue</a>
      </div>
      <button class="btn-print" onclick="window.print()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
        Save / Print
      </button>
    </div>
  </header>

  <main>
    <section class="chapter" id="prologue" data-depth="0.05">
      <div class="eyebrow">REPLAY ATLAS · 声音旅程</div>
      <h1>${report.year}</h1>
      <p>A year of your time, translated into sound. Every beat, every silence, mapped locally on your device.</p>

      <div class="hero-grid">
        <div class="hero-card"><div class="lbl">Listening Time</div><div class="val">${fmt(report.total)}</div></div>
        <div class="hero-card"><div class="lbl">Plays</div><div class="val">${report.totalPlays}</div></div>
        <div class="hero-card"><div class="lbl">Active Days</div><div class="val">${report.activeDays}</div></div>
        <div class="hero-card"><div class="lbl">Unique Songs</div><div class="val">${report.uniqueSongs}</div></div>
        <div class="hero-card"><div class="lbl">Top Artist</div><div class="val">${esc(topArtist)}</div></div>
        <div class="hero-card"><div class="lbl">Top Album</div><div class="val">${esc(topAlbum)}</div></div>
      </div>
    </section>

    <section class="chapter" id="ch01" data-depth="-0.04">
      <div class="eyebrow">Chapter 01 / 年度之歌 (Song of the Year)</div>
      <h2>The sound that defined your year</h2>
      <div class="vinyl-container">
        <div class="vinyl-disc">
          <div class="vinyl-label"><div class="vinyl-hole"></div></div>
        </div>
        <div class="soty-info">
          <h3>${esc(topTitle)}</h3>
          <p>${esc(top?.track?.artist||top?.entry.artist||'')}</p>
          <div class="ev-badge" style="display:inline-flex;">
            <span>Repeated</span><b>${top?.plays||0} times</b>
          </div>
          <div class="ev-badge" style="display:inline-flex; margin-left: 12px;">
            <span>Listened for</span><b>${top ? fmt(top.seconds) : '-'}</b>
          </div>
        </div>
      </div>
    </section>

    <section class="chapter" id="ch02" data-depth="0.06">
      <div class="eyebrow">Chapter 02 / 声音的昼夜与四季节拍</div>
      <h2>Rhythm & Circadian Flow</h2>
      <div class="grid-3">
        <div class="dim-panel">
          <h4>24-Hour Daypart</h4>
          <p style="font-size:14px; margin-bottom: 12px; color: var(--accent-cyan);">Peak: ${esc(report.peakHour===null?'-':report.peakHour+':00')}</p>
          <div class="bars">${barRows(report.hourBands)}</div>
        </div>
        <div class="dim-panel">
          <h4>Weekly Flow</h4>
          <p style="font-size:14px; margin-bottom: 12px; color: var(--accent-cyan);">Peak: ${esc(report.peakWeekday?.label||'-')}</p>
          <div class="bars">${barRows(report.weekdays)}</div>
        </div>
        <div class="dim-panel">
          <h4>Seasonal Tides</h4>
          <p style="font-size:14px; margin-bottom: 12px; color: var(--accent-cyan);">Peak: ${esc(report.peakSeason?.label||'-')}</p>
          <div class="bars">${barRows(report.seasons)}</div>
        </div>
      </div>
    </section>

    <section class="chapter" id="ch03" data-depth="-0.03">
      <div class="eyebrow">Chapter 03 / 12 个月的流动故事</div>
      <h2>Twelve Months in Motion</h2>
      <p>Your listening peaks and the monthly top artist evolution.</p>
      <div class="grid-3">
        <div class="dim-panel" style="grid-column: 1 / -1;">
          <div class="bars" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 24px;">
            <div style="flex:1;">
              <h4 style="font-size:16px;">Monthly Volume</h4>
              <div class="bars">${barRows(report.monthly)}</div>
            </div>
            <div style="flex:1;">
              <h4 style="font-size:16px;">Top Artist by Month</h4>
              <div class="evolution" style="margin-top:0;">
                ${report.artistEvolution.map(row=>`<div class="ev-badge"><span>${esc(row.label)}</span><b>${esc(row.name)}</b></div>`).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="chapter" id="ch04" data-depth="0.05">
      <div class="eyebrow">Chapter 04 / 年度百炼排行榜 Top 12</div>
      <h2>The Hall of Fame</h2>
      <div class="rankings">${rows}</div>
    </section>

    <section class="chapter" id="ch05" data-depth="-0.05">
      <div class="eyebrow">Chapter 05 / 偏好版图与星系</div>
      <h2>Cartography of Taste</h2>
      <div class="grid-3">${dims}</div>
    </section>

    <section class="chapter" id="ch06" data-depth="0.04">
      <div class="eyebrow">Chapter 06 / 发烧与音质档案</div>
      <h2>Audiophile & Acoustic DNA</h2>
      <div class="grid-3">
        <div class="hero-card"><div class="lbl">Lossless Listening</div><div class="val">${fmt(report.audioProfile.losslessSeconds)}</div></div>
        <div class="hero-card"><div class="lbl">High Sample-Rate</div><div class="val">${report.audioProfile.sampleRateTracks} tracks</div></div>
        <div class="hero-card"><div class="lbl">Formats Discovered</div><div class="val" style="font-size:18px;">${esc(report.audioProfile.formats.map(row=>row[0]).join(' · ')||'-')}</div></div>
      </div>
    </section>

    <section class="chapter" id="epilogue" data-depth="-0.02" style="align-items: center; text-align: center;">
      <div class="eyebrow">Chapter 07 & Epilogue / 尾声</div>
      <h2>Thanks for listening.</h2>
      <p style="margin: 20px auto;">Your single highest listening day was <strong>${esc(report.bestDay?.key||'-')}</strong>.</p>

      <div class="privacy-seal">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
        100% 本地生成 · 零数据上传 · 音乐文件始终保留在你的设备中
      </div>

      <div style="margin-top: 60px; font-weight: 800; color: var(--text-muted); font-size: 14px; letter-spacing: 0.2em;">
        GLASS PLAYER GEN 7<br>REPLAY ATLAS
      </div>
    </section>
  </main>

  <script>
    (function(){
      const sections = Array.from(document.querySelectorAll(".chapter"));
      const bar = document.getElementById("scrollProgress");
      const pills = Array.from(document.querySelectorAll(".pill"));

      let frame = 0;
      function sync() {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const h = document.documentElement.scrollHeight - window.innerHeight;
          const scroll = window.scrollY;
          bar.style.width = (h ? (scroll / h) * 100 : 0) + "%";

          let currentId = '';
          sections.forEach(s => {
            const r = s.getBoundingClientRect();
            const p = (window.innerHeight / 2 - (r.top + r.height / 2)) / window.innerHeight;
            // Parallax shift calculation
            const depth = Number(s.dataset.depth || 0);
            const shift = Math.max(-1, Math.min(1, p)) * depth * 200;
            s.style.setProperty("--parallax-shift", shift + "px");

            // Determine active section for nav pills
            if (r.top < window.innerHeight / 2 && r.bottom > window.innerHeight / 2) {
              currentId = s.id;
            }
          });

          if (currentId) {
            pills.forEach(pill => {
              if (pill.getAttribute("href") === "#" + currentId) {
                pill.classList.add("active");
                // Center active pill in nav if scrollable
                pill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
              } else {
                pill.classList.remove("active");
              }
            });
          }
        });
      }

      const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
          }
        });
      }, { threshold: 0.15 });

      sections.forEach(s => io.observe(s));

      window.addEventListener("scroll", sync, { passive: true });
      window.addEventListener("resize", sync);
      sync();

      // Smooth scroll for nav pills
      pills.forEach(pill => {
        pill.addEventListener("click", (e) => {
          e.preventDefault();
          const targetId = pill.getAttribute("href").substring(1);
          const target = document.getElementById(targetId);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth' });
          }
        });
      });
    })();
  </script>
</body>
</html>`;
    return html;
  }
  function downloadAnnualReport(year){
    const store=loadHistoryStore(),report=buildAnnualReport(store,year);
    if(report.total<=0){showToast(tr("这一年还没有听歌记录","No listening history for this year"));return;}
    const blob=new Blob(["﻿",buildAnnualReportHTML(report)],{type:"text/html;charset=utf-8"});
    const url=URL.createObjectURL(blob),link=document.createElement("a");
     link.href=url;link.download=`Glass Player Replay Atlas Annual Report ${year}.html`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
    showToast(tr("年度报告已导出","Annual report exported"));
  }
  $("#annualReportBtn").addEventListener("click",()=>openAnnualReport());
  $("#annualCloseBtn").addEventListener("click",closeAnnualReport);
  $("#annualDownloadBtn").addEventListener("click",()=>{if(annualReportYear!==null&&annualReportYear!==undefined)downloadAnnualReport(annualReportYear);});
  $("#annualReportModal").addEventListener("click",event=>{if(event.target===$("#annualReportModal"))closeAnnualReport();});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&$("#annualReportModal")?.classList.contains("show"))closeAnnualReport();});
  $("#annualYearTabs").addEventListener("click",event=>{const button=event.target.closest("[data-annual-year]");if(button)openAnnualReport(Number(button.dataset.annualYear));});
  const historyRenderedSignatures=new Map();
  function renderHistory(){
    /* Metadata migration already runs after import and manual rescan. Repeating
       the full identity reconciliation on every tab click blocked first paint. */
    const store=loadHistoryStore(),mode=$("#historyModeSeg button.active")?.dataset.historyMode||"time";
    lastVisibleHistoryRefreshAt=Date.now();
    syncAnnualButton();
    $$(".history-pane").forEach(p=>p.classList.toggle("active",p.id===({time:"historyTimePane",favorites:"historyFavoritesPane",data:"historyDataPane"}[mode])));
    const activeRange=$("#rangeSeg button.active")?.dataset.r||"day";
    const signature=`${historyStoreRevision}|${uiLanguage}|${playlist.length}|${activeRange}`;
    if(historyRenderedSignatures.get(mode)===signature)return;
    historyRenderedSignatures.set(mode,signature);
    if(mode==="favorites"){renderRecentFavorites(store);return;}if(mode==="data"){renderListeningData(store);return;}
    const range=activeRange,dateRange=calendarHistoryRange(range),total=sumDailyRange(store.daily,dateRange);
    $("#statNumber").textContent=fmtDuration(total);
    $("#historyStatTopSong").textContent="—";
    if(total<=0){const compare=$("#historyCompare"),topList=$("#topList");compare.textContent=tr("当前无听歌数据","No listening data for this period");compare.className="history-compare flat";setBatchedScrollHTML(topList,`<div class="empty-state"><p>${tr("当前无听歌数据","No listening data for this period")}</p></div>`);return;}
    renderHistoryComparison(store,range,dateRange,total);renderHistoryRanking(store,dateRange);
  }
  let historyModeRenderFrame=0,historyIdleRender=0,historyFallbackTimer=0;
  function cancelScheduledHistoryRender(){
    if(historyModeRenderFrame){cancelAnimationFrame(historyModeRenderFrame);historyModeRenderFrame=0;}
    if(historyIdleRender&&"cancelIdleCallback" in window){cancelIdleCallback(historyIdleRender);historyIdleRender=0;}
    if(historyFallbackTimer){clearTimeout(historyFallbackTimer);historyFallbackTimer=0;}
  }
  function scheduleHistoryRender(){
    cancelScheduledHistoryRender();
    historyModeRenderFrame=requestAnimationFrame(()=>{
      historyModeRenderFrame=0;
      const run=()=>{historyIdleRender=0;historyFallbackTimer=0;renderHistory();requestAnimationFrame(refreshScrollEdgeFrames);};
      if("requestIdleCallback" in window)historyIdleRender=requestIdleCallback(run,{timeout:180});
      else historyFallbackTimer=setTimeout(run,24);
    });
  }
  function scheduleVisibleHistoryRefresh(){
    const historyView=$(".view[data-view=\"history\"]");
    if(!historyView?.classList.contains("active"))return;
    clearTimeout(visibleHistoryRefreshTimer);
    const delay=Math.max(250,30000-(Date.now()-lastVisibleHistoryRefreshAt));
    visibleHistoryRefreshTimer=setTimeout(()=>{
      visibleHistoryRefreshTimer=0;
      if($(".view[data-view=\"history\"]")?.classList.contains("active"))scheduleHistoryRender();
    },delay);
  }
  $("#historyModeSeg").addEventListener("click",e=>{
    const btn=e.target.closest("button");if(!btn)return;
    $$("#historyModeSeg button").forEach(b=>b.classList.remove("active"));btn.classList.add("active");
    const mode=btn.dataset.historyMode,targetId={time:"historyTimePane",favorites:"historyFavoritesPane",data:"historyDataPane"}[mode];
    requestAnimationFrame(()=>updateGlider($("#historyModeSeg"),true));
    const host=$("#historyModeSeg");
    transitionMotionSector(host,()=>$(".history-pane.active"),()=>{
      let target=null;
      $$(".history-pane").forEach(p=>{const active=p.id===targetId;p.classList.toggle("active",active);if(active)target=p;});
      /* Render while the old pane is already invisible, before the new pane
         begins its entry. A superseded rapid click leaves rendering to the
         final queued target instead of flashing intermediate statistics. */
      if($("#historyModeSeg button.active")?.dataset.historyMode===mode){
        cancelScheduledHistoryRender();renderHistory();
      }
      requestAnimationFrame(refreshScrollEdgeFrames);return target;
    },true);
  });
  document.addEventListener("pointerover",e=>{const target=e.target.closest?.("[data-chart-tip]");if(!target)return;const tip=$("#chartTooltip");tip.textContent=target.dataset.chartTip;tip.classList.add("show");});
  let chartTooltipFrame=0,chartTooltipPoint=null;
  document.addEventListener("pointermove",e=>{const tip=$("#chartTooltip");if(!tip.classList.contains("show"))return;chartTooltipPoint={x:e.clientX,y:e.clientY};if(chartTooltipFrame)return;chartTooltipFrame=requestAnimationFrame(()=>{chartTooltipFrame=0;if(!chartTooltipPoint||!tip.classList.contains("show"))return;tip.style.left=`${Math.min(innerWidth-tip.offsetWidth-12,chartTooltipPoint.x+14)}px`;tip.style.top=`${Math.min(innerHeight-tip.offsetHeight-12,chartTooltipPoint.y+14)}px`;});});
  document.addEventListener("pointerout",e=>{if(e.target.closest?.("[data-chart-tip]"))$("#chartTooltip").classList.remove("show");});

  /* ================= seek bar + track peak/format analysis ================= */
  let seekProgress = 0;
  function loadWaveformFor(t){
    drawWaveform();
    updateTrackInfoCard(t);
  }
  function drawWaveform(){
    if(!audio.duration){ $("#seek").value = 0; $("#seek").style.setProperty("--seek-pct","0%"); return; }
    const pct = seekProgress*100;
    $("#seek").value = Math.round(seekProgress*1000);
    $("#seek").style.setProperty("--seek-pct", pct+"%");
  }
  let seekBehaviorStart=null,seekEnvelopeActive=false;
  $("#seek").addEventListener("pointerdown",()=>{seekBehaviorStart=finiteNumber(audio.currentTime,0);settleBehaviorProgress();if(audioCtx&&isPlaying){seekEnvelopeActive=true;smoothAudioParam(masterGain.gain,0,.012);}});
  $("#seek").addEventListener("input", () => {
    if(!audio.duration) return;
    flushHistory();
    const ratio = $("#seek").value/1000;
    audio.currentTime = ratio * audio.duration;
    lastTimeMark = audio.currentTime;
    seekProgress = ratio;
    $("#seek").style.setProperty("--seek-pct", (ratio*100)+"%");
    resetBehaviorMediaClock();
  });
  $("#seek").addEventListener("change",()=>{if(seekBehaviorStart===null)return;const to=finiteNumber(audio.currentTime,0);recordBehaviorEvent("seek",playlist[currentIndex]||null,{from:seekBehaviorStart,to,duration:finiteNumber(audio.duration,0),delta:to-seekBehaviorStart});seekBehaviorStart=null;resetBehaviorMediaClock();if(seekEnvelopeActive&&audioCtx){seekEnvelopeActive=false;smoothAudioParam(masterGain.gain,parseFloat($("#vol").value)||0.7,.02);}});
  GP.spatialPresets = (() => {
    const freezePreset=value=>{if(value&&typeof value==="object"){Object.values(value).forEach(freezePreset);Object.freeze(value);}return value;};
    const presets=freezePreset({
      none:{id:"none",name:{zh:"无空间音效",en:"No Spatial Audio"},description:{zh:"关闭全部空间处理。",en:"Disables all spatial processing."},lowSideGain:1,midWidth:1,highWidth:1,crossfeed:null,hrtf:{angle:0,wet:0},reflectionWet:0,reverb:null,chorus:null,outputTrimDb:0},
      orbit:{id:"orbit",name:{zh:"环绕音",en:"Orbit"},description:{zh:"经典 3D 环绕，声像缓慢绕头部旋转。",en:"Classic 3D surround that slowly circles around the listener."},mainGain:.72,lowSideGain:.04,midWidth:1.02,highWidth:1.05,crossfeed:null,hrtf:{angle:0,wet:.42},reflectionWet:.012,reverb:null,chorus:null,orbit:{rate:.09,depth:.88},outputTrimDb:-1.5},
      desktop:{id:"desktop",name:{zh:"桌面音响",en:"Desktop Speakers"},description:{zh:"把声音自然移到面前，适合长期听。",en:"Moves the sound naturally in front for long listening."},lowSideGain:.15,midWidth:1.01,highWidth:1.04,crossfeed:{gainDb:-22,delay:.00028,lowpass:900},hrtf:{angle:30,wet:0},reflectionWet:.015,reverb:null,chorus:null,outputTrimDb:-.5},
      studio:{id:"studio",name:{zh:"监听音箱",en:"Studio Monitors"},description:{zh:"中央更准、染色更少，适合检查人声。",en:"Tighter center and minimal colour for checking vocals."},lowSideGain:.10,midWidth:1,highWidth:1.02,crossfeed:{gainDb:-26,delay:.00022,lowpass:1000},hrtf:{angle:25,wet:0},reflectionWet:0,reverb:null,chorus:null,outputTrimDb:-.3},
      wide:{id:"wide",name:{zh:"宽阔舞台",en:"Wide Stage"},description:{zh:"主要向左右展开，房间感很轻。",en:"Expands mainly sideways with little room colour."},lowSideGain:.05,midWidth:1.05,highWidth:1.10,crossfeed:null,hrtf:{angle:35,wet:.06},reflectionWet:.015,reverb:null,chorus:null,outputTrimDb:-.8},
      front:{id:"front",name:{zh:"前置双耳",en:"Front Binaural"},description:{zh:"明显减少脑内感，把声像推向前方。",en:"Reduces in-head sound and pushes the image forward."},lowSideGain:.10,midWidth:1.01,highWidth:1.04,crossfeed:null,hrtf:{angle:28,wet:.22},reflectionWet:.02,reverb:null,chorus:null,outputTrimDb:-1},
      hall:{id:"hall",name:{zh:"现场大厅",en:"Live Hall"},description:{zh:"舞台更远，增加演出厅空间和尾音。",en:"Adds concert-hall distance, space and ambience."},lowSideGain:0,midWidth:1.03,highWidth:1.08,crossfeed:null,hrtf:{angle:35,wet:.12},reflectionWet:.045,reverb:{wet:.025,decay:.55,highpass:200,lowpass:7500},chorus:null,outputTrimDb:-1.3},
      cinema:{id:"cinema",name:{zh:"影院",en:"Cinema"},description:{zh:"更宽、更远，并增强前后深度。",en:"Creates a wider, farther stage with stronger depth."},lowSideGain:0,midWidth:1.04,highWidth:1.10,crossfeed:null,hrtf:{angle:42,wet:.20},reflectionWet:.055,reverb:{wet:.035,decay:.60,highpass:180,lowpass:7000},chorus:null,outputTrimDb:-1.6},
      dream:{id:"dream",name:{zh:"梦境",en:"Dreamscape"},description:{zh:"柔和漂浮、略带朦胧，适合氛围音乐。",en:"Soft, floating and hazy for atmospheric music."},lowSideGain:.05,midWidth:1.05,highWidth:1.12,crossfeed:null,hrtf:{angle:38,wet:.10},reflectionWet:.025,reverb:{wet:.04,decay:.75,highpass:220,lowpass:8000},chorus:{wet:.012,baseDelay:.012,depth:.001,rate:.18},outputTrimDb:-1.3}
    });
    function getPreset(id){return presets[id]||null;}
    function getAllPresets(){return Object.freeze(Object.values(presets));}
    function getDescription(id,language){const preset=getPreset(id);return preset?.description?.[language==="en"?"en":"zh"]||"";}
    return Object.freeze({getPreset,getAllPresets,getDescription});
  })();
  GP.pipRenderer = (() => {
    function roundedRect(ctx,x,y,width,height,radius){
      const r=Math.max(0,Math.min(radius,width/2,height/2));ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+width,y,x+width,y+height,r);ctx.arcTo(x+width,y+height,x,y+height,r);ctx.arcTo(x,y+height,x,y,r);ctx.arcTo(x,y,x+width,y,r);ctx.closePath();
    }
    function fitText(ctx,text,maxWidth){
      const value=String(text||"");if(ctx.measureText(value).width<=maxWidth)return value;let low=0,high=value.length;while(low<high){const mid=Math.ceil((low+high)/2);if(ctx.measureText(value.slice(0,mid)+"…").width<=maxWidth)low=mid;else high=mid-1;}return value.slice(0,low)+"…";
    }
    function drawCover(ctx,image,x,y,size,radius){
      const deviceScale=ctx.getTransform?.().a||1;x=Math.round(x*deviceScale)/deviceScale;y=Math.round(y*deviceScale)/deviceScale;size=Math.round(size*deviceScale)/deviceScale;
      roundedRect(ctx,x,y,size,size,radius);ctx.save();ctx.clip();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
      const scale=Math.max(size/image.naturalWidth,size/image.naturalHeight),width=image.naturalWidth*scale,height=image.naturalHeight*scale;ctx.drawImage(image,x+(size-width)/2,y+(size-height)/2,width,height);ctx.restore();
    }
    function calculateLayout(designWidth,designHeight,canvasWidth,pipWidth){
      const scale=canvasWidth/designWidth,compactness=Math.max(0,Math.min(1,(520-pipWidth)/260)),snap=value=>Math.round(value*scale)/scale;
      const coverSize=snap(492+52*compactness),coverX=snap(82-40*compactness),coverY=snap((designHeight-coverSize)/2),contentX=snap(620+6*compactness),contentWidth=snap(designWidth-contentX-70),titleSize=snap(52+16*compactness),artistSize=snap(29+8*compactness),titleY=snap(267+9*compactness),artistY=snap(319+20*compactness);
      return Object.freeze({scale,compactness,coverSize,coverX,coverY,contentX,contentWidth,titleSize,artistSize,titleY,artistY});
    }
    return Object.freeze({roundedRect,fitText,drawCover,calculateLayout});
  })();

  /* ================= equalizer (real Web Audio filter chain) ================= */
  const eqBandFreqs = [60, 150, 400, 1000, 2400, 6000, 15000];
  const eqBandLabels = ["60Hz","150Hz","400Hz","1kHz","2.4kHz","6kHz","15kHz"];
  const GP_EQ_POINTER_CURVE_EXPONENT=1.7;
  function eqGainFromPointer(y){
    const normalized=Math.max(-1,Math.min(1,(92-y)/70));
    const curved=Math.sign(normalized)*12*Math.pow(Math.abs(normalized),GP_EQ_POINTER_CURVE_EXPONENT);
    return Math.max(-12,Math.min(12,Math.round(curved*2)/2));
  }
  const eqPresets = {
    flat:  [0,0,0,0,0,0,0],
    bass:  [6,5,3,1,0,-1,-1],
    vocal: [-2,-1,1,3,3,1,-1],
    treble:[-1,-1,0,1,3,5,6],
    electronic:[6,4,0,-2,-2,3,5],
    monitor:[-3.5,-4,-2.5,0.5,2,2.5,1],
    qc35:[-2,-1,1,2,1,2,3],
    qcearbuds:[-1,-2,0,1,1,2,2],
    poly:[4,2,-1,-2,-3,1,0],
    /* Conservative B&O-style compensation: broad, warm low end and clear
       upper detail without pretending this is a measured device correction. */
    zhang1:[1.4,.8,-.4,.2,.8,1.2,.7]
  };
  const eqPresetNames={
    flat:["原始","Flat"],bass:["低音增强","Bass Boost"],vocal:["人声增强","Vocal Boost"],
    treble:["高音明亮","Bright Treble"],electronic:["电子","Electronic"],
    monitor:["显示器音响","Monitor Speakers"],qc35:["QC35","QC35"],
    qcearbuds:["QC Earbuds","QC Earbuds"],poly:["Poly Sync 40","Poly Sync 40"],
    zhang1:["ZHAN G1 · B&O","ZHAN G1 · B&O"],
    custom:["自定义","Manual"]
  };
  let eqGains = eqPresets.flat.slice();
  let customEQGains = eqPresets.flat.slice();
  let eqPresetKey = "flat";
  let eqFilters = [];
  let eqVisualAnimation=0,eqLabelTimer=0,eqPopoverOpen=false;
  function buildEQFilters(){
    eqFilters = eqBandFreqs.map((freq,i) => {
      const f = audioCtx.createBiquadFilter();
      f.frequency.value = freq;
      f.type = i===0 ? "lowshelf" : i===eqBandFreqs.length-1 ? "highshelf" : "peaking";
      if(f.type === "peaking") f.Q.value = 1.0;
      f.gain.value = eqGains[i] || 0;
      return f;
    });
    for(let i=0;i<eqFilters.length-1;i++) eqFilters[i].connect(eqFilters[i+1]);
    return eqFilters;
  }
  function eqCurvePoints(values){
    return values.map((value,index)=>({
      x:50+index*100,
      y:22+(12-Math.max(-12,Math.min(12,Number(value)||0)))/24*140
    }));
  }
  function smoothEQPath(points){
    return monotoneCurvePath(points,.62);
  }
  function renderEQCurve(values=eqGains){
    const line=$("#eqCurveLine"),area=$("#eqCurveArea"),dots=$("#eqCurveDots");if(!line||!area||!dots)return;
    const points=eqCurvePoints(values),path=smoothEQPath(points);
    line.setAttribute("d",path);area.setAttribute("d",`${path} L 650 174 L 50 174 Z`);
    if(dots.children.length!==points.length)dots.innerHTML=points.map((_,index)=>`<circle data-i="${index}" r="4.2"/>`).join("");
    [...dots.children].forEach((dot,index)=>{dot.setAttribute("cx",points[index].x);dot.setAttribute("cy",points[index].y);});
  }
  function updateEQSliders(values=eqGains){
    $$("#eqBands .eq-slider").forEach((slider,index)=>{slider.value=String(values[index]??0);slider.setAttribute("aria-valuetext",`${Number(values[index]||0).toFixed(1)} dB`);});
  }
  function buildEQUI(){
    const wrap = $("#eqBands");
    wrap.innerHTML = eqBandFreqs.map((f,i) => `
      <label class="eq-band">
        <input type="range" class="eq-slider" data-i="${i}" min="-12" max="12" step="0.5" value="${eqGains[i]}" aria-label="${eqBandLabels[i]}">
        <span class="eq-band-label">${eqBandLabels[i]}</span>
      </label>`).join("");
    wrap.querySelectorAll(".eq-slider").forEach(s => {
      s.addEventListener("input", () => {
        const i = +s.dataset.i;
        setManualEQBand(i,parseFloat(s.value));
      });
    });
    const curve=$("#eqCurveVisual");
    if(curve&&!curve.dataset.dragReady){
      curve.dataset.dragReady="1";
      let activeIndex=-1;
      const pointerInEQViewBox=event=>{
        const point=curve.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
        const matrix=curve.getScreenCTM();return matrix?point.matrixTransform(matrix.inverse()):{x:0,y:0};
      };
      const release=()=>{if(activeIndex<0)return;$("#eqCurveDots")?.querySelector(`[data-i="${activeIndex}"]`)?.classList.remove("active");activeIndex=-1;savePrefs();};
      const updateFromPointer=event=>{
        const rect=curve.getBoundingClientRect();if(!rect.width||!rect.height)return;
        const {x,y}=pointerInEQViewBox(event);
        if(activeIndex<0)activeIndex=Math.max(0,Math.min(6,Math.round((x-50)/100)));
        const gain=eqGainFromPointer(y);
        setManualEQBand(activeIndex,gain);
      };
      curve.addEventListener("pointerdown",event=>{event.preventDefault();eqVisualAnimation++;const {x}=pointerInEQViewBox(event);activeIndex=Math.max(0,Math.min(6,Math.round((x-50)/100)));curve.setPointerCapture(event.pointerId);$("#eqCurveDots")?.querySelector(`[data-i="${activeIndex}"]`)?.classList.add("active");updateFromPointer(event);});
      curve.addEventListener("pointermove",event=>{if(activeIndex>=0)updateFromPointer(event);});
      curve.addEventListener("pointerup",release);curve.addEventListener("pointercancel",release);curve.addEventListener("lostpointercapture",release);
    }
    renderEQCurve();updateEQSliders();
  }
  function setManualEQBand(index,value){
    eqGains[index]=Math.max(-12,Math.min(12,Number(value)||0));
    customEQGains=eqGains.slice();
    if(eqFilters[index])smoothAudioParam(eqFilters[index].gain,eqGains[index],.055);
    syncAudioHeadroom(false,eqGains);renderEQCurve();updateEQSliders();setEQPresetLabel("custom",true);
  }
  function eqPresetName(key){const names=eqPresetNames[key]||eqPresetNames.flat;return names[uiLanguage==="zh"?0:1];}
  function setEQPresetLabel(key,animate=false){
    eqPresetKey = key;
    $$("#eqPresetPop button[data-p]").forEach(button=>button.classList.toggle("active",button.dataset.p===key));
    const label=$("#eqPresetName");if(!label)return;
    const next=eqPresetName(key);if(label.textContent===next)return;
    clearTimeout(eqLabelTimer);
    if(!animate||matchMedia("(prefers-reduced-motion: reduce)").matches){label.textContent=next;label.classList.remove("eq-label-out","eq-label-in");return;}
    label.classList.remove("eq-label-in");label.classList.add("eq-label-out");
    eqLabelTimer=setTimeout(()=>{label.textContent=next;label.classList.remove("eq-label-out");void label.offsetWidth;label.classList.add("eq-label-in");eqLabelTimer=setTimeout(()=>label.classList.remove("eq-label-in"),190);},105);
  }
  function animateEQValues(target,duration=360){
    const start=eqGains.slice(),token=++eqVisualAnimation,startAt=performance.now(),reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
    eqGains=target.slice();
    if(reduced){updateEQSliders();renderEQCurve();return;}
    const frame=now=>{
      if(token!==eqVisualAnimation)return;
      const progress=Math.min(1,(now-startAt)/duration),eased=1-Math.pow(1-progress,3);
      const visual=start.map((value,index)=>value+(target[index]-value)*eased);
      updateEQSliders(visual);renderEQCurve(visual);
      if(progress<1)requestAnimationFrame(frame);
      else{updateEQSliders(target);renderEQCurve(target);};
    };
    requestAnimationFrame(frame);
  }
  function applyEQPreset(key){
    if(key!=="custom"&&!eqPresets[key])key="flat";
    const target=(key==="custom"?customEQGains:eqPresets[key]).slice();
    eqFilters.forEach((filter,index)=>smoothAudioParam(filter.gain,target[index],.34));
    animateEQValues(target);
    setEQPresetLabel(key,true);syncAudioHeadroom(false,target);savePrefs();closeEQPresetPopover();
  }
  function placeEQPresetPopover(){
    const pop=$("#eqPresetPop"),trigger=$("#eqPresetButton");if(!pop||!trigger)return;
    if(pop.parentElement!==document.body)document.body.appendChild(pop);
    const rect=trigger.getBoundingClientRect(),width=Math.min(310,Math.max(220,innerWidth-24));
    const left=Math.max(12,Math.min(innerWidth-width-12,rect.left));
    const estimatedHeight=pop.offsetHeight||286,below=rect.bottom+8,top=below+estimatedHeight<=innerHeight-12?below:Math.max(12,rect.top-estimatedHeight-8);
    pop.style.width=`${width}px`;pop.style.left=`${Math.round(left)}px`;pop.style.top=`${Math.round(top)}px`;
  }
  function setEQPresetPopover(open){
    const pop=$("#eqPresetPop"),trigger=$("#eqPresetButton");if(!pop||!trigger)return;
    eqPopoverOpen=Boolean(open);if(eqPopoverOpen)placeEQPresetPopover();setMotionPopover(pop,eqPopoverOpen);if(eqPopoverOpen)requestAnimationFrame(placeEQPresetPopover);
  }
  function closeEQPresetPopover(){setEQPresetPopover(false);}
  $("#eqPresetButton").addEventListener("click",event=>{event.stopPropagation();setEQPresetPopover(!eqPopoverOpen);});
  $("#eqPresetPop").addEventListener("click",event=>{const button=event.target.closest("button[data-p]");if(!button)return;event.stopPropagation();applyEQPreset(button.dataset.p);});
  document.addEventListener("pointerdown",event=>{if(eqPopoverOpen&&!event.target.closest(".eq-preset-wrap,#eqPresetPop"))closeEQPresetPopover();},{passive:true});
  window.addEventListener("resize",()=>{if(eqPopoverOpen)placeEQPresetPopover();},{passive:true});

  /* ================= GP Spatial Engine 1.1 — Room =================
     Fixed, predictable presets. Playback state, track features, RMS and stereo
     correlation never modify spatial parameters. Only an explicit user mode
     selection can start the 400 ms equal-power A/B bus transition. */
  let spatialEngine=null,spatialEnabled=false,spatialMode="desktop",spatialLastMode="desktop";
  const spatialDbGain=db=>Math.pow(10,db/20);
  const SPATIAL_FADE_SECONDS=.4;
  const SPATIAL_CURVE_STEPS=65;
  const SPATIAL_FADE_OUT=Float32Array.from({length:SPATIAL_CURVE_STEPS},(_,i)=>Math.cos((i/(SPATIAL_CURVE_STEPS-1))*Math.PI/2));
  const SPATIAL_FADE_IN=Float32Array.from({length:SPATIAL_CURVE_STEPS},(_,i)=>Math.sin((i/(SPATIAL_CURVE_STEPS-1))*Math.PI/2));
  function spatialClarityDiagnostics(mode){
    const mainGain=Math.max(0,Number(mode?.mainGain??1)),hrtfWet=Math.max(0,Number(mode?.hrtf?.wet??0));
    return Object.freeze({entryGain:.72,mainGain,hrtfWet,clarityBias:mainGain/Math.max(.01,hrtfWet||.01)});
  }
  function spatialSetFixed(param,value){
    if(!audioCtx||!param)return;const now=audioCtx.currentTime,target=Number.isFinite(value)?value:0;param.cancelScheduledValues(now);param.setValueAtTime(target,now);
  }
  function spatialSetPannerFixed(panner,angle){
    const radians=angle*Math.PI/180,x=Math.sin(radians),z=-Math.cos(radians);
    if(panner.positionX){spatialSetFixed(panner.positionX,x);spatialSetFixed(panner.positionY,0);spatialSetFixed(panner.positionZ,z);}else panner.setPosition(x,0,z);
  }
  function spatialSeededRandom(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
  function spatialImpulse(context,duration,seed){
    const length=Math.ceil(context.sampleRate*duration),buffer=context.createBuffer(2,length,context.sampleRate);
    for(let channel=0;channel<2;channel++){
      const random=spatialSeededRandom(seed+channel*2654435761),data=buffer.getChannelData(channel);let energy=0;
      for(let i=0;i<length;i++){const t=i/Math.max(1,length-1),sample=(random()*2-1)*Math.exp(-6.8*t)*(1-.08*t);data[i]=sample;energy+=sample*sample;}
      const scale=energy>0?1/Math.sqrt(energy):1;for(let i=0;i<length;i++)data[i]*=scale;
    }
    return buffer;
  }
  function createSpatialIRBank(context){
    return Object.freeze({"0.55":spatialImpulse(context,.55,0x47505311),"0.60":spatialImpulse(context,.60,0x47505321),"0.75":spatialImpulse(context,.75,0x47505331)});
  }
  function createSpatialBus(c,irBank,engineOutput,index){
    const entry=c.createGain(),split=c.createChannelSplitter(2),msMerge=c.createChannelMerger(2),sum=c.createGain();entry.gain.value=.72;entry.channelCount=2;entry.channelCountMode="explicit";entry.connect(split);
    const mid=c.createGain(),side=c.createGain(),midL=c.createGain(),midR=c.createGain(),sideL=c.createGain(),sideR=c.createGain();midL.gain.value=.5;midR.gain.value=.5;sideL.gain.value=.5;sideR.gain.value=-.5;
    split.connect(midL,0);split.connect(midR,1);midL.connect(mid);midR.connect(mid);split.connect(sideL,0);split.connect(sideR,1);sideL.connect(side);sideR.connect(side);mid.connect(msMerge,0,0);mid.connect(msMerge,0,1);
    const low=c.createBiquadFilter(),midHP=c.createBiquadFilter(),midLP=c.createBiquadFilter(),high=c.createBiquadFilter();low.type="lowpass";low.frequency.value=120;midHP.type="highpass";midHP.frequency.value=120;midLP.type="lowpass";midLP.frequency.value=2500;high.type="highpass";high.frequency.value=2500;side.connect(low);side.connect(midHP);midHP.connect(midLP);side.connect(high);
    const widthNodes={};[["low",low],["mid",midLP],["high",high]].forEach(([key,node])=>{const left=c.createGain(),right=c.createGain();node.connect(left);node.connect(right);left.connect(msMerge,0,0);right.connect(msMerge,0,1);widthNodes[key]=[left,right];});
    const main=c.createGain();msMerge.connect(main);main.connect(sum);
    const crossMerge=c.createChannelMerger(2),cross=[];[[1,0],[0,1]].forEach(([source,target])=>{const filter=c.createBiquadFilter(),delay=c.createDelay(.001),gain=c.createGain();filter.type="lowpass";filter.frequency.value=900;split.connect(filter,source);filter.connect(delay);delay.connect(gain);gain.connect(crossMerge,0,target);cross.push({filter,delay,gain});});crossMerge.connect(sum);
    const pannerL=c.createPanner(),pannerR=c.createPanner(),hrtf=c.createGain();[pannerL,pannerR].forEach(p=>{p.panningModel="HRTF";p.distanceModel="inverse";p.rolloffFactor=0;p.refDistance=1;p.maxDistance=1;});split.connect(pannerL,0);split.connect(pannerR,1);pannerL.connect(hrtf);pannerR.connect(hrtf);hrtf.connect(sum);
    const reflection=c.createGain(),reflectionPaths=[];[[.008,-.55,-20],[.013,.45,-22],[.021,-.35,-25],[.031,.65,-27]].forEach(([seconds,pan,db])=>{const delay=c.createDelay(.04),hp=c.createBiquadFilter(),lp=c.createBiquadFilter(),gain=c.createGain(),panner=c.createStereoPanner();delay.delayTime.value=seconds;hp.type="highpass";hp.frequency.value=180;lp.type="lowpass";lp.frequency.value=6500;gain.gain.value=spatialDbGain(db);panner.pan.value=pan;mid.connect(delay);delay.connect(hp);hp.connect(lp);lp.connect(gain);gain.connect(panner);panner.connect(reflection);reflectionPaths.push({delay,hp,lp,gain,panner});});reflection.connect(sum);
    const reverbHP=c.createBiquadFilter(),convolver=c.createConvolver(),reverbLP=c.createBiquadFilter(),reverb=c.createGain();reverbHP.type="highpass";reverbHP.frequency.value=200;reverbLP.type="lowpass";reverbLP.frequency.value=7500;convolver.normalize=false;convolver.buffer=irBank["0.75"];side.connect(reverbHP);reverbHP.connect(convolver);convolver.connect(reverbLP);reverbLP.connect(reverb);reverb.connect(sum);
    const chorusDelayL=c.createDelay(.02),chorusDelayR=c.createDelay(.02),chorusPanL=c.createStereoPanner(),chorusPanR=c.createStereoPanner(),chorus=c.createGain(),lfoInv=c.createGain(),lfoDepthL=c.createGain(),lfoDepthR=c.createGain();chorusDelayL.delayTime.value=.012;chorusDelayR.delayTime.value=.012;chorusPanL.pan.value=-.72;chorusPanR.pan.value=.72;lfoDepthL.gain.value=.001;lfoDepthR.gain.value=.001;lfoInv.gain.value=-1;high.connect(chorusDelayL);high.connect(chorusDelayR);chorusDelayL.connect(chorusPanL);chorusDelayR.connect(chorusPanR);chorusPanL.connect(chorus);chorusPanR.connect(chorus);lfoInv.connect(lfoDepthR);lfoDepthL.connect(chorusDelayL.delayTime);lfoDepthR.connect(chorusDelayR.delayTime);chorus.connect(sum);
    const outputTrim=c.createGain(),safety=c.createDynamicsCompressor(),outputGain=c.createGain();safety.threshold.value=0;safety.knee.value=0;safety.ratio.value=1;safety.attack.value=.003;safety.release.value=.06;outputGain.gain.value=0;sum.connect(outputTrim);outputTrim.connect(outputGain);outputGain.connect(engineOutput);
    return{index,entry,main,widthNodes,cross,pannerL,pannerR,hrtf,reflection,reflectionPaths,reverbHP,convolver,reverbLP,reverb,chorus,chorusDelayL,chorusDelayR,lfoInv,lfoDepthL,lfoDepthR,lfo:null,orbit:null,outputTrim,safety,outputGain,inputConnected:false,mode:"none"};
  }
  function stopSpatialChorus(bus){
    if(!bus?.lfo)return;try{bus.lfo.stop();}catch(e){}try{bus.lfo.disconnect();}catch(e){}bus.lfo=null;
  }
  function startSpatialChorus(bus,chorus){
    stopSpatialChorus(bus);if(!chorus||chorus.wet<=0)return;const lfo=audioCtx.createOscillator();lfo.frequency.value=chorus.rate;lfo.connect(bus.lfoDepthL);lfo.connect(bus.lfoInv);lfo.start();bus.lfo=lfo;
  }
  function stopSpatialOrbit(bus){
    if(!bus?.orbit)return;bus.orbit.sources.forEach(source=>{try{source.stop();}catch(e){}try{source.disconnect();}catch(e){}});bus.orbit.gains.forEach(gain=>{try{gain.disconnect();}catch(e){}});bus.orbit=null;
  }
  function startSpatialOrbit(bus,orbit){
    stopSpatialOrbit(bus);if(!orbit||!bus.pannerL.positionX||!bus.pannerL.positionZ)return;
    const x=audioCtx.createOscillator(),z=audioCtx.createOscillator(),xGain=audioCtx.createGain(),zGain=audioCtx.createGain(),depth=Math.max(.1,Math.min(1,orbit.depth||.88));
    x.type="sine";z.setPeriodicWave(audioCtx.createPeriodicWave(new Float32Array([0,1]),new Float32Array([0,0])));x.frequency.value=z.frequency.value=Math.max(.02,Math.min(.2,orbit.rate||.09));xGain.gain.value=zGain.gain.value=depth;
    [bus.pannerL,bus.pannerR].forEach(panner=>{spatialSetFixed(panner.positionX,0);spatialSetFixed(panner.positionY,0);spatialSetFixed(panner.positionZ,0);xGain.connect(panner.positionX);zGain.connect(panner.positionZ);});x.connect(xGain);z.connect(zGain);x.start();z.start();bus.orbit={sources:[x,z],gains:[xGain,zGain]};
  }
  function configureSpatialBus(bus,modeKey){
    const mode=GP.spatialPresets.getPreset(modeKey)||GP.spatialPresets.getPreset("desktop"),clarity=spatialClarityDiagnostics(mode);stopSpatialChorus(bus);stopSpatialOrbit(bus);spatialSetFixed(bus.entry.gain,clarity.entryGain);spatialSetFixed(bus.main.gain,clarity.mainGain);bus.clarity=clarity;
    [["low",mode.lowSideGain],["mid",mode.midWidth],["high",mode.highWidth]].forEach(([key,width])=>{spatialSetFixed(bus.widthNodes[key][0].gain,width);spatialSetFixed(bus.widthNodes[key][1].gain,-width);});
    bus.cross.forEach(path=>{spatialSetFixed(path.gain.gain,mode.crossfeed?spatialDbGain(mode.crossfeed.gainDb):0);spatialSetFixed(path.delay.delayTime,mode.crossfeed?.delay||.00028);spatialSetFixed(path.filter.frequency,mode.crossfeed?.lowpass||900);});
    spatialSetPannerFixed(bus.pannerL,-mode.hrtf.angle);spatialSetPannerFixed(bus.pannerR,mode.hrtf.angle);spatialSetFixed(bus.hrtf.gain,mode.hrtf.wet);spatialSetFixed(bus.reflection.gain,mode.reflectionWet);
    const reverb=mode.reverb;spatialSetFixed(bus.reverb.gain,reverb?.wet||0);spatialSetFixed(bus.reverbHP.frequency,reverb?.highpass||200);spatialSetFixed(bus.reverbLP.frequency,reverb?.lowpass||7500);bus.convolver.buffer=spatialEngine.irBank[(reverb?.decay||.75).toFixed(2)]||spatialEngine.irBank["0.75"];
    const chorus=mode.chorus;spatialSetFixed(bus.chorus.gain,chorus?.wet||0);spatialSetFixed(bus.chorusDelayL.delayTime,chorus?.baseDelay||.012);spatialSetFixed(bus.chorusDelayR.delayTime,chorus?.baseDelay||.012);spatialSetFixed(bus.lfoDepthL.gain,chorus?.depth||.001);spatialSetFixed(bus.lfoDepthR.gain,chorus?.depth||.001);if(chorus)startSpatialChorus(bus,chorus);if(mode.orbit)startSpatialOrbit(bus,mode.orbit);
    spatialSetFixed(bus.outputTrim.gain,spatialDbGain(mode.outputTrimDb));bus.mode=modeKey;
  }
  function connectSpatialBus(engine,bus){if(bus.inputConnected)return;engine.input.connect(bus.entry);bus.inputConnected=true;}
  function disconnectSpatialBus(engine,bus){if(!bus.inputConnected){stopSpatialChorus(bus);stopSpatialOrbit(bus);return;}try{engine.input.disconnect(bus.entry);}catch(e){}bus.inputConnected=false;stopSpatialChorus(bus);stopSpatialOrbit(bus);}
  function finishSpatialTransition(engine,target,bus,oldBus){
    if(oldBus){spatialSetFixed(oldBus.outputGain.gain,0);disconnectSpatialBus(engine,oldBus);}if(bus){spatialSetFixed(bus.outputGain.gain,1);engine.activeIndex=bus.index;spatialSetFixed(engine.dry.gain,0);}else{engine.activeIndex=null;spatialSetFixed(engine.dry.gain,1);}engine.transitioning=false;engine.transitionTimer=0;const pending=engine.pendingMode;engine.pendingMode=null;if(pending&&pending!==target)requestSpatialMode(pending);
  }
  function scheduleEqualPower(param,curve,now){param.cancelScheduledValues(now);param.setValueCurveAtTime(curve,now,SPATIAL_FADE_SECONDS);}
  function requestSpatialMode(target,immediate=false){
    const engine=spatialEngine;if(!engine)return;target=target&&target!=="none"&&GP.spatialPresets.getPreset(target)?target:"none";
    if(engine.transitioning&&!immediate){engine.pendingMode=target;return;}
    const oldBus=engine.activeIndex==null?null:engine.buses[engine.activeIndex];
    if(target!=="none"&&oldBus?.mode===target&&!engine.transitioning)return;
    clearTimeout(engine.transitionTimer);engine.pendingMode=null;
    if(immediate){engine.buses.forEach(bus=>{spatialSetFixed(bus.outputGain.gain,0);disconnectSpatialBus(engine,bus);});if(target==="none"){engine.activeIndex=null;spatialSetFixed(engine.dry.gain,1);}else{const bus=engine.buses[0];configureSpatialBus(bus,target);connectSpatialBus(engine,bus);spatialSetFixed(bus.outputGain.gain,1);spatialSetFixed(engine.dry.gain,0);engine.activeIndex=0;}return;}
    const now=audioCtx.currentTime;let nextBus=null;if(target!=="none"){nextBus=engine.buses[oldBus?1-oldBus.index:0];disconnectSpatialBus(engine,nextBus);configureSpatialBus(nextBus,target);connectSpatialBus(engine,nextBus);spatialSetFixed(nextBus.outputGain.gain,0);}
    engine.transitioning=true;
    if(oldBus)scheduleEqualPower(oldBus.outputGain.gain,SPATIAL_FADE_OUT,now);else scheduleEqualPower(engine.dry.gain,SPATIAL_FADE_OUT,now);
    if(nextBus)scheduleEqualPower(nextBus.outputGain.gain,SPATIAL_FADE_IN,now);else scheduleEqualPower(engine.dry.gain,SPATIAL_FADE_IN,now);
    engine.transitionTimer=setTimeout(()=>finishSpatialTransition(engine,target,nextBus,oldBus),Math.ceil(SPATIAL_FADE_SECONDS*1000)+24);
  }
  function ensureSpatialEngine(){
    if(spatialEngine)return spatialEngine;const c=audioCtx,input=c.createGain(),output=c.createGain(),dry=c.createGain(),irBank=createSpatialIRBank(c);input.channelCount=2;input.channelCountMode="explicit";input.connect(dry);dry.connect(output);dry.gain.value=spatialEnabled?0:1;
    spatialEngine={input,output,dry,irBank,buses:[],activeIndex:null,transitioning:false,pendingMode:null,transitionTimer:0};spatialEngine.buses=[createSpatialBus(c,irBank,output,0),createSpatialBus(c,irBank,output,1)];requestSpatialMode(spatialEnabled?spatialMode:"none",true);return spatialEngine;
  }
  function applySpatialParameters(immediate=false){if(!spatialEngine)return;requestSpatialMode(spatialEnabled?spatialMode:"none",immediate);}
  /* ================= track info card + loudness meter ================= */
  const INFERRED_GENRE_ZH={Pop:"流行",Rock:"摇滚",Metal:"金属",Electronic:"电子", "Hip-Hop":"嘻哈", "R&B/Soul":"R&B / 灵魂乐",Jazz:"爵士",Classical:"古典",Ambient:"氛围", "Folk/Country":"民谣 / 乡村",Soundtrack:"原声配乐",Reggae:"雷鬼",Blues:"蓝调",Mixed:"混合风格"};
  const MFCC_TONE_LABELS={bright:["明亮","Bright"],deep:["厚重","Deep"],warm:["温暖","Warm"]};
  const MFCC_MOTION_LABELS={driving:["推进感","Driving"],dynamic:["动态丰富","Dynamic"],intense:["强烈","Intense"],punchy:["有冲击力","Punchy"],calm:["平稳","Calm"],smooth:["平滑","Smooth"],balanced:["均衡","Balanced"]};
  function formatTrackGenre(track){
    if(!track?.genre)return tr("未知","Unknown");
    if(track.genreSource!=="spectrum-inference")return track.genre;
    const localize=genre=>uiLanguage==="zh"?(INFERRED_GENRE_ZH[genre]||genre):genre;
    return track.genreSecondary?`${localize(track.genre)} / ${localize(track.genreSecondary)}`:localize(track.genre);
  }
  function formatMfccSummary(track){
    if(!track?.mfccSummary)return "--";
    const tone=MFCC_TONE_LABELS[track.mfccSummary.tone]||[track.mfccSummary.tone,track.mfccSummary.tone];
    const motion=MFCC_MOTION_LABELS[track.mfccSummary.motion||track.mood]||[track.mfccSummary.motion||track.mood||"",track.mfccSummary.motion||track.mood||""];
    const index=uiLanguage==="zh"?0:1;return `${tone[index]} · ${motion[index]}`;
  }
  function updateTrackInfoCard(t){
    if(!t){
      ["infoFormat","infoDuration","infoBitrate","infoSampleRate","infoChannels","infoGenre","infoEnergy","infoBpm","infoMfcc"].forEach(id => $("#"+id).textContent = "--");
      $("#loudnessFill").style.width = "0%";
      return;
    }
    const ext = t.format||audioFormatFromName(t.name);
    $("#infoFormat").textContent = ext || tr("未知","Unknown");
    $("#infoDuration").textContent = t.duration ? fmtTime(t.duration) : "--";
    const bitrate = Number.isFinite(t.bitrateKbps)?t.bitrateKbps:estimateTrackBitrate(t.fileSize||t.file?.size,t.duration);
    $("#infoBitrate").textContent = bitrate ? bitrate + " kbps" : tr("计算中…","Calculating…");
    const spectrumPending=t.spectrumStatus==="queued"||t.spectrumStatus==="analyzing";
    $("#infoSampleRate").textContent = t.sampleRate ? Math.round(t.sampleRate/1000*10)/10 + " kHz" : spectrumPending?tr("分析中…","Analyzing…"):"--";
    $("#infoChannels").textContent = t.channels ? (t.channels===1?tr("单声道","Mono"):t.channels===2?tr("立体声","Stereo"):t.channels+tr(" 声道"," channels")) : spectrumPending?tr("分析中…","Analyzing…"):"--";
    $("#infoGenre").textContent = formatTrackGenre(t);
    $("#infoEnergy").textContent=Number.isFinite(t.energy)?`${Math.round(t.energy)} / 100`:spectrumPending?tr("分析中…","Analyzing…"):t.spectrumStatus==="complete"?tr("未检测到","Not detected"):"--";
    $("#infoBpm").textContent=Number.isFinite(t.bpm)?`${Math.round(t.bpm)} BPM`:spectrumPending?tr("分析中…","Analyzing…"):t.spectrumStatus==="complete"?tr("未检测到","Not detected"):"--";
    $("#infoMfcc").textContent=Array.isArray(t.mfcc?.mean)?formatMfccSummary(t):spectrumPending?tr("分析中…","Analyzing…"):t.spectrumStatus==="complete"?tr("未检测到","Not detected"):"--";
    updateLoudnessMeter(t);
  }
  function updateLoudnessMeter(t){
    const fill = $("#loudnessFill");
    if(Number.isFinite(t?.energy)){fill.style.width=Math.max(0,Math.min(100,Math.round(t.energy)))+"%";return;}
    if(!t || !t.peaks || !t.peaks.length){ fill.style.width = "0%"; return; }
    const avg = t.peaks.reduce((a,b)=>a+b,0) / t.peaks.length;
    fill.style.width = Math.min(100, Math.round(avg*150)) + "%";
  }

  /* ================= sleep timer ================= */
  let sleepTimerHandle = null, sleepTimerMode = null, sleepTimerDeadline=0, sleepCountdownHandle=null; // null | 'minutes' | 'end'
  function updateSleepCountdown(){
    if(sleepTimerMode!=="minutes"||!sleepTimerDeadline)return;
    const remaining=Math.max(0,Math.ceil((sleepTimerDeadline-Date.now())/1000)),minutes=Math.floor(remaining/60),seconds=remaining%60;
    $("#sleepBtnText").textContent=`${minutes}:${String(seconds).padStart(2,"0")}`;
  }
  function scheduleSleepCountdown(){updateSleepCountdown();if(sleepTimerMode==="minutes")sleepCountdownHandle=setTimeout(scheduleSleepCountdown,1000-(Date.now()%1000)+12);}
  function selectSleepOption(mode){$$("#sleepPop button").forEach(button=>button.classList.toggle("active",button.dataset.m===String(mode)));}
  function clearSleepTimer(){
    if(sleepTimerHandle){ clearTimeout(sleepTimerHandle); sleepTimerHandle = null; }
    if(sleepCountdownHandle){clearTimeout(sleepCountdownHandle);sleepCountdownHandle=null;}sleepTimerDeadline=0;
    sleepTimerMode = null;
    $("#sleepBtn").classList.remove("on","counting");
    $("#sleepBtnText").textContent = tr("睡眠定时","Snooze");
    $$("#sleepPop button").forEach(b => b.classList.remove("active"));
  }
  function setSleepMinutes(mins){
    clearSleepTimer();
    sleepTimerMode = "minutes";
    sleepTimerDeadline=Date.now()+mins*60000;
    sleepTimerHandle = setTimeout(() => { pauseAudio(); clearSleepTimer(); }, mins*60000);
    scheduleSleepCountdown();
    $("#sleepBtn").classList.add("on","counting");
    selectSleepOption(mins);
  }
  function setSleepAtEnd(){
    clearSleepTimer();
    sleepTimerMode = "end";
    $("#sleepBtn").classList.add("on");
    $("#sleepBtn").classList.remove("counting");
    $("#sleepBtnText").textContent = tr("播完暂停","Stop After Song");
    selectSleepOption("end");
  }
  const gpPopoverTimers=new WeakMap();
  const gpPopoverTriggerIds={sleepPop:"sleepBtn",playbackSpeedPop:"playbackSpeedButton",eqPresetPop:"eqPresetButton",sortPop:"sortBtn",fontPickerPop:"fontPickerBtn",spatialInfoPop:"spatialInfoBtn",loudnessInfoPop:"loudnessInfoBtn"};
  function syncMotionPopoverState(pop,open){
    pop.setAttribute("aria-hidden",String(!open));
    const triggerId=gpPopoverTriggerIds[pop.id],trigger=triggerId?$("#"+triggerId):null;
    trigger?.setAttribute("aria-expanded",String(open));
    if(pop.id==="eqPresetPop")eqPopoverOpen=open;
    if(pop.id==="fontPickerPop")trigger?.classList.toggle("open",open);
  }
  function closeMotionPopover(pop,animate=true){
    if(!pop)return;clearTimeout(gpPopoverTimers.get(pop));pop.classList.remove("show");
    if(!animate){pop.classList.remove("gp-popover-exit");pop.style.removeProperty("will-change");syncMotionPopoverState(pop,false);return;}
    if(!pop.classList.contains("gp-popover-exit"))pop.classList.add("gp-popover-exit");
    syncMotionPopoverState(pop,false);
    const timer=setTimeout(()=>{pop.style.willChange="opacity, transform";pop.classList.remove("gp-popover-exit");requestAnimationFrame(()=>pop.style.removeProperty("will-change"));},88);
    gpPopoverTimers.set(pop,timer);
  }
  function closeAllMotionPopovers(){ $$(".gp-motion-popover.show,.gp-motion-popover.gp-popover-exit").forEach(pop=>closeMotionPopover(pop,false)); }
  function dismissMotionPopoversForExternalScroll(event){
    const target=event?.target;
    $$(".gp-motion-popover.show").forEach(pop=>{
      const scrolledInside=target===pop||(target instanceof Element&&pop.contains(target));
      if(!scrolledInside)closeMotionPopover(pop,true);
    });
  }
  document.addEventListener("scroll",dismissMotionPopoversForExternalScroll,{capture:true,passive:true});
  window.addEventListener("scroll",dismissMotionPopoversForExternalScroll,{passive:true});
  function setMotionPopover(pop,open){
    if(!pop)return;
    clearTimeout(gpPopoverTimers.get(pop));
    if(open){
      $$(".gp-motion-popover.show,.gp-motion-popover.gp-popover-exit").forEach(other=>{if(other!==pop)closeMotionPopover(other,false);});
      pop.classList.remove("gp-popover-exit");restartCssMotion(pop,"show");
      syncMotionPopoverState(pop,true);
      return;
    }
    if(!pop.classList.contains("show")&&!pop.classList.contains("gp-popover-exit")){syncMotionPopoverState(pop,false);return;}
    closeMotionPopover(pop,true);
  }
  function setSleepPopover(open){setMotionPopover($("#sleepPop"),open);}
  $("#sleepBtn").addEventListener("click", (e) => { e.stopPropagation(); setSleepPopover(!$("#sleepPop").classList.contains("show")); });
  document.addEventListener("click", (e) => { if(!e.target.closest(".sleep-wrap")) setSleepPopover(false); });
  $("#sleepPop").addEventListener("click", (e) => {
    const btn = e.target.closest("button"); if(!btn) return;
    const m = btn.dataset.m;
    if(m === "off") clearSleepTimer();
    else if(m === "end") setSleepAtEnd();
    else setSleepMinutes(parseInt(m,10));
    setSleepPopover(false);
  });
  bindMicroMotion($("#sleepBtn"),"gp-snooze-motion",400);

  function showPipSupportModal(message,detail=""){
    $("#pipSupportTitle").textContent=tr("无法打开悬浮播放器","Unable to open floating player");
    $("#pipSupportMessage").textContent=message;
    $("#pipSupportDetail").textContent=detail;
    $("#pipSupportClose").textContent=tr("知道了","OK");
    $("#pipSupportModal").classList.add("show");$("#pipSupportModal").setAttribute("aria-hidden","false");requestAnimationFrame(()=>$("#pipSupportClose").focus());
  }
  function closePipSupportModal(){$("#pipSupportModal").classList.remove("show");$("#pipSupportModal").setAttribute("aria-hidden","true");$("#pipLaunchBtn").focus();}
  $("#pipSupportClose").addEventListener("click",closePipSupportModal);
  $("#pipSupportModal").addEventListener("click",event=>{if(event.target===$("#pipSupportModal"))closePipSupportModal();});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&$("#pipSupportModal").classList.contains("show")){event.preventDefault();closePipSupportModal();}});
  /* ================= 6.0.4 Traditional Video Picture-in-Picture =================
     A high-resolution canvas is exposed as a muted video stream. Edge owns the
     borderless always-on-top shell and native transport overlay; GP remains the
     only audio runtime. This deliberately replaces the address-bearing Document
     PiP path without duplicating Audio, Web Audio or Spectrum analysis. */
  let gpVideoPipCanvas=null,gpVideoPipContext=null,gpVideoPipVideo=null,gpVideoPipTrack=null;
  let gpVideoPipCover=null,gpVideoPipCoverSource="",gpVideoPipPalette=null,gpVideoPipTargetPlayback=false,gpVideoPipOpening=false,gpVideoPipFramePulse=false,gpVideoPipThemeObserver=null,gpVideoPipRefreshFrame=0,gpVideoPipWindow=null,gpVideoPipResizeHandler=null,gpVideoPipPulseTimer=0,gpVideoPipLastRender=0;
  let gpVideoPipBackgroundCanvas=null,gpVideoPipBackgroundContext=null,gpVideoPipBackgroundKey="",gpVideoPipMotionFrame=0,gpVideoPipLastMotionFrame=0,gpVideoPipMarqueeKey="",gpVideoPipMarqueeStart=0;
  const GP_VIDEO_PIP_DESIGN_WIDTH=1280,GP_VIDEO_PIP_DESIGN_HEIGHT=720,GP_VIDEO_PIP_WIDTH=1920,GP_VIDEO_PIP_HEIGHT=1080,GP_VIDEO_PIP_BACKGROUND_BLUR=58;
  function configureTraditionalPiPCanvas(){if(!gpVideoPipCanvas)return;if(gpVideoPipCanvas.width!==GP_VIDEO_PIP_WIDTH||gpVideoPipCanvas.height!==GP_VIDEO_PIP_HEIGHT){gpVideoPipCanvas.width=GP_VIDEO_PIP_WIDTH;gpVideoPipCanvas.height=GP_VIDEO_PIP_HEIGHT;gpVideoPipContext=gpVideoPipCanvas.getContext("2d",{alpha:false,desynchronized:true});}if(!gpVideoPipBackgroundCanvas){gpVideoPipBackgroundCanvas=document.createElement("canvas");gpVideoPipBackgroundCanvas.width=GP_VIDEO_PIP_WIDTH;gpVideoPipBackgroundCanvas.height=GP_VIDEO_PIP_HEIGHT;gpVideoPipBackgroundContext=gpVideoPipBackgroundCanvas.getContext("2d",{alpha:false,desynchronized:true});}}
  function scheduleTraditionalPiPRefresh(forceTheme=false){if(!gpVideoPipCanvas)return;cancelAnimationFrame(gpVideoPipRefreshFrame);gpVideoPipRefreshFrame=requestAnimationFrame(()=>{gpVideoPipRefreshFrame=0;syncTraditionalPiP(forceTheme);});}
  function pulseTraditionalPiPFrame(){
    const video=gpVideoPipVideo;if(!video||document.pictureInPictureElement!==video||isPlaying||gpVideoPipFramePulse)return;
    gpVideoPipFramePulse=true;clearTimeout(gpVideoPipPulseTimer);video.play().then(()=>{try{gpVideoPipTrack?.requestFrame?.();}catch(error){}gpVideoPipPulseTimer=setTimeout(()=>{if(document.pictureInPictureElement===video&&!isPlaying&&!video.paused)video.pause();gpVideoPipFramePulse=false;},72);}).catch(()=>{gpVideoPipFramePulse=false;});
  }
  function gpPipCss(name,fallback){return getComputedStyle(document.body).getPropertyValue(name).trim()||fallback;}
  function gpPipLoadCover(source){
    if(source===gpVideoPipCoverSource)return;gpVideoPipCoverSource=source;gpVideoPipCover=null;gpVideoPipPalette=null;if(!source)return;
    const image=new Image();image.decoding="async";image.onload=()=>{if(gpVideoPipCoverSource===source){gpVideoPipCover=image;renderTraditionalPiPFrame(true);gpVideoPipLastRender=performance.now();pulseTraditionalPiPFrame();}};image.onerror=()=>{if(gpVideoPipCoverSource===source)gpVideoPipCover=null;};image.src=source;
    getDominantColors(source,3).then(colors=>{if(gpVideoPipCoverSource===source&&colors?.length){gpVideoPipPalette=colors.map(color=>color.slice(0,3));renderTraditionalPiPFrame(true);gpVideoPipLastRender=performance.now();pulseTraditionalPiPFrame();}});
  }
  function renderTraditionalPiPFrame(forceStatic=false){
    if(!gpVideoPipCanvas||!gpVideoPipContext)return;configureTraditionalPiPCanvas();const ctx=gpVideoPipContext,bgCtx=gpVideoPipBackgroundContext,canvas=gpVideoPipCanvas;
    const width=GP_VIDEO_PIP_DESIGN_WIDTH,height=GP_VIDEO_PIP_DESIGN_HEIGHT,track=playlist[currentIndex]||null,dark=activeTheme()==="dark",pipWidth=gpVideoPipWindow?.width||640,pipLayout=GP.pipRenderer.calculateLayout(width,height,canvas.width,pipWidth),{scale,compactness}=pipLayout;
    const bg=gpPipCss("--bg-base",dark?"#111318":"#f1f3f5"),accent=gpPipCss("--accent","#7197c9"),accentRgb=gpPipCss("--accent-rgb","113,151,201"),text=gpPipCss("--text-primary",dark?"#f5f7fa":"#16191d"),secondary=gpPipCss("--text-secondary",dark?"rgba(245,247,250,.72)":"rgba(22,25,29,.66)"),font=gpPipCss("--font-family","system-ui"),weight=gpPipCss("--font-weight","600"),fontScale=Math.max(.85,Math.min(1.35,Number.parseFloat(gpPipCss("--font-scale","1"))||1));
    const paletteSignature=(gpVideoPipPalette||[]).flat().join(","),backgroundKey=[bgMode,dark,bg,accentRgb,gpVideoPipCoverSource,gpVideoPipCover?.complete?1:0,paletteSignature].join("|");
    if(backgroundKey!==gpVideoPipBackgroundKey){
      gpVideoPipBackgroundKey=backgroundKey;bgCtx.setTransform(scale,0,0,scale,0,0);bgCtx.imageSmoothingEnabled=true;bgCtx.imageSmoothingQuality="high";bgCtx.clearRect(0,0,width,height);bgCtx.fillStyle=bg;bgCtx.fillRect(0,0,width,height);
      if(bgMode==="blur"&&gpVideoPipCover?.complete&&gpVideoPipCover.naturalWidth){bgCtx.save();bgCtx.filter=`blur(${GP_VIDEO_PIP_BACKGROUND_BLUR}px) saturate(${dark?1.25:1.38}) brightness(${dark ? 0.48 : 1.02})`;bgCtx.globalAlpha=dark ? 0.88 : 0.72;bgCtx.drawImage(gpVideoPipCover,-96,-96,width+192,height+192);bgCtx.restore();bgCtx.fillStyle=dark?"rgba(4,6,9,.46)":"rgba(255,255,255,.10)";bgCtx.fillRect(0,0,width,height);}
      else{const fallback=currentAccentRgb(),palette=bgMode==="color"&&gpVideoPipPalette?.length?gpVideoPipPalette:[fallback,mixRgb(fallback,dark?[255,255,255]:[0,0,0],.2),mixRgb(fallback,dark?[0,0,0]:[255,255,255],.28)],points=bgMode==="color"?[[.08,.05,.78,.58],[.92,.18,.66,.5],[.48,1,.72,.46]]:[[.14,.12,.58,.34],[.86,.24,.5,.23],[.48,.94,.62,.2]];points.forEach((point,index)=>{const color=palette[index%palette.length],gradient=bgCtx.createRadialGradient(width*point[0],height*point[1],0,width*point[0],height*point[1],width*point[2]);gradient.addColorStop(0,`rgba(${color.join(",")},${dark?point[3]*.72:point[3]})`);gradient.addColorStop(1,"rgba(0,0,0,0)");bgCtx.fillStyle=gradient;bgCtx.fillRect(0,0,width,height);});bgCtx.fillStyle=dark?"rgba(3,5,8,.24)":"rgba(255,255,255,.08)";bgCtx.fillRect(0,0,width,height);}
    }
    ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(gpVideoPipBackgroundCanvas,0,0);ctx.setTransform(scale,0,0,scale,0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
    const {coverSize,coverX,coverY,contentX,contentWidth,titleSize,artistSize,titleY,artistY}=pipLayout;
    if(gpVideoPipCover?.complete&&gpVideoPipCover.naturalWidth)GP.pipRenderer.drawCover(ctx,gpVideoPipCover,coverX,coverY,coverSize,34);else{GP.pipRenderer.roundedRect(ctx,coverX,coverY,coverSize,coverSize,34);ctx.fillStyle=`rgba(${accentRgb},.11)`;ctx.fill();}
    const title=track?.title||tr("未选择歌曲","No Song Selected"),now=performance.now();ctx.save();ctx.fillStyle=text;ctx.font=`${weight} ${titleSize*fontScale}px ${font}`;ctx.textBaseline="alphabetic";const titleWidth=ctx.measureText(title).width,marqueeKey=[track?.id,title,contentWidth,font,weight,fontScale.toFixed(2)].join("|");if(marqueeKey!==gpVideoPipMarqueeKey){gpVideoPipMarqueeKey=marqueeKey;gpVideoPipMarqueeStart=now+1100;}ctx.beginPath();ctx.rect(contentX,titleY-titleSize*1.25,contentWidth,titleSize*1.55);ctx.clip();if(titleWidth<=contentWidth)ctx.fillText(title,contentX,titleY);else if(now<gpVideoPipMarqueeStart)ctx.fillText(title,contentX,titleY);else{const gap=100,travel=titleWidth+gap,offset=((now-gpVideoPipMarqueeStart)*.075)%travel;ctx.fillText(title,contentX-offset,titleY);ctx.fillText(title,contentX-offset+travel,titleY);}ctx.restore();
    ctx.save();ctx.fillStyle=secondary;ctx.font=`${Math.min(600,Number(weight)||500)} ${artistSize*fontScale}px ${font}`;ctx.fillText(GP.pipRenderer.fitText(ctx,track?.artist||tr("导入音乐后开始播放","Import music to begin"),contentWidth),contentX,artistY);
    const duration=Number(audio.duration)||Number(track?.duration)||0,current=Math.min(duration,Number(audio.currentTime)||0),ratio=duration?Math.max(0,Math.min(1,current/duration)):0,barX=contentX,barY=407+14*compactness,barW=width-barX-70;
    GP.pipRenderer.roundedRect(ctx,barX,barY,barW,8,4);ctx.fillStyle=dark?"rgba(255,255,255,.18)":"rgba(20,28,38,.15)";ctx.fill();if(ratio>0){GP.pipRenderer.roundedRect(ctx,barX,barY,Math.max(8,barW*ratio),8,4);ctx.fillStyle=accent;ctx.fill();}ctx.fillStyle=secondary;ctx.font=`500 ${21*fontScale}px ${font}`;ctx.fillText(fmtTime(current),barX,barY+43);const end=fmtTime(duration),endWidth=ctx.measureText(end).width;ctx.fillText(end,barX+barW-endWidth,barY+43);ctx.fillStyle=text;ctx.font=`${weight} ${(25+5*compactness)*fontScale}px ${font}`;ctx.fillText(isPlaying?tr("正在播放","Now Playing"):tr("已暂停","Paused"),barX,526+10*compactness);if(compactness<.72){ctx.fillStyle=secondary;ctx.font=`500 ${20*fontScale}px ${font}`;ctx.fillText(tr("使用画中画控制播放","Use Picture-in-Picture controls"),barX,567);}ctx.restore();
    try{gpVideoPipTrack?.requestFrame?.();}catch(error){}
  }
  function stopTraditionalPiPMotion(){
    if(gpVideoPipMotionFrame){cancelAnimationFrame(gpVideoPipMotionFrame);gpVideoPipMotionFrame=0;}
    gpVideoPipLastMotionFrame=0;
  }
  function startTraditionalPiPMotion(){
    if(gpVideoPipMotionFrame||document.pictureInPictureElement!==gpVideoPipVideo||!isPlaying||gpVideoPipVideo.paused)return;
    gpVideoPipLastMotionFrame=0;gpVideoPipMotionFrame=requestAnimationFrame(runTraditionalPiPMotion);
  }
  function runTraditionalPiPMotion(timestamp){
    gpVideoPipMotionFrame=0;
    if(document.pictureInPictureElement!==gpVideoPipVideo||!isPlaying||gpVideoPipVideo.paused)return;
    if(timestamp-gpVideoPipLastMotionFrame>=GP_PIP_FRAME_MS-.35){gpVideoPipLastMotionFrame=timestamp;renderTraditionalPiPFrame(false);}
    gpVideoPipMotionFrame=requestAnimationFrame(runTraditionalPiPMotion);
  }
  function ensureTraditionalPiPVideo(){
    if(gpVideoPipVideo)return gpVideoPipVideo;
    gpVideoPipCanvas=document.createElement("canvas");gpVideoPipCanvas.hidden=true;gpVideoPipCanvas.setAttribute("aria-hidden","true");configureTraditionalPiPCanvas();
    const stream=gpVideoPipCanvas.captureStream(GP_PIP_TARGET_FPS);gpVideoPipTrack=stream.getVideoTracks()[0];gpVideoPipVideo=document.createElement("video");gpVideoPipVideo.hidden=true;gpVideoPipVideo.muted=true;gpVideoPipVideo.playsInline=true;gpVideoPipVideo.disablePictureInPicture=false;gpVideoPipVideo.srcObject=stream;gpVideoPipVideo.setAttribute("aria-hidden","true");document.body.append(gpVideoPipCanvas,gpVideoPipVideo);
    gpVideoPipVideo.addEventListener("play",()=>{if(gpVideoPipOpening||gpVideoPipFramePulse)return;if(!gpVideoPipTargetPlayback){gpVideoPipTargetPlayback=true;if(!isPlaying)playAudio();}startTraditionalPiPMotion();});
    gpVideoPipVideo.addEventListener("pause",()=>{stopTraditionalPiPMotion();if(gpVideoPipFramePulse)return;if(document.pictureInPictureElement===gpVideoPipVideo&&gpVideoPipTargetPlayback){gpVideoPipTargetPlayback=false;if(isPlaying)pauseAudio();}});
    gpVideoPipVideo.addEventListener("enterpictureinpicture",event=>{gpVideoPipWindow=event.pictureInPictureWindow||null;gpVideoPipResizeHandler=()=>scheduleTraditionalPiPRefresh(false);gpVideoPipWindow?.addEventListener("resize",gpVideoPipResizeHandler);$("#pipLaunchBtn").classList.add("active");gpVideoPipOpening=false;syncTraditionalPiP(true);});
    gpVideoPipVideo.addEventListener("leavepictureinpicture",cleanupTraditionalPiP,{once:true});
    gpVideoPipThemeObserver=new MutationObserver(()=>scheduleTraditionalPiPRefresh(true));[document.documentElement,document.body,$("#ambientGlow"),$("#ambientBlur"),$("#blob1"),$("#blob2"),$("#blob3")].filter(Boolean).forEach(element=>gpVideoPipThemeObserver.observe(element,{attributes:true,attributeFilter:["style","class","data-theme"]}));
    return gpVideoPipVideo;
  }
  function syncTraditionalPiP(forceTheme=false){
    if(!gpVideoPipCanvas)return;const track=playlist[currentIndex]||null,source=track?.coverUrl||track?.thumbUrl||"",shouldRender=forceTheme||!isPlaying;gpPipLoadCover(source);if(shouldRender){renderTraditionalPiPFrame(forceTheme);gpVideoPipLastRender=performance.now();}
    if(document.pictureInPictureElement===gpVideoPipVideo){gpVideoPipTargetPlayback=!!isPlaying;if(isPlaying&&gpVideoPipVideo.paused)gpVideoPipVideo.play().catch(()=>{});else if(isPlaying)startTraditionalPiPMotion();else{stopTraditionalPiPMotion();if(!gpVideoPipVideo.paused&&!gpVideoPipFramePulse)gpVideoPipVideo.pause();else if(gpVideoPipVideo.paused&&shouldRender)pulseTraditionalPiPFrame();}}
  }
  function cleanupTraditionalPiP(){
    gpVideoPipOpening=false;gpVideoPipTargetPlayback=false;gpVideoPipFramePulse=false;gpVideoPipLastRender=0;clearTimeout(gpVideoPipPulseTimer);gpVideoPipPulseTimer=0;cancelAnimationFrame(gpVideoPipRefreshFrame);gpVideoPipRefreshFrame=0;cancelAnimationFrame(gpVideoPipMotionFrame);gpVideoPipMotionFrame=0;gpVideoPipLastMotionFrame=0;gpVideoPipThemeObserver?.disconnect();gpVideoPipThemeObserver=null;if(gpVideoPipWindow&&gpVideoPipResizeHandler)gpVideoPipWindow.removeEventListener("resize",gpVideoPipResizeHandler);gpVideoPipWindow=null;gpVideoPipResizeHandler=null;try{gpVideoPipTrack?.stop();}catch(error){}if(gpVideoPipVideo){gpVideoPipVideo.srcObject=null;gpVideoPipVideo.remove();}gpVideoPipCanvas?.remove();gpVideoPipCanvas=null;gpVideoPipContext=null;gpVideoPipVideo=null;gpVideoPipTrack=null;gpVideoPipCover=null;gpVideoPipCoverSource="";gpVideoPipPalette=null;gpVideoPipBackgroundCanvas=null;gpVideoPipBackgroundContext=null;gpVideoPipBackgroundKey="";gpVideoPipMarqueeKey="";gpVideoPipMarqueeStart=0;$("#pipLaunchBtn").classList.remove("active");
  }
  async function toggleTraditionalPiP(){
    if(document.pictureInPictureElement){await document.exitPictureInPicture().catch(()=>{});return;}
    if(!document.pictureInPictureEnabled||!("requestPictureInPicture" in HTMLVideoElement.prototype)||!("captureStream" in HTMLCanvasElement.prototype)){
      showPipSupportModal(tr("当前 Edge 或页面环境不支持传统视频画中画。","Traditional video Picture-in-Picture is not available in this Edge or page context."),`pictureInPictureEnabled=${!!document.pictureInPictureEnabled} · protocol=${location.protocol}`);return;
    }
    try{
      const video=ensureTraditionalPiPVideo(),track=playlist[currentIndex]||null;gpPipLoadCover(track?.coverUrl||track?.thumbUrl||"");renderTraditionalPiPFrame();gpVideoPipOpening=true;gpVideoPipTargetPlayback=!!isPlaying;await video.play();if(video.readyState<1)await new Promise(resolve=>{const done=()=>resolve();video.addEventListener("loadedmetadata",done,{once:true});setTimeout(done,500);});await video.requestPictureInPicture();gpVideoPipOpening=false;syncTraditionalPiP(true);
    }catch(error){cleanupTraditionalPiP();showPipSupportModal(tr("Edge 拒绝或无法创建视频画中画。请从 GP 的按钮再次尝试。","Edge denied or could not create video Picture-in-Picture. Please try again from the GP button."),`${error?.name||"Error"}: ${error?.message||"Unknown failure"}`);}
  }
  $("#pipLaunchBtn").addEventListener("click",toggleTraditionalPiP);bindMicroMotion($("#pipLaunchBtn"),"gp-pip-motion",500);
  window.addEventListener("resize",()=>{if(gpVideoPipCanvas)scheduleTraditionalPiPRefresh(false);},{passive:true});

  /* ================= audio events (bound to both decks) ================= */
  decks.forEach(d => {
    d.addEventListener("play",()=>{if(d===audio&&wantsPlayback){resetBehaviorMediaClock();setPlaybackVisualState(true);syncTraditionalPiP();}});
    d.addEventListener("playing",()=>{if(d===audio&&wantsPlayback){resetBehaviorMediaClock();setPlaybackVisualState(true);syncTraditionalPiP();}});
    d.addEventListener("pause",()=>{
      if(d!==audio)return;
      // A native pause may arrive at the terminal media time before `ended`.
      // Keep the intent across that ordering window; ordinary pauses still
      // clear it immediately below.
      if(d.ended||crossfading){if(d.ended)deferNativeEndPause(d);setPlaybackVisualState(false);syncTraditionalPiP();return;}
      const atNaturalEnd=Number.isFinite(d.duration)&&d.duration>0&&Number.isFinite(d.currentTime)&&d.currentTime>=d.duration-.05&&wantsPlayback&&isPlaying;
      if(atNaturalEnd){deferNativeEndPause(d);setPlaybackVisualState(false);syncTraditionalPiP();return;}
      emitListeningCheckpoint("pause");
      setPlaybackVisualState(false);syncTraditionalPiP();
      if(!pendingPlayToken)wantsPlayback=false;
    });
    d.addEventListener("error",()=>{
      if(d!==audio||d.ended)return;
      pendingPlayToken=0;wantsPlayback=false;setPlaybackVisualState(false);syncTraditionalPiP();
    });
    d.addEventListener("timeupdate", () => {
      if(d !== audio || !audio.duration) return;
      settleBehaviorProgress();
      seekProgress = audio.currentTime/audio.duration;
      drawWaveform();
      if(typeof syncTraditionalPiP==="function")syncTraditionalPiP();
      $("#curTime").textContent = fmtTime(audio.currentTime);
      if(audio.currentTime - lastTimeMark > 4) flushHistory();
      maybeTriggerAutoCrossfade();
    });
    d.addEventListener("loadedmetadata", () => { if(d === audio) $("#durTime").textContent = fmtTime(audio.duration); });
    d.addEventListener("ended", () => { if(d === audio) onEnded(); });
  });

  $("#vol").addEventListener("input", () => {
    ensureAudioCtx();
    const v = parseFloat($("#vol").value);
    smoothAudioParam(masterGain.gain,v,.025);
    $("#vol").style.setProperty("--vol-pct", (v*100)+"%");
    updateVolIcon();
  });
  $("#vol").addEventListener("change",savePrefs);
  function currentVolume(){ return masterGain ? masterGain.gain.value : (parseFloat($("#vol").value)||0.7); }
  function updateVolIcon(){
    const v = currentVolume();
    $("#volIcon").innerHTML = v===0 ? '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M23 9l-6 6M17 9l6 6"/>'
      : v<0.5 ? '<path d="M11 5L6 9H2v6h4l5 4z"/>'
      : '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7"/>';
  }
  let lastVol = 0.7;
  $("#volIcon").addEventListener("click", () => {
    ensureAudioCtx();
    const v = currentVolume();
    const next=v>0?0:(lastVol||0.7);if(v>0)lastVol=v;
    const volumeRange=$("#vol");
    if(typeof volumeRange._gpAnimateRangeTo==="function")volumeRange._gpAnimateRangeTo(next,true);
    else{smoothAudioParam(masterGain.gain,next,.025);volumeRange.value=next;volumeRange.style.setProperty("--vol-pct",(next*100)+"%");updateVolIcon();}
  });

  $("#playBtn").addEventListener("click", togglePlay);
  $("#nextBtn").addEventListener("click", nextTrack);
  $("#prevBtn").addEventListener("click", prevTrack);
  bindImmediateMotion($("#nextBtn"),"gp-skip-motion",300);
  bindImmediateMotion($("#prevBtn"),"gp-skip-motion",300);

  /* 5.5.2: browsers do not expose Fn as a modifier. Fn+F11 therefore arrives
     as ordinary F11 and cannot be distinguished from a raw function key.
     Keep F9/F11 browser-owned; retain the requested F10 toggle and true media events. */
  const functionKeyPlayback={F10:togglePlay,MediaTrackPrevious:prevTrack,MediaPlayPause:togglePlay,MediaTrackNext:nextTrack};
  const playbackKeyActivation=new Map();
  function playbackKeyName(event){return functionKeyPlayback[event.code]?event.code:(functionKeyPlayback[event.key]?event.key:null);}
  function runPlaybackKey(event){
    const key=playbackKeyName(event),action=functionKeyPlayback[key];if(!action)return;
    if(key.startsWith("Media")&&"mediaSession" in navigator)return;
    const target=event.target;
    if(target?.matches?.("input,textarea,select,[contenteditable='true']"))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.repeat)return;
    const now=performance.now(),last=playbackKeyActivation.get(key)||-Infinity;
    if(now-last<120)return;
    playbackKeyActivation.set(key,now);action();
  }
  /* Edge exposes the same media press through Media Session. Listening to
     both keydown and Media Session makes press/release toggle twice. Use the
     keyboard route only as a fallback when Media Session is unavailable. */
  window.addEventListener("keydown",runPlaybackKey,true);
  window.addEventListener("blur",()=>playbackKeyActivation.clear());
  document.addEventListener("visibilitychange",()=>{if(document.hidden)playbackKeyActivation.clear();});
  if("mediaSession" in navigator){
    try{
      navigator.mediaSession.setActionHandler("previoustrack",prevTrack);
      navigator.mediaSession.setActionHandler("play",()=>{if(!isPlaying)togglePlay();});
      navigator.mediaSession.setActionHandler("pause",()=>{if(isPlaying)togglePlay();});
      navigator.mediaSession.setActionHandler("nexttrack",nextTrack);
    }catch(error){}
  }
  document.addEventListener("keydown", (e) => {
    if(e.target.matches?.("input,textarea,select,[contenteditable='true']")) return;
    if(e.code === "Space"){ e.preventDefault(); togglePlay(); }
  });

  /* ================= search / import / drag&drop ================= */
  let searchBehaviorTimer=0,searchRenderFrame=0;
  $("#search").addEventListener("input", () => {
    const query=$("#search").value;$(".search-wrap")?.classList.toggle("has-query",Boolean(query));
    if(searchRenderFrame)cancelAnimationFrame(searchRenderFrame);
    searchRenderFrame=requestAnimationFrame(()=>{searchRenderFrame=0;if($("#search").value===query)render(query);});
    clearTimeout(searchBehaviorTimer);
    if(query.trim())searchBehaviorTimer=setTimeout(()=>{
      if($("#search").value!==query)return;
      const resultCount=playlist.filter(track=>fuzzySearchScore(track,query).score>=.5).length;
      recordBehaviorEvent("search",null,{query:query.trim(),resultCount});
    },650);
  });
  $("#searchClearBtn").addEventListener("click",event=>{
    event.preventDefault();const search=$("#search");if(!search.value)return;
    search.value="";$(".search-wrap")?.classList.remove("has-query");render("");search.focus();
  });
  bindMicroMotion($("#addFilesBtn"),"gp-import-file-motion",500);
  bindMicroMotion($("#addFolderBtn"),"gp-import-folder-motion",500);
  $("#addFilesBtn").addEventListener("click", () => requestAnimationFrame(()=>$("#fileInput").click()));
  $("#addFolderBtn").addEventListener("click", () => requestAnimationFrame(()=>$("#folderInput").click()));
  $("#fileInput").addEventListener("change", (e) => { addFiles(e.target.files).catch(error=>finishImportProgress(null,error)); e.target.value=""; });
  $("#folderInput").addEventListener("change", (e) => { addFiles(e.target.files).catch(error=>finishImportProgress(null,error)); e.target.value=""; });

  let dragCounter = 0;
  window.addEventListener("dragenter", (e) => { if(queueDragFrom !== null) return; e.preventDefault(); dragCounter++; $("#drop-overlay").classList.add("show"); });
  window.addEventListener("dragover", (e) => { if(queueDragFrom !== null) return; e.preventDefault(); });
  window.addEventListener("dragleave", (e) => { if(queueDragFrom !== null) return; e.preventDefault(); dragCounter--; if(dragCounter<=0){ dragCounter=0; $("#drop-overlay").classList.remove("show"); } });
  window.addEventListener("drop", (e) => {
    if(queueDragFrom !== null) return;
    e.preventDefault(); dragCounter=0; $("#drop-overlay").classList.remove("show");
    if(e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files).catch(error=>finishImportProgress(null,error));
  });

  /* ================= settings ================= */
  let settingsCategory="appearance";
  function activateSettingsCategory(category){
    const valid=new Set(["appearance","playback","audio","library","data","advanced","about"]);
    settingsCategory=valid.has(category)?category:"appearance";
    $$("[data-settings-category]").forEach(button=>{
      const active=button.dataset.settingsCategory===settingsCategory;
      button.classList.toggle("active",active);button.setAttribute("aria-current",active?"page":"false");
    });
    $$('[data-settings-pane]').forEach(pane=>pane.classList.toggle("active",pane.dataset.settingsPane===settingsCategory));
    soundPanelActive=settingsCategory==="audio";
    requestAnimationFrame(()=>{
      refreshScrollEdgeFrames();
      if(soundPanelActive&&playlist[currentIndex]){ensureAudioCtx();loadWaveformFor(playlist[currentIndex]);}
      if(soundPanelActive){syncEQGeometry();syncSpatialModeGeometry();}
      if(settingsCategory==="about")renderAboutRuntimeInfo();
      if(settingsCategory==="advanced")syncTypographyPreviewLayout();
    });
  }
  $$("[data-settings-category]").forEach(button=>button.addEventListener("click",()=>activateSettingsCategory(button.dataset.settingsCategory)));
  activateSettingsCategory(settingsCategory);
  let rescanModalMode="closed";
  function openRescanConfirmation(){
    rescanModalMode="confirm";
    $("#rescanModal").classList.remove("is-scanning");$("#rescanLibraryBtn").classList.remove("is-scanning");
    $("#rescanModalTitle").textContent=tr("重新扫描歌曲库？","Rescan Music Library?");
    $("#rescanModalMessage").textContent=tr(`将重新读取当前导入的 ${playlist.length} 首歌曲，并用文件里的最新 Genre、Title、Artist、Album、日期、时长和封面更新缓存。Spectrum ID、MFCC、Energy、BPM 与收听历史不会改变。`,`The ${playlist.length} currently imported songs will be reread for current Genre, Title, Artist, Album, date, duration and artwork. Spectrum ID, MFCC, Energy, BPM and listening history will not change.`);
    $("#rescanProgress").classList.remove("show");$("#rescanProgressFill").style.width="0%";
    $("#rescanCancelBtn").style.display="";$("#rescanCancelBtn").disabled=false;$("#rescanCancelBtn").textContent=tr("取消","Cancel");
    $("#rescanConfirmBtn").disabled=false;$("#rescanConfirmBtn").textContent=tr("开始扫描","Start Scan");
    $("#rescanModal").classList.add("show");requestAnimationFrame(()=>$("#rescanConfirmBtn").focus());
  }
  function closeRescanModal(force=false){
    if(metadataRescanRunning||importRunning)return;
    const completedImport=rescanModalMode==="importDone"||rescanModalMode==="importError";
    if(completedImport&&!force)return;
    $("#rescanModal").classList.remove("show","is-scanning");$("#rescanLibraryBtn").classList.remove("is-scanning");rescanModalMode="closed";
    if(completedImport){requestAnimationFrame(()=>requestAnimationFrame(()=>positionCurrentQueueRow(true)));releaseImportBackgroundWork();}
  }
  async function runMetadataRescanFromModal(){
    if(rescanModalMode==="importDone"||rescanModalMode==="importError"){closeRescanModal(true);return;}
    if(rescanModalMode==="done"||rescanModalMode==="error"){closeRescanModal();return;}
    if(rescanModalMode!=="confirm"||metadataRescanRunning)return;
    rescanModalMode="running";$("#rescanLibraryBtn").disabled=true;$("#rescanLibraryBtn").classList.add("is-scanning");$("#rescanModal").classList.add("is-scanning");$("#rescanCancelBtn").style.display="none";$("#rescanConfirmBtn").disabled=true;
    $("#rescanModalTitle").textContent=tr("正在重新扫描","Rescanning Library");$("#rescanConfirmBtn").textContent=tr("扫描中…","Scanning…");
    $("#rescanProgress").classList.add("show");$("#rescanProgressFill").style.width="0%";
    try{
      const stats=await rescanImportedLibrary((completed,total)=>{
        $("#rescanProgressFill").style.width=`${total?completed/total*100:0}%`;
        $("#rescanModalMessage").textContent=tr(`正在读取 ${completed} / ${total} 首歌曲的现存数据…`,`Reading current file data: ${completed} / ${total} songs…`);
      });
      rescanModalMode="done";$("#rescanProgressFill").style.width="100%";
      $("#rescanModalTitle").textContent=tr("重新扫描完成","Rescan Complete");
      $("#rescanModalMessage").textContent=tr(`已扫描 ${stats.scanned} 首，更新 ${stats.changed} 首，读取到真实 Genre ${stats.genreFound} 首${stats.failed?`，失败 ${stats.failed} 首`:""}。所有 Spectrum 分析与收听历史均已保留。`,`Scanned ${stats.scanned} songs, updated ${stats.changed}, and found file Genre on ${stats.genreFound}${stats.failed?`; ${stats.failed} failed`:""}. All Spectrum analysis and listening history were preserved.`);
      $("#rescanConfirmBtn").disabled=false;$("#rescanConfirmBtn").textContent=tr("完成","Done");
      showToast(tr("音乐库现存数据已刷新","Current library metadata refreshed"));
    }catch(error){
      rescanModalMode="error";$("#rescanModalTitle").textContent=tr("重新扫描未完成","Rescan Incomplete");
      $("#rescanModalMessage").textContent=tr("扫描过程中出现错误；已经成功写入的歌曲不会回退，声学分析与历史未受影响。","An error interrupted the scan. Completed metadata updates remain saved; acoustic analysis and history were not affected.");
      $("#rescanConfirmBtn").disabled=false;$("#rescanConfirmBtn").textContent=tr("关闭","Close");
    }finally{$("#rescanLibraryBtn").disabled=false;$("#rescanLibraryBtn").classList.remove("is-scanning");$("#rescanModal").classList.remove("is-scanning");}
  }
  $("#rescanLibraryBtn").addEventListener("click",()=>{if(metadataRescanRunning)return;if(!playlist.length){showToast(tr("请先导入歌曲","Import songs first"));return;}openRescanConfirmation();});
  $("#rescanCancelBtn").addEventListener("click",closeRescanModal);$("#rescanConfirmBtn").addEventListener("click",runMetadataRescanFromModal);
  $("#rescanModal").addEventListener("click",event=>{if(event.target===$("#rescanModal"))closeRescanModal();});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&rescanModalMode!=="closed")closeRescanModal();});

  const defaultFolderButton=$("#defaultFolderBtn"),defaultFolderHint=$("#defaultFolderHint");
  defaultFolderButton?.addEventListener("click",async()=>{
    const chooseDefaultFolder=window.GP?.commands?.chooseDefaultMusicFolder;
    if(typeof chooseDefaultFolder!=="function"){
      if(defaultFolderHint)defaultFolderHint.textContent=tr("当前浏览器不支持自动记住文件夹；请每次使用添加文件夹。","This browser cannot remember folders automatically; use Add Folder each time.");
      return;
    }
    defaultFolderButton.disabled=true;
    try{
      const count=Number(await chooseDefaultFolder())||0;
      if(defaultFolderHint)defaultFolderHint.textContent=count
        ?tr(`默认文件夹已选择；本次找到 ${count} 个音频文件。`,`Default folder selected; found {count} audio files this time.`).replace("{count}",String(count))
        :tr("默认文件夹中没有找到音频文件。","No audio files were found in the default folder.");
      showToast(count?tr("已保存默认文件夹，下次打开会自动导入音乐。","Default folder saved. Its music will be imported next time."):tr("默认文件夹中没有找到音频文件。","No audio files were found in the default folder."));
    }catch(error){
      if(error?.name!=="AbortError")showToast(tr("默认文件夹未保存。","The default folder was not saved."));
    }finally{defaultFolderButton.disabled=false;}
  });

  $("#languageSeg").addEventListener("click",e=>{const button=e.target.closest("button");if(!button)return;GP.i18n.setLanguage(button.dataset.lang);syncSortUI();renderRecommendList();$("#modeLabel").textContent=tr(modeLabels[playMode][0],modeLabels[playMode][1]);savePrefs();requestAnimationFrame(()=>{GLIDER_SELECTORS.filter(selector=>selector!=="#languageSeg").forEach(selector=>updateGlider($(selector),false));updateGlider($("#languageSeg"),true);updateNavGlider(false);});});
  let themeMode = "auto";
  let autoThemeTimer=0;
  function scheduledAutoTheme(date=new Date()){const hour=date.getHours();return hour>=18||hour<5?"dark":"light";}
  function scheduleAutoThemeBoundary(){
    clearTimeout(autoThemeTimer);if(themeMode!=="auto")return;
    const now=new Date(),next=new Date(now);next.setMinutes(0,0,0);
    if(now.getHours()<5)next.setHours(5);else if(now.getHours()<18)next.setHours(18);else{next.setDate(next.getDate()+1);next.setHours(5);}
    autoThemeTimer=setTimeout(()=>{if(themeMode==="auto")applyTheme();},Math.max(1000,next-now+50));
  }
  function applyTheme(){
    const accentRequestToken=++adaptiveAccentRequestToken;
    const actual = themeMode==="auto" ? scheduledAutoTheme() : themeMode;
    const previousActual=document.body.getAttribute("data-theme");
    document.body.setAttribute("data-theme", actual);
    $$("#themeSeg button").forEach(b => b.classList.toggle("active", b.dataset.v===themeMode));
    if(adaptiveColorOn){refreshAdaptiveAccentForTheme();applyAdaptiveAccent(accentRequestToken);}
    else setAccent(accentKey,{refreshAmbient:false,persist:false});
    if(previousActual!==actual)requestAnimationFrame(()=>updateAmbient());
    updateFavoriteAnswerContrast();
    updateAdaptiveTextColors();updateContextualControlColors();scheduleAutoThemeBoundary();
    requestAnimationFrame(()=>{refreshScrollEdgeFrames();GPUIRegistry.refresh(document,false);});
  }
  $("#themeSeg").addEventListener("click", (e) => {
    const b=e.target.closest("button");if(!b)return;
    const themeGroup=$("#themeSeg"),previousActive=themeGroup.querySelector("button.active");
    const themeGliderOrigin=previousActive?{
      x:previousActive.offsetLeft,y:previousActive.offsetTop,
      w:previousActive.offsetWidth,h:previousActive.offsetHeight
    }:null;
    themeMode=b.dataset.v;applyTheme();savePrefs();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const glider=themeGroup.querySelector(":scope>.segment-glider");
      if(glider&&themeGliderOrigin){
        glider._gpMotion?.cancel();glider._gpMotion=null;
        glider.dataset.x=themeGliderOrigin.x;glider.dataset.y=themeGliderOrigin.y;
        glider.dataset.w=themeGliderOrigin.w;glider.dataset.h=themeGliderOrigin.h;
        glider.style.width=`${themeGliderOrigin.w}px`;glider.style.height=`${themeGliderOrigin.h}px`;
        glider.style.transform=`translate3d(${themeGliderOrigin.x}px,${themeGliderOrigin.y}px,0)`;
      }
      updateGlider(themeGroup,true);
    }));
  });

  $("#coverSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if(!b) return;
    coverDisplayMode = b.dataset.v;
    $$("#coverSeg button").forEach(x=>x.classList.toggle("active", x===b));
    updateArtDisplay(); savePrefs();
  });

  $("#bgSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if(!b) return;
    bgMode = b.dataset.v;
    $$("#bgSeg button").forEach(x=>x.classList.toggle("active", x===b));
    if(typeof reserveAmbientTransitionWindow==="function")reserveAmbientTransitionWindow(340);
    updateAmbient(); savePrefs();
  });

  function setAdaptiveColorEnabled(value){
    adaptiveColorOn = !!value;
    $("#adaptiveColorToggle").classList.toggle("on", adaptiveColorOn);
    syncAccentAvailability();
    if(adaptiveColorOn) applyAdaptiveAccent(); else setAccent(accentKey);
    savePrefs();
  }
  function syncCrossfadeAvailability(){
    const control=$("#crossfadeControl");if(control){control.classList.toggle("crossfade-disabled",!crossfadeEnabled);control.setAttribute("aria-disabled",String(!crossfadeEnabled));}
    $("#crossfadeSlider").disabled=!crossfadeEnabled;
  }
  function setCrossfadeEnabled(value){
    crossfadeEnabled = !!value;
    $("#crossfadeToggle").classList.toggle("on", crossfadeEnabled);
    syncCrossfadeAvailability();
    savePrefs();
  }
  function setLoudnessNormalizationEnabled(value){
    loudnessNormalizationEnabled=!!value;
    $("#loudnessNormalizeToggle").classList.toggle("on",loudnessNormalizationEnabled);
    if(audioCtx){applyCurrentTrackNormalization();syncAudioHeadroom();}
    savePrefs();
  }
  function renderSpatialInfo(){
    $("#spatialInfoList").innerHTML=GP.spatialPresets.getAllPresets().filter(preset=>preset.id!=="none").map(preset=>`<li><strong>${escapeHTML(tr(preset.name.zh,preset.name.en))}</strong> · ${escapeHTML(tr(preset.description.zh,preset.description.en))}</li>`).join("");
  }
  function renderLoudnessInfo(){
    $("#loudnessInfoList").innerHTML=tr(
      "<li><strong>自动均衡</strong> · 以当前曲库最响歌曲为参考。</li><li>只抬高较安静歌曲的播放增益，不压低较响歌曲。</li><li>不修改音频文件；响度数值仍显示原曲数据。</li>",
      "<li><strong>Auto Balance</strong> · Uses the loudest track in the current library as reference.</li><li>Raises quieter playback only; louder tracks are never turned down.</li><li>Audio files stay untouched and Loudness still shows source data.</li>"
    );
  }
  function syncSpatialModeGeometry(){
    const group=$("#spatialModeSeg");if(!group)return;
    const display=getComputedStyle(group).display;
    if(display==="grid"){group.style.width="100%";group.style.maxWidth="100%";return;}
    /* The Settings pane owns this strip. Let its glass frame end at the last
       wrapped option while retaining the existing narrow-container grid. */
    group.style.width="max-content";group.style.maxWidth="100%";
  }
  let eqGeometryFrame=0;
  function syncEQGeometry(){
    cancelAnimationFrame(eqGeometryFrame);
    eqGeometryFrame=requestAnimationFrame(()=>{
      const stage=$(".eq-curve-stage"),curve=$("#eqCurveVisual"),bands=$("#eqBands");
      if(!stage||!curve||!bands||!stage.offsetWidth)return;
      const compact=window.matchMedia("(max-width:660px)").matches;
      const stageRect=stage.getBoundingClientRect(),visualRect=curve.getBoundingClientRect();
      if(!visualRect.width||!visualRect.height)return;
      const viewBox=curve.viewBox?.baseVal,viewWidth=viewBox?.width||700,viewHeight=viewBox?.height||180;
      const scale=Math.min(visualRect.width/viewWidth,visualRect.height/viewHeight);
      const contentWidth=viewWidth*scale,contentHeight=viewHeight*scale;
      const contentLeft=visualRect.left+(visualRect.width-contentWidth)/2;
      const contentTop=visualRect.top+(visualRect.height-contentHeight)/2;
      const plotLeft=contentLeft+50*scale,plotRight=contentLeft+650*scale;
      const plotTop=contentTop+22*scale,plotBottom=contentTop+162*scale;
      bands.style.left=`${Math.round(plotLeft-stageRect.left)}px`;
      bands.style.width=`${Math.round(plotRight-plotLeft)}px`;
      bands.style.right="auto";bands.style.top=`${Math.round(plotTop-stageRect.top)}px`;
      bands.style.height=`${Math.max(31,Math.round(plotBottom-plotTop+31))}px`;bands.style.bottom="auto";
      bands.dataset.gpGeometry="aligned";
    });
  }
  function syncSpatialUI(animate=false,revealAtSelection=false){
    $("#spatialToggle").classList.toggle("on",spatialEnabled);
    $$("#spatialModeSeg button").forEach(button=>{const selected=spatialEnabled&&button.dataset.spatial===spatialMode;button.classList.toggle("active",selected);button.setAttribute("aria-pressed",String(selected));if(!spatialEnabled)button.classList.remove("gp-press-held","gp-press-release","glow-pulse");});
    const group=$("#spatialModeSeg");renderSpatialInfo();syncSpatialModeGeometry();
    const glider=group.querySelector(":scope>.segment-glider");
    if(!spatialEnabled){glider?._gpMotion?.cancel();if(glider){glider._gpMotion=null;glider.getAnimations().forEach(animation=>animation.cancel());}group.classList.remove("spatial-on");return;}
    if(revealAtSelection){group.classList.add("spatial-on");updateGlider(group,false);const revealed=group.querySelector(":scope>.segment-glider");revealed?.animate([{opacity:0},{opacity:1}],{duration:155,easing:"ease-out"});}
    else{group.classList.add("spatial-on");requestAnimationFrame(()=>updateGlider(group,animate));}
  }
  function selectSpatialMode(mode,persist=true){
    if(!GP.spatialPresets.getPreset(mode)||mode==="none")mode="desktop";const wasEnabled=spatialEnabled;spatialLastMode=mode;spatialMode=mode;spatialEnabled=true;syncSpatialUI(wasEnabled,!wasEnabled);if(spatialEngine)applySpatialParameters();syncAudioHeadroom();if(persist)savePrefs();
  }
  function setSpatialEnabled(value){const next=!!value;if(!next&&spatialEnabled)spatialLastMode=spatialMode;spatialEnabled=next;if(spatialEnabled)spatialMode=GP.spatialPresets.getPreset(spatialLastMode)&&spatialLastMode!=="none"?spatialLastMode:"desktop";syncSpatialUI(false,spatialEnabled);if(spatialEngine)applySpatialParameters();syncAudioHeadroom();savePrefs();}
  $("#spatialModeSeg").addEventListener("click",event=>{const button=event.target.closest("button[data-spatial]");if(button)selectSpatialMode(button.dataset.spatial);});
  function createSoundInfoController(buttonSelector,popSelector,render,widthLimit=310){
    const button=$(buttonSelector),pop=$(popSelector);let hoverTimer=0,hideTimer=0;
    function playMotion(){restartCssMotion(button,"info-motion");clearTimeout(button._motionTimer);button._motionTimer=setTimeout(()=>button.classList.remove("info-motion"),340);}
    function position(){const anchor=button.getBoundingClientRect(),width=Math.min(widthLimit,Math.max(220,innerWidth-24));pop.style.width=`${width}px`;const height=Math.min(pop.scrollHeight,innerHeight-24),left=Math.max(12,Math.min(innerWidth-width-12,anchor.right-width));let top=anchor.bottom+8;if(top+height>innerHeight-12)top=Math.max(12,anchor.top-height-8);pop.style.left=`${Math.round(left)}px`;pop.style.top=`${Math.round(top)}px`;}
    function show(){clearTimeout(hoverTimer);clearTimeout(hideTimer);render();if(!pop.classList.contains("gp-spatial-info-portal")){document.body.appendChild(pop);pop.classList.add("gp-spatial-info-portal");}setMotionPopover(pop,true);pop.setAttribute("aria-hidden","false");requestAnimationFrame(()=>{position();requestAnimationFrame(position);});}
    function hide(){clearTimeout(hoverTimer);clearTimeout(hideTimer);setMotionPopover(pop,false);pop.setAttribute("aria-hidden","true");}
    function scheduleHide(){clearTimeout(hideTimer);hideTimer=setTimeout(hide,140);}
    button.addEventListener("pointerenter",()=>{playMotion();clearTimeout(hoverTimer);hoverTimer=setTimeout(show,100);});
    button.addEventListener("pointerleave",()=>{clearTimeout(hoverTimer);scheduleHide();});
    button.addEventListener("click",event=>{event.stopPropagation();if(pop.classList.contains("show"))return;playMotion();show();});
    pop.addEventListener("pointerenter",()=>clearTimeout(hideTimer));pop.addEventListener("pointerleave",scheduleHide);
    return{button,pop,position,hide};
  }
  const spatialInfoController=createSoundInfoController("#spatialInfoBtn","#spatialInfoPop",renderSpatialInfo,310);
  const loudnessInfoController=createSoundInfoController("#loudnessInfoBtn","#loudnessInfoPop",renderLoudnessInfo,290);
  document.addEventListener("click",event=>{[spatialInfoController,loudnessInfoController].forEach(controller=>{if(!controller.button.contains(event.target)&&!controller.pop.contains(event.target))controller.hide();});});
  window.addEventListener("resize",()=>{spatialInfoController.position();loudnessInfoController.position();syncTypographyPreviewLayout();syncEQGeometry();syncSpatialModeGeometry();},{passive:true});
  $("#settingsPanel")?.addEventListener("scroll",()=>{spatialInfoController.position();loudnessInfoController.position();},{passive:true});
  function bindDragToggle(button,getValue,setValue){
    if(!button)return;let startX=0,dragging=false,suppressClickUntil=0;
    button.addEventListener("pointerdown",event=>{
      if(event.button!==0)return;startX=event.clientX;dragging=false;button.setPointerCapture?.(event.pointerId);
    });
    button.addEventListener("pointermove",event=>{
      if(!button.hasPointerCapture?.(event.pointerId))return;
      if(Math.abs(event.clientX-startX)>3)dragging=true;
      if(dragging){const rect=button.getBoundingClientRect();button.classList.toggle("on",event.clientX>=rect.left+rect.width/2);}
    });
    button.addEventListener("pointerup",event=>{
      if(!button.hasPointerCapture?.(event.pointerId))return;
      button.releasePointerCapture?.(event.pointerId);
      if(dragging){const rect=button.getBoundingClientRect();setValue(event.clientX>=rect.left+rect.width/2);suppressClickUntil=performance.now()+120;}
      else button.classList.toggle("on",!!getValue());
      dragging=false;
    });
    button.addEventListener("pointercancel",()=>{dragging=false;button.classList.toggle("on",!!getValue());});
    button.addEventListener("click",event=>{if(performance.now()<suppressClickUntil){event.preventDefault();return;}setValue(!getValue());});
  }
  bindDragToggle($("#adaptiveColorToggle"),()=>adaptiveColorOn,setAdaptiveColorEnabled);
  bindDragToggle($("#crossfadeToggle"),()=>crossfadeEnabled,setCrossfadeEnabled);
  bindDragToggle($("#spatialToggle"),()=>spatialEnabled,setSpatialEnabled);
  bindDragToggle($("#loudnessNormalizeToggle"),()=>loudnessNormalizationEnabled,setLoudnessNormalizationEnabled);
  let fluidMotionEnabled=true,continuousPlayEnabled=true,keyboardControlsEnabled=true;
  bindDragToggle($("#fluidMotionToggle"),()=>fluidMotionEnabled,value=>{
    fluidMotionEnabled=!!value;
    $("#fluidMotionToggle")?.classList.toggle("on",fluidMotionEnabled);
    savePrefs();
  });
  bindDragToggle($("#continuousPlayToggle"),()=>continuousPlayEnabled,value=>{
    continuousPlayEnabled=!!value;
    $("#continuousPlayToggle")?.classList.toggle("on",continuousPlayEnabled);
    savePrefs();
  });
  bindDragToggle($("#keyboardControlsToggle"),()=>keyboardControlsEnabled,value=>{
    keyboardControlsEnabled=!!value;
    $("#keyboardControlsToggle")?.classList.toggle("on",keyboardControlsEnabled);
    savePrefs();
  });
  $("#resetPrefsBtn")?.addEventListener("click",()=>{
    themeMode="auto";
    coverDisplayMode="rotate";
    bgMode="glow";
    adaptiveColorOn=true;
    crossfadeEnabled=false;
    crossfadeSeconds=3;
    spatialEnabled=false;
    loudnessNormalizationEnabled=false;
    fluidMotionEnabled=true;
    continuousPlayEnabled=true;
    keyboardControlsEnabled=true;
    setAccent("navy");
    applyTheme();
    $("#crossfadeToggle")?.classList.toggle("on",crossfadeEnabled);
    $("#spatialToggle")?.classList.toggle("on",spatialEnabled);
    $("#loudnessNormalizeToggle")?.classList.toggle("on",loudnessNormalizationEnabled);
    $("#fluidMotionToggle")?.classList.toggle("on",fluidMotionEnabled);
    $("#continuousPlayToggle")?.classList.toggle("on",continuousPlayEnabled);
    $("#keyboardControlsToggle")?.classList.toggle("on",keyboardControlsEnabled);
    $("#fontSizeSlider").value=1;
    document.documentElement.style.setProperty("--font-scale","1");
    $("#fontWeightSlider").value=450;
    applyFontWeight(450);
    savePrefs();
    showToast(tr("已恢复默认设置","Settings restored to defaults"));
  });
  function formatCrossfadeValue(value){return `${Number(value).toFixed(1)}s`;}
  $("#crossfadeSlider").addEventListener("input", () => {
    crossfadeSeconds = parseFloat($("#crossfadeSlider").value);
    $("#crossfadeValue").textContent = formatCrossfadeValue(crossfadeSeconds);
    savePrefs();
  });

  const swatchWrap = $("#accentSwatches");
  function syncAccentAvailability(){
    const group=$("#accentColorGroup");if(!group)return;
    group.classList.toggle("accent-disabled",adaptiveColorOn);group.setAttribute("aria-disabled",String(adaptiveColorOn));
    $$("#accentSwatches .swatch").forEach(button=>{button.disabled=adaptiveColorOn;button.setAttribute("aria-disabled",String(adaptiveColorOn));});
  }
  Object.keys(accentPalettes).forEach(key => {
    const b = document.createElement("button");
    b.className = "swatch ripple-target"; b.dataset.k = key;
    b.style.setProperty("--swatch-fill",key === "mono" ? "linear-gradient(135deg, #000000 0 50%, #8e8e93 50% 100%)" : `linear-gradient(135deg, ${accentPalettes[key][0]}, ${accentPalettes[key][1]})`);
    b.addEventListener("click", () => {if(!adaptiveColorOn)setAccent(key);});
    swatchWrap.appendChild(b);
  });

  const GP_FONT_LANGUAGE_STACKS=Object.freeze({
    zh:'"PingFang SC", "PingFang TC", "PingFang HK", "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", Arial, sans-serif',
    en:'"Segoe UI", Arial, "SF Pro Text", sans-serif',
    ru:'"Segoe UI", Arial, "SF Pro Text", sans-serif'
  });
  const GP_FONT_SERIF_STACKS=Object.freeze({
    zh:'"Songti SC", "Songti TC", "Noto Serif SC", "Source Han Serif SC", "SimSun", "STSong", "Times New Roman", serif',
    en:'Georgia, "Times New Roman", "Songti SC", "SimSun", serif',
    ru:'Georgia, "Times New Roman", serif'
  });
  const GP_FONT_MONO_STACKS=Object.freeze({
    zh:'Consolas, "Courier New", "PingFang SC", "Microsoft YaHei", monospace',
    en:'Consolas, "Courier New", monospace',
    ru:'Consolas, "Courier New", monospace'
  });
  const GP_APPLE_FONT_ROLES=Object.freeze({
    zh:Object.freeze({base:'"SF Pro", "SF Pro Text", "PingFang SC", "PingFang TC", "PingFang HK", "Segoe UI", Arial, sans-serif',display:'"SF Pro Display", "SF Pro", "PingFang SC", "PingFang TC", "PingFang HK", "Segoe UI", Arial, sans-serif',text:'"SF Pro Text", "SF Pro", "PingFang SC", "PingFang TC", "PingFang HK", "Segoe UI", Arial, sans-serif',mono:'"SF Mono", "SF Pro", "PingFang SC", "PingFang TC", "Segoe UI", Consolas, monospace'}),
    en:Object.freeze({base:'"SF Pro", "SF Pro Text", "Segoe UI", Arial, sans-serif',display:'"SF Pro Display", "SF Pro", "Segoe UI", Arial, sans-serif',text:'"SF Pro Text", "SF Pro", "Segoe UI", Arial, sans-serif',mono:'"SF Mono", "SF Pro", "Segoe UI", Consolas, monospace'}),
    ru:Object.freeze({base:'"SF Pro", "SF Pro Text", "Segoe UI", Arial, sans-serif',display:'"SF Pro Display", "SF Pro", "Segoe UI", Arial, sans-serif',text:'"SF Pro Text", "SF Pro", "Segoe UI", Arial, sans-serif',mono:'"SF Mono", "SF Pro", "Segoe UI", Consolas, monospace'})
  });
  function fontLanguage(){return uiLanguage==="ru"?"ru":uiLanguage==="en"?"en":"zh";}
  function appendFontLanguageFallback(value,language){
    const raw=String(value||"").trim();
    const isMono=/\bmonospace\s*$/i.test(raw);
    const isSerif=!isMono && /(?:^|[,\s])serif\s*$/i.test(raw);
    const base=raw.replace(/,\s*(?:sans-serif|serif|monospace)\s*$/i,"").trim();
    if(isSerif){
      return `${base}, ${(GP_FONT_SERIF_STACKS[language]||GP_FONT_SERIF_STACKS.zh)}`;
    }
    if(isMono){
      return `${base}, ${(GP_FONT_MONO_STACKS[language]||GP_FONT_MONO_STACKS.zh)}`;
    }
    return `${base}, ${(GP_FONT_LANGUAGE_STACKS[language]||GP_FONT_LANGUAGE_STACKS.zh)}`;

  }
  function syncTypographyLanguage(){
    const select=$("#fontSelect"),selected=select?.options?.[select.selectedIndex];if(!select||!selected)return;
    const language=fontLanguage(),isApple=selected.dataset.fontProfile==="apple",root=document.documentElement;
    root.dataset.fontLanguage=language;
    let effectiveStack=appendFontLanguageFallback(selected.value,language);
    if(isApple){
      const roles=GP_APPLE_FONT_ROLES[language];root.dataset.fontProfile="apple";
      Object.entries(roles).forEach(([role,stack])=>root.style.setProperty(`--gp-font-${role}`,stack));
      effectiveStack=roles.text;
    }else{
      root.removeAttribute("data-font-profile");
      ["base","display","text","mono"].forEach(role=>root.style.removeProperty(`--gp-font-${role}`));
    }
    root.style.setProperty("--font-family",effectiveStack);
    const preview=$("#fontPreview");if(preview){preview.style.fontFamily=effectiveStack;preview.lang=document.documentElement.lang||language;}
    if(typeof realignTypographyGliders==="function")realignTypographyGliders();
  }
  function applyFontFamily(){syncTypographyLanguage();}
  function primaryStackFamily(stack){
    const match=String(stack||"").match(/^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/);
    return (match?.[1]||match?.[2]||match?.[3]||"").trim();
  }
  function verifyFontAvailable(stack){
    // 7.4.0: a missing family used to fail silently (CJK kept PingFang while
    // the Apple profile fell back to Segoe UI). Tell the user instead.
    try{
      const family=primaryStackFamily(stack),generic=family.toLowerCase();
      if(!family||generic==="sans-serif"||generic==="serif"||generic==="monospace")return;
      if(document.fonts?.check&&!document.fonts.check(`16px "${family.replace(/"/g,"")}"`))showToast(tr(`系统未安装「${family}」，已使用回退字体`,`“${family}” is not installed; using a fallback font`));
    }catch(error){}
  }
  function syncFontPicker(){
    const select = $("#fontSelect");
    const selected = select.options[select.selectedIndex];
    $("#fontPickerLabel").textContent = selected ? selected.textContent : "选择字体";
    $$("#fontPickerPop .font-picker-option").forEach(button => {
      button.classList.toggle("active", button.dataset.fontValue === select.value);
    });
  }
  function syncTypographyPreviewLayout(){
    const preview=$("#fontPreview"),group=preview?.closest(".setting-group");if(!preview||!group)return;
    const label=group.querySelector(":scope > .setting-label"),picker=group.querySelector(":scope > .font-picker");
    const compact=window.matchMedia("(max-width:900px)").matches;
    preview.style.gridColumn=compact?"1":"1 / -1";preview.style.gridRow="1";preview.style.justifySelf="center";
    preview.style.width="min(100%, 340px)";preview.style.maxWidth="340px";preview.style.marginTop="0";preview.style.textAlign="center";
    if(label){label.style.gridColumn="1";label.style.gridRow=compact?"2":"2 / span 2";}
    if(picker){picker.style.gridColumn=compact?"1":"2";picker.style.gridRow=compact?"3":"2 / span 2";picker.style.justifySelf=compact?"start":"end";}
    group.dataset.typographyLayout="preview-first";
  }
  let aboutRuntimeInfoNode=null;
  function renderAboutRuntimeInfo(){
    const pane=$('[data-settings-pane="about"]'),card=pane?.querySelector(".build-card");if(!pane||!card)return;
    if(!aboutRuntimeInfoNode){aboutRuntimeInfoNode=document.createElement("div");aboutRuntimeInfoNode.className="about-runtime-info";card.after(aboutRuntimeInfoNode);}
    const runtime=window.GP||{},engines=runtime.engines||{};
    const engineList=["core","bionic","fusion","motion","spatial","spectrum","neural"].map(key=>engines[key]).filter(Boolean);
    const fallbackEngineList=("GP Core 4.3 — Kinetic Runtime · GP Bionic Engine 1.0 — Intelligence Core · GP Fusion Engine 4.2 — Playlist Flow · GP Motion Engine 4.2 — Kinetic Motion · GP Spatial Engine 1.1 — Room · GP Spectrum Engine 2.3 — Signal · GP Neural Engine 2.2 — Listening DNA").split(" · ");
    const rows=[
      [tr("架构","Architecture"),runtime.architecture||"Peregrine Lake"],
      [tr("引擎","Engines"),engineList.length?engineList:fallbackEngineList],
      [tr("数据安全","Cache safety"),tr("本地单一运行时；设置不新增状态，音频分析与听歌历史继续使用现有缓存边界。","One local runtime; Settings adds no state, and audio analysis and listening history keep their existing cache boundaries.")]
    ];
    aboutRuntimeInfoNode.innerHTML=rows.map(([label,value])=>{
      const lines=Array.isArray(value)?value:[value];
      return `<div class="setting-row settings-note-row"><div class="setting-copy"><div class="setting-label">${escapeHTML(label)}</div>${lines.map(line=>`<div class="setting-hint">${escapeHTML(line)}</div>`).join("")}</div></div>`;
    }).join("");
    aboutRuntimeInfoNode.querySelectorAll(".setting-hint").forEach(node=>node.style.setProperty("display","block","important"));
  }
  function closeFontPicker(){
    setMotionPopover($("#fontPickerPop"),false);
    $("#fontPickerBtn").classList.remove("open");
    $("#fontPickerBtn").setAttribute("aria-expanded", "false");
  }
  function positionFontPickerPortal(){
    const button=$("#fontPickerBtn"),pop=$("#fontPickerPop");
    if(!button||!pop||!pop.classList.contains("gp-font-portal"))return;
    const rect=button.getBoundingClientRect(),margin=10,gap=8;
    pop.style.setProperty("--font-pop-width",`${rect.width}px`);
    const popHeight=Math.min(pop.scrollHeight||260,Math.min(380,window.innerHeight*.7));
    let top=rect.top-popHeight-gap;
    if(top<margin)top=Math.min(window.innerHeight-popHeight-margin,rect.bottom+gap);
    const left=Math.max(margin,Math.min(window.innerWidth-rect.width-margin,rect.left));
    pop.style.left=`${left}px`;pop.style.top=`${Math.max(margin,top)}px`;
  }
  function refreshFontAvailability(){
    // 7.4.0: mark options whose first family is not installed so a silent
    // fallback is never mistaken for a broken switch.
    $$("#fontPickerPop .font-picker-option").forEach(button=>{
      let available=true;
      try{
        const family=primaryStackFamily(button.dataset.fontValue);
        if(family&&document.fonts?.check)available=document.fonts.check(`16px "${family.replace(/"/g,"")}"`);
      }catch(error){available=true;}
      button.dataset.available=available?"1":"0";
      if(available)button.removeAttribute("title");
      else button.title=tr("系统未安装此字体，会使用回退字体","This font is not installed; a fallback will be used");
    });
  }
  function buildFontPicker(){
    const select = $("#fontSelect");
    const pop = $("#fontPickerPop");
    pop.innerHTML = "";
    Array.from(select.children).forEach(group => {
      if(group.tagName !== "OPTGROUP") return;
      const heading = document.createElement("div");
      heading.className = "font-picker-group";
      heading.textContent = group.label;
      pop.appendChild(heading);
      Array.from(group.children).forEach(option => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "font-picker-option ripple-target";
        button.dataset.fontValue = option.value;
        button.dataset.fontProfile = option.dataset.fontProfile || "single";
        button.textContent = option.textContent;
        if(option.dataset.fontProfile !== "apple")button.style.fontFamily = option.value;
        button.addEventListener("click", e => {
          e.stopPropagation();
          select.value = option.value;
          select.dispatchEvent(new Event("change", {bubbles:true}));
          closeFontPicker();
        });
        pop.appendChild(button);
      });
    });
    $("#fontPickerBtn").addEventListener("click", e => {
      e.stopPropagation();
      const show = !pop.classList.contains("show");
      if(show&&!pop.classList.contains("gp-font-portal")){
        document.body.appendChild(pop);pop.classList.add("gp-font-portal");
      }
      setMotionPopover(pop,show);
      if(show)requestAnimationFrame(positionFontPickerPortal);
      $("#fontPickerBtn").classList.toggle("open", show);
      $("#fontPickerBtn").setAttribute("aria-expanded", String(show));
    });
    document.addEventListener("click", e => { if(!e.target.closest("#fontPicker")&&!e.target.closest("#fontPickerPop")) closeFontPicker(); });
    window.addEventListener("resize",()=>{if(pop.classList.contains("show"))requestAnimationFrame(positionFontPickerPortal);},{passive:true});
    syncFontPicker();refreshFontAvailability();
    if(document.fonts?.ready)document.fonts.ready.then(()=>refreshFontAvailability());
  }
  let typographyGliderFrame=0;
  function realignTypographyGliders(){
    cancelAnimationFrame(typographyGliderFrame);
    typographyGliderFrame=requestAnimationFrame(()=>requestAnimationFrame(()=>{initializeSelectionGliders();fitActiveView();}));
  }
  $("#fontSelect").addEventListener("change", () => {
    applyFontFamily();
    verifyFontAvailable(document.documentElement.style.getPropertyValue("--font-family"));
    syncFontPicker();
    savePrefs();
    scheduleViewportFit();
    realignTypographyGliders();
  });
  $("#fontSizeSlider").addEventListener("input", () => { document.documentElement.style.setProperty("--font-scale", $("#fontSizeSlider").value); savePrefs(); scheduleViewportFit(); realignTypographyGliders(); });
  function fontWeightLabel(weight){
    const value=Number(weight)||450;
    if(value<=350)return tr("细","Light");
    if(value<=450)return tr("常规","Regular");
    if(value<=550)return tr("中等","Medium");
    if(value<=650)return tr("半粗","Semibold");
    if(value<=750)return tr("粗","Bold");
    return tr("特粗","Heavy");
  }
  function applyFontWeight(weight){
    weight=Math.max(300,Math.min(800,Number(weight)||450));
    document.documentElement.style.setProperty("--font-weight",weight);
    /* Use the font's real variable/declared weight. Artificial strokes create
       double-sampled edges at fractional Edge zoom levels. */
    document.documentElement.style.setProperty("--font-stroke","0px");
    $("#fontWeightValue").textContent=fontWeightLabel(weight);
  }
  $("#fontWeightSlider").addEventListener("input", () => {
    applyFontWeight($("#fontWeightSlider").value);
    savePrefs();
    realignTypographyGliders();
  });

  function savePrefs(){
    try{
      GPBrowserStorage.setLocal("glassPlayerPrefs", JSON.stringify({
        themeMode, accentKey, coverDisplayMode, bgMode, uiLanguage,
        font: $("#fontSelect").value, fontScale: $("#fontSizeSlider").value, fontWeight: $("#fontWeightSlider").value,
        volume: currentVolume(), playMode, playbackRate,
        crossfadeEnabled, crossfadeSeconds, adaptiveColorOn, spatialEnabled, spatialMode, spatialLastMode, loudnessNormalizationEnabled,
        fluidMotionEnabled, continuousPlayEnabled, keyboardControlsEnabled,
        eqPresetKey, eqGains, customEQGains
      }));
    }catch(e){}
    if(typeof scheduleTraditionalPiPRefresh==="function")scheduleTraditionalPiPRefresh(true);
  }
  function loadPrefs(){
    let p; try{ p = JSON.parse(GPBrowserStorage.getLocal("glassPlayerPrefs")); }catch(e){}
    if(!p) p = {};
    uiLanguage = p.uiLanguage === "en" ? "en" : p.uiLanguage === "ru" ? "ru" : "zh";
    themeMode = ["auto","light","dark"].includes(p.themeMode) ? p.themeMode : "auto";
    coverDisplayMode = ["rotate","static"].includes(p.coverDisplayMode) ? p.coverDisplayMode : "rotate";
    bgMode = ["glow","color","blur"].includes(p.bgMode) ? p.bgMode : "glow";
    $$("#coverSeg button").forEach(b => b.classList.toggle("active", b.dataset.v===coverDisplayMode));
    $$("#bgSeg button").forEach(b => b.classList.toggle("active", b.dataset.v===bgMode));
    const fontOptions=Array.from($("#fontSelect").options);
    if(p.font&&fontOptions.some(option=>option.value===p.font))$("#fontSelect").value=p.font;
    else $("#fontSelect").selectedIndex=0;
    applyFontFamily();
    $("#fontSizeSlider").value = p.fontScale || 1;
    document.documentElement.style.setProperty("--font-scale", $("#fontSizeSlider").value);
    $("#fontWeightSlider").value=p.fontWeight||450;
    applyFontWeight($("#fontWeightSlider").value);
    const savedVolume = p.volume !== undefined ? p.volume : 0.7;
    $("#vol").value = savedVolume; $("#vol").style.setProperty("--vol-pct",(savedVolume*100)+"%");
    if(masterGain) masterGain.gain.value = savedVolume; // if audio ctx already exists, apply immediately
    const storedPlaybackRate=Number(p.playbackRate),validPlaybackRates=[.5,.75,1,1.5,2];
    const restoredPlaybackRate=validPlaybackRates.find(rate=>Math.abs(rate-storedPlaybackRate)<.005)??1;
    applyPlaybackRate(restoredPlaybackRate,{syncSlider:true,persist:false});
    crossfadeEnabled = !!p.crossfadeEnabled;
    $("#crossfadeToggle").classList.toggle("on", crossfadeEnabled);
    syncCrossfadeAvailability();
    crossfadeSeconds = Math.max(.5,Math.min(3,Number(p.crossfadeSeconds)||3));
    $("#crossfadeSlider").value = crossfadeSeconds;
    $("#crossfadeValue").textContent = formatCrossfadeValue(crossfadeSeconds);
    spatialMode=GP.spatialPresets.getPreset(p.spatialMode)&&p.spatialMode!=="none"?p.spatialMode:"desktop";
    spatialLastMode=GP.spatialPresets.getPreset(p.spatialLastMode)&&p.spatialLastMode!=="none"?p.spatialLastMode:spatialMode;
    spatialEnabled=!!p.spatialEnabled;
    syncSpatialUI(false);
    loudnessNormalizationEnabled=!!p.loudnessNormalizationEnabled;
    $("#loudnessNormalizeToggle").classList.toggle("on",loudnessNormalizationEnabled);
    fluidMotionEnabled = p.fluidMotionEnabled !== undefined ? !!p.fluidMotionEnabled : true;
    continuousPlayEnabled = p.continuousPlayEnabled !== undefined ? !!p.continuousPlayEnabled : true;
    keyboardControlsEnabled = p.keyboardControlsEnabled !== undefined ? !!p.keyboardControlsEnabled : true;
    $("#fluidMotionToggle")?.classList.toggle("on", fluidMotionEnabled);
    $("#continuousPlayToggle")?.classList.toggle("on", continuousPlayEnabled);
    $("#keyboardControlsToggle")?.classList.toggle("on", keyboardControlsEnabled);
    adaptiveColorOn = !!p.adaptiveColorOn;
    $("#adaptiveColorToggle").classList.toggle("on", adaptiveColorOn);
    syncAccentAvailability();
    const validSavedGains=values=>Array.isArray(values)&&values.length===7&&values.every(value=>Number.isFinite(Number(value)));
    customEQGains=validSavedGains(p.customEQGains)?p.customEQGains.map(Number):p.eqPresetKey==="custom"&&validSavedGains(p.eqGains)?p.eqGains.map(Number):eqPresets.flat.slice();
    eqPresetKey=p.eqPresetKey==="custom"||eqPresets[p.eqPresetKey]?p.eqPresetKey:"flat";
    eqGains=(eqPresetKey==="custom"?customEQGains:eqPresets[eqPresetKey]).slice();
    buildEQUI();
    syncEQGeometry();syncSpatialModeGeometry();syncTypographyPreviewLayout();
    setEQPresetLabel(eqPresetKey);
    setMode(["sequential","shuffle","repeatOne"].includes(p.playMode)?p.playMode:"sequential");
    setAccent(p.accentKey || "navy");
    applyTheme(); updateVolIcon();
  }
  /* ================= stable Edge window fitting ================= */
  const APP_MIN_WIDTH = 1040;
  const APP_MIN_HEIGHT = 800;
  const initialFrameRatio=(window.outerWidth&&window.innerWidth)?window.outerWidth/window.innerWidth:1;
  let viewportFitFrame = 0;

  function fitActiveView(view=null){
    const mainArea = $(".main-area");
    const activeView = view || $(".view.active:not(.gp-view-overlay)") || $(".view.active");
    if(!mainArea || !activeView) return;
    const target = activeView.querySelector(".view-fill") || activeView.querySelector(".player-layout");
    if(!target) return;
    const style = getComputedStyle(mainArea);
    const verticalPadding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const available = mainArea.clientHeight - verticalPadding;
    const nextHeight=Math.floor(Math.max(520,available));
    const currentHeight=parseFloat(target.style.height)||0;
    if(Math.abs(currentHeight-nextHeight)>=1)target.style.height=nextHeight+"px";
  }

  function applyViewportFit(){
    viewportFitFrame = 0;
    const viewport = window.visualViewport;
    const width = Math.max(320, Math.round(viewport ? viewport.width : window.innerWidth));
    const height = Math.max(320, Math.round(viewport ? viewport.height : window.innerHeight));
    const currentFrameRatio=(window.outerWidth&&window.innerWidth)?window.outerWidth/window.innerWidth:initialFrameRatio;
    const pageZoom=Math.max(.75,Math.min(2,currentFrameRatio/initialFrameRatio));
    const rawScale = Math.min(1, (width*pageZoom) / APP_MIN_WIDTH, (height*pageZoom) / APP_MIN_HEIGHT);
    /* Snap fit zoom to a device-pixel-aware raster step. Tiny continuously
       changing fractions force Chromium to resample glyphs onto half pixels. */
    const rasterStep=1/(64*Math.max(1,Math.round(window.devicePixelRatio||1)));
    const scale=rawScale>=.999?1:Math.max(.5,Math.floor(rawScale/rasterStep)*rasterStep);
    const shell = $("#appShell");
    shell.style.width = (width / scale) + "px";
    shell.style.height = (height / scale) + "px";
    /* Chromium layout zoom keeps glyphs in the text rasterization pipeline.
       Scaling the complete shell as one texture made fractional-size text rough. */
    shell.style.transform = "none";
    shell.style.zoom = scale;
    document.documentElement.style.setProperty("--ui-scale", scale.toFixed(4));
    document.body.classList.toggle("compact-window", scale < .999);
    fitActiveView();
    window.dispatchEvent(new CustomEvent("gp:viewport-fit",{detail:{width:Math.round(width*pageZoom),height:Math.round(height*pageZoom)}}));
    requestAnimationFrame(()=>{
      updateNavGlider(false);updateAllGliders(false);
      refreshScrollEdgeFrames();GPUIRegistry.refresh($(".view.active")||document,false);
      refreshNowTitleMarqueeForScale();
    });
  }

  function scheduleViewportFit(){
    if(viewportFitFrame) cancelAnimationFrame(viewportFitFrame);
    viewportFitFrame = requestAnimationFrame(applyViewportFit);
  }

  window.addEventListener("resize", scheduleViewportFit, {passive:true});
  window.addEventListener("load",()=>requestAnimationFrame(initializeSelectionGliders),{once:true});
  document.addEventListener("fullscreenchange", scheduleViewportFit);
  if(window.visualViewport) window.visualViewport.addEventListener("resize", scheduleViewportFit, {passive:true});
  scheduleViewportFit();
  /* Window and visualViewport events are sufficient here. Observing main-area itself
     created a resize feedback loop that made the two facing glass borders shimmer. */

  /* Bind the existing, tested 3.5.3 player to /src/core/audio without changing
     any UI handler or playback call site in this Beta. */
  GPAudioCore.bindRuntime({
    play:playAudio,
    pause:pauseAudio,
    toggle:togglePlay,
    loadTrack,
    next:nextTrack,
    previous:prevTrack,
    getState:()=>({currentIndex,isPlaying,wantsPlayback,playMode,queueLength:playQueue.length})
  });
  GPModules.register("createEqPresets",function createEqPresets(source){const copy={};Object.entries(source).forEach(([key,value])=>copy[key]=Object.freeze([...value]));return Object.freeze(copy);});
  GPModules.register("createAudioEngine",function createAudioEngine(runtime){
    return Object.freeze({init:runtime.init,loadTrack:runtime.loadTrack,play:runtime.play,pause:runtime.pause,seek:runtime.seek,setVolume:runtime.setVolume,setEQ:runtime.setEQ,setSpatialMode:runtime.setSpatialMode,setSpatialEnabled:runtime.setSpatialEnabled,startCrossfade:runtime.startCrossfade,stop:runtime.stop,destroy:runtime.destroy,getRuntimeSnapshot:runtime.getRuntimeSnapshot});
  });
  GPModules.register("createBionicEngine",function createBionicEngine(runtime){
    return Object.freeze({
      recognizeAudioEssence:runtime.recognizeAudioEssence,
      detectAudioPayload:runtime.detectAudioPayload,
      extractFileMetadata:runtime.extractFileMetadata,
      extractGenre:runtime.extractGenre,
      analyze:runtime.analyze,
      readCached:runtime.readCached,
      processPending:runtime.processPending,
      recordBehavior:runtime.recordBehavior,
      generateDailyMix:runtime.generateDailyMix,
      getUserModel:runtime.getUserModel,
      resolveNextTrack:runtime.resolveNextTrack,
      resolvePreviousTrack:runtime.resolvePreviousTrack,
      getVersion:()=>runtime.version||GP_SPECTRUM_ALGORITHM_VERSION
    });
  });
  GPModules.register("createRecognitionEngine",function createRecognitionEngine(runtime){
    return Object.freeze({
      recognizeAudioEssence:runtime.recognizeAudioEssence,
      detectAudioPayload:runtime.detectAudioPayload,
      extractFileMetadata:runtime.extractFileMetadata,
      extractGenre:runtime.extractGenre
    });
  });
  GPModules.register("createSpectrumAnalyzer",function createSpectrumAnalyzer(runtime){
    return Object.freeze({
      analyze:runtime.analyze,
      readCached:runtime.readCached,
      processPending:runtime.processPending,
      getVersion:()=>runtime.version
    });
  });
  GPModules.register("createSpatialEngine",function createSpatialEngine(runtime){return Object.freeze({setEnabled:runtime.setEnabled,setMode:runtime.setMode,getSnapshot:runtime.getSnapshot,destroy:runtime.destroy});});
  GPModules.register("createMotionEngine",function createMotionEngine(runtime){return Object.freeze({transitionView:runtime.transitionView,transitionSector:runtime.transitionSector,setPopover:runtime.setPopover,refresh:runtime.refresh});});
  GPModules.register("createPlaybackService",function createPlaybackService({runtime,bus,events}){
    function play(){const result=runtime.play();bus.emit(events.TRACK_STARTED,runtime.snapshot());return result;}
    function pause(){const result=runtime.pause();bus.emit(events.TRACK_PAUSED,runtime.snapshot());return result;}
    return Object.freeze({play,pause,toggle:runtime.toggle,playTrack:runtime.playTrack,next:runtime.next,previous:runtime.previous,seek:runtime.seek,setVolume:runtime.setVolume,getSnapshot:runtime.snapshot});
  });
  GPModules.register("createQueueService",function createQueueService(runtime){return Object.freeze({add:runtime.add,playNext:runtime.playNext,remove:runtime.remove,clear:runtime.clear,reorder:runtime.reorder,resolveNextTrack:runtime.resolveNextTrack,resolvePreviousTrack:runtime.resolvePreviousTrack,getVisibleQueue:runtime.getVisibleQueue,restoreLibraryOrder:runtime.restoreLibraryOrder});});
  GPModules.register("createLibraryService",function createLibraryService(runtime){return Object.freeze({pickFiles:runtime.pickFiles,pickFolder:runtime.pickFolder,importFiles:runtime.importFiles,rescan:runtime.rescan,sort:runtime.sort,search:runtime.search,getTracks:runtime.getTracks});});
  GPModules.register("createHistoryService",function createHistoryService(runtime){return Object.freeze({checkpoint:runtime.checkpoint,incrementPlayCount:runtime.incrementPlayCount,render:runtime.render,getSnapshot:runtime.getSnapshot,destroy:runtime.destroy});});
  GPModules.register("createSpectrumService",function createSpectrumService({analyzer,storage,bus,events}){async function analyze(track){try{const result=await analyzer.analyze(track);bus.emit(events.ANALYSIS_COMPLETED,{trackId:track?.id,result});return result;}catch(error){bus.emit(events.ANALYSIS_FAILED,{trackId:track?.id,error});throw error;}}return Object.freeze({analyze,readCached:analyzer.readCached,processPending:analyzer.processPending});});
  GPModules.register("createNeuralService",function createNeuralService(runtime){
    // Daily Mix uses cached acoustic features plus the offline Genre Relations graph only.
    return Object.freeze({recordBehavior:runtime.recordBehavior,generateDailyMix:runtime.generateDailyMix,getUserModel:runtime.getUserModel});
  });
  GPModules.register("createSettingsService",function createSettingsService(runtime){return Object.freeze({load:runtime.load,save:runtime.save,setTheme:runtime.setTheme,setLanguage:runtime.setLanguage,setSpatialEnabled:runtime.setSpatialEnabled,setSpatialMode:runtime.setSpatialMode,getSnapshot:runtime.getSnapshot});});
  GPModules.register("createPiPService",function createPiPService(runtime){return Object.freeze({open:runtime.open,close:runtime.close,sync:runtime.sync,destroy:runtime.destroy,getSnapshot:runtime.getSnapshot});});
  GPModules.register("createView",function createView({name,refresh}){let mounted=false;return Object.freeze({name,mount(){mounted=true;},render(snapshot){if(mounted&&refresh)refresh(snapshot);},refresh(){if(mounted&&refresh)refresh();},destroy(){mounted=false;},isMounted:()=>mounted});});
  ["Player","Library","History","Settings","Changelog","Sound"].forEach(name=>{GPModules.register(`create${name}View`,deps=>GPModules.createView({name:name.toLowerCase(),refresh:deps?.refresh}));});
  GPModules.register("createSharedControls",function createSharedControls(runtime){return Object.freeze({mount:runtime.mount,refresh:runtime.refresh,destroy:runtime.destroy});});
﻿  /* ================= init ================= */
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
    fileAdapter.restoreRememberedAudioFolder().then(autoImportDefaultFolder).catch(()=>{});
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
  const publicFacade=Object.freeze({generation:7,version:"7.6.2",architecture:"Peregrine Lake",genreRelations:GP.genreRelations,engines:Object.freeze({core:"GP Core 4.3 — Kinetic Runtime",bionic:"GP Bionic Engine 1.0 — Intelligence Core",fusion:`GP Fusion Engine ${GP_FUSION_ENGINE_VERSION} — Playlist Flow`,motion:"GP Motion Engine 4.2 — Kinetic Motion",spatial:"GP Spatial Engine 1.1 — Room",spectrum:`GP Spectrum Engine ${GP_SPECTRUM_ENGINE_VERSION} — Signal`,neural:`GP Neural Engine ${GP_NEURAL_ENGINE_VERSION} — Listening DNA`}),commands:Object.freeze({play:playbackService.play,pause:playbackService.pause,next:playbackService.next,previous:playbackService.previous,chooseDefaultMusicFolder}),selectors,getState:store.getState});
  window.GP=publicFacade;
})();

