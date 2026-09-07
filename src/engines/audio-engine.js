
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
  function ensureAudioCtx(){
    if(audioCtx) { if(audioCtx.state === "suspended") audioCtx.resume(); return; }
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
