  /* ================= GP Spatial Engine 1.1 =================
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

